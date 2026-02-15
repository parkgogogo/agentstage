import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'pathe';
import { execa } from 'execa';
import { getWorkspaceDir } from '../utils/paths.js';

const REGISTRY_URL = 'https://ui.shadcn.com/registry/index.json';

export const componentsCommand = new Command('components')
  .description('Manage shadcn/ui components');

componentsCommand
  .command('list')
  .description('List installed and available components')
  .action(async () => {
    try {
      const workspaceDir = await getWorkspaceDir();
      const componentsDir = join(workspaceDir, 'components', 'ui');
      
      let installed: string[] = [];
      if (existsSync(componentsDir)) {
        const files = await readdir(componentsDir);
        installed = files.filter(f => f.endsWith('.tsx')).map(f => f.replace('.tsx', ''));
      }
      
      const registry = await fetch(REGISTRY_URL).then(r => r.json()).catch(() => null);
      const allComponents = registry?.items?.filter((i: any) => i.type === 'registry:ui') || [];
      const available = allComponents.filter((c: any) => !installed.includes(c.name));
      
      console.log();
      console.log(c.bold(`Installed (${installed.length}):`));
      if (installed.length > 0) {
        console.log('  ' + installed.map(n => c.green(n)).join('  '));
      } else {
        console.log(c.gray('  None'));
      }
      
      console.log();
      console.log(c.bold(`Available (${available.length}):`));
      if (available.length > 0) {
        const names = available.map((c: any) => c.name);
        console.log('  ' + names.slice(0, 20).join('  ') + (names.length > 20 ? ' ...' : ''));
      }
      
      console.log();
      console.log(`Use ${c.cyan('agentstage add <component>')} to install`);
      console.log();
      
    } catch (error: any) {
      consola.error('Failed to list components:', error.message);
    }
  });

componentsCommand
  .command('search')
  .description('Search for components')
  .argument('<query>', 'Search query')
  .action(async (query) => {
    try {
      const registry = await fetch(REGISTRY_URL).then(r => r.json()).catch(() => null);
      const components = registry?.items?.filter((i: any) => 
        i.type === 'registry:ui' && i.name.includes(query)
      ) || [];
      
      console.log();
      console.log(c.bold(`Found ${components.length} components:`));
      for (const comp of components) {
        console.log(`  ${c.cyan(comp.name)} - ${comp.description || ''}`);
      }
      console.log();
      
    } catch (error: any) {
      consola.error('Failed to search:', error.message);
    }
  });

export const addCommand = new Command('add')
  .description('Add a shadcn/ui component')
  .argument('<component>', 'Component name')
  .action(async (component) => {
    try {
      const workspaceDir = await getWorkspaceDir();
      
      consola.info(`Installing ${component}...`);
      
      await execa('npx', ['shadcn', 'add', component, '-y'], {
        cwd: workspaceDir,
        stdio: 'inherit',
      });
      
      consola.success(`${component} installed`);
      
    } catch (error: any) {
      consola.error('Installation failed:', error.message);
      process.exit(1);
    }
  });
