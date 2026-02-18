import type { Server } from 'http';
import type WebSocket from 'ws';
import type {
  StoreId,
  PageId,
  StoreKey,
  StoreDescription,
  StoreChangeEvent,
  GatewayMessage as BrowserMessage,
  ServerMessage as ClientMessage,
  SubscriberMessage,
  SetStateOptions,
} from '../shared/types.js';

export type {
  StoreId,
  PageId,
  StoreKey,
  BrowserMessage,
  ClientMessage,
  SubscriberMessage,
  StoreChangeEvent,
};

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
  findStoreByKey(pageId: PageId, storeKey: StoreKey): RegisteredStore | undefined;
  getDescription(id: StoreId): StoreDescription | undefined;
  getState(id: StoreId): { state: unknown; version: number } | undefined;
  setState(id: StoreId, state: unknown, options?: SetStateOptions): Promise<void>;
  dispatch(id: StoreId, action: { type: string; payload?: unknown }): Promise<void>;
  subscribe(id: StoreId, ws: WebSocket, callback?: (event: StoreChangeEvent) => void): () => void;
  attach(server: Server | import('http2').Http2SecureServer): import('ws').WebSocketServer;
  destroy(): void;
}

export interface GatewayOptions {
  wsPath?: string;
  heartbeatTimeout?: number;
  pagesDir?: string;
  ackTimeout?: number;
  ackRetryCount?: number;
}
