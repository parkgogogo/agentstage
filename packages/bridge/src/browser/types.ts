import type { StoreApi } from 'zustand/vanilla';
import type { ZodSchema } from 'zod';
import type { StoreDescription, StoreState } from '../shared/types.js';

export interface CreateBridgeStoreOptions<
  TState,
  TActions extends Record<string, { payload?: unknown }>
> {
  gatewayUrl?: string;
  pageId: string;
  storeKey?: string;
  description: {
    schema: ZodSchema<TState>;
    actions: {
      [K in keyof TActions]: {
        description: string;
        payload?: ZodSchema<TActions[K]['payload']>;
      }
    };
    events?: Record<string, { description: string; payload?: ZodSchema<unknown> }>;
  };
  createState: (
    set: (fn: (state: TState) => Partial<TState>) => void,
    get: () => TState
  ) => TState;
}

export interface BridgeStore<TState> {
  readonly store: StoreApi<TState>;
  describes(): StoreDescription;
  connect(): Promise<{ storeId: string; disconnect: () => void }>;
  readonly isConnected: boolean;
  readonly isHydrated: boolean;
}

export type { StoreDescription, StoreState };
