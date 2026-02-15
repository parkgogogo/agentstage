/**
 * Shared types for Bridge
 */

export interface ActionDefinition {
  description: string;
  payload?: unknown;
}

export interface EventDefinition {
  description: string;
  payload?: unknown;
}

export interface StoreDescription {
  pageId: string;
  storeKey: string;
  schema: unknown;
  actions: Record<string, ActionDefinition>;
  events?: Record<string, EventDefinition>;
}

export interface StoreState<T = unknown> {
  data: T;
  version: number;
  updatedAt: number;
}

// Messages from Browser to Gateway
export type GatewayMessage =
  | { type: 'store.register'; payload: RegisterPayload }
  | { type: 'store.stateChanged'; payload: StateChangedPayload }
  | { type: 'store.heartbeat' }
  | { type: 'store.disconnect' };

// Messages from Gateway to Browser
export type ServerMessage =
  | { type: 'client.setState'; payload: { state: unknown; expectedVersion?: number } }
  | { type: 'client.dispatch'; payload: { action: { type: string; payload?: unknown } } }
  | { type: 'client.ping' };

interface RegisterPayload {
  storeId: string;
  pageId: string;
  storeKey: string;
  description: StoreDescription;
  initialState: unknown;
}

interface StateChangedPayload {
  storeId: string;
  state: unknown;
  version: number;
  source: string;
}
