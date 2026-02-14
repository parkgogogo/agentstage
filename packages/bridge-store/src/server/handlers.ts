import type WebSocket from "ws";
import {
  isObject,
  jsonRpcError,
  jsonRpcResult,
  type JsonRpcId,
  type JsonRpcRequest,
} from "../shared/protocol.js";
import { SemanticError, semanticError } from "../shared/errors.js";
import type { PageId, StageMeta, StoreId, StoreKey } from "../shared/types.js";
import { BridgeRegistry } from "./registry.js";

function send(ws: WebSocket, msg: unknown) {
  ws.send(JSON.stringify(msg));
}

function requireParams<T extends Record<string, unknown>>(params: unknown): T {
  if (!isObject(params)) throw semanticError('INVALID_PARAMS', 'Invalid params');
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
    const p = requireParams<{
      storeId: string;
      pageId?: PageId;
      storeKey?: StoreKey;
      meta?: StageMeta;
      initialState?: unknown;
      version?: number;
    }>(params);
    const storeId = p.storeId;
    if (!storeId || typeof storeId !== "string") throw semanticError('INVALID_PARAMS', 'storeId required');

    const meta = (p.meta ?? null) as StageMeta | null;
    const pageId: PageId = (p.pageId ?? meta?.id ?? "page") as string;

    // Mvp policy: last-wins
    reg.setHost(storeId, {
      ws,
      storeId,
      pageId,
      storeKey: p.storeKey,
      meta,
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
    if (!host) throw semanticError('UNKNOWN_STORE_ID', 'Unknown storeId', { storeId });
    if (host.ws !== ws) throw semanticError('NOT_STORE_HOST', 'Not store host', { storeId });

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
      if (!host) throw semanticError('STORE_OFFLINE', 'Store offline', { storeId: p.storeId });
      send(ws, jsonRpcResult(id, { meta: host.meta }));
      return;
    }

    if (method === "store.getState") {
      const p = requireParams<{ storeId: string }>(req.params);
      const host = reg.getHost(p.storeId);
      if (!host) throw semanticError('STORE_OFFLINE', 'Store offline', { storeId: p.storeId });
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

    if (method === "page.listStores") {
      const p = requireParams<{ pageId: string }>(req.params);
      const storeIds = Array.from(reg.pageToStores.get(p.pageId) ?? []);
      const stores = storeIds
        .map((storeId) => reg.getHost(storeId))
        .filter(Boolean)
        .map((h) => ({
          storeId: h!.storeId,
          pageId: h!.pageId,
          storeKey: h!.storeKey ?? null,
          version: h!.version,
        }));
      send(ws, jsonRpcResult(id, { stores }));
      return;
    }

    if (method === "page.getStoresMeta") {
      const p = requireParams<{ pageId: string }>(req.params);
      const storeIds = Array.from(reg.pageToStores.get(p.pageId) ?? []);
      const stores = storeIds
        .map((storeId) => reg.getHost(storeId))
        .filter(Boolean)
        .map((h) => ({
          storeId: h!.storeId,
          pageId: h!.pageId,
          storeKey: h!.storeKey ?? null,
          meta: h!.meta,
          version: h!.version,
        }));
      send(ws, jsonRpcResult(id, { stores }));
      return;
    }

    if (method === "page.resolve") {
      const p = requireParams<{ pageId: string; storeKey: string }>(req.params);
      const map = reg.pageToStoreKeys.get(p.pageId);
      const storeId = map?.get(p.storeKey as any);
      if (!storeId) {
        send(ws, semanticError('STORE_NOT_FOUND', 'Store not found', { pageId: p.pageId, storeKey: p.storeKey }).toJsonRpc(id));
        return;
      }
      send(ws, jsonRpcResult(id, { storeId }));
      return;
    }

    if (method === "store.setState") {
      const p = requireParams<{ storeId: string; state: unknown; expectedVersion?: number; source?: string }>(req.params);
      const host = reg.getHost(p.storeId);
      if (!host) throw semanticError('STORE_OFFLINE', 'Store offline', { storeId: p.storeId });

      if (typeof p.expectedVersion === "number" && p.expectedVersion !== host.version) {
        send(ws, semanticError('VERSION_CONFLICT', 'Version conflict', { storeId: p.storeId, currentVersion: host.version, expectedVersion: p.expectedVersion }).toJsonRpc(id));
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
      if (!host) throw semanticError('STORE_OFFLINE', 'Store offline', { storeId: p.storeId });

      if (typeof p.expectedVersion === "number" && p.expectedVersion !== host.version) {
        send(ws, semanticError('VERSION_CONFLICT', 'Version conflict', { storeId: p.storeId, currentVersion: host.version, expectedVersion: p.expectedVersion }).toJsonRpc(id));
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

    send(ws, semanticError('METHOD_NOT_FOUND', `Method not found: ${method}`).toJsonRpc(id));
  } catch (err) {
    if (err instanceof SemanticError) {
      send(ws, err.toJsonRpc(id));
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    send(ws, semanticError('INTERNAL_ERROR', message).toJsonRpc(id));
  }
}
