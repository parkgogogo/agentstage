import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { getPidFile, getProjectDir } from '../utils/paths.js';

export const statusCommand = new Command('status')
  .description('Show the Agentstage Runtime status')
  .action(async () => {
    const pidFile = getPidFile();
    const projectDir = getProjectDir();
    
    console.log();
    console.log(c.bold('Agentstage Runtime'));
    console.log(c.gray('─'.repeat(30)));
    console.log(`Directory: ${c.cyan(projectDir)}`);
    
    if (!existsSync(pidFile)) {
      console.log(`Status:    ${c.red('●')} Stopped`);
      console.log();
      return;
    }
    
    try {
      const pid = parseInt(await readFile(pidFile, 'utf8'));
      
      // 检查进程是否存在
      try {
        process.kill(pid, 0);
        console.log(`Status:    ${c.green('●')} Running`);
        console.log(`PID:       ${pid}`);
        console.log(`Web:       ${c.cyan('http://localhost:3000')}`);
        console.log(`Bridge:    ${c.cyan('ws://localhost:8787/_bridge')}`);
      } catch {
        console.log(`Status:    ${c.yellow('●')} Dead (PID file exists but process not found)`);
      }
      
    } catch (error: any) {
      console.log(`Status:    ${c.red('●')} Error: ${error.message}`);
    }
    
    console.log();
  });
