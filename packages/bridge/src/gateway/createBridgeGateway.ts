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

const DEFAULT_WS_PATH = '/_bridge';
const DEFAULT_HEARTBEAT_TIMEOUT = 60000;

export function createBridgeGateway(options: GatewayOptions = {}): Gateway {
  const wsPath = options.wsPath || DEFAULT_WS_PATH;
  const heartbeatTimeout = options.heartbeatTimeout || DEFAULT_HEARTBEAT_TIMEOUT;

  const registry = new StoreRegistry();
  const lastHeartbeat = new Map<StoreId, number>();

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, last] of lastHeartbeat) {
      if (now - last > heartbeatTimeout) {
        console.log(`[Gateway] Store ${id} timed out`);
        registry.disconnect(id, 'timeout');
        lastHeartbeat.delete(id);
      }
    }
    registry.cleanup();
  }, 30000);

  // Helper function to register a store (used by server route)
  function registerStore(store: RegisteredStore): void {
    registry.register(store);
  }

  function handleBrowserMessage(ws: WebSocket, data: string): void {
    try {
      const msg = JSON.parse(data) as BrowserMessage;

      switch (msg.type) {
        case 'store.register': {
          const { storeId, pageId, storeKey, description, initialState } = msg.payload;

          const store: RegisteredStore = {
            id: storeId,
            pageId,
            storeKey,
            description,
            currentState: initialState,
            version: 0,
            ws,
            subscribers: new Set(),
            connectedAt: new Date(),
            lastActivity: new Date(),
          };

          registry.register(store);
          lastHeartbeat.set(storeId, Date.now());

          console.log(`[Gateway] Store registered: ${storeId} (${pageId}:${storeKey})`);
          break;
        }

        case 'store.stateChanged': {
          const { storeId, state, version } = msg.payload;
          registry.updateState(storeId, state, version);

          const store = registry.get(storeId);
          if (store) {
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
    try {
      const msg = JSON.parse(data);

      // JSON-RPC style requests from SDK/CLI
      if (typeof msg?.id === 'number' && typeof msg?.method === 'string') {
        const id: number = msg.id;
        const method: string = msg.method;
        const params: unknown = msg.params;

        (async () => {
          try {
            switch (method) {
              case 'listStores': {
                ws.send(JSON.stringify({ id, result: gateway.listStores() }));
                return;
              }

              case 'describe': {
                const storeId = (params as { storeId?: unknown } | null)?.storeId;
                if (typeof storeId !== 'string') throw new Error('Invalid params: storeId');
                const description = gateway.getDescription(storeId) ?? null;
                ws.send(JSON.stringify({ id, result: description }));
                return;
              }

              case 'getState': {
                const storeId = (params as { storeId?: unknown } | null)?.storeId;
                if (typeof storeId !== 'string') throw new Error('Invalid params: storeId');
                const state = gateway.getState(storeId) ?? null;
                ws.send(JSON.stringify({ id, result: state }));
                return;
              }

              case 'setState': {
                const p = params as { storeId?: unknown; state?: unknown; expectedVersion?: unknown } | null;
                const storeId = p?.storeId;
                if (typeof storeId !== 'string') throw new Error('Invalid params: storeId');
                await gateway.setState(storeId, p?.state, {
                  expectedVersion: typeof p?.expectedVersion === 'number' ? p.expectedVersion : undefined,
                });
                ws.send(JSON.stringify({ id, result: null }));
                return;
              }

              case 'dispatch': {
                const p = params as { storeId?: unknown; action?: unknown } | null;
                const storeId = p?.storeId;
                if (typeof storeId !== 'string') throw new Error('Invalid params: storeId');
                const action = p?.action as { type?: unknown; payload?: unknown } | undefined;
                if (!action || typeof action.type !== 'string') throw new Error('Invalid params: action');
                await gateway.dispatch(storeId, { type: action.type, payload: action.payload });
                ws.send(JSON.stringify({ id, result: null }));
                return;
              }

              default:
                throw new Error(`Unknown method: ${method}`);
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            ws.send(JSON.stringify({ id, error: { message } }));
          }
        })();

        return;
      }

      if (msg.type === 'subscribe' && msg.payload?.storeId) {
        const unsubscribe = registry.addSubscriber(msg.payload.storeId, ws);
        (ws as unknown as { _unsubscribe: () => void })._unsubscribe = unsubscribe;

        ws.send(JSON.stringify({
          type: 'subscribed',
          payload: { storeId: msg.payload.storeId },
        }));
      }

      if (msg.type === 'unsubscribe' && msg.payload?.storeId) {
        const store = registry.get(msg.payload.storeId);
        if (store) {
          store.subscribers.delete(ws);
        }
      }
    } catch (err) {
      console.error('[Gateway] Failed to handle client message:', err);
    }
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

      store.ws.send(JSON.stringify(message), (err) => {
        if (err) reject(err);
        else resolve();
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
      return registry.list().map(s => ({
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

      // 添加我们的 upgrade 处理器（使用 prependListener 确保先处理）
      httpServer.prependListener('upgrade', (request, socket, head) => {
        const pathname = request.url?.split('?')[0] || '/';

        if (pathname === wsPath) {
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
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const clientType = url.searchParams.get('type') || 'unknown';

      console.log(`[Gateway] Connection from ${clientType}: ${req.socket.remoteAddress}`);

      ws.on('message', (data) => {
        const str = data.toString('utf8');

        if (clientType === 'browser') {
          handleBrowserMessage(ws, str);
        } else {
          handleClientMessage(ws, str);
        }
      });

      ws.on('close', () => {
        for (const store of registry.list()) {
          if (store.ws === ws) {
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
        console.error('[Gateway] WebSocket error:', err);
      });
    });

      return wss;
    },

    destroy() {
      clearInterval(cleanupInterval);
      for (const store of registry.list()) {
        registry.disconnect(store.id, 'server_shutdown');
      }
    },
  };

  return gateway;
}
