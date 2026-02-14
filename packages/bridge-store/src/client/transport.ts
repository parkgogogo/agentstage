import {
  jsonRpcError,
  jsonRpcResult,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcSuccess,
  type JsonRpcFailure,
} from "../shared/protocol.js";
import { SemanticError, semanticError } from "../shared/errors.js";

export type RpcHandler = (req: JsonRpcRequest) => Promise<unknown> | unknown;

export class WsRpcTransport {
  ws: WebSocket;
  nextId = 1;
  pending = new Map<JsonRpcId, { resolve: (v: any) => void; reject: (e: any) => void }>();
  handlers = new Map<string, RpcHandler>();

  constructor(url: string) {
    this.ws = new WebSocket(url);

    this.ws.addEventListener("message", (ev) => {
      this.onMessage(String(ev.data));
    });

    this.ws.addEventListener("close", () => {
      for (const [id, p] of this.pending.entries()) {
        p.reject(new Error("WS closed"));
        this.pending.delete(id);
      }
    });
  }

  on(method: string, handler: RpcHandler) {
    this.handlers.set(method, handler);
  }

  async ready(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("WS error"));
      };
      const cleanup = () => {
        this.ws.removeEventListener("open", onOpen);
        this.ws.removeEventListener("error", onError);
      };
      this.ws.addEventListener("open", onOpen);
      this.ws.addEventListener("error", onError);
    });
  }

  notify(method: string, params?: unknown) {
    this.ws.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  request(method: string, params?: unknown): Promise<any> {
    const id = this.nextId++;
    const req = { jsonrpc: "2.0", id, method, params };
    this.ws.send(JSON.stringify(req));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  private async onMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Response
    if (msg && msg.jsonrpc === "2.0" && "id" in msg && ("result" in msg || "error" in msg)) {
      const pending = this.pending.get(msg.id as JsonRpcId);
      if (!pending) return;
      this.pending.delete(msg.id as JsonRpcId);

      if ("result" in msg) pending.resolve((msg as JsonRpcSuccess).result);
      else pending.reject((msg as JsonRpcFailure).error);
      return;
    }

    // Request to client
    if (msg && msg.jsonrpc === "2.0" && "id" in msg && typeof msg.method === "string") {
      const handler = this.handlers.get(msg.method);
      if (!handler) {
        this.ws.send(JSON.stringify(jsonRpcError(msg.id, -32601, `Method not found: ${msg.method}`)));
        return;
      }

      try {
        const result = await handler(msg as JsonRpcRequest);
        this.ws.send(JSON.stringify(jsonRpcResult(msg.id, result)));
      } catch (err) {
        if (err instanceof SemanticError) {
          this.ws.send(JSON.stringify(err.toJsonRpc(msg.id)));
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        this.ws.send(JSON.stringify(semanticError('INTERNAL_ERROR', message).toJsonRpc(msg.id)));
      }
    }

    // Notification: ignore in transport
  }

  close() {
    this.ws.close();
  }
}
