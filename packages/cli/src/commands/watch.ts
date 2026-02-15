import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { BridgeClient } from '@agentstage/bridge/sdk';

export const watchCommand = new Command('watch')
  .description('Watch a page for real-time changes')
  .argument('<page>', 'Page ID')
  .action(async (pageId) => {
    try {
      const client = new BridgeClient('ws://localhost:8787/_bridge');
      
      client.onEvent((event) => {
        const timestamp = new Date().toISOString();
        console.log(c.gray(`[${timestamp}]`), event);
      });
      
      await client.connect();
      
      // 查找并订阅所有该 page 的 stores
      const stores = await client.listStores();
      const pageStores = stores.filter(s => s.pageId === pageId);
      
      if (pageStores.length === 0) {
        consola.error(`Page "${pageId}" not found`);
        client.disconnect();
        process.exit(1);
      }
      
      for (const store of pageStores) {
        client.subscribe(store.id);
      }
      
      consola.success(`Watching ${c.cyan(pageId)}. Press Ctrl+C to exit.`);
      console.log();
      
      // 保持运行
      process.on('SIGINT', () => {
        console.log();
        consola.info('Stopped watching');
        client.disconnect();
        process.exit(0);
      });
      
      await new Promise(() => {});
      
    } catch (error: any) {
      consola.error('Failed to watch page:', error.message);
      process.exit(1);
    }
  });
