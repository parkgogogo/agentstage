import type WebSocket from "ws";
import {
  isObject,
  jsonRpcError,
  jsonRpcResult,
  type JsonRpcId,
  type JsonRpcRequest,
} from "../shared/protocol.js";
import type { StageMeta, StoreId } from "../shared/types.js";
import { BridgeRegistry } from "./registry.js";

function send(ws: WebSocket, msg: unknown) {
  ws.send(JSON.stringify(msg));
}

function requireParams<T extends Record<string, unknown>>(params: unknown): T {
  if (!isObject(params)) throw new Error("Invalid params");
  return params as T;
}

export function broadcastStateChanged(reg: BridgeRegistry, storeId: StoreId, payload: { state: unknown; version: number; source?: string }) {
  const subs = reg.subscribers.get(storeId);
  if (!subs) return;
  const notification = {
    jsonrpc: "2.0",
    method: "store.stateChanged",
    params: { storeId, ...payload },
  };
  for (const sub of subs) {
    if (sub.ws.readyState === sub.ws.OPEN) send(sub.ws, notification);
  }
}

export function handleNotification(reg: BridgeRegistry, ws: WebSocket, method: string, params: unknown) {
  if (method === "host.register") {
    const p = requireParams<{ storeId: string; meta?: StageMeta; initialState?: unknown; version?: number }>(params);
    const storeId = p.storeId;
    if (!storeId || typeof storeId !== "string") throw new Error("storeId required");

    // Mvp policy: last-wins
    reg.setHost(storeId, {
      ws,
      storeId,
      meta: (p.meta ?? null) as StageMeta | null,
      state: p.initialState ?? null,
      version: typeof p.version === "number" ? p.version : 0,
    });

    const host = reg.getHost(storeId)!;
    broadcastStateChanged(reg, storeId, { state: host.state, version: host.version, source: "host.register" });
    return;
  }

  if (method === "host.stateChanged") {
    const p = requireParams<{ storeId: string; state: unknown; version?: number; source?: string }>(params);
    const storeId = p.storeId;
    const host = reg.getHost(storeId);
    if (!host) throw new Error("Unknown storeId");
    if (host.ws !== ws) throw new Error("Not store host");

    host.state = p.state;
    host.version = typeof p.version === "number" ? p.version : host.version + 1;

    broadcastStateChanged(reg, storeId, { state: host.state, version: host.version, source: p.source ?? "host" });
    return;
  }
}

export function handleResponse(reg: BridgeRegistry, msg: any) {
  const rawId = msg?.id;
  const forwardId = typeof rawId === "number" ? rawId : Number(rawId);
  if (!Number.isFinite(forwardId)) return;

  const pending = reg.pendingForwards.get(forwardId);
  if (!pending) return;
  reg.pendingForwards.delete(forwardId);

  const { clientWs, clientId } = pending;
  if (clientWs.readyState !== clientWs.OPEN) return;

  if ("result" in msg) {
    send(clientWs, { jsonrpc: "2.0", id: clientId, result: msg.result });
    return;
  }

  if ("error" in msg) {
    send(clientWs, { jsonrpc: "2.0", id: clientId, error: msg.error });
    return;
  }
}

export function handleRequest(reg: BridgeRegistry, ws: WebSocket, req: JsonRpcRequest) {
  const { id, method } = req;

  try {
    if (method === "store.getMeta") {
      const p = requireParams<{ storeId: string }>(req.params);
      const host = reg.getHost(p.storeId);
      if (!host) throw new Error("Store offline");
      send(ws, jsonRpcResult(id, { meta: host.meta }));
      return;
    }

    if (method === "store.getState") {
      const p = requireParams<{ storeId: string }>(req.params);
      const host = reg.getHost(p.storeId);
      if (!host) throw new Error("Store offline");
      send(ws, jsonRpcResult(id, { state: host.state, version: host.version }));
      return;
    }

    if (method === "store.subscribe") {
      const p = requireParams<{ storeId: string }>(req.params);
      reg.addSubscriber(p.storeId, ws);

      // immediate snapshot if any
      const host = reg.getHost(p.storeId);
      if (host) {
        send(ws, {
          jsonrpc: "2.0",
          method: "store.stateChanged",
          params: { storeId: p.storeId, state: host.state, version: host.version, source: "bridge.snapshot" },
        });
      }

      send(ws, jsonRpcResult(id, { ok: true }));
      return;
    }

    if (method === "store.setState") {
      const p = requireParams<{ storeId: string; state: unknown; expectedVersion?: number; source?: string }>(req.params);
      const host = reg.getHost(p.storeId);
      if (!host) throw new Error("Store offline");

      if (typeof p.expectedVersion === "number" && p.expectedVersion !== host.version) {
        send(ws, jsonRpcError(id, 409, "Version conflict", { currentVersion: host.version }));
        return;
      }

      const forwardId = ++reg.forwardSeq;
      reg.pendingForwards.set(forwardId, { clientWs: ws, clientId: id as JsonRpcId });

      send(host.ws, {
        jsonrpc: "2.0",
        id: forwardId,
        method: "client.setState",
        params: { state: p.state, expectedVersion: host.version, source: p.source ?? "agent" },
      });
      return;
    }

    if (method === "store.dispatch") {
      const p = requireParams<{ storeId: string; action: unknown; expectedVersion?: number; source?: string }>(req.params);
      const host = reg.getHost(p.storeId);
      if (!host) throw new Error("Store offline");

      if (typeof p.expectedVersion === "number" && p.expectedVersion !== host.version) {
        send(ws, jsonRpcError(id, 409, "Version conflict", { currentVersion: host.version }));
        return;
      }

      const forwardId = ++reg.forwardSeq;
      reg.pendingForwards.set(forwardId, { clientWs: ws, clientId: id as JsonRpcId });

      send(host.ws, {
        jsonrpc: "2.0",
        id: forwardId,
        method: "client.dispatch",
        params: { action: p.action, expectedVersion: host.version, source: p.source ?? "agent" },
      });
      return;
    }

    send(ws, jsonRpcError(id, -32601, `Method not found: ${method}`));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send(ws, jsonRpcError(id, -32000, message));
  }
}
