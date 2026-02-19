import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'pathe';
import { getWorkspaceDir, isInitialized } from '../../utils/paths.js';

export const pageGetUiCommand = new Command('get-ui')
  .description('Get the UI spec for a page')
  .argument('<name>', 'Page name')
  .option('-p, --pretty', 'Pretty print JSON', true)
  .action(async (name, options) => {
    if (!isInitialized()) {
      consola.error('Project not initialized. Please run `agentstage init` first.');
      process.exit(1);
    }

    const workspaceDir = await getWorkspaceDir();
    const uiFile = join(workspaceDir, 'src', 'pages', name, 'ui.json');

    if (!existsSync(uiFile)) {
      consola.error(`UI spec not found for page "${name}"`);
      process.exit(1);
    }

    try {
      const content = await readFile(uiFile, 'utf8');
      const uiSpec = JSON.parse(content);
      
      if (options.pretty) {
        console.log(JSON.stringify(uiSpec, null, 2));
      } else {
        console.log(JSON.stringify(uiSpec));
      }
    } catch (error: any) {
      consola.error('Failed to read UI spec:', error.message);
      process.exit(1);
    }
  });
