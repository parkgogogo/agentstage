import { Command } from 'commander';
import * as p from '@clack/prompts';
import consola from 'consola';
import c from 'picocolors';
import { unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'pathe';
import { getWorkspaceDir, isInitialized } from '../../utils/paths.js';

export const pageRmCommand = new Command('rm')
  .description('Remove a page')
  .argument('<name>', 'Page name to remove')
  .option('-f, --force', 'Skip confirmation', false)
  .action(async (name, options) => {
    if (!isInitialized()) {
      consola.error('Project not initialized. Please run `agentstage dev init` first.');
      process.exit(1);
    }

    const workspaceDir = await getWorkspaceDir();
    const pageFile = join(workspaceDir, 'src', 'routes', `${name}.tsx`);
    const typeFile = join(workspaceDir, '.agentstage', 'types', `${name}.d.ts`);

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
      // Remove page file
      await unlink(pageFile);

      // Remove type file if exists
      if (existsSync(typeFile)) {
        await unlink(typeFile);
      }

      consola.success(`Page "${name}" removed`);
      console.log(`  Removed: ${c.gray(`src/routes/${name}.tsx`)}`);

    } catch (error: any) {
      consola.error('Failed to remove page:', error.message);
      process.exit(1);
    }
  });
