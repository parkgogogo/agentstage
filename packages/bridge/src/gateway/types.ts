import type { IncomingMessage } from 'http';
import type WebSocket from 'ws';
import type { StoreDescription } from '../shared/types.js';

export type StoreId = string;
export type PageId = string;
export type StoreKey = string;

export interface RegisteredStore {
  id: StoreId;
  pageId: PageId;
  storeKey: StoreKey;
  description: StoreDescription;
  currentState: unknown;
  version: number;
  ws: WebSocket;
  subscribers: Set<WebSocket>;
  connectedAt: Date;
  lastActivity: Date;
}

export interface Gateway {
  readonly stores: ReadonlyMap<StoreId, RegisteredStore>;
  listStores(): Array<{
    id: StoreId;
    pageId: PageId;
    storeKey: StoreKey;
    version: number;
    connectedAt: Date;
  }>;
  getStore(id: StoreId): RegisteredStore | undefined;
  findStore(pageId: PageId, storeKey: StoreKey): RegisteredStore | undefined;
  getDescription(id: StoreId): StoreDescription | undefined;
  getState(id: StoreId): { state: unknown; version: number } | undefined;
  setState(id: StoreId, state: unknown, options?: { expectedVersion?: number }): Promise<void>;
  dispatch(id: StoreId, action: { type: string; payload?: unknown }): Promise<void>;
  subscribe(id: StoreId, ws: WebSocket, callback?: (event: StoreChangeEvent) => void): () => void;
}

export interface StoreChangeEvent {
  type: 'stateChanged' | 'disconnected';
  storeId: StoreId;
  state?: unknown;
  version?: number;
  source?: string;
}

export interface GatewayOptions {
  wsPath?: string;
  heartbeatTimeout?: number;
}

export type BrowserMessage =
  | { type: 'store.register'; payload: RegisterPayload }
  | { type: 'store.stateChanged'; payload: StateChangedPayload }
  | { type: 'store.heartbeat' }
  | { type: 'store.disconnect' };

interface RegisterPayload {
  storeId: StoreId;
  pageId: PageId;
  storeKey: StoreKey;
  description: StoreDescription;
  initialState: unknown;
}

interface StateChangedPayload {
  storeId: StoreId;
  state: unknown;
  version: number;
  source: string;
}

export type ClientMessage =
  | { type: 'client.setState'; payload: { state: unknown; expectedVersion?: number } }
  | { type: 'client.dispatch'; payload: { action: { type: string; payload?: unknown } } }
  | { type: 'client.ping' };

export type SubscriberMessage =
  | { type: 'store.registered'; payload: { storeId: StoreId; pageId: PageId; storeKey: StoreKey } }
  | { type: 'store.stateChanged'; payload: { storeId: StoreId; state: unknown; version: number; source: string } }
  | { type: 'store.disconnected'; payload: { storeId: StoreId; reason: string } };
