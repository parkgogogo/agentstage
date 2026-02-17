import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { createBridgeStore } from '../../src/browser/createBridgeStore.js';

// Mock global objects
global.window = {
  location: {
    protocol: 'http:',
    host: 'localhost:3000',
  },
} as any;

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  public readyState = 0;
  public sentMessages: string[] = [];
  private listeners: Record<string, ((data: any) => void)[]> = {};

  // Support both onopen/onmessage/onclose/onerror setters and addEventListener
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onclose: (() => void) | null = null;
  public onerror: ((err: any) => void) | null = null;

  constructor(public url: string) {
    // Simulate async open
    queueMicrotask(() => {
      this.readyState = 1;
      if (this.onopen) this.onopen();
      this.emit('open');

      // Simulate receiving client.setState (hydration) message
      queueMicrotask(() => {
        if (this.onmessage) {
          this.onmessage({
            data: JSON.stringify({
              type: 'client.setState',
              payload: { state: { count: 0 }, expectedVersion: undefined }
            })
          });
        }
      });
    });
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = 3;
    if (this.onclose) this.onclose();
    this.emit('close');
  }

  addEventListener(event: string, handler: (data: any) => void): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(handler);
  }

  emit(event: string, data?: any): void {
    this.listeners[event]?.forEach(h => h(data));
  }
}

global.WebSocket = MockWebSocket as any;

describe('createBridgeStore', () => {
  const schema = z.object({ count: z.number() });
  
  describe('store creation', () => {
    it('should create zustand store with initial state', () => {
      const bridge = createBridgeStore({
        pageId: 'test-page',
        description: {
          schema,
          actions: {},
        },
        createState: (set, get) => ({
          count: 0,
          dispatch: () => {},
        }),
      });
      
      const state = bridge.store.getState();
      expect(state.count).toBe(0);
    });
    
    it('should generate unique storeId with pageId prefix', async () => {
      const bridge = createBridgeStore({
        pageId: 'test-page',
        description: {
          schema,
          actions: {},
        },
        createState: (set, get) => ({
          count: 0,
          dispatch: () => {},
        }),
      });
      
      const connected = await bridge.connect();
      
      expect(connected.storeId).toMatch(/^test-page#/);
      expect(typeof connected.storeId).toBe('string');
      expect(connected.storeId.length).toBeGreaterThan('test-page#'.length);
      
      connected.disconnect();
    });
    
    it('should use provided storeKey', () => {
      const bridge = createBridgeStore({
        pageId: 'test-page',
        storeKey: 'sidebar',
        description: {
          schema,
          actions: {},
        },
        createState: (set, get) => ({
          count: 0,
          dispatch: () => {},
        }),
      });
      
      const description = bridge.describes();
      expect(description.storeKey).toBe('sidebar');
    });
    
    it('should default storeKey to "main"', () => {
      const bridge = createBridgeStore({
        pageId: 'test-page',
        description: {
          schema,
          actions: {},
        },
        createState: (set, get) => ({
          count: 0,
          dispatch: () => {},
        }),
      });
      
      const description = bridge.describes();
      expect(description.storeKey).toBe('main');
    });
  });
  
  describe('description generation', () => {
    it('should include pageId and storeKey in description', () => {
      const bridge = createBridgeStore({
        pageId: 'test-page',
        storeKey: 'sidebar',
        description: {
          schema,
          actions: {
            increment: {
              description: 'Increment counter',
            },
          },
          events: {
            update: {
              description: 'Update event',
            },
          },
        },
        createState: (set, get) => ({
          count: 0,
          dispatch: () => {},
        }),
      });
      
      const description = bridge.describes();
      
      expect(description.pageId).toBe('test-page');
      expect(description.storeKey).toBe('sidebar');
      expect(description.actions.increment.description).toBe('Increment counter');
      expect(description.events?.update.description).toBe('Update event');
    });
  });
  
  describe('connect', () => {
    it('should open WebSocket connection to gateway', async () => {
      const bridge = createBridgeStore({
        pageId: 'test-page',
        description: {
          schema,
          actions: {},
        },
        createState: (set, get) => ({
          count: 0,
          dispatch: () => {},
        }),
      });
      
      const connected = await bridge.connect();
      
      expect(bridge.isConnected).toBe(true);
      
      connected.disconnect();
    });
    
    it('should mark as disconnected after disconnect', async () => {
      const bridge = createBridgeStore({
        pageId: 'test-page',
        description: {
          schema,
          actions: {},
        },
        createState: (set, get) => ({
          count: 0,
          dispatch: () => {},
        }),
      });
      
      const connected = await bridge.connect();
      expect(bridge.isConnected).toBe(true);
      
      connected.disconnect();
      expect(bridge.isConnected).toBe(false);
    });
  });
  
  describe('state management', () => {
    it('should update state through zustand', async () => {
      const bridge = createBridgeStore({
        pageId: 'test-page',
        description: {
          schema,
          actions: {},
        },
        createState: (set, get) => ({
          count: 0,
          dispatch: () => {},
        }),
      });
      
      bridge.store.setState({ count: 5 });
      
      expect(bridge.store.getState().count).toBe(5);
    });
    
    it('should handle dispatch action', async () => {
      const dispatchFn = vi.fn();
      
      const bridge = createBridgeStore({
        pageId: 'test-page',
        description: {
          schema,
          actions: {},
        },
        createState: (set, get) => ({
          count: 0,
          dispatch: dispatchFn,
        }),
      });
      
      bridge.store.getState().dispatch({ type: 'increment', payload: { by: 5 } });
      
      expect(dispatchFn).toHaveBeenCalledWith({ type: 'increment', payload: { by: 5 } });
    });
  });
});
