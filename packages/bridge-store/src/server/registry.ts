import type WebSocket from "ws";
import type { JsonRpcId } from "../shared/protocol.js";
import type { StageMeta, StoreId } from "../shared/types.js";

export type HostConn = {
  ws: WebSocket;
  storeId: StoreId;
  meta: StageMeta | null;
  state: unknown;
  version: number;
};

export type SubscriberConn = { ws: WebSocket };

export class BridgeRegistry {
  hosts = new Map<StoreId, HostConn>();
  subscribers = new Map<StoreId, Set<SubscriberConn>>();

  // Forwards: bridge request id -> { clientWs, clientId }
  forwardSeq = 0;
  pendingForwards = new Map<number, { clientWs: WebSocket; clientId: JsonRpcId }>();

  setHost(storeId: StoreId, host: HostConn) {
    this.hosts.set(storeId, host);
  }

  getHost(storeId: StoreId) {
    return this.hosts.get(storeId);
  }

  removeWs(ws: WebSocket) {
    for (const [storeId, host] of this.hosts.entries()) {
      if (host.ws === ws) this.hosts.delete(storeId);
    }

    for (const subs of this.subscribers.values()) {
      for (const s of subs) {
        if (s.ws === ws) subs.delete(s);
      }
    }

    for (const [fid, pending] of this.pendingForwards.entries()) {
      if (pending.clientWs === ws) this.pendingForwards.delete(fid);
    }
  }

  addSubscriber(storeId: StoreId, ws: WebSocket) {
    const set = this.subscribers.get(storeId) ?? new Set<SubscriberConn>();
    set.add({ ws });
    this.subscribers.set(storeId, set);
  }
}
