import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { BridgeClient } from '@agentstage/bridge/sdk';
import { readRuntimeConfig, isInitialized } from '../utils/paths.js';

export const inspectCommand = new Command('inspect')
  .description('Inspect a page\'s schema, actions, and current state')
  .argument('<page>', 'Page ID')
  .action(async (pageId) => {
    try {
      // 1. 检查是否已初始化
      if (!isInitialized()) {
        consola.error('Project not initialized. Please run `agentstage init` first.');
        process.exit(1);
      }

      // 2. 检查是否已启动
      const config = await readRuntimeConfig();
      if (!config) {
        consola.error('Runtime is not running. Please run `agentstage start` first.');
        process.exit(1);
      }

      const client = new BridgeClient(`ws://localhost:${config.port}/_bridge`);
      await client.connect();
      
      // 查找 page 对应的 store
      const stores = await client.listStores();
      const pageStores = stores.filter(s => s.pageId === pageId);
      
      if (pageStores.length === 0) {
        consola.error(`Page "${pageId}" not found or not connected`);
        client.disconnect();
        process.exit(1);
      }
      
      for (const storeInfo of pageStores) {
        const description = await client.describe?.(storeInfo.id);
        const state = await client.getState?.(storeInfo.id);
        
        console.log();
        console.log(c.bold(`${pageId}/${storeInfo.storeKey}`));
        console.log(c.gray('─'.repeat(40)));
        
        if (description) {
          console.log(c.bold('Schema:'));
          console.log(JSON.stringify(description.schema, null, 2));
          console.log();
          
          console.log(c.bold('Actions:'));
          if (description.actions) {
            for (const [name, action] of Object.entries(description.actions as any)) {
              console.log(`  ${c.cyan(name)} - ${(action as any).description || ''}`);
            }
          }
          console.log();
        }
        
        if (state) {
          console.log(c.bold('Current State:'));
          console.log(JSON.stringify(state.state, null, 2));
        }
      }
      
      console.log();
      client.disconnect();
      
    } catch (error: any) {
      consola.error('Failed to inspect page:', error.message);
      process.exit(1);
    }
  });
