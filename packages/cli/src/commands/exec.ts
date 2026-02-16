import { Command } from 'commander';
import consola from 'consola';
import { BridgeClient } from '@agentstage/bridge/sdk';
import { readRuntimeConfig, isInitialized } from '../utils/paths.js';

export const execCommand = new Command('exec')
  .description('Execute an action on a page or set state')
  .argument('<page>', 'Page ID')
  .argument('[action]', 'Action name')
  .argument('[payload]', 'Action payload as JSON')
  .option('-s, --state <json>', 'Set state directly')
  .action(async (pageId, action, payload, options) => {
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
      consola.info(`Found ${stores.length} stores:`, stores.map(s => `${s.pageId}:${s.storeKey} (${s.id})`));
      const store = stores.find(s => s.pageId === pageId && s.storeKey === 'main');

      if (!store) {
        consola.error(`Page "${pageId}" not found`);
        consola.info('Available pages:', stores.map(s => s.pageId));
        client.disconnect();
        process.exit(1);
      }

      if (options.state) {
        // 设置 state
        const state = JSON.parse(options.state);
        await client.setState(store.id, state);
        consola.success('State updated');
      } else if (action) {
        // 执行 action
        const actionPayload = payload ? JSON.parse(payload) : undefined;
        await client.dispatch(store.id, { type: action, payload: actionPayload });
        consola.success(`Action "${action}" executed`);
      } else {
        consola.error('Please specify an action or use --state');
        client.disconnect();
        process.exit(1);
      }

      client.disconnect();

    } catch (error: any) {
      consola.error('Failed to execute:', error.message);
      process.exit(1);
    }
  });
