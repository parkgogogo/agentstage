import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { getPagesDir } from '../utils/paths.js';
import { BridgeClient } from '@agentstage/bridge/sdk';

export const lsCommand = new Command('ls')
  .description('List all pages and their store status')
  .action(async () => {
    try {
      const pagesDir = await getPagesDir();
      const pages = await readdir(pagesDir, { withFileTypes: true });
      
      console.log();
      console.log(c.bold('Pages:'));
      console.log();
      
      let stores: any[] = [];
      try {
        const client = new BridgeClient('ws://localhost:8787/_bridge');
        await client.connect();
        stores = await client.listStores();
        client.disconnect();
      } catch {
        // Bridge 未运行
      }
      
      for (const page of pages.filter(p => p.isDirectory())) {
        const pageStores = stores.filter(s => s.pageId === page.name);
        
        if (pageStores.length > 0) {
          console.log(`  ${c.green('●')} ${c.bold(page.name)}`);
          for (const store of pageStores) {
            console.log(`      └─ ${store.storeKey}  v${store.version}`);
          }
        } else {
          console.log(`  ${c.gray('○')} ${page.name}`);
        }
      }
      
      console.log();
      
      if (stores.length === 0) {
        console.log(c.gray('Runtime is not running. Run `agentstage start` to see live status.'));
        console.log();
      }
      
    } catch (error: any) {
      consola.error('Failed to list pages:', error.message);
    }
  });
