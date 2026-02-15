import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { createBridgeGateway } from '../../src/gateway/createBridgeGateway.js';
import { StoreRegistry } from '../../src/gateway/registry.js';
import type { Gateway } from '../../src/gateway/types.js';
import getPort from 'get-port';

describe('Gateway + Registry Integration', () => {
  let gateway: Gateway & { attach: (server: any) => WebSocketServer; destroy: () => void };
  let server: ReturnType<typeof createServer>;
  let wss: WebSocketServer;
  let port: number;
  
  beforeAll(async () => {
    gateway = createBridgeGateway() as any;
    server = createServer();
    wss = gateway.attach(server);
    port = await getPort();
    await new Promise<void>((resolve) => server.listen(port, resolve));
  });
  
  afterAll(() => {
    gateway.destroy();
    wss.close();
    server.close();
  });
  
  beforeEach(() => {
    // Clear all stores between tests
    const registry = (gateway as any).registry as StoreRegistry;
    for (const store of registry.list()) {
      registry.disconnect(store.id, 'test_cleanup');
    }
  });
  
  describe('full lifecycle', () => {
    it('should handle complete register -> stateChange -> disconnect flow', async () => {
      // 1. Browser connects and registers
      const browserWs = new WebSocket(`ws://localhost:${port}/_bridge?type=browser`);
      
      await new Promise<void>((resolve, reject) => {
        browserWs.on('open', resolve);
        browserWs.on('error', reject);
      });
      
      // Register store
      browserWs.send(JSON.stringify({
        type: 'store.register',
        payload: {
          storeId: 'page#test123',
          pageId: 'test-page',
          storeKey: 'main',
          description: {
            pageId: 'test-page',
            storeKey: 'main',
            schema: { type: 'object' },
            actions: {},
          },
          initialState: { count: 0 },
        },
      }));
      
      // Wait a bit for registration
      await new Promise(r => setTimeout(r, 50));
      
      // Verify store is registered
      const store = gateway.getStore('page#test123');
      expect(store).toBeDefined();
      expect(store?.pageId).toBe('test-page');
      expect(store?.currentState).toEqual({ count: 0 });
      
      // 2. Browser sends state change
      browserWs.send(JSON.stringify({
        type: 'store.stateChanged',
        payload: {
          storeId: 'page#test123',
          state: { count: 5 },
          version: 1,
          source: 'browser',
        },
      }));
      
      await new Promise(r => setTimeout(r, 50));
      
      // Verify state is updated
      const updatedStore = gateway.getStore('page#test123');
      expect(updatedStore?.currentState).toEqual({ count: 5 });
      expect(updatedStore?.version).toBe(1);
      
      // 3. Browser disconnects
      browserWs.close();
      
      await new Promise(r => setTimeout(r, 50));
      
      // Verify store is removed
      expect(gateway.getStore('page#test123')).toBeUndefined();
    });
    
    it('should broadcast state changes to subscribers', async () => {
      // 1. Browser registers store
      const browserWs = new WebSocket(`ws://localhost:${port}/_bridge?type=browser`);
      await new Promise<void>((resolve) => browserWs.on('open', resolve));
      
      browserWs.send(JSON.stringify({
        type: 'store.register',
        payload: {
          storeId: 'page#test123',
          pageId: 'test-page',
          storeKey: 'main',
          description: {
            pageId: 'test-page',
            storeKey: 'main',
            schema: { type: 'object' },
            actions: {},
          },
          initialState: { count: 0 },
        },
      }));
      
      await new Promise(r => setTimeout(r, 50));
      
      // 2. Client subscribes to store
      const clientWs = new WebSocket(`ws://localhost:${port}/_bridge?type=client`);
      const receivedMessages: unknown[] = [];
      
      await new Promise<void>((resolve) => clientWs.on('open', resolve));
      
      clientWs.on('message', (data) => {
        receivedMessages.push(JSON.parse(data.toString()));
      });
      
      clientWs.send(JSON.stringify({
        type: 'subscribe',
        payload: { storeId: 'page#test123' },
      }));
      
      await new Promise(r => setTimeout(r, 50));
      
      // Should receive snapshot immediately
      expect(receivedMessages.length).toBeGreaterThanOrEqual(1);
      const snapshot = receivedMessages.find(m => (m as any).type === 'store.stateChanged');
      expect(snapshot).toBeDefined();
      expect((snapshot as any).payload.source).toBe('snapshot');
      
      // 3. Browser sends state change
      browserWs.send(JSON.stringify({
        type: 'store.stateChanged',
        payload: {
          storeId: 'page#test123',
          state: { count: 10 },
          version: 1,
          source: 'browser',
        },
      }));
      
      await new Promise(r => setTimeout(r, 50));
      
      // 4. Client should receive broadcast
      const stateChanged = receivedMessages.find(
        m => (m as any).type === 'store.stateChanged' && (m as any).payload.source === 'browser'
      );
      expect(stateChanged).toBeDefined();
      expect((stateChanged as any).payload.state).toEqual({ count: 10 });
      
      browserWs.close();
      clientWs.close();
    });
    
    it('should handle page refresh scenario (new store replaces old)', async () => {
      // 1. First browser tab connects
      const browser1 = new WebSocket(`ws://localhost:${port}/_bridge?type=browser`);
      await new Promise<void>((resolve) => browser1.on('open', resolve));
      
      browser1.send(JSON.stringify({
        type: 'store.register',
        payload: {
          storeId: 'page#old',
          pageId: 'test-page',
          storeKey: 'main',
          description: {
            pageId: 'test-page',
            storeKey: 'main',
            schema: { type: 'object' },
            actions: {},
          },
          initialState: { count: 0 },
        },
      }));
      
      await new Promise(r => setTimeout(r, 50));
      
      expect(gateway.getStore('page#old')).toBeDefined();
      expect(gateway.find('test-page', 'main')?.id).toBe('page#old');
      
      // 2. Page refreshes (new tab connects with same pageId+storeKey)
      const browser2 = new WebSocket(`ws://localhost:${port}/_bridge?type=browser`);
      await new Promise<void>((resolve) => browser2.on('open', resolve));
      
      browser2.send(JSON.stringify({
        type: 'store.register',
        payload: {
          storeId: 'page#new',
          pageId: 'test-page',
          storeKey: 'main',
          description: {
            pageId: 'test-page',
            storeKey: 'main',
            schema: { type: 'object' },
            actions: {},
          },
          initialState: { count: 5 },
        },
      }));
      
      await new Promise(r => setTimeout(r, 50));
      
      // Old store should be replaced
      expect(gateway.getStore('page#old')).toBeUndefined();
      expect(gateway.getStore('page#new')).toBeDefined();
      expect(gateway.find('test-page', 'main')?.id).toBe('page#new');
      
      browser1.close();
      browser2.close();
    });
    
    it('should handle setState from client to browser', async () => {
      // 1. Browser registers
      const browserWs = new WebSocket(`ws://localhost:${port}/_bridge?type=browser`);
      const browserMessages: unknown[] = [];
      
      await new Promise<void>((resolve) => browserWs.on('open', resolve));
      
      browserWs.on('message', (data) => {
        browserMessages.push(JSON.parse(data.toString()));
      });
      
      browserWs.send(JSON.stringify({
        type: 'store.register',
        payload: {
          storeId: 'page#test123',
          pageId: 'test-page',
          storeKey: 'main',
          description: {
            pageId: 'test-page',
            storeKey: 'main',
            schema: { type: 'object' },
            actions: {},
          },
          initialState: { count: 0 },
        },
      }));
      
      await new Promise(r => setTimeout(r, 50));
      
      // 2. Call gateway.setState
      await gateway.setState('page#test123', { count: 42 });
      
      await new Promise(r => setTimeout(r, 50));
      
      // 3. Browser should receive setState message
      const setStateMsg = browserMessages.find(
        m => (m as any).type === 'client.setState'
      );
      expect(setStateMsg).toBeDefined();
      expect((setStateMsg as any).payload.state).toEqual({ count: 42 });
      
      browserWs.close();
    });
    
    it('should handle dispatch from client to browser', async () => {
      // 1. Browser registers
      const browserWs = new WebSocket(`ws://localhost:${port}/_bridge?type=browser`);
      const browserMessages: unknown[] = [];
      
      await new Promise<void>((resolve) => browserWs.on('open', resolve));
      
      browserWs.on('message', (data) => {
        browserMessages.push(JSON.parse(data.toString()));
      });
      
      browserWs.send(JSON.stringify({
        type: 'store.register',
        payload: {
          storeId: 'page#test123',
          pageId: 'test-page',
          storeKey: 'main',
          description: {
            pageId: 'test-page',
            storeKey: 'main',
            schema: { type: 'object' },
            actions: {},
          },
          initialState: { count: 0 },
        },
      }));
      
      await new Promise(r => setTimeout(r, 50));
      
      // 2. Call gateway.dispatch
      await gateway.dispatch('page#test123', { type: 'increment', payload: { by: 5 } });
      
      await new Promise(r => setTimeout(r, 50));
      
      // 3. Browser should receive dispatch message
      const dispatchMsg = browserMessages.find(
        m => (m as any).type === 'client.dispatch'
      );
      expect(dispatchMsg).toBeDefined();
      expect((dispatchMsg as any).payload.action).toEqual({ type: 'increment', payload: { by: 5 } });
      
      browserWs.close();
    });
    
    it('should notify subscribers when store disconnects', async () => {
      // 1. Browser registers
      const browserWs = new WebSocket(`ws://localhost:${port}/_bridge?type=browser`);
      await new Promise<void>((resolve) => browserWs.on('open', resolve));
      
      browserWs.send(JSON.stringify({
        type: 'store.register',
        payload: {
          storeId: 'page#test123',
          pageId: 'test-page',
          storeKey: 'main',
          description: {
            pageId: 'test-page',
            storeKey: 'main',
            schema: { type: 'object' },
            actions: {},
          },
          initialState: { count: 0 },
        },
      }));
      
      await new Promise(r => setTimeout(r, 50));
      
      // 2. Client subscribes
      const clientWs = new WebSocket(`ws://localhost:${port}/_bridge?type=client`);
      const receivedMessages: unknown[] = [];
      
      await new Promise<void>((resolve) => clientWs.on('open', resolve));
      
      clientWs.on('message', (data) => {
        receivedMessages.push(JSON.parse(data.toString()));
      });
      
      clientWs.send(JSON.stringify({
        type: 'subscribe',
        payload: { storeId: 'page#test123' },
      }));
      
      await new Promise(r => setTimeout(r, 50));
      
      // 3. Browser disconnects
      browserWs.close();
      
      await new Promise(r => setTimeout(r, 100));
      
      // 4. Client should receive disconnected message
      const disconnectedMsg = receivedMessages.find(
        m => (m as any).type === 'store.disconnected'
      );
      expect(disconnectedMsg).toBeDefined();
      expect((disconnectedMsg as any).payload.storeId).toBe('page#test123');
      
      clientWs.close();
    });
  });
});
