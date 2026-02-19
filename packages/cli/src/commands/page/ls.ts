import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'pathe';
import { getWorkspaceDir, isInitialized, readRuntimeConfig } from '../../utils/paths.js';

export const pageLsCommand = new Command('ls')
  .description('List all pages')
  .action(async () => {
    if (!isInitialized()) {
      consola.error('Project not initialized. Please run `agentstage dev init` first.');
      process.exit(1);
    }

    const workspaceDir = await getWorkspaceDir();
    const routesDir = join(workspaceDir, 'src', 'routes');
    const config = await readRuntimeConfig();

    if (!existsSync(routesDir)) {
      consola.info('No pages found');
      return;
    }

    const entries = await readdir(routesDir, { withFileTypes: true });
    const pages = entries
      .filter((e) => e.isFile() && e.name.endsWith('.tsx'))
      .map((e) => e.name.replace('.tsx', ''))
      .filter((name) => name !== '__root');

    if (pages.length === 0) {
      consola.info('No pages found');
      console.log();
      console.log('Create your first page:');
      console.log(`  ${c.cyan('agentstage page add <name>')}`);
      return;
    }

    const port = config?.port || 3000;
    const baseUrl = config?.tunnelUrl || `http://localhost:${port}`;

    console.log();
    console.log(c.bold(`Found ${pages.length} page(s):`));
    console.log();

    for (const page of pages) {
      console.log(`  ${c.cyan(page)}`);
      console.log(`    URL: ${c.gray(`${baseUrl}/${page}`)}`);
      console.log(`    File: ${c.gray(`src/routes/${page}.tsx`)}`);
      console.log();
    }
  });
