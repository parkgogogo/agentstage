import { WebSocketServer } from "ws";
import type WebSocket from "ws";
import type { IncomingMessage } from "http";
import { isObject, parseJsonRpcMessage, jsonRpcError, type JsonRpcId } from "../shared/protocol.js";
import { BridgeRegistry } from "./registry.js";
import { handleNotification, handleRequest, handleResponse } from "./handlers.js";

export type BridgeServerOptions = {
  port?: number;
  host?: string;
  token?: string;
};

function send(ws: WebSocket, msg: unknown) {
  ws.send(JSON.stringify(msg));
}

export function startBridgeServer(opts: BridgeServerOptions = {}) {
  const port = opts.port ?? 8787;
  const host = opts.host ?? "127.0.0.1";
  const token = opts.token;

  const reg = new BridgeRegistry();
  const wss = new WebSocketServer({ port, host });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    if (token) {
      const url = new URL(req.url ?? "", `http://${req.headers.host}`);
      const got = url.searchParams.get("token");
      if (got !== token) {
        ws.close(1008, "Unauthorized");
        return;
      }
    }

    ws.on("message", (data) => {
      const raw = data.toString("utf8");

      let id: JsonRpcId | null = null;
      try {
        const msg = parseJsonRpcMessage(raw);
        if ("id" in msg) id = (msg as any).id as JsonRpcId;

        if (!isObject(msg)) throw new Error("Invalid JSON-RPC message");

        // Requests / Notifications
        if ("method" in msg && typeof (msg as any).method === "string") {
          if ("id" in msg) {
            handleRequest(reg, ws, msg as any);
            return;
          }
          handleNotification(reg, ws, (msg as any).method, (msg as any).params);
          return;
        }

        // Responses
        if ("id" in msg && ("result" in msg || "error" in msg)) {
          handleResponse(reg, msg as any);
          return;
        }

        throw new Error("Unsupported JSON-RPC message");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send(ws, jsonRpcError(id, -32600, message));
      }
    });

    ws.on("close", () => {
      reg.removeWs(ws);
    });
  });

  return { wss, reg, port, host };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.BRIDGE_STORE_PORT ? Number(process.env.BRIDGE_STORE_PORT) : 8787;
  const token = process.env.BRIDGE_STORE_TOKEN;
  const server = startBridgeServer({ port, token });
  // eslint-disable-next-line no-console
  console.log(`bridge-store server ws://${server.host}:${server.port}${token ? "?token=***" : ""}`);
}
