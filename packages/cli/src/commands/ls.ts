import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'pathe';
import { getWorkspaceDir, readRuntimeConfig, isInitialized } from '../utils/paths.js';
import { BridgeClient } from 'agent-stage-bridge/sdk';

interface ListedStore {
  pageId: string;
  storeKey: string;
  version: number;
}

async function readLocalStores(localPagesDir: string): Promise<ListedStore[]> {
  if (!existsSync(localPagesDir)) {
    return [];
  }

  const entries = await readdir(localPagesDir, { withFileTypes: true });
  const stores: ListedStore[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const pageId = entry.name;
    const storePath = join(localPagesDir, pageId, 'store.json');
    if (!existsSync(storePath)) {
      continue;
    }

    try {
      const content = await readFile(storePath, 'utf8');
      const parsed = JSON.parse(content) as { pageId?: unknown; version?: unknown };
      stores.push({
        pageId: typeof parsed.pageId === 'string' ? parsed.pageId : pageId,
        storeKey: 'main',
        version: typeof parsed.version === 'number' ? parsed.version : 0,
      });
    } catch {
      // Ignore invalid local files in offline mode
    }
  }

  return stores;
}

export const lsCommand = new Command('ls')
  .description('List all pages and their store status')
  .option('--offline', 'Skip Bridge WebSocket and list local store files only')
  .action(async (options) => {
    try {
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

      console.log();
      console.log(c.bold('Pages:'));
      console.log();

      let stores: ListedStore[] = [];
      const localPagesDir = join(homedir(), '.agentstage', 'webapp', 'pages');

      if (options.offline) {
        stores = await readLocalStores(localPagesDir);
      } else {
        const config = await readRuntimeConfig();

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
      }

      const pageSet = new Set(pages);
      for (const store of stores) {
        if (store.pageId !== 'index') {
          pageSet.add(store.pageId);
        }
      }
      const listedPages = Array.from(pageSet);

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
      if (listedPages.length === 0) {
        console.log(c.gray('  No additional pages. Create one with:'));
        console.log(c.gray('  agentstage add-page <name>'));
      } else {
        for (const page of listedPages) {
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
        if (options.offline) {
          console.log(c.gray(`No local store files found in ${localPagesDir}`));
        } else {
          console.log(c.gray('Runtime is not running. Run `agentstage start` to see live status.'));
        }
        console.log();
      }

    } catch (error: any) {
      consola.error('Failed to list pages:', error.message);
    }
  });
