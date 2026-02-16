import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'pathe';
import { getWorkspaceDir, readRuntimeConfig, isInitialized } from '../utils/paths.js';
import { BridgeClient } from 'agent-stage-bridge/sdk';

export const lsCommand = new Command('ls')
  .description('List all pages and their store status')
  .action(async () => {
    try {
      // 1. 检查是否已初始化
      if (!isInitialized()) {
        consola.error('Project not initialized. Please run `agentstage init` first.');
        process.exit(1);
      }

      const workspaceDir = await getWorkspaceDir();
      const routesDir = join(workspaceDir, 'src', 'routes');

      let pages: string[] = [];
      if (existsSync(routesDir)) {
        const entries = await readdir(routesDir, { withFileTypes: true });
        pages = entries
          .filter(e => e.isFile() && e.name.endsWith('.tsx') && !e.name.startsWith('_'))
          .map(e => e.name.replace('.tsx', ''))
          .filter(name => name !== 'index'); // index is the home page
      }

      // 2. 检查是否已启动
      const config = await readRuntimeConfig();

      console.log();
      console.log(c.bold('Pages:'));
      console.log();

      let stores: any[] = [];
      if (config) {
        try {
          const client = new BridgeClient(`ws://localhost:${config.port}/_bridge`);
          await client.connect();
          stores = await client.listStores();
          client.disconnect();
        } catch {
          // Bridge 未运行
        }
      }

      // Show home page
      const homeStores = stores.filter(s => s.pageId === 'index');
      if (homeStores.length > 0) {
        console.log(`  ${c.green('●')} ${c.bold('/ (home)')}`);
        for (const store of homeStores) {
          console.log(`      └─ ${store.storeKey}  v${store.version}`);
        }
      } else {
        console.log(`  ${c.gray('○')} / (home)`);
      }

      // Show other pages
      if (pages.length === 0) {
        console.log(c.gray('  No additional pages. Create one with:'));
        console.log(c.gray('  agentstage add-page <name>'));
      } else {
        for (const page of pages) {
          const pageStores = stores.filter(s => s.pageId === page);

          if (pageStores.length > 0) {
            console.log(`  ${c.green('●')} ${c.bold('/' + page)}`);
            for (const store of pageStores) {
              console.log(`      └─ ${store.storeKey}  v${store.version}`);
            }
          } else {
            console.log(`  ${c.gray('○')} /${page}`);
          }
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
