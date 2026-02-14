import { createStore, type StoreApi } from "zustand/vanilla";
import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import type { StageAction, StageMeta, StoreId } from "../shared/types.js";
import { attachZustandBridge } from "./zustand.js";

export type ZodActionDef = {
  type: string;
  description?: string;
  payloadSchema?: ZodTypeAny;
  danger?: boolean;
  confirmText?: string;
};

export type ZodEventDef = {
  type: string;
  description?: string;
  payloadSchema?: ZodTypeAny;
};

export type BridgeStoreOptions<TState> = {
  bridgeUrl: string;

  // A human/semantic id is still useful (e.g. "subagents-monitor")
  // storeId will be auto-generated if omitted.
  storeId?: StoreId;

  // Meta can include Zod schemas; we'll convert them to JSON Schema for wire.
  meta: Omit<StageMeta, "store"> & {
    store?: {
      version?: number;
      stateSchema?: ZodTypeAny;
      actions?: ZodActionDef[];
      events?: ZodEventDef[];
    };
  };

  // Zustand store initializer (vanilla)
  // NOTE: we keep this intentionally simple to avoid heavy Zustand generic types.
  createState: (set: any, get: any, api: StoreApi<TState>) => TState;

  sourceName?: string;
};

function toJsonSchema(schema: ZodTypeAny): unknown {
  // Keep it simple: no refs
  const out = zodToJsonSchema(schema as any, { $refStrategy: "none" });
  // zod-to-json-schema returns { $schema, definitions?, ...schema }
  return (out as any).schema ?? out;
}

export async function createBridgeStore<TState>(opts: BridgeStoreOptions<TState>): Promise<{
  store: StoreApi<TState>;
  storeId: StoreId;
  close: () => void;
}> {
  const store = createStore<TState>(opts.createState);

  const stateSchema = opts.meta.store?.stateSchema;
  const actionDefs = opts.meta.store?.actions ?? [];

  const actionSchemaMap = new Map<string, ZodTypeAny>();
  for (const a of actionDefs) {
    if (a.payloadSchema) actionSchemaMap.set(a.type, a.payloadSchema);
  }

  const validateState = stateSchema
    ? (state: unknown) => {
        const r = stateSchema.safeParse(state);
        if (!r.success) {
          // throw to become JSON-RPC error
          throw new Error(`Invalid state: ${r.error.issues[0]?.message ?? "zod"}`);
        }
      }
    : undefined;

  const validateAction = (action: StageAction) => {
    if (!action || typeof action.type !== "string") throw new Error("Invalid action: missing type");
    const sch = actionSchemaMap.get(action.type);
    if (!sch) return; // unknown allowed for now (MVP)
    const r = sch.safeParse(action.payload ?? {});
    if (!r.success) {
      throw new Error(`Invalid action payload: ${r.error.issues[0]?.message ?? "zod"}`);
    }
  };

  const wireMeta: StageMeta = {
    ...(opts.meta as any),
    store: {
      version: opts.meta.store?.version,
      stateSchema: stateSchema ? toJsonSchema(stateSchema) : undefined,
      actions: actionDefs.map((a) => ({
        type: a.type,
        description: a.description,
        payloadSchema: a.payloadSchema ? toJsonSchema(a.payloadSchema) : undefined,
        danger: a.danger,
        confirmText: a.confirmText,
      })),
      events: (opts.meta.store?.events ?? []).map((e) => ({
        type: e.type,
        description: e.description,
        payloadSchema: e.payloadSchema ? toJsonSchema(e.payloadSchema) : undefined,
      })),
    },
  };

  const attached = await attachZustandBridge({
    bridgeUrl: opts.bridgeUrl,
    storeId: opts.storeId,
    meta: wireMeta,
    store,
    sourceName: opts.sourceName,
    validateState,
    validateAction,
  });

  return {
    store,
    storeId: attached.storeId,
    close: attached.close,
  };
}
