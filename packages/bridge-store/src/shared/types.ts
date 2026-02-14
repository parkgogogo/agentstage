export type StoreId = string;

export type StageMeta = {
  id?: string;
  title?: string;
  description?: string;
  store?: {
    version?: number;
    stateSchema?: unknown;
    actions?: Array<{ type: string; description?: string; payloadSchema?: unknown; danger?: boolean; confirmText?: string }>;
    events?: Array<{ type: string; description?: string; payloadSchema?: unknown }>;
  };
  [k: string]: unknown;
};

export type StageAction = { type: string; payload?: unknown };

export type StoreStateEnvelope = {
  storeId: StoreId;
  state: unknown;
  version: number;
  source?: string;
};
