import type { StoreApi } from "zustand/vanilla";
import type { StageAction, StageMeta, StoreId } from "../shared/types.js";
import type { JsonRpcRequest } from "../shared/protocol.js";
import { WsRpcTransport } from "./transport.js";

export type BridgeClientOptions<TState> = {
  bridgeUrl: string;
  storeId?: StoreId;
  meta: StageMeta;
  store: StoreApi<TState>;
  sourceName?: string; // e.g. "browser"
  validateState?: (state: unknown) => void;
  validateAction?: (action: StageAction) => void;
};

// Attaches a zustand store to the bridge server.
// - Registers storeId + meta + initial state
// - Pushes full state on any change (MVP)
// - Accepts remote setState / dispatch
function randomId(): string {
  const c: any = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}

function defaultStoreId(meta: StageMeta): StoreId {
  const base = meta.id ?? "store";
  return `${base}#${randomId().slice(0, 8)}`;
}

export async function attachZustandBridge<TState>(opts: BridgeClientOptions<TState>) {
  const { bridgeUrl, meta, store } = opts;
  const storeId = opts.storeId ?? defaultStoreId(meta);
  const validateState = opts.validateState;
  const validateAction = opts.validateAction;
  const sourceName = opts.sourceName ?? "browser";

  let version = 0;

  const rpc = new WsRpcTransport(bridgeUrl);

  // Remote: setState (merge by default to avoid wiping methods)
  rpc.on("client.setState", async (req: JsonRpcRequest) => {
    const p: any = req.params ?? {};
    if (validateState) validateState(p.state);
    store.setState(p.state, false);
    // version bump is handled by subscribe callback
    return { ok: true, version };
  });

  // Remote: dispatch
  rpc.on("client.dispatch", async (req: JsonRpcRequest) => {
    const p: any = req.params ?? {};
    const action = p.action as StageAction;
    if (validateAction) validateAction(action);

    const s: any = store.getState();
    if (typeof s.dispatch === "function") {
      await s.dispatch(action);
      return { ok: true, version };
    }

    // No dispatch handler; treat as no-op.
    return { ok: false, version, warning: "no-dispatch" };
  });

  await rpc.ready();

  rpc.notify("host.register", { storeId, meta, initialState: store.getState(), version });

  const unsub = store.subscribe((state) => {
    version += 1;
    rpc.notify("host.stateChanged", { storeId, state, version, source: sourceName });
  });

  return {
    storeId,
    rpc,
    close: () => {
      unsub();
      rpc.close();
    },
  };
}
