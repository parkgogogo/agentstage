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
  StoreId
} from './types.js';
import { StoreRegistry } from './registry.js';
import { FileStore } from './fileStore.js';
import { logger } from '../utils/logger.js';

const DEFAULT_WS_PATH = '/_bridge';
const DEFAULT_HEARTBEAT_TIMEOUT = 60000;

export function createBridgeGateway(options: GatewayOptions = {}): Gateway {
  const wsPath = options.wsPath || DEFAULT_WS_PATH;
  const heartbeatTimeout = options.heartbeatTimeout || DEFAULT_HEARTBEAT_TIMEOUT;
  const pagesDir = options.pagesDir || process.cwd();

  const registry = new StoreRegistry();
  const fileStore = new FileStore({ pagesDir });
  const lastHeartbeat = new Map<StoreId, number>();
  const fileUnsubscribers = new Map<string, () => void>();

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, last] of lastHeartbeat) {
      if (now - last > heartbeatTimeout) {
        logger.info(`[Gateway] Store ${id} timed out`);
        registry.disconnect(id, 'timeout');
        lastHeartbeat.delete(id);
      }
    }
    registry.cleanup();
  }, 30000);

  logger.info('[Gateway] Created new gateway instance', { pagesDir });

  // Helper function to register a store (used by server route)
  function registerStore(store: RegisteredStore): void {
    registry.register(store);
  }

  // Setup file watcher for a page - broadcasts file changes to all connected browsers
  function setupFileWatcher(pageId: string): void {
    // Clean up existing watcher
    const existing = fileUnsubscribers.get(pageId);
    if (existing) {
      existing();
      fileUnsubscribers.delete(pageId);
    }

    const unsubscribe = fileStore.watch(pageId, (data) => {
      logger.debug('[Gateway] File changed, broadcasting to browsers', { pageId, version: data.version });
      
      // Broadcast to all connected browsers for this page
      const stores = registry.list().filter(s => s.pageId === pageId);
      for (const store of stores) {
        const notification: SubscriberMessage = {
          type: 'store.stateChanged',
          payload: {
            storeId: store.id,
            state: data.state,
            version: data.version,
            source: 'file',
          },
        };

        // Send to browser
        if (store.ws.readyState === WebSocket.OPEN) {
          store.ws.send(JSON.stringify(notification));
        }

        // Send to subscribers
        for (const sub of store.subscribers) {
          if (sub.readyState === WebSocket.OPEN) {
            sub.send(JSON.stringify(notification));
          }
        }

        // Update registry state
        store.currentState = data.state;
        store.version = data.version;
      }
    });

    fileUnsubscribers.set(pageId, unsubscribe);
  }

  function handleBrowserMessage(ws: WebSocket, data: string): void {
    logger.wsMessage('in', 'browser', data);
    try {
      const msg = JSON.parse(data) as BrowserMessage;
      logger.debug('[Gateway] Browser message received', { type: msg.type });

      switch (msg.type) {
        case 'store.register': {
          const { storeId, pageId, storeKey, description, initialState } = msg.payload;

          // Try to load existing state from file
          fileStore.load(pageId).then((fileData) => {
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

            // Send initial state to browser (from file or browser's initial)
            logger.info(`[Gateway] Sending initial state to ${storeId}`, { fromFile: !!fileData });
            sendToBrowser(storeId, {
              type: 'client.setState',
              payload: { state: stateToUse, expectedVersion: undefined },
            }).catch(err => {
              logger.error('[Gateway] Failed to send initial state', { storeId, error: err.message });
            });

            // Setup file watcher for this page
            setupFileWatcher(pageId);

            logger.info(`[Gateway] Store registered: ${storeId} (${pageId}:${storeKey})`);
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

          // Save to file first (source of truth)
          fileStore.save(store.pageId, {
            state,
            version,
            updatedAt: new Date().toISOString(),
            pageId: store.pageId,
          }).then(() => {
            logger.debug('[Gateway] State saved to file', { storeId, pageId: store.pageId, version });
          }).catch(err => {
            logger.error('[Gateway] Failed to save state to file', { storeId, error: err.message });
          });

          // Update registry
          registry.updateState(storeId, state, version);
          store.lastActivity = new Date();

          // Broadcast to subscribers
          const notification: SubscriberMessage = {
            type: 'store.stateChanged',
            payload: {
              storeId,
              state,
              version,
              source: 'browser',
            },
          };

          for (const sub of store.subscribers) {
            if (sub.readyState === WebSocket.OPEN) {
              sub.send(JSON.stringify(notification));
            }
          }
          break;
        }

        case 'store.heartbeat': {
          for (const store of registry.list()) {
            if (store.ws === ws) {
              lastHeartbeat.set(store.id, Date.now());
              store.lastActivity = new Date();
              break;
            }
          }
          break;
        }

        case 'store.disconnect': {
          for (const store of registry.list()) {
            if (store.ws === ws) {
              registry.disconnect(store.id, 'client_disconnect');
              lastHeartbeat.delete(store.id);
              break;
            }
          }
          break;
        }
      }
    } catch (err) {
      console.error('[Gateway] Failed to handle browser message:', err);
    }
  }

  function handleClientMessage(ws: WebSocket, data: string): void {
    logger.wsMessage('in', 'client', data);
    try {
      const msg = JSON.parse(data);
      logger.debug('[Gateway] Client message received', { msg });

      // JSON-RPC style requests from SDK/CLI
      if (typeof msg?.id === 'number' && typeof msg?.method === 'string') {
        const id: number = msg.id;
        const method: string = msg.method;
        const params: unknown = msg.params;

        logger.debug('[Gateway] JSON-RPC request', { id, method, params });

        (async () => {
          try {
            switch (method) {
              case 'listStores': {
                logger.debug('[Gateway] listStores called');
                const result = gateway.listStores();
                logger.debug('[Gateway] listStores result', { count: result.length });
                ws.send(JSON.stringify({ id, result }));
                return;
              }

              case 'describe': {
                const storeId = (params as { storeId?: unknown } | null)?.storeId;
                if (typeof storeId !== 'string') throw new Error('Invalid params: storeId');
                logger.debug('[Gateway] describe called', { storeId });
                const description = gateway.getDescription(storeId) ?? null;
                ws.send(JSON.stringify({ id, result: description }));
                return;
              }

              case 'getState': {
                const p = params as { pageId?: unknown; storeId?: unknown } | null;
                // Support both pageId (new) and storeId (legacy)
                const pageId = p?.pageId as string | undefined;
                const storeId = p?.storeId as string | undefined;
                
                logger.debug('[Gateway] getState called', { pageId, storeId });
                
                if (pageId) {
                  // New: get state directly from file
                  const fileData = await fileStore.load(pageId);
                  ws.send(JSON.stringify({ id, result: fileData }));
                  return;
                }
                
                if (storeId) {
                  // Legacy: get state from registry
                  const state = gateway.getState(storeId) ?? null;
                  ws.send(JSON.stringify({ id, result: state }));
                  return;
                }
                
                throw new Error('Invalid params: need pageId or storeId');
              }

              case 'setState': {
                const p = params as { pageId?: unknown; storeId?: unknown; state?: unknown; expectedVersion?: unknown } | null;
                const pageId = p?.pageId as string | undefined;
                const storeId = p?.storeId as string | undefined;
                const state = p?.state;
                
                if (pageId) {
                  // New: write directly to file
                  logger.info('[Gateway] setState (file) called', { pageId });
                  const existing = await fileStore.load(pageId);
                  const newVersion = existing ? existing.version + 1 : 1;
                  
                  await fileStore.save(pageId, {
                    state,
                    version: newVersion,
                    updatedAt: new Date().toISOString(),
                    pageId,
                  });
                  
                  // Notify connected browsers
                  const stores = registry.list().filter(s => s.pageId === pageId);
                  for (const store of stores) {
                    sendToBrowser(store.id, {
                      type: 'client.setState',
                      payload: { state, expectedVersion: typeof p?.expectedVersion === 'number' ? p.expectedVersion : undefined },
                    }).catch(() => {});
                  }
                  
                  ws.send(JSON.stringify({ id, result: { version: newVersion } }));
                  logger.info('[Gateway] setState (file) completed', { pageId, version: newVersion });
                  return;
                }
                
                if (storeId) {
                  // Legacy: use browser-based store
                  logger.info('[Gateway] setState called', { storeId });
                  await gateway.setState(storeId, state, {
                    expectedVersion: typeof p?.expectedVersion === 'number' ? p.expectedVersion : undefined,
                  });
                  ws.send(JSON.stringify({ id, result: null }));
                  logger.info('[Gateway] setState completed', { storeId });
                  return;
                }
                
                throw new Error('Invalid params: need pageId or storeId');
              }

              case 'dispatch': {
                const p = params as { storeId?: unknown; action?: unknown } | null;
                const storeId = p?.storeId;
                if (typeof storeId !== 'string') throw new Error('Invalid params: storeId');
                const action = p?.action as { type?: unknown; payload?: unknown } | undefined;
                if (!action || typeof action.type !== 'string') throw new Error('Invalid params: action');
                logger.info('[Gateway] dispatch called', { storeId, action });
                await gateway.dispatch(storeId, { type: action.type, payload: action.payload });
                ws.send(JSON.stringify({ id, result: null }));
                logger.info('[Gateway] dispatch completed', { storeId });
                return;
              }

              default:
                throw new Error(`Unknown method: ${method}`);
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error('[Gateway] JSON-RPC error', { id, message });
            ws.send(JSON.stringify({ id, error: { message } }));
          }
        })();

        return;
      }

      if (msg.type === 'subscribe' && msg.payload?.storeId) {
        logger.debug('[Gateway] Subscribe request', { storeId: msg.payload.storeId });
        const unsubscribe = registry.addSubscriber(msg.payload.storeId, ws);
        (ws as unknown as { _unsubscribe: () => void })._unsubscribe = unsubscribe;

        ws.send(JSON.stringify({
          type: 'subscribed',
          payload: { storeId: msg.payload.storeId },
        }));
      }

      if (msg.type === 'unsubscribe' && msg.payload?.storeId) {
        logger.debug('[Gateway] Unsubscribe request', { storeId: msg.payload.storeId });
        const store = registry.get(msg.payload.storeId);
        if (store) {
          store.subscribers.delete(ws);
        }
      }
    } catch (err) {
      logger.error('[Gateway] Failed to handle client message:', err);
    }
  }

  function sendToBrowser(storeId: StoreId, message: ClientMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      const store = registry.get(storeId);
      logger.debug('[Gateway] sendToBrowser', { storeId, messageType: message.type, storeExists: !!store });

      if (!store) {
        logger.error('[Gateway] Store not found', { storeId });
        reject(new Error(`Store not found: ${storeId}`));
        return;
      }

      if (store.ws.readyState !== WebSocket.OPEN) {
        logger.error('[Gateway] Store WebSocket not open', { storeId, readyState: store.ws.readyState });
        reject(new Error(`Store not connected: ${storeId}`));
        return;
      }

      const data = JSON.stringify(message);
      logger.wsMessage('out', 'browser', data);

      store.ws.send(data, (err) => {
        if (err) {
          logger.error('[Gateway] Failed to send to browser', { storeId, error: err.message });
          reject(err);
        } else {
          logger.debug('[Gateway] Message sent to browser', { storeId, messageType: message.type });
          resolve();
        }
      });
    });
  }

  const gateway: Gateway = {
    get stores() {
      return registry.list().reduce((map, store) => {
        map.set(store.id, store);
        return map;
      }, new Map<StoreId, RegisteredStore>());
    },

    listStores() {
      const stores = registry.list();
      logger.info('[Gateway] listStores called, returning:', { count: stores.length, stores: stores.map(s => ({ id: s.id, pageId: s.pageId })) });
      return stores.map(s => ({
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

    getDescription(id: StoreId) {
      return registry.get(id)?.description;
    },

    getState(id: StoreId) {
      const store = registry.get(id);
      if (!store) return undefined;
      return { state: store.currentState, version: store.version };
    },

    async setState(id, state, options = {}) {
      const store = registry.get(id);
      if (!store) throw new Error(`Store not found: ${id}`);

      await sendToBrowser(id, {
        type: 'client.setState',
        payload: { state, expectedVersion: options.expectedVersion },
      });
    },

    async dispatch(id, action) {
      const store = registry.get(id);
      if (!store) throw new Error(`Store not found: ${id}`);

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
      // 使用 noServer: true 避免干扰 HTTP server 的 upgrade 事件
      // 手动监听 upgrade 事件，只处理 /_bridge 路径
      const wss = new WebSocketServer({ noServer: true });

      const httpServer = server as Server;

      logger.info('[Gateway] Attaching to HTTP server', { wsPath });

      // 添加我们的 upgrade 处理器（使用 prependListener 确保先处理）
      httpServer.prependListener('upgrade', (request, socket, head) => {
        const pathname = request.url?.split('?')[0] || '/';

        if (pathname === wsPath) {
          logger.debug('[Gateway] Handling WebSocket upgrade', { url: request.url });
          // 处理 /_bridge 路径的 WebSocket 连接
          wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
          });
          // 不再传递此事件给其他监听器
          return;
        }
        // 其他路径让其他监听器处理
      });

    wss.on('connection', (ws, req: IncomingMessage) => {
      // Client type detection: we'll determine based on the first message
      // Browser sends: store.register, store.stateChanged, store.heartbeat
      // Client (CLI/SDK) sends: JSON-RPC requests or subscribe/unsubscribe
      let clientType: 'browser' | 'client' | 'unknown' = 'unknown';

      logger.info(`[Gateway] New WebSocket connection`, { ip: req.socket.remoteAddress, url: req.url });

      ws.on('message', (data) => {
        const str = data.toString('utf8');

        // Auto-detect client type on first message if unknown
        if (clientType === 'unknown') {
          try {
            const msg = JSON.parse(str);
            if (msg.type?.startsWith('store.')) {
              clientType = 'browser';
              logger.info(`[Gateway] Auto-detected client as browser (message type: ${msg.type})`);
            } else if (msg.id !== undefined && msg.method) {
              clientType = 'client';
              logger.info(`[Gateway] Auto-detected client as SDK/CLI (method: ${msg.method})`);
            } else if (msg.type === 'subscribe' || msg.type === 'unsubscribe') {
              clientType = 'client';
              logger.info(`[Gateway] Auto-detected client as SDK/CLI (type: ${msg.type})`);
            }
          } catch {
            // Not JSON, treat as unknown
          }
        }

        if (clientType === 'browser') {
          handleBrowserMessage(ws, str);
        } else {
          handleClientMessage(ws, str);
        }
      });

      ws.on('close', () => {
        logger.info(`[Gateway] Connection closed`, { clientType });
        for (const store of registry.list()) {
          if (store.ws === ws) {
            logger.info(`[Gateway] Store disconnected`, { storeId: store.id });
            registry.disconnect(store.id, 'connection_closed');
            lastHeartbeat.delete(store.id);
            break;
          }
        }

        const unsubscribe = (ws as unknown as { _unsubscribe?: () => void })._unsubscribe;
        if (unsubscribe) {
          unsubscribe();
        }
      });

      ws.on('error', (err) => {
        logger.error('[Gateway] WebSocket error:', err);
      });
    });

      return wss;
    },

    destroy() {
      clearInterval(cleanupInterval);
      for (const store of registry.list()) {
        registry.disconnect(store.id, 'server_shutdown');
      }
      // Clean up file watchers
      for (const unsubscribe of fileUnsubscribers.values()) {
        unsubscribe();
      }
      fileUnsubscribers.clear();
      fileStore.destroy();
    },
  };

  return gateway;
}
