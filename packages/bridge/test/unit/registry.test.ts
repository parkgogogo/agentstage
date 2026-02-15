import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSocket } from 'ws';
import { StoreRegistry } from '../../src/gateway/registry.js';
import type { RegisteredStore, StoreChangeEvent } from '../../src/gateway/types.js';

// Mock WebSocket
vi.mock('ws', () => ({
  WebSocket: class MockWebSocket {
    readyState = 1; // OPEN
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    
    sentMessages: unknown[] = [];
    
    send(data: string): void {
      this.sentMessages.push(data);
    }
    
    close(): void {
      this.readyState = 3;
    }
  },
}));

function createMockStore(overrides: Partial<RegisteredStore> = {}): RegisteredStore {
  const ws = new WebSocket('ws://localhost:3000/_bridge');
  
  return {
    id: 'page#abc123',
    pageId: 'page',
    storeKey: 'main',
    description: {
      pageId: 'page',
      storeKey: 'main',
      schema: { type: 'object' },
      actions: {},
    },
    currentState: { count: 0 },
    version: 0,
    ws,
    subscribers: new Set(),
    connectedAt: new Date(),
    lastActivity: new Date(),
    ...overrides,
  };
}

describe('StoreRegistry', () => {
  let registry: StoreRegistry;
  
  beforeEach(() => {
    registry = new StoreRegistry();
  });
  
  describe('register', () => {
    it('should register a store and make it retrievable by id', () => {
      const store = createMockStore({ id: 'page#abc123' });
      
      registry.register(store);
      
      const retrieved = registry.get('page#abc123');
      expect(retrieved).toBe(store);
    });
    
    it('should index store by pageId + storeKey', () => {
      const store = createMockStore({ 
        id: 'page#abc123',
        pageId: 'test-page',
        storeKey: 'main',
      });
      
      registry.register(store);
      
      const found = registry.find('test-page', 'main');
      expect(found).toBe(store);
    });
    
    it('should replace existing store with same pageId+storeKey and disconnect old', () => {
      const oldStore = createMockStore({ 
        id: 'page#old',
        pageId: 'test-page',
        storeKey: 'main',
      });
      const newStore = createMockStore({ 
        id: 'page#new',
        pageId: 'test-page',
        storeKey: 'main',
      });
      
      registry.register(oldStore);
      registry.register(newStore);
      
      // Old store should be removed
      expect(registry.get('page#old')).toBeUndefined();
      // New store should be available
      expect(registry.get('page#new')).toBe(newStore);
      // Index should point to new store
      expect(registry.find('test-page', 'main')).toBe(newStore);
    });
    
    it('should group stores by pageId', () => {
      const store1 = createMockStore({ id: 'page#1', pageId: 'page-a', storeKey: 'main' });
      const store2 = createMockStore({ id: 'page#2', pageId: 'page-a', storeKey: 'secondary' });
      const store3 = createMockStore({ id: 'page#3', pageId: 'page-b', storeKey: 'main' });
      
      registry.register(store1);
      registry.register(store2);
      registry.register(store3);
      
      const pageAStores = registry.findByPage('page-a');
      expect(pageAStores).toHaveLength(2);
      expect(pageAStores).toContain(store1);
      expect(pageAStores).toContain(store2);
      
      const pageBStores = registry.findByPage('page-b');
      expect(pageBStores).toHaveLength(1);
      expect(pageBStores).toContain(store3);
    });
    
    it('should emit stateChanged event on register', () => {
      const store = createMockStore({ id: 'page#abc123', currentState: { count: 5 } });
      const handler = vi.fn();
      
      registry.onChange(handler);
      registry.register(store);
      
      expect(handler).toHaveBeenCalledWith({
        type: 'stateChanged',
        storeId: 'page#abc123',
        state: { count: 5 },
        version: 0,
        source: 'register',
      });
    });
  });
  
  describe('updateState', () => {
    it('should update store state and version', () => {
      const store = createMockStore({ id: 'page#abc123' });
      registry.register(store);
      
      registry.updateState('page#abc123', { count: 10 }, 1);
      
      const updated = registry.get('page#abc123');
      expect(updated?.currentState).toEqual({ count: 10 });
      expect(updated?.version).toBe(1);
    });
    
    it('should update lastActivity timestamp', () => {
      const store = createMockStore({ id: 'page#abc123' });
      const oldActivity = store.lastActivity.getTime();
      
      registry.register(store);
      
      // Wait a bit (using real time)
      const start = Date.now();
      while (Date.now() - start < 10) {} // Small delay
      
      registry.updateState('page#abc123', { count: 10 }, 1);
      
      const updated = registry.get('page#abc123');
      expect(updated?.lastActivity.getTime()).toBeGreaterThanOrEqual(oldActivity);
    });
    
    it('should emit stateChanged event', () => {
      const store = createMockStore({ id: 'page#abc123' });
      const handler = vi.fn();
      
      registry.register(store);
      registry.onChange(handler);
      registry.updateState('page#abc123', { count: 10 }, 1);
      
      expect(handler).toHaveBeenCalledWith({
        type: 'stateChanged',
        storeId: 'page#abc123',
        state: { count: 10 },
        version: 1,
        source: 'browser',
      });
    });
    
    it('should do nothing if store does not exist', () => {
      const handler = vi.fn();
      registry.onChange(handler);
      
      registry.updateState('non-existent', { count: 10 }, 1);
      
      expect(handler).not.toHaveBeenCalled();
    });
  });
  
  describe('disconnect', () => {
    it('should remove store from registry', () => {
      const store = createMockStore({ id: 'page#abc123' });
      registry.register(store);
      
      registry.disconnect('page#abc123', 'test');
      
      expect(registry.get('page#abc123')).toBeUndefined();
    });
    
    it('should remove from page index', () => {
      const store = createMockStore({ id: 'page#abc123', pageId: 'test-page', storeKey: 'main' });
      registry.register(store);
      
      registry.disconnect('page#abc123', 'test');
      
      expect(registry.find('test-page', 'main')).toBeUndefined();
    });
    
    it('should remove from page grouping', () => {
      const store = createMockStore({ id: 'page#abc123', pageId: 'test-page', storeKey: 'main' });
      registry.register(store);
      
      registry.disconnect('page#abc123', 'test');
      
      expect(registry.findByPage('test-page')).toHaveLength(0);
    });
    
    it('should notify subscribers with disconnected message', () => {
      const store = createMockStore({ id: 'page#abc123' });
      const subscriberWs = new WebSocket('ws://localhost');
      store.subscribers.add(subscriberWs);
      
      registry.register(store);
      registry.disconnect('page#abc123', 'client_disconnect');
      
      // Check that message was sent to subscriber
      const messages = (subscriberWs as any).sentMessages;
      expect(messages).toHaveLength(1);
      const message = JSON.parse(messages[0] as string);
      expect(message.type).toBe('store.disconnected');
      expect(message.payload).toEqual({
        storeId: 'page#abc123',
        reason: 'client_disconnect',
      });
    });
    
    it('should emit disconnected event', () => {
      const store = createMockStore({ id: 'page#abc123' });
      const handler = vi.fn();
      
      registry.register(store);
      registry.onChange(handler);
      registry.disconnect('page#abc123', 'test');
      
      expect(handler).toHaveBeenCalledWith({
        type: 'disconnected',
        storeId: 'page#abc123',
      });
    });
  });
  
  describe('addSubscriber', () => {
    it('should add subscriber to store', () => {
      const store = createMockStore({ id: 'page#abc123' });
      const subscriberWs = new WebSocket('ws://localhost');
      
      registry.register(store);
      registry.addSubscriber('page#abc123', subscriberWs);
      
      expect(store.subscribers.has(subscriberWs)).toBe(true);
    });
    
    it('should send current state snapshot to subscriber', () => {
      const store = createMockStore({ 
        id: 'page#abc123',
        currentState: { count: 42 },
        version: 5,
      });
      const subscriberWs = new WebSocket('ws://localhost');
      
      registry.register(store);
      registry.addSubscriber('page#abc123', subscriberWs);
      
      const messages = (subscriberWs as any).sentMessages;
      expect(messages).toHaveLength(1);
      const message = JSON.parse(messages[0] as string);
      expect(message.type).toBe('store.stateChanged');
      expect(message.payload.state).toEqual({ count: 42 });
      expect(message.payload.version).toBe(5);
      expect(message.payload.source).toBe('snapshot');
    });
    
    it('should throw if store does not exist', () => {
      const subscriberWs = new WebSocket('ws://localhost');
      
      expect(() => registry.addSubscriber('non-existent', subscriberWs)).toThrow('Store not found');
    });
    
    it('should return unsubscribe function', () => {
      const store = createMockStore({ id: 'page#abc123' });
      const subscriberWs = new WebSocket('ws://localhost');
      
      registry.register(store);
      const unsubscribe = registry.addSubscriber('page#abc123', subscriberWs);
      
      expect(store.subscribers.has(subscriberWs)).toBe(true);
      
      unsubscribe();
      
      expect(store.subscribers.has(subscriberWs)).toBe(false);
    });
  });
  
  describe('cleanup', () => {
    it('should remove closed WebSocket subscribers', () => {
      const store = createMockStore({ id: 'page#abc123' });
      const closedWs = new WebSocket('ws://localhost');
      const openWs = new WebSocket('ws://localhost');
      
      // Simulate closed state
      (closedWs as any).readyState = 3; // CLOSED
      
      store.subscribers.add(closedWs);
      store.subscribers.add(openWs);
      
      registry.register(store);
      registry.cleanup();
      
      expect(store.subscribers.has(closedWs)).toBe(false);
      expect(store.subscribers.has(openWs)).toBe(true);
    });
  });
  
  describe('onChange', () => {
    it('should return unsubscribe function', () => {
      const store = createMockStore({ id: 'page#abc123' });
      const handler = vi.fn();
      
      const unsubscribe = registry.onChange(handler);
      
      registry.register(store);
      expect(handler).toHaveBeenCalledTimes(1);
      
      unsubscribe();
      
      registry.updateState('page#abc123', { count: 10 }, 1);
      // Should not be called again
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
