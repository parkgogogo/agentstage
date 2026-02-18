import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage, Server } from 'http';
import type { Http2SecureServer } from 'http2';
import type {
  Gateway,
  GatewayOptions,
  RegisteredStore,
  BrowserMessage,
  ClientMessage,
  SubscriberMessage,
  StoreId,
} from './types.js';
import type { SetStateOptions, StateAppliedPayload, ClientSetStatePayload } from '../shared/types.js';
import { StoreRegistry } from './registry.js';
import { FileStore, VersionConflictError } from './fileStore.js';
import { logger } from '../utils/logger.js';

const DEFAULT_WS_PATH = '/_bridge';
const DEFAULT_HEARTBEAT_TIMEOUT = 60000;
const DEFAULT_ACK_TIMEOUT = 3000;
const DEFAULT_ACK_RETRY_COUNT = 1;

interface PendingAck {
  storeId: StoreId;
  resolve: (payload: StateAppliedPayload) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createBridgeGateway(options: GatewayOptions = {}): Gateway {
  const wsPath = options.wsPath || DEFAULT_WS_PATH;
  const heartbeatTimeout = options.heartbeatTimeout || DEFAULT_HEARTBEAT_TIMEOUT;
  const pagesDir = options.pagesDir || process.cwd();
  const ackTimeout = options.ackTimeout ?? DEFAULT_ACK_TIMEOUT;
  const ackRetryCount = options.ackRetryCount ?? DEFAULT_ACK_RETRY_COUNT;

  const registry = new StoreRegistry();
  const fileStore = new FileStore({ pagesDir });
  const lastHeartbeat = new Map<StoreId, number>();
  const fileUnsubscribers = new Map<string, () => void>();
  const pageRefCount = new Map<string, number>();
  const wsStores = new Map<WebSocket, Set<StoreId>>();
  const pendingAcks = new Map<string, PendingAck>();
  let ackSequence = 0;

  function getStoreIdsByWs(ws: WebSocket): Set<StoreId> {
    return wsStores.get(ws) ?? new Set<StoreId>();
  }

  function trackStoreOnWs(ws: WebSocket, storeId: StoreId): void {
    if (!wsStores.has(ws)) {
      wsStores.set(ws, new Set());
    }
    wsStores.get(ws)!.add(storeId);
  }

  function untrackStoreFromWs(ws: WebSocket, storeId: StoreId): void {
    const ids = wsStores.get(ws);
    if (!ids) {
      return;
    }
    ids.delete(storeId);
    if (ids.size === 0) {
      wsStores.delete(ws);
    }
  }

  function setupFileWatcher(pageId: string): void {
    if (fileUnsubscribers.has(pageId)) {
      return;
    }

    const unsubscribe = fileStore.watch(pageId, (data) => {
      void (async () => {
        logger.debug('[Gateway] File changed, broadcasting to browsers', { pageId, version: data.version });
        const stores = registry.findByPage(pageId);
        if (stores.length === 0) {
          return;
        }

        const result = await Promise.allSettled(
          stores.map(async (store) => {
            await sendSetStateWithAck(
              store.id,
              {
                state: data.state,
                version: data.version,
              },
              { timeoutMs: ackTimeout }
            );
            store.currentState = data.state;
            store.version = data.version;
          })
        );

        for (const item of result) {
          if (item.status === 'rejected') {
            logger.error('[Gateway] Failed to apply file state to browser', {
              pageId,
              error: item.reason instanceof Error ? item.reason.message : String(item.reason),
            });
          }
        }
      })();
    });

    fileUnsubscribers.set(pageId, unsubscribe);
  }

  function retainPage(pageId: string): void {
    const next = (pageRefCount.get(pageId) ?? 0) + 1;
    pageRefCount.set(pageId, next);
    if (next === 1) {
      setupFileWatcher(pageId);
    }
  }

  function releasePage(pageId: string): void {
    const count = pageRefCount.get(pageId);
    if (!count) {
      return;
    }
    if (count <= 1) {
      pageRefCount.delete(pageId);
      const unsubscribe = fileUnsubscribers.get(pageId);
      if (unsubscribe) {
        unsubscribe();
        fileUnsubscribers.delete(pageId);
      }
      return;
    }
    pageRefCount.set(pageId, count - 1);
  }

  function rejectPendingAcksForStore(storeId: StoreId, reason: string): void {
    for (const [requestId, pending] of pendingAcks) {
      if (pending.storeId !== storeId) {
        continue;
      }
      clearTimeout(pending.timer);
      pendingAcks.delete(requestId);
      pending.reject(new Error(reason));
    }
  }

  function disconnectStore(storeId: StoreId, reason: string): void {
    const store = registry.get(storeId);
    if (!store) {
      return;
    }

    registry.disconnect(storeId, reason);
    lastHeartbeat.delete(storeId);
    untrackStoreFromWs(store.ws, storeId);
    releasePage(store.pageId);
    rejectPendingAcksForStore(storeId, `Store disconnected: ${reason}`);
  }

  function disconnectAllStoresOnWs(ws: WebSocket, reason: string): void {
    const storeIds = Array.from(getStoreIdsByWs(ws));
    for (const storeId of storeIds) {
      disconnectStore(storeId, reason);
    }
    wsStores.delete(ws);
  }

  function settleStateAppliedAck(payload: StateAppliedPayload): void {
    const pending = pendingAcks.get(payload.requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    pendingAcks.delete(payload.requestId);

    if (payload.status === 'applied') {
      pending.resolve(payload);
      return;
    }

    const detail = payload.error ? `: ${payload.error}` : '';
    pending.reject(new Error(`State apply failed (${payload.status})${detail}`));
  }

  function sendToBrowser(storeId: StoreId, message: ClientMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      const store = registry.get(storeId);
      if (!store) {
        reject(new Error(`Store not found: ${storeId}`));
        return;
      }

      if (store.ws.readyState !== WebSocket.OPEN) {
        reject(new Error(`Store not connected: ${storeId}`));
        return;
      }

      const data = JSON.stringify(message);
      logger.wsMessage('out', 'browser', data);

      store.ws.send(data, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  function waitForStateAppliedAck(
    storeId: StoreId,
    message: { type: 'client.setState'; payload: ClientSetStatePayload & { requestId: string } },
    timeoutMs: number
  ): Promise<StateAppliedPayload> {
    return new Promise<StateAppliedPayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingAcks.delete(message.payload.requestId);
        reject(new Error(`ACK timeout for ${storeId}`));
      }, timeoutMs);

      pendingAcks.set(message.payload.requestId, {
        storeId,
        resolve,
        reject,
        timer,
      });

      sendToBrowser(storeId, message).catch((error) => {
        clearTimeout(timer);
        pendingAcks.delete(message.payload.requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  async function sendSetStateWithAck(
    storeId: StoreId,
    payload: ClientSetStatePayload,
    options: { timeoutMs?: number } = {}
  ): Promise<StateAppliedPayload> {
    const timeoutMs = options.timeoutMs ?? ackTimeout;
    const maxAttempts = ackRetryCount + 1;

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const requestId = `${storeId}:${Date.now()}:${++ackSequence}`;
      const message: { type: 'client.setState'; payload: ClientSetStatePayload & { requestId: string } } = {
        type: 'client.setState',
        payload: {
          ...payload,
          storeId,
          requestId,
        },
      };

      try {
        return await waitForStateAppliedAck(storeId, message, timeoutMs);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxAttempts) {
          logger.warn('[Gateway] setState ACK timeout, retrying', { storeId, attempt, maxAttempts });
        }
      }
    }

    throw lastError ?? new Error(`Failed to apply state for ${storeId}`);
  }

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, last] of lastHeartbeat) {
      if (now - last > heartbeatTimeout) {
        logger.info('[Gateway] Store timed out', { storeId: id });
        disconnectStore(id, 'timeout');
      }
    }
    registry.cleanup();
  }, 30000);

  logger.info('[Gateway] Created new gateway instance', { pagesDir });

  function handleBrowserMessage(ws: WebSocket, data: string): void {
    logger.wsMessage('in', 'browser', data);
    try {
      const msg = JSON.parse(data) as BrowserMessage;

      switch (msg.type) {
        case 'store.register': {
          const { storeId, pageId, storeKey, description, initialState } = msg.payload;

          void fileStore.load(pageId).then(async (fileData) => {
            const existing = registry.findStoreByKey(pageId, storeKey);
            if (existing) {
              disconnectStore(existing.id, 'replaced');
            }

            const stateToUse = fileData ? fileData.state : initialState;
            const versionToUse = fileData ? fileData.version : 0;

            const store: RegisteredStore = {
              id: storeId,
              pageId,
              storeKey,
              description,
              currentState: stateToUse,
              version: versionToUse,
              ws,
              subscribers: new Set(),
              connectedAt: new Date(),
              lastActivity: new Date(),
            };

            registry.register(store);
            lastHeartbeat.set(storeId, Date.now());
            trackStoreOnWs(ws, storeId);
            retainPage(pageId);

            try {
              await sendSetStateWithAck(storeId, {
                state: stateToUse,
                version: versionToUse,
              });
            } catch (error) {
              logger.error('[Gateway] Failed to hydrate browser store', {
                storeId,
                error: error instanceof Error ? error.message : String(error),
              });
            }

            logger.info('[Gateway] Store registered', { storeId, pageId, storeKey });
          });
          break;
        }

        case 'store.stateChanged': {
          const { storeId, state, version } = msg.payload;
          const store = registry.get(storeId);
          if (!store) {
            logger.warn('[Gateway] State change for unknown store', { storeId });
            break;
          }

          const expectedVersion = typeof version === 'number' ? Math.max(version - 1, 0) : undefined;

          void fileStore
            .save(
              store.pageId,
              {
                state,
                version: store.version,
                updatedAt: new Date().toISOString(),
                pageId: store.pageId,
              },
              expectedVersion
            )
            .then((saved) => {
              registry.updateState(storeId, state, saved.version);
              store.lastActivity = new Date();

              const notification: SubscriberMessage = {
                type: 'store.stateChanged',
                payload: {
                  storeId,
                  state,
                  version: saved.version,
                  source: 'browser',
                },
              };

              for (const sub of store.subscribers) {
                if (sub.readyState === WebSocket.OPEN) {
                  sub.send(JSON.stringify(notification));
                }
              }
            })
            .catch(async (error) => {
              if (error instanceof VersionConflictError) {
                logger.warn('[Gateway] Version conflict from browser update', {
                  storeId,
                  expectedVersion: error.expectedVersion,
                  actualVersion: error.actualVersion,
                });
                const latest = await fileStore.load(store.pageId);
                if (latest) {
                  try {
                    await sendSetStateWithAck(storeId, {
                      state: latest.state,
                      version: latest.version,
                    });
                  } catch (ackError) {
                    logger.error('[Gateway] Failed to reconcile browser after conflict', {
                      storeId,
                      error: ackError instanceof Error ? ackError.message : String(ackError),
                    });
                  }
                }
                return;
              }

              logger.error('[Gateway] Failed to save state to file', {
                storeId,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          break;
        }

        case 'store.stateApplied': {
          settleStateAppliedAck(msg.payload);
          const store = registry.get(msg.payload.storeId);
          if (store) {
            store.lastActivity = new Date();
            lastHeartbeat.set(store.id, Date.now());
          }
          break;
        }

        case 'store.heartbeat': {
          const now = Date.now();
          for (const storeId of getStoreIdsByWs(ws)) {
            const store = registry.get(storeId);
            if (!store) {
              continue;
            }
            lastHeartbeat.set(storeId, now);
            store.lastActivity = new Date(now);
          }
          break;
        }

        case 'store.disconnect': {
          disconnectAllStoresOnWs(ws, 'client_disconnect');
          break;
        }
      }
    } catch (err) {
      logger.error('[Gateway] Failed to handle browser message', err);
    }
  }

  function handleClientMessage(ws: WebSocket, data: string): void {
    logger.wsMessage('in', 'client', data);

    try {
      const msg = JSON.parse(data);

      if (typeof msg?.id === 'number' && typeof msg?.method === 'string') {
        const id: number = msg.id;
        const method: string = msg.method;
        const params: unknown = msg.params;

        void (async () => {
          try {
            switch (method) {
              case 'listStores': {
                ws.send(JSON.stringify({ id, result: gateway.listStores() }));
                return;
              }

              case 'findStoreByKey': {
                const p = params as { pageId?: unknown; storeKey?: unknown } | null;
                const pageId = p?.pageId;
                const storeKey = p?.storeKey;
                if (typeof pageId !== 'string' || typeof storeKey !== 'string') {
                  throw new Error('Invalid params: pageId and storeKey are required');
                }
                const found = gateway.findStoreByKey(pageId, storeKey);
                ws.send(
                  JSON.stringify({
                    id,
                    result: found
                      ? {
                          id: found.id,
                          pageId: found.pageId,
                          storeKey: found.storeKey,
                          version: found.version,
                          connectedAt: found.connectedAt,
                        }
                      : null,
                  })
                );
                return;
              }

              case 'describe': {
                const storeId = (params as { storeId?: unknown } | null)?.storeId;
                if (typeof storeId !== 'string') {
                  throw new Error('Invalid params: storeId');
                }
                const description = gateway.getDescription(storeId) ?? null;
                ws.send(JSON.stringify({ id, result: description }));
                return;
              }

              case 'getState': {
                const p = params as { pageId?: unknown; storeKey?: unknown; storeId?: unknown } | null;
                const pageId = p?.pageId as string | undefined;
                const storeKey = p?.storeKey as string | undefined;
                const storeId = p?.storeId as string | undefined;

                if (pageId) {
                  const key = storeKey ?? 'main';
                  const activeStore = gateway.findStoreByKey(pageId, key);
                  if (activeStore) {
                    ws.send(
                      JSON.stringify({
                        id,
                        result: { state: activeStore.currentState, version: activeStore.version },
                      })
                    );
                    return;
                  }

                  if (key !== 'main') {
                    ws.send(JSON.stringify({ id, result: null }));
                    return;
                  }

                  const fileData = await fileStore.load(pageId);
                  ws.send(
                    JSON.stringify({
                      id,
                      result: fileData ? { state: fileData.state, version: fileData.version } : null,
                    })
                  );
                  return;
                }

                if (storeId) {
                  ws.send(JSON.stringify({ id, result: gateway.getState(storeId) ?? null }));
                  return;
                }

                throw new Error('Invalid params: need pageId or storeId');
              }

              case 'setState': {
                const p = params as {
                  pageId?: unknown;
                  storeKey?: unknown;
                  storeId?: unknown;
                  state?: unknown;
                  expectedVersion?: unknown;
                  waitForAck?: unknown;
                  timeoutMs?: unknown;
                } | null;
                const pageId = p?.pageId as string | undefined;
                const storeKey = p?.storeKey as string | undefined;
                const storeId = p?.storeId as string | undefined;
                const state = p?.state;
                const options: SetStateOptions = {
                  expectedVersion: typeof p?.expectedVersion === 'number' ? p.expectedVersion : undefined,
                  waitForAck: p?.waitForAck === true,
                  timeoutMs: typeof p?.timeoutMs === 'number' ? p.timeoutMs : undefined,
                };

                if (pageId) {
                  const saved = await fileStore.save(
                    pageId,
                    {
                      state,
                      version: 0,
                      updatedAt: new Date().toISOString(),
                      pageId,
                    },
                    options.expectedVersion
                  );

                  const targets = storeKey
                    ? [registry.findStoreByKey(pageId, storeKey)].filter(
                        (store): store is RegisteredStore => Boolean(store)
                      )
                    : registry.findByPage(pageId);

                  if (options.waitForAck && targets.length === 0) {
                    throw new Error(`No connected browser for ${pageId}${storeKey ? `:${storeKey}` : ''}`);
                  }

                  for (const store of targets) {
                    store.currentState = state;
                    store.version = saved.version;

                    if (options.waitForAck) {
                      await sendSetStateWithAck(
                        store.id,
                        {
                          state,
                          version: saved.version,
                        },
                        { timeoutMs: options.timeoutMs }
                      );
                    } else {
                      void sendSetStateWithAck(
                        store.id,
                        {
                          state,
                          version: saved.version,
                        },
                        { timeoutMs: options.timeoutMs }
                      ).catch((error) => {
                        logger.error('[Gateway] Failed to deliver setState', {
                          storeId: store.id,
                          error: error instanceof Error ? error.message : String(error),
                        });
                      });
                    }
                  }

                  ws.send(JSON.stringify({ id, result: { version: saved.version } }));
                  return;
                }

                if (storeId) {
                  await gateway.setState(storeId, state, options);
                  ws.send(JSON.stringify({ id, result: null }));
                  return;
                }

                throw new Error('Invalid params: need pageId or storeId');
              }

              case 'dispatch': {
                const p = params as { storeId?: unknown; action?: unknown } | null;
                const storeId = p?.storeId;
                if (typeof storeId !== 'string') {
                  throw new Error('Invalid params: storeId');
                }
                const action = p?.action as { type?: unknown; payload?: unknown } | undefined;
                if (!action || typeof action.type !== 'string') {
                  throw new Error('Invalid params: action');
                }
                await gateway.dispatch(storeId, { type: action.type, payload: action.payload });
                ws.send(JSON.stringify({ id, result: null }));
                return;
              }

              default:
                throw new Error(`Unknown method: ${method}`);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ws.send(JSON.stringify({ id, error: { message } }));
          }
        })();

        return;
      }

      if (msg.type === 'subscribe' && msg.payload?.storeId) {
        try {
          const unsubscribe = registry.addSubscriber(msg.payload.storeId, ws);
          (ws as unknown as { _unsubscribe: () => void })._unsubscribe = unsubscribe;
          ws.send(JSON.stringify({ type: 'subscribed', payload: { storeId: msg.payload.storeId } }));
        } catch (err) {
          logger.error('[Gateway] Failed to subscribe client to store', { storeId: msg.payload.storeId, error: err instanceof Error ? err.message : String(err) });
        }
      }

      if (msg.type === 'unsubscribe' && msg.payload?.storeId) {
        const store = registry.get(msg.payload.storeId);
        if (store) {
          store.subscribers.delete(ws);
        }
      }
    } catch (err) {
      logger.error('[Gateway] Failed to handle client message', err);
    }
  }

  const gateway: Gateway = {
    get stores() {
      return registry.list().reduce((map, store) => {
        map.set(store.id, store);
        return map;
      }, new Map<StoreId, RegisteredStore>());
    },

    listStores() {
      return registry.list().map((s) => ({
        id: s.id,
        pageId: s.pageId,
        storeKey: s.storeKey,
        version: s.version,
        connectedAt: s.connectedAt,
      }));
    },

    getStore(id: StoreId) {
      return registry.get(id);
    },

    findStore(pageId, storeKey) {
      return registry.find(pageId, storeKey);
    },

    findStoreByKey(pageId, storeKey) {
      return registry.findStoreByKey(pageId, storeKey);
    },

    getDescription(id: StoreId) {
      return registry.get(id)?.description;
    },

    getState(id: StoreId) {
      const store = registry.get(id);
      if (!store) {
        return undefined;
      }
      return { state: store.currentState, version: store.version };
    },

    async setState(id, state, options = {}) {
      const store = registry.get(id);
      if (!store) {
        throw new Error(`Store not found: ${id}`);
      }

      const saved = await fileStore.save(
        store.pageId,
        {
          state,
          version: store.version,
          updatedAt: new Date().toISOString(),
          pageId: store.pageId,
        },
        options.expectedVersion
      );

      registry.updateState(id, state, saved.version);
      await sendSetStateWithAck(
        id,
        {
          state,
          version: saved.version,
        },
        { timeoutMs: options.timeoutMs }
      );
    },

    async dispatch(id, action) {
      const store = registry.get(id);
      if (!store) {
        throw new Error(`Store not found: ${id}`);
      }

      await sendToBrowser(id, {
        type: 'client.dispatch',
        payload: { action },
      });
    },

    subscribe(id, ws, callback) {
      const unsubscribe = registry.addSubscriber(id, ws);

      if (callback) {
        const handler = registry.onChange((event) => {
          if (event.storeId === id) {
            callback(event);
          }
        });

        return () => {
          unsubscribe();
          handler();
        };
      }

      return unsubscribe;
    },

    attach(server: Server | Http2SecureServer) {
      const wss = new WebSocketServer({ noServer: true });
      const httpServer = server as Server;

      httpServer.prependListener('upgrade', (request, socket, head) => {
        const pathname = request.url?.split('?')[0] || '/';
        if (pathname !== wsPath) {
          return;
        }

        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      });

      wss.on('connection', (ws, req: IncomingMessage) => {
        let clientType: 'browser' | 'client' | 'unknown' = 'unknown';

        logger.info('[Gateway] New WebSocket connection', { ip: req.socket.remoteAddress, url: req.url });

        ws.on('message', (data) => {
          const str = data.toString('utf8');

          if (clientType === 'unknown') {
            try {
              const msg = JSON.parse(str);
              if (msg.type?.startsWith('store.')) {
                clientType = 'browser';
              } else if (msg.id !== undefined && msg.method) {
                clientType = 'client';
              } else if (msg.type === 'subscribe' || msg.type === 'unsubscribe') {
                clientType = 'client';
              }
            } catch {
              // Ignore malformed data.
            }
          }

          if (clientType === 'browser') {
            handleBrowserMessage(ws, str);
          } else {
            handleClientMessage(ws, str);
          }
        });

        ws.on('close', () => {
          disconnectAllStoresOnWs(ws, 'connection_closed');
          const unsubscribe = (ws as unknown as { _unsubscribe?: () => void })._unsubscribe;
          if (unsubscribe) {
            unsubscribe();
          }
        });

        ws.on('error', (err) => {
          logger.error('[Gateway] WebSocket error', err);
        });
      });

      return wss;
    },

    destroy() {
      clearInterval(cleanupInterval);
      for (const store of registry.list()) {
        disconnectStore(store.id, 'server_shutdown');
      }
      for (const pending of pendingAcks.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Gateway destroyed'));
      }
      pendingAcks.clear();
      for (const unsubscribe of fileUnsubscribers.values()) {
        unsubscribe();
      }
      fileUnsubscribers.clear();
      pageRefCount.clear();
      wsStores.clear();
      fileStore.destroy();
    },
  };

  return gateway;
}
