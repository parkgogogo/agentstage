import { Command } from 'commander';
import consola from 'consola';
import { readFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { getPidFile, getWorkspaceDir } from '../utils/paths.js';

export const stopCommand = new Command('stop')
  .description('Stop the Agentstage Runtime')
  .action(async () => {
    const pidFile = await getPidFile();
    
    if (!existsSync(pidFile)) {
      consola.info('Runtime is not running');
      return;
    }
    
    try {
      const pid = parseInt(await readFile(pidFile, 'utf8'));
      
      try {
        process.kill(pid, 'SIGTERM');
        
        let attempts = 0;
        while (attempts < 10) {
          await new Promise(r => setTimeout(r, 500));
          try {
            process.kill(pid, 0);
            attempts++;
          } catch {
            break;
          }
        }
        
        if (attempts >= 10) {
          process.kill(pid, 'SIGKILL');
        }
        
      } catch (error: any) {
        if (error.code !== 'ESRCH') throw error;
      }
      
      await unlink(pidFile);
      consola.success('Runtime stopped');
      
    } catch (error: any) {
      consola.error('Failed to stop runtime:', error.message);
      process.exit(1);
    }
  });
