import { Command } from 'commander';
import * as p from '@clack/prompts';
import consola from 'consola';
import c from 'picocolors';
import { execa } from 'execa';
import { getWorkspaceDir } from '../utils/paths.js';

export const addCommand = new Command('add')
  .description('Add a shadcn/ui component')
  .argument('<component>', 'Component name')
  .action(async (component) => {
    const s = p.spinner();
    
    try {
      const workspaceDir = await getWorkspaceDir();
      
      s.start(`Installing ${component}...`);
      
      await execa('npx', ['shadcn', 'add', component, '-y'], {
        cwd: projectDir,
        stdio: 'pipe',
      });
      
      s.stop(`${c.green('✓')} ${component} installed`);
      
    } catch (error: any) {
      s.stop('Installation failed');
      consola.error(error.message);
      process.exit(1);
    }
  });
