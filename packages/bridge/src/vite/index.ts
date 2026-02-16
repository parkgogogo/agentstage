import type { Plugin, ViteDevServer } from 'vite';
import type { Server } from 'http';
import type { Http2SecureServer } from 'http2';
import { createBridgeGateway } from '../gateway/createBridgeGateway.js';

export function bridgePlugin(): Plugin {
  return {
    name: 'agentstage-bridge',
    configureServer(server: ViteDevServer) {
      const gateway = createBridgeGateway();

      // 保存 gateway 引用供后续使用
      (server as any).bridgeGateway = gateway;

      // 同步检查 httpServer 是否可用
      if (server.httpServer) {
        gateway.attach(server.httpServer as Server | Http2SecureServer);
        console.log('[Bridge] WebSocket mounted at /_bridge');
      } else {
        console.warn('[Bridge] httpServer not available during configureServer');
      }
    },
  };
}
