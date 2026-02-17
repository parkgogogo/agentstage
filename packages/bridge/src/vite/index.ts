import type { Plugin, ViteDevServer } from 'vite';
import type { Server } from 'http';
import type { Http2SecureServer } from 'http2';
import { join } from 'path';
import { createBridgeGateway } from '../gateway/createBridgeGateway.js';

export interface BridgePluginOptions {
  pagesDir?: string;
}

export function bridgePlugin(options: BridgePluginOptions = {}): Plugin {
  return {
    name: 'agentstage-bridge',
    configureServer(server: ViteDevServer) {
      const pagesDir = options.pagesDir || join(process.cwd(), 'src', 'pages');
      const gateway = createBridgeGateway({ pagesDir });

      // 保存 gateway 引用供后续使用
      (server as any).bridgeGateway = gateway;

      // 同步检查 httpServer 是否可用
      if (server.httpServer) {
        gateway.attach(server.httpServer as Server | Http2SecureServer);
        console.log('[Bridge] WebSocket mounted at /_bridge');
        console.log('[Bridge] Pages directory:', pagesDir);
      } else {
        console.warn('[Bridge] httpServer not available during configureServer');
      }
    },
  };
}
