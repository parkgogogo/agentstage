import WebSocket from 'ws';
import type { BridgeEvent, SetStateOptions, StateSnapshot, StoreDescription, StoreSummary } from '../shared/types.js';

export type { BridgeEvent, StoreDescription, StoreSummary, StateSnapshot };

export class BridgeClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private eventHandlers = new Set<(event: BridgeEvent) => void>();
  private pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private requestId = 0;
  private subscribedStores = new Set<string>();

  constructor(url: string) {
    this.url = url;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url + '?type=client');

      this.ws.on('open', () => {
        this.reconnectAttempts = 0;

        for (const storeId of this.subscribedStores) {
          this.send({ type: 'subscribe', payload: { storeId } });
        }

        resolve();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('close', () => {
        this.attemptReconnect();
      });

      this.ws.on('error', (err) => {
        reject(err);
      });
    });
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.reconnectAttempts++;

    setTimeout(() => {
      this.connect().catch(() => {});
    }, this.reconnectDelay * this.reconnectAttempts);
  }

  private send(message: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private handleMessage(data: string): void {
    try {
      const msg = JSON.parse(data);

      if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
        const pending = this.pendingRequests.get(msg.id)!;
        this.pendingRequests.delete(msg.id);

        if (msg.error) {
          pending.reject(new Error(msg.error.message || msg.error));
        } else {
          pending.resolve(msg.result);
        }
        return;
      }

      if (msg.type) {
        switch (msg.type) {
          case 'store.stateChanged':
            this.emit({
              type: 'stateChanged',
              storeId: msg.payload.storeId,
              state: msg.payload.state,
              version: msg.payload.version,
              source: msg.payload.source,
            });
            break;

          case 'store.disconnected':
            this.emit({
              type: 'disconnected',
              storeId: msg.payload.storeId,
              reason: msg.payload.reason,
            });
            this.subscribedStores.delete(msg.payload.storeId);
            break;

          case 'store.registered':
            this.emit({
              type: 'connected',
              storeId: msg.payload.storeId,
              pageId: msg.payload.pageId,
              storeKey: msg.payload.storeKey,
            });
            break;
        }
      }
    } catch {
      // Ignore malformed messages from unknown clients.
    }
  }

  private emit(event: BridgeEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }

  onEvent(handler: (event: BridgeEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private async request<T>(method: string, params: unknown): Promise<T> {
    const id = ++this.requestId;

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (v) => resolve(v as T),
        reject: (e) => reject(e),
      });
      this.send({ id, method, params });

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 5000);
    });
  }

  async listStores(): Promise<StoreSummary[]> {
    return this.request<StoreSummary[]>('listStores', {});
  }

  async describe(storeId: string): Promise<StoreDescription | undefined> {
    const res = await this.request<StoreDescription | null>('describe', { storeId });
    return res ?? undefined;
  }

  async getState(storeId: string): Promise<StateSnapshot | undefined> {
    const res = await this.request<StateSnapshot | null>('getState', { storeId });
    return res ?? undefined;
  }

  async findStoreByKey(pageId: string, storeKey: string): Promise<StoreSummary | undefined> {
    const stores = await this.listStores();
    return stores.find((store) => store.pageId === pageId && store.storeKey === storeKey);
  }

  async getStateByKey(pageId: string, storeKey = 'main'): Promise<StateSnapshot | undefined> {
    const res = await this.request<StateSnapshot | null>('getState', { pageId, storeKey });
    return res ?? undefined;
  }

  subscribe(storeId: string): void {
    this.subscribedStores.add(storeId);
    this.send({ type: 'subscribe', payload: { storeId } });
  }

  unsubscribe(storeId: string): void {
    this.subscribedStores.delete(storeId);
    this.send({ type: 'unsubscribe', payload: { storeId } });
  }

  async setState(storeId: string, state: unknown, options?: SetStateOptions): Promise<void> {
    await this.request<null>('setState', { storeId, state, ...options });
  }

  async setStateByKey(
    pageId: string,
    storeKey: string,
    state: unknown,
    options?: SetStateOptions
  ): Promise<{ version: number }> {
    return this.request<{ version: number }>('setState', { pageId, storeKey, state, ...options });
  }

  async dispatch(storeId: string, action: { type: string; payload?: unknown }): Promise<void> {
    await this.request<null>('dispatch', { storeId, action });
  }

  disconnect(): void {
    this.ws?.close();
  }
}
