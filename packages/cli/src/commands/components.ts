import { Command } from 'commander';
import * as p from '@clack/prompts';
import consola from 'consola';
import c from 'picocolors';
import { execa } from 'execa';
import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'pathe';
import { getWorkspaceDir, isInitialized } from '../utils/paths.js';

export const componentsCommand = new Command('components')
  .description('Manage shadcn/ui components');

// 检查初始化中间件
const checkInit = () => {
  if (!isInitialized()) {
    consola.error('Project not initialized. Please run `agentstage init` first.');
    process.exit(1);
  }
};

componentsCommand
  .command('list')
  .description('List installed components')
  .action(async () => {
    checkInit();
    try {
      const workspaceDir = await getWorkspaceDir();

      // 支持 src/components/ui (TanStack Start) 和 components/ui 两种结构
      let componentsDir = join(workspaceDir, 'src', 'components', 'ui');
      if (!existsSync(componentsDir)) {
        componentsDir = join(workspaceDir, 'components', 'ui');
      }

      let installed: string[] = [];
      if (existsSync(componentsDir)) {
        const files = await readdir(componentsDir);
        installed = files.filter(f => f.endsWith('.tsx')).map(f => f.replace('.tsx', ''));
      }

      console.log();
      console.log(c.bold(`Installed (${installed.length}):`));
      if (installed.length > 0) {
        console.log('  ' + installed.map(n => c.green(n)).join('  '));
      } else {
        console.log(c.gray('  None'));
      }

      console.log();
      console.log(`Use ${c.cyan('agentstage components available')} to see available components`);
      console.log(`Use ${c.cyan('agentstage components add <component>')} to install`);
      console.log();

    } catch (error: any) {
      consola.error('Failed to list components:', error.message);
    }
  });

componentsCommand
  .command('available')
  .description('List available components from shadcn/ui registry')
  .action(async () => {
    checkInit();
    try {
      const workspaceDir = await getWorkspaceDir();

      console.log();
      consola.info('Fetching available components from shadcn/ui registry...');
      console.log();

      // 使用 shadcn 原生的 list 命令
      await execa('npx', ['shadcn@latest', 'list', '@shadcn'], {
        cwd: workspaceDir,
        stdio: 'inherit',
      });

    } catch (error: any) {
      consola.error('Failed to list available components:', error.message);
    }
  });

componentsCommand
  .command('search')
  .description('Search for components in shadcn/ui registry')
  .argument('<query>', 'Search query')
  .action(async (query) => {
    checkInit();
    try {
      const workspaceDir = await getWorkspaceDir();

      console.log();
      consola.info(`Searching for "${query}"...`);
      console.log();

      // 使用 shadcn 原生的 search 命令
      await execa('npx', ['shadcn@latest', 'search', '@shadcn', '-q', query], {
        cwd: workspaceDir,
        stdio: 'inherit',
      });

    } catch (error: any) {
      consola.error('Failed to search:', error.message);
    }
  });

componentsCommand
  .command('add')
  .description('Add a shadcn/ui component')
  .argument('<component>', 'Component name (e.g., button, card, dialog)')
  .action(async (component) => {
    checkInit();
    const s = p.spinner();

    try {
      const workspaceDir = await getWorkspaceDir();

      s.start(`Installing ${component}...`);

      await execa('npx', ['shadcn@latest', 'add', component, '-y'], {
        cwd: workspaceDir,
        stdio: 'pipe',
      });

      s.stop(`${c.green('✓')} ${component} installed`);

    } catch (error: any) {
      s.stop('Installation failed');
      consola.error(error.message);
      process.exit(1);
    }
  });

componentsCommand
  .command('view')
  .description('View a component before installing')
  .argument('<component>', 'Component name to view')
  .action(async (component) => {
    checkInit();
    try {
      const workspaceDir = await getWorkspaceDir();

      console.log();
      consola.info(`Viewing ${component}...`);
      console.log();

      // 使用 shadcn 原生的 view 命令
      await execa('npx', ['shadcn@latest', 'view', component], {
        cwd: workspaceDir,
        stdio: 'inherit',
      });

    } catch (error: any) {
      consola.error('Failed to view component:', error.message);
    }
  });
