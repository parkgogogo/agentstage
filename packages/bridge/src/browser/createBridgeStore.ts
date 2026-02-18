import { createStore, type StoreApi } from 'zustand/vanilla';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { CreateBridgeStoreOptions, BridgeStore } from './types.js';
import type { StoreDescription, GatewayMessage, ServerMessage } from '../shared/types.js';

const WS_PATH = '/_bridge';

function generateStoreId(pageId: string): string {
  const random = Math.random().toString(36).substring(2, 10);
  return `${pageId}#${random}`;
}

function getGatewayUrl(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${WS_PATH}?type=browser`;
}

export function createBridgeStore<
  TState,
  TActions extends Record<string, { payload?: unknown }> = Record<string, never>
>(
  options: CreateBridgeStoreOptions<TState, TActions>
): BridgeStore<TState> {
  const gatewayUrl = options.gatewayUrl;
  const storeKey = options.storeKey || 'main';
  const storeId = generateStoreId(options.pageId);

  const store = createStore<TState>((set, get) =>
    options.createState(
      (fn) => set(fn(get())),
      get
    )
  );

  const description: StoreDescription = {
    pageId: options.pageId,
    storeKey,
    schema: zodToJsonSchema(options.description.schema, { name: 'State' }),
    actions: Object.fromEntries(
      Object.entries(options.description.actions).map(([key, def]) => [
        key,
        {
          description: def.description,
          payload: def.payload
            ? zodToJsonSchema(def.payload, { name: `${key}Payload` })
            : undefined,
        },
      ])
    ),
    events: options.description.events
      ? Object.fromEntries(
          Object.entries(options.description.events).map(([key, def]) => [
            key,
            {
              description: def.description,
              payload: def.payload
                ? zodToJsonSchema(def.payload, { name: `${key}Payload` })
                : undefined,
            },
          ])
        )
      : undefined,
  };

  let ws: WebSocket | null = null;
  let version = 0;
  let isConnected = false;
  let isHydrated = false;
  let resolveHydration: (() => void) | null = null;
  let hydrationPromise: Promise<void> | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let suppressNextPublish = false;

  function send(message: GatewayMessage) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  function startHeartbeat() {
    heartbeatInterval = setInterval(() => {
      send({ type: 'store.heartbeat' });
    }, 30000);
  }

  function stopHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  function handleGatewayMessage(data: string) {
    try {
      const msg = JSON.parse(data) as ServerMessage;

      switch (msg.type) {
        case 'client.setState': {
          const { state, expectedVersion, requestId, version: targetVersion } = msg.payload;
          const canAck = typeof requestId === 'string' && requestId.length > 0;
          if (expectedVersion !== undefined && expectedVersion !== version) {
            if (canAck) {
              send({
                type: 'store.stateApplied',
                payload: {
                  storeId,
                  requestId,
                  status: 'version_mismatch',
                  version,
                },
              });
            }
            return;
          }
          try {
            suppressNextPublish = true;
            store.setState(state as TState);
            if (typeof targetVersion === 'number') {
              version = targetVersion;
            }
            if (canAck) {
              send({
                type: 'store.stateApplied',
                payload: {
                  storeId,
                  requestId,
                  status: 'applied',
                  version,
                },
              });
            }
          } catch (error) {
            if (canAck) {
              send({
                type: 'store.stateApplied',
                payload: {
                  storeId,
                  requestId,
                  status: 'failed',
                  version,
                  error: error instanceof Error ? error.message : String(error),
                },
              });
            }
          }

          // Mark as hydrated on first setState
          if (!isHydrated) {
            isHydrated = true;
            resolveHydration?.();
          }
          break;
        }

        case 'client.dispatch': {
          const { action } = msg.payload;
          const current = store.getState();
          if (typeof (current as any).dispatch === 'function') {
            (current as any).dispatch(action);
          }
          break;
        }

        case 'client.ping':
          break;
      }
    } catch (err) {
      console.error('[BridgeStore] Failed to handle message:', err);
    }
  }

  const unsubscribe = store.subscribe((state) => {
    if (suppressNextPublish) {
      suppressNextPublish = false;
      return;
    }
    version += 1;
    send({
      type: 'store.stateChanged',
      payload: {
        storeId,
        state,
        version,
        source: 'browser',
      },
    });
  });

  return {
    store,

    describes() {
      return description;
    },

    get isConnected() {
      return isConnected;
    },

    get isHydrated() {
      return isHydrated;
    },

    connect(): Promise<{ storeId: string; disconnect: () => void }> {
      return new Promise((resolve, reject) => {
        if (ws?.readyState === WebSocket.OPEN) {
          resolve({ storeId, disconnect: () => ws?.close() });
          return;
        }

        const url = gatewayUrl || getGatewayUrl();
        if (!url) {
          reject(new Error('Cannot connect: gatewayUrl not provided and window is not available'));
          return;
        }

        ws = new WebSocket(url);

        ws.onopen = () => {
          isConnected = true;

          // Create hydration promise - resolves when first client.setState arrives
          hydrationPromise = new Promise((resolveHydrationFn) => {
            resolveHydration = resolveHydrationFn;
          });

          send({
            type: 'store.register',
            payload: {
              storeId,
              pageId: options.pageId,
              storeKey,
              description,
              initialState: store.getState(),
            },
          });

          startHeartbeat();
        };

        // Wait for hydration before resolving connect()
        const checkHydration = async () => {
          if (hydrationPromise) {
            await hydrationPromise;
          }
          resolve({
            storeId,
            disconnect: () => {
              send({ type: 'store.disconnect' });
              stopHeartbeat();
              unsubscribe();
              ws?.close();
            },
          });
        };
        checkHydration();

        ws.onmessage = (event) => {
          handleGatewayMessage(event.data);
        };

        ws.onclose = () => {
          isConnected = false;
          stopHeartbeat();
        };

        ws.onerror = (err) => {
          reject(err);
        };
      });
    },
  };
}
