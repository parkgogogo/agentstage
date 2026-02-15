import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import getPort from 'get-port';
import { createBridgeGateway } from '../../src/gateway/createBridgeGateway.js';
import { BridgeClient } from '../../src/sdk/BridgeClient.js';

describe('Bridge E2E Tests', () => {
  let gateway: ReturnType<typeof createBridgeGateway> & { 
    attach: (server: any) => WebSocketServer; 
    destroy: () => void 
  };
  let server: ReturnType<typeof createServer>;
  let wss: WebSocketServer;
  let port: number;
  let gatewayUrl: string;
  
  beforeAll(async () => {
    gateway = createBridgeGateway() as any;
    server = createServer();
    wss = gateway.attach(server);
    port = await getPort();
    gatewayUrl = `ws://localhost:${port}/_bridge`;
    await new Promise<void>((resolve) => server.listen(port, resolve));
  });
  
  afterAll(() => {
    gateway.destroy();
    wss.close();
    server.close();
  });
  
  describe('Browser store <-> Gateway <-> SDK Client', () => {
    it('should sync state from browser to SDK client', async () => {
      // 1. Browser connects and registers
      const browserWs = new WebSocket(`${gatewayUrl}?type=browser`);
      await new Promise<void>((resolve, reject) => {
        browserWs.on('open', resolve);
        browserWs.on('error', reject);
      });
      
      browserWs.send(JSON.stringify({
        type: 'store.register',
        payload: {
          storeId: 'counter#test1',
          pageId: 'counter',
          storeKey: 'main',
          description: {
            pageId: 'counter',
            storeKey: 'main',
            schema: { type: 'object' },
            actions: {},
          },
          initialState: { count: 0 },
        },
      }));
      
      await new Promise(r => setTimeout(r, 50));
      
      // 2. SDK Client connects and subscribes
      const client = new BridgeClient(gatewayUrl);
      const events: unknown[] = [];
      
      client.onEvent((event) => {
        events.push(event);
      });
      
      await client.connect();
      client.subscribe('counter#test1');
      
      await new Promise(r => setTimeout(r, 100));
      
      // Should have received snapshot
      const snapshot = events.find(e => (e as any).type === 'stateChanged');
      expect(snapshot).toBeDefined();
      expect((snapshot as any).state).toEqual({ count: 0 });
      
      // 3. Browser updates state
      browserWs.send(JSON.stringify({
        type: 'store.stateChanged',
        payload: {
          storeId: 'counter#test1',
          state: { count: 5 },
          version: 1,
          source: 'browser',
        },
      }));
      
      await new Promise(r => setTimeout(r, 100));
      
      // 4. Client should receive the update
      const update = events.find(
        e => (e as any).type === 'stateChanged' && (e as any).source === 'browser'
      );
      expect(update).toBeDefined();
      expect((update as any).state).toEqual({ count: 5 });
      
      browserWs.close();
      client.disconnect();
    });
    
    it('should dispatch action from SDK to browser', async () => {
      // 1. Browser connects
      const browserWs = new WebSocket(`${gatewayUrl}?type=browser`);
      const receivedMessages: unknown[] = [];
      
      browserWs.on('message', (data) => {
        receivedMessages.push(JSON.parse(data.toString()));
      });
      
      await new Promise<void>((resolve, reject) => {
        browserWs.on('open', resolve);
        browserWs.on('error', reject);
      });
      
      browserWs.send(JSON.stringify({
        type: 'store.register',
        payload: {
          storeId: 'counter#test2',
          pageId: 'counter',
          storeKey: 'main',
          description: {
            pageId: 'counter',
            storeKey: 'main',
            schema: { type: 'object' },
            actions: {},
          },
          initialState: { count: 0 },
        },
      }));
      
      await new Promise(r => setTimeout(r, 50));
      
      // 2. SDK Client connects and dispatches action
      const client = new BridgeClient(gatewayUrl);
      await client.connect();
      
      // Note: SDK's dispatch is not fully implemented in the current BridgeClient
      // but we can test via gateway API directly
      await gateway.dispatch('counter#test2', { type: 'increment', payload: { by: 10 } });
      
      await new Promise(r => setTimeout(r, 100));
      
      // 3. Browser should receive the dispatch
      const dispatchMsg = receivedMessages.find(
        m => (m as any).type === 'client.dispatch'
      );
      expect(dispatchMsg).toBeDefined();
      expect((dispatchMsg as any).payload.action).toEqual({ type: 'increment', payload: { by: 10 } });
      
      browserWs.close();
      client.disconnect();
    });
    
    it('should handle page refresh scenario', async () => {
      const client = new BridgeClient(gatewayUrl);
      const events: unknown[] = [];
      
      client.onEvent((event) => {
        events.push(event);
      });
      
      await client.connect();
      
      // 1. First browser tab connects
      const browser1 = new WebSocket(`${gatewayUrl}?type=browser`);
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
          initialState: { version: 1 },
        },
      }));
      
      await new Promise(r => setTimeout(r, 50));
      
      // Client subscribes
      client.subscribe('page#old');
      await new Promise(r => setTimeout(r, 50));
      
      // Clear events
      events.length = 0;
      
      // 2. Page refreshes (new tab)
      const browser2 = new WebSocket(`${gatewayUrl}?type=browser`);
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
          initialState: { version: 2 },
        },
      }));
      
      await new Promise(r => setTimeout(r, 100));
      
      // 3. Client should receive disconnected for old store
      const disconnected = events.find(e => (e as any).type === 'disconnected');
      expect(disconnected).toBeDefined();
      expect((disconnected as any).storeId).toBe('page#old');
      
      browser1.close();
      browser2.close();
      client.disconnect();
    });
    
    it('should handle multiple browsers on same page', async () => {
      const client = new BridgeClient(gatewayUrl);
      const events: unknown[] = [];
      
      client.onEvent((event) => {
        events.push(event);
      });
      
      await client.connect();
      
      // 1. Browser 1 connects
      const browser1 = new WebSocket(`${gatewayUrl}?type=browser`);
      await new Promise<void>((resolve) => browser1.on('open', resolve));
      
      browser1.send(JSON.stringify({
        type: 'store.register',
        payload: {
          storeId: 'page#tab1',
          pageId: 'test-page',
          storeKey: 'main',
          description: {
            pageId: 'test-page',
            storeKey: 'main',
            schema: { type: 'object' },
            actions: {},
          },
          initialState: { tab: 1 },
        },
      }));
      
      await new Promise(r => setTimeout(r, 50));
      
      // Client subscribes to first tab
      client.subscribe('page#tab1');
      await new Promise(r => setTimeout(r, 50));
      
      // 2. Browser 2 (second tab) connects with same pageId+storeKey
      const browser2 = new WebSocket(`${gatewayUrl}?type=browser`);
      await new Promise<void>((resolve) => browser2.on('open', resolve));
      
      browser2.send(JSON.stringify({
        type: 'store.register',
        payload: {
          storeId: 'page#tab2',
          pageId: 'test-page',
          storeKey: 'main',
          description: {
            pageId: 'test-page',
            storeKey: 'main',
            schema: { type: 'object' },
            actions: {},
          },
          initialState: { tab: 2 },
        },
      }));
      
      await new Promise(r => setTimeout(r, 100));
      
      // First tab's store should be replaced (disconnected)
      // Client should have received disconnected for page#tab1
      const disconnected = events.find(
        e => (e as any).type === 'disconnected' && (e as any).storeId === 'page#tab1'
      );
      expect(disconnected).toBeDefined();
      
      // Gateway.find should return the new store
      const currentStore = gateway.find('test-page', 'main');
      expect(currentStore?.id).toBe('page#tab2');
      
      browser1.close();
      browser2.close();
      client.disconnect();
    });
  });
  
  describe('HTTP API', () => {
    it('should list stores via API', async () => {
      // 1. Register a store via WebSocket
      const browserWs = new WebSocket(`${gatewayUrl}?type=browser`);
      await new Promise<void>((resolve, reject) => {
        browserWs.on('open', resolve);
        browserWs.on('error', reject);
      });
      
      browserWs.send(JSON.stringify({
        type: 'store.register',
        payload: {
          storeId: 'page#api-test',
          pageId: 'api-page',
          storeKey: 'main',
          description: {
            pageId: 'api-page',
            storeKey: 'main',
            schema: { type: 'object' },
            actions: {},
          },
          initialState: { data: 'test' },
        },
      }));
      
      await new Promise(r => setTimeout(r, 50));
      
      // 2. Call API to list stores
      const stores = gateway.listStores();
      
      const found = stores.find(s => s.id === 'page#api-test');
      expect(found).toBeDefined();
      expect(found?.pageId).toBe('api-page');
      
      browserWs.close();
    });
    
    it('should get store state via API', async () => {
      // 1. Register a store
      const browserWs = new WebSocket(`${gatewayUrl}?type=browser`);
      await new Promise<void>((resolve, reject) => {
        browserWs.on('open', resolve);
        browserWs.on('error', reject);
      });
      
      browserWs.send(JSON.stringify({
        type: 'store.register',
        payload: {
          storeId: 'page#state-test',
          pageId: 'state-page',
          storeKey: 'main',
          description: {
            pageId: 'state-page',
            storeKey: 'main',
            schema: { type: 'object' },
            actions: {},
          },
          initialState: { count: 42 },
        },
      }));
      
      await new Promise(r => setTimeout(r, 50));
      
      // 2. Get state via gateway API
      const state = gateway.getState('page#state-test');
      
      expect(state).toBeDefined();
      expect(state?.state).toEqual({ count: 42 });
      expect(state?.version).toBe(0);
      
      browserWs.close();
    });
  });
});
