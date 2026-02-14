import type { StoreApi } from "zustand/vanilla";
import type { StageAction, StageMeta, StoreId } from "../shared/types.js";
import type { JsonRpcRequest } from "../shared/protocol.js";
import { WsRpcTransport } from "./transport.js";

export type BridgeClientOptions<TState> = {
  bridgeUrl: string;
  storeId: StoreId;
  meta: StageMeta;
  store: StoreApi<TState>;
  sourceName?: string; // e.g. "browser"
};

// Attaches a zustand store to the bridge server.
// - Registers storeId + meta + initial state
// - Pushes full state on any change (MVP)
// - Accepts remote setState / dispatch
export async function attachZustandBridge<TState>(opts: BridgeClientOptions<TState>) {
  const { bridgeUrl, storeId, meta, store } = opts;
  const sourceName = opts.sourceName ?? "browser";

  let version = 0;

  const rpc = new WsRpcTransport(bridgeUrl);

  // Remote: setState
  rpc.on("client.setState", async (req: JsonRpcRequest) => {
    const p: any = req.params ?? {};
    store.setState(p.state, true);
    // version bump is handled by subscribe callback
    return { ok: true, version };
  });

  // Remote: dispatch
  rpc.on("client.dispatch", async (req: JsonRpcRequest) => {
    const p: any = req.params ?? {};
    const action = p.action as StageAction;

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
    rpc,
    close: () => {
      unsub();
      rpc.close();
    },
  };
}
