import { WebSocket } from 'ws';
import type {
  StoreId,
  PageId,
  StoreKey,
  RegisteredStore,
  StoreChangeEvent
} from './types.js';

export class StoreRegistry {
  private stores = new Map<StoreId, RegisteredStore>();
  private index = new Map<`${PageId}:${StoreKey}`, StoreId>();
  private byPage = new Map<PageId, Set<StoreId>>();
  private changeHandlers = new Set<(event: StoreChangeEvent) => void>();
  
  register(store: RegisteredStore): void {
    const key: `${PageId}:${StoreKey}` = `${store.pageId}:${store.storeKey}`;
    
    const existingId = this.index.get(key);
    if (existingId) {
      const existing = this.stores.get(existingId);
      if (existing) {
        this.disconnect(existingId, 'replaced');
      }
    }
    
    this.stores.set(store.id, store);
    this.index.set(key, store.id);
    
    if (!this.byPage.has(store.pageId)) {
      this.byPage.set(store.pageId, new Set());
    }
    this.byPage.get(store.pageId)!.add(store.id);
    
    this.emit({
      type: 'stateChanged',
      storeId: store.id,
      state: store.currentState,
      version: store.version,
      source: 'register',
    });
  }
  
  get(id: StoreId): RegisteredStore | undefined {
    return this.stores.get(id);
  }
  
  find(pageId: PageId, storeKey: StoreKey): RegisteredStore | undefined {
    const key: `${PageId}:${StoreKey}` = `${pageId}:${storeKey}`;
    const storeId = this.index.get(key);
    return storeId ? this.stores.get(storeId) : undefined;
  }

  findStoreByKey(pageId: PageId, storeKey: StoreKey): RegisteredStore | undefined {
    return this.find(pageId, storeKey);
  }
  
  findByPage(pageId: PageId): RegisteredStore[] {
    const ids = this.byPage.get(pageId);
    if (!ids) return [];
    return Array.from(ids)
      .map(id => this.stores.get(id))
      .filter((s): s is RegisteredStore => s !== undefined);
  }
  
  list(): RegisteredStore[] {
    return Array.from(this.stores.values());
  }
  
  updateState(id: StoreId, state: unknown, version: number): void {
    const store = this.stores.get(id);
    if (!store) return;
    
    store.currentState = state;
    store.version = version;
    store.lastActivity = new Date();
    
    this.emit({
      type: 'stateChanged',
      storeId: id,
      state,
      version,
      source: 'browser',
    });
  }
  
  disconnect(id: StoreId, reason: string): void {
    const store = this.stores.get(id);
    if (!store) return;
    
    for (const sub of store.subscribers) {
      if (sub.readyState === WebSocket.OPEN) {
        sub.send(JSON.stringify({
          type: 'store.disconnected',
          payload: { storeId: id, reason },
        }));
      }
    }
    
    this.stores.delete(id);
    
    const key: `${PageId}:${StoreKey}` = `${store.pageId}:${store.storeKey}`;
    if (this.index.get(key) === id) {
      this.index.delete(key);
    }
    
    const pageStores = this.byPage.get(store.pageId);
    if (pageStores) {
      pageStores.delete(id);
      if (pageStores.size === 0) {
        this.byPage.delete(store.pageId);
      }
    }
    
    this.emit({
      type: 'disconnected',
      storeId: id,
    });
  }
  
  addSubscriber(id: StoreId, ws: WebSocket): () => void {
    const store = this.stores.get(id);
    if (!store) {
      throw new Error(`Store not found: ${id}`);
    }
    
    store.subscribers.add(ws);
    
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'store.stateChanged',
        payload: {
          storeId: id,
          state: store.currentState,
          version: store.version,
          source: 'snapshot',
        },
      }));
    }
    
    return () => {
      store.subscribers.delete(ws);
    };
  }
  
  onChange(handler: (event: StoreChangeEvent) => void): () => void {
    this.changeHandlers.add(handler);
    return () => this.changeHandlers.delete(handler);
  }
  
  private emit(event: StoreChangeEvent): void {
    for (const handler of this.changeHandlers) {
      handler(event);
    }
  }
  
  cleanup(): void {
    for (const store of this.stores.values()) {
      for (const sub of store.subscribers) {
        if (sub.readyState !== WebSocket.OPEN) {
          store.subscribers.delete(sub);
        }
      }
    }
  }
}
