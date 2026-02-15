import WebSocket from 'ws';

export interface StoreSummary {
  id: string;
  pageId: string;
  storeKey: string;
  version: number;
  connectedAt: Date;
}

export interface StoreDescription {
  pageId: string;
  storeKey: string;
  schema: unknown;
  actions: Record<string, { description: string; payload?: unknown }>;
  events?: Record<string, { description: string; payload?: unknown }>;
}

export interface StateSnapshot {
  state: unknown;
  version: number;
}

export type BridgeEvent =
  | { type: 'stateChanged'; storeId: string; state: unknown; version: number; source: string }
  | { type: 'disconnected'; storeId: string; reason: string }
  | { type: 'connected'; storeId: string; pageId: string; storeKey: string };

export class BridgeClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private eventHandlers = new Set<(event: BridgeEvent) => void>();
  private pendingRequests = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private requestId = 0;
  private subscribedStores = new Set<string>();
  
  constructor(url: string) {
    this.url = url;
  }
  
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url + '?type=client');
      
      this.ws.on('open', () => {
        console.log('[BridgeClient] Connected');
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
        console.log('[BridgeClient] Disconnected');
        this.attemptReconnect();
      });
      
      this.ws.on('error', (err) => {
        reject(err);
      });
    });
  }
  
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[BridgeClient] Max reconnect attempts reached');
      return;
    }
    
    this.reconnectAttempts++;
    console.log(`[BridgeClient] Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
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
    } catch (err) {
      console.error('[BridgeClient] Failed to handle message:', err);
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
  
  async listStores(): Promise<StoreSummary[]> {
    const id = ++this.requestId;
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send({ id, method: 'listStores', params: {} });
      
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 5000);
    });
  }
  
  subscribe(storeId: string): void {
    this.subscribedStores.add(storeId);
    this.send({ type: 'subscribe', payload: { storeId } });
  }
  
  unsubscribe(storeId: string): void {
    this.subscribedStores.delete(storeId);
    this.send({ type: 'unsubscribe', payload: { storeId } });
  }
  
  async setState(storeId: string, state: unknown, options?: { expectedVersion?: number }): Promise<void> {
    const id = ++this.requestId;
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send({
        id,
        method: 'setState',
        params: { storeId, state, expectedVersion: options?.expectedVersion },
      });
      
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 5000);
    });
  }
  
  async dispatch(storeId: string, action: { type: string; payload?: unknown }): Promise<void> {
    const id = ++this.requestId;
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send({
        id,
        method: 'dispatch',
        params: { storeId, action },
      });
      
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 5000);
    });
  }
  
  disconnect(): void {
    this.ws?.close();
  }
}
