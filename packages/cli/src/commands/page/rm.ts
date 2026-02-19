import { Command } from 'commander';
import * as p from '@clack/prompts';
import consola from 'consola';
import c from 'picocolors';
import { unlink, rmdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'pathe';
import { getWorkspaceDir, isInitialized } from '../../utils/paths.js';
import { printAgentErrorHelp, printAgentSuccess } from '../../utils/agent-helper.js';

// 安全验证：页面名称只允许字母、数字、连字符
const PAGE_NAME_PATTERN = /^[a-z0-9-]+$/;

export const pageRmCommand = new Command('rm')
  .description('Remove a page')
  .argument('<name>', 'Page name to remove')
  .option('-f, --force', 'Skip confirmation', false)
  .action(async (name, options) => {
    if (!isInitialized()) {
      printAgentErrorHelp('Project not initialized');
      process.exit(1);
    }

    // 安全验证：严格检查页面名称
    if (!PAGE_NAME_PATTERN.test(name)) {
      printAgentErrorHelp('Page name contains invalid characters');
      process.exit(1);
    }

    const workspaceDir = await getWorkspaceDir();
    const pageFile = join(workspaceDir, 'src', 'routes', `${name}.tsx`);
    const pageDir = join(workspaceDir, 'src', 'pages', name);
    
    // 安全检查：确保解析后的路径在工作目录内
    const resolvedPageFile = resolve(pageFile);
    const routesDir = resolve(join(workspaceDir, 'src', 'routes'));
    if (!resolvedPageFile.startsWith(routesDir)) {
      consola.error('Invalid page name: path traversal detected.');
      process.exit(1);
    }

    if (!existsSync(pageFile)) {
      consola.error(`Page "${name}" not found at src/routes/${name}.tsx`);
      process.exit(1);
    }

    // Confirm deletion
    if (!options.force) {
      const confirmed = await p.confirm({
        message: `Are you sure you want to remove page "${name}"?`,
        initialValue: false,
      });

      if (p.isCancel(confirmed) || !confirmed) {
        consola.info('Cancelled');
        return;
      }
    }

    try {
      const uiFile = join(pageDir, 'ui.json');
      const storeFile = join(pageDir, 'store.json');
      const typeFile = join(workspaceDir, '.agentstage', 'types', `${name}.d.ts`);

      // Remove route file
      await unlink(pageFile);
      console.log(`  Removed: ${c.gray(`src/routes/${name}.tsx`)}`);

      // Remove UI file if exists
      if (existsSync(uiFile)) {
        await unlink(uiFile);
        console.log(`  Removed: ${c.gray(`src/pages/${name}/ui.json`)}`);
      }

      // Remove store file if exists
      if (existsSync(storeFile)) {
        await unlink(storeFile);
        console.log(`  Removed: ${c.gray(`src/pages/${name}/store.json`)}`);
      }

      // Try to remove page directory (if empty)
      if (existsSync(pageDir)) {
        try {
          await rmdir(pageDir);
          console.log(`  Removed: ${c.gray(`src/pages/${name}/`)}`);
        } catch {
          // Directory not empty, skip
        }
      }

      // Remove type file if exists
      if (existsSync(typeFile)) {
        await unlink(typeFile);
        console.log(`  Removed: ${c.gray(`.agentstage/types/${name}.d.ts`)}`);
      }

      printAgentSuccess(`Page "${name}" removed`);

    } catch (error: any) {
      printAgentErrorHelp('Failed to remove page', error.message);
      process.exit(1);
    }
  });
