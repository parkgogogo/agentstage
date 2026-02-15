import { Command } from 'commander';
import * as p from '@clack/prompts';
import consola from 'consola';
import c from 'picocolors';
import { execa } from 'execa';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'pathe';
import { getWorkspaceDir, getPidFile } from '../utils/paths.js';

export const startCommand = new Command('start')
  .description('Start the Agentstage Runtime (background service)')
  .action(async () => {
    const workspaceDir = await getWorkspaceDir();
    const pidFile = await getPidFile();
    
    // 检查是否已运行
    if (existsSync(pidFile)) {
      const pid = parseInt(await readFile(pidFile, 'utf8').catch(() => '0'));
      if (pid > 0) {
        try {
          process.kill(pid, 0);
          consola.warn(`Runtime is already running (PID: ${pid})`);
          return;
        } catch {
          // 进程不存在，继续启动
        }
      }
    }
    
    const s = p.spinner();
    s.start('Starting Agentstage Runtime...');
    
    try {
      const subprocess = execa('npm', ['run', 'dev'], {
        cwd: workspaceDir,
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          PORT: '3000',
          BRIDGE_PORT: '8787',
        },
      });
      
      await mkdir(join(workspaceDir, '.agentstage'), { recursive: true });
      await writeFile(pidFile, String(subprocess.pid));
      
      await new Promise((resolve) => setTimeout(resolve, 2000));
      
      s.stop('Runtime started successfully');
      console.log();
      consola.success('Agentstage Runtime is running');
      console.log(`  Web:    ${c.cyan('http://localhost:3000')}`);
      console.log(`  Bridge: ${c.cyan('ws://localhost:8787/_bridge')}`);
      console.log();
      console.log(`  Workspace: ${c.gray(workspaceDir)}`);
      
    } catch (error: any) {
      s.stop('Failed to start runtime');
      consola.error(error.message);
      process.exit(1);
    }
  });
