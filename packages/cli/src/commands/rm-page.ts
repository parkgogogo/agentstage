import { Command } from 'commander';
import consola from 'consola';
import { rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'pathe';
import { getPagesDir } from '../utils/paths.js';

export const rmPageCommand = new Command('rm-page')
  .description('Remove a page')
  .argument('<name>', 'Page name')
  .action(async (name) => {
    try {
      const pagesDir = await getPagesDir();
      const pageDir = join(pagesDir, name);
      
      if (!existsSync(pageDir)) {
        consola.error(`Page "${name}" not found`);
        process.exit(1);
      }
      
      await rm(pageDir, { recursive: true });
      consola.success(`Page "${name}" deleted`);
      
    } catch (error: any) {
      consola.error('Failed to delete page:', error.message);
      process.exit(1);
    }
  });
