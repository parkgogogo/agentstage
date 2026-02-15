import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'pathe';
import { getProjectDir } from '../utils/paths.js';

const REGISTRY_URL = 'https://ui.shadcn.com/registry/index.json';

export const componentsCommand = new Command('components')
  .description('Manage shadcn/ui components');

componentsCommand
  .command('list')
  .description('List installed and available components')
  .action(async () => {
    try {
      const projectDir = getProjectDir();
      const componentsDir = join(projectDir, 'components', 'ui');
      
      // 获取已安装组件
      let installed: string[] = [];
      if (existsSync(componentsDir)) {
        const files = await readdir(componentsDir);
        installed = files.filter(f => f.endsWith('.tsx')).map(f => f.replace('.tsx', ''));
      }
      
      // 获取 registry 中的所有组件
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
        console.log('  ' + names.join('  '));
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
