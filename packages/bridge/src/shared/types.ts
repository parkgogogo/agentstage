/**
 * Shared types for Bridge
 */

export type StoreId = string;
export type PageId = string;
export type StoreKey = string;

export interface ActionDefinition {
  description: string;
  payload?: unknown;
}

export interface EventDefinition {
  description: string;
  payload?: unknown;
}

export interface StoreDescription {
  pageId: PageId;
  storeKey: StoreKey;
  schema: unknown;
  actions: Record<string, ActionDefinition>;
  events?: Record<string, EventDefinition>;
}

export interface StoreSummary {
  id: StoreId;
  pageId: PageId;
  storeKey: StoreKey;
  version: number;
  connectedAt: Date;
}

export interface StateSnapshot {
  state: unknown;
  version: number;
}

export interface StoreState<T = unknown> {
  data: T;
  version: number;
  updatedAt: number;
}

export interface SetStateOptions {
  expectedVersion?: number;
  waitForAck?: boolean;
  timeoutMs?: number;
}

export interface RegisterPayload {
  storeId: StoreId;
  pageId: PageId;
  storeKey: StoreKey;
  description: StoreDescription;
  initialState: unknown;
}

export interface StateChangedPayload {
  storeId: StoreId;
  state: unknown;
  version: number;
  source: string;
}

export interface StateAppliedPayload {
  storeId: StoreId;
  requestId: string;
  status: 'applied' | 'version_mismatch' | 'failed';
  version: number;
  error?: string;
}

// Messages from Browser to Gateway
export type GatewayMessage =
  | { type: 'store.register'; payload: RegisterPayload }
  | { type: 'store.stateChanged'; payload: StateChangedPayload }
  | { type: 'store.stateApplied'; payload: StateAppliedPayload }
  | { type: 'store.heartbeat' }
  | { type: 'store.disconnect' };

export interface ClientSetStatePayload {
  storeId?: StoreId;
  state: unknown;
  expectedVersion?: number;
  requestId?: string;
  version?: number;
}

// Messages from Gateway to Browser
export type ServerMessage =
  | { type: 'client.setState'; payload: ClientSetStatePayload }
  | { type: 'client.dispatch'; payload: { action: { type: string; payload?: unknown } } }
  | { type: 'client.ping' };

export type SubscriberMessage =
  | { type: 'store.registered'; payload: { storeId: StoreId; pageId: PageId; storeKey: StoreKey } }
  | { type: 'store.stateChanged'; payload: { storeId: StoreId; state: unknown; version: number; source: string } }
  | { type: 'store.disconnected'; payload: { storeId: StoreId; reason: string } };

export type GatewayClientMessage =
  | { type: 'subscribe'; payload: { storeId: StoreId } }
  | { type: 'unsubscribe'; payload: { storeId: StoreId } };

export interface StoreChangeEvent {
  type: 'stateChanged' | 'disconnected';
  storeId: StoreId;
  state?: unknown;
  version?: number;
  source?: string;
}

export type BridgeEvent =
  | { type: 'stateChanged'; storeId: StoreId; state: unknown; version: number; source: string }
  | { type: 'disconnected'; storeId: StoreId; reason: string }
  | { type: 'connected'; storeId: StoreId; pageId: PageId; storeKey: StoreKey };
