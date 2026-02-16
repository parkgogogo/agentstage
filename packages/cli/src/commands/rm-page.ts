import { Command } from 'commander';
import consola from 'consola';
import { unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'pathe';
import { getWorkspaceDir, isInitialized } from '../utils/paths.js';

export const rmPageCommand = new Command('rm-page')
  .description('Remove a page from the routes directory')
  .argument('<name>', 'Page name')
  .action(async (name) => {
    // 检查是否已初始化
    if (!isInitialized()) {
      consola.error('Project not initialized. Please run `agentstage init` first.');
      process.exit(1);
    }

    try {
      const workspaceDir = await getWorkspaceDir();
      const routesDir = join(workspaceDir, 'src', 'routes');
      const pageFile = join(routesDir, `${name}.tsx`);

      if (!existsSync(pageFile)) {
        consola.error(`Page "${name}" not found at src/routes/${name}.tsx`);
        process.exit(1);
      }

      await unlink(pageFile);
      consola.success(`Page "${name}" deleted`);
      console.log(`  Note: TanStack Router will automatically remove the route`);

    } catch (error: any) {
      consola.error('Failed to delete page:', error.message);
      process.exit(1);
    }
  });
