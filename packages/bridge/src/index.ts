/**
 * Agentstage Bridge
 *
 * Agent 控制浏览器页面的核心基础设施
 *
 * @example
 * // Gateway side (TanStack Start)
 * import { createBridgeGateway, createBridgeApiHandler } from '@agentstage/bridge';
 *
 * // Browser side
 * import { createBridgeStore } from '@agentstage/bridge/browser';
 *
 * // CLI/SDK side
 * import { BridgeClient } from '@agentstage/bridge/sdk';
 *
 * // Vite Plugin
 * import { bridgePlugin } from '@agentstage/bridge/vite';
 */

export type * from './shared/types.js';
export type * from './gateway/types.js';
export { createBridgeGateway } from './gateway/createBridgeGateway.js';
export { createBridgeApiHandler } from './gateway/apiHandler.js';
export { StoreRegistry } from './gateway/registry.js';
export { bridgePlugin } from './vite/index.js';
