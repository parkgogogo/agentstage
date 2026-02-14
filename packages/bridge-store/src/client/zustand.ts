import type { StoreApi } from "zustand/vanilla";
import type { PageId, StageAction, StageMeta, StoreId, StoreKey } from "../shared/types.js";
import type { JsonRpcRequest } from "../shared/protocol.js";
import { WsRpcTransport } from "./transport.js";

export type StoreHostOptions<TState> = {
  bridgeUrl: string;
  pageId?: PageId;
  storeKey?: StoreKey;
  storeId?: StoreId;
  meta: StageMeta;
  store: StoreApi<TState>;
  sourceName?: string; // e.g. "browser"
  validateState?: (state: unknown) => void;
  validateAction?: (action: StageAction) => void;
};

/** @deprecated Use StoreHostOptions */
export type BridgeClientOptions<TState> = StoreHostOptions<TState>;

// Attaches a zustand store to the bridge server.
// - Registers storeId + meta + initial state
// - Pushes full state on any change (MVP)
// - Accepts remote setState / dispatch
function randomId(): string {
  const c: any = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}

function defaultPageId(meta: StageMeta): PageId {
  return (meta.id ?? "page") as string;
}

function defaultStoreId(pageId: PageId): StoreId {
  return `${pageId}#${randomId().slice(0, 8)}`;
}

export async function attachZustandHost<TState>(opts: StoreHostOptions<TState>) {
  const { bridgeUrl, meta, store } = opts;
  const pageId = opts.pageId ?? defaultPageId(meta);
  const storeId = opts.storeId ?? defaultStoreId(pageId);
  const storeKey = opts.storeKey;
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

  rpc.notify("host.register", { storeId, pageId, storeKey, meta, initialState: store.getState(), version });

  const unsub = store.subscribe((state) => {
    version += 1;
    rpc.notify("host.stateChanged", { storeId, state, version, source: sourceName });
  });

  return {
    pageId,
    storeKey,
    storeId,
    rpc,
    close: () => {
      unsub();
      rpc.close();
    },
  };
}

/** @deprecated Use attachZustandHost */
export const attachZustandBridge = attachZustandHost;
