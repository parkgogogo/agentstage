import { Command } from 'commander';
import * as p from '@clack/prompts';
import consola from 'consola';
import c from 'picocolors';
import { execa } from 'execa';
import { mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'pathe';
import { getWorkspaceDir, saveRuntimeConfig, readRuntimeConfig, isInitialized } from '../utils/paths.js';

async function killProcess(pid: number): Promise<void> {
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
}

export const restartCommand = new Command('restart')
  .description('Restart the Agentstage Runtime (stop and start)')
  .option('-p, --port <port>', 'Port to run the web server on', '3000')
  .action(async (options) => {
    // 1. 检查是否已初始化
    if (!isInitialized()) {
      consola.error('Project not initialized. Please run `agentstage init` first.');
      process.exit(1);
    }

    const workspaceDir = await getWorkspaceDir();
    const port = parseInt(options.port, 10);

    const s = p.spinner();

    // 2. 停止现有服务
    const existingConfig = await readRuntimeConfig();
    if (existingConfig) {
      s.start('Stopping current runtime...');
      try {
        await killProcess(existingConfig.pid);
        s.stop('Runtime stopped');
      } catch (error: any) {
        s.stop('Failed to stop runtime');
        consola.warn('Continuing with start...');
      }
    }

    // 3. 启动新服务
    s.start('Starting Agentstage Runtime...');

    try {
      // 启动 TanStack Start 项目（包含 Bridge Gateway）
      const subprocess = execa('npm', ['run', 'dev'], {
        cwd: workspaceDir,
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          PORT: String(port),
        },
      });

      await mkdir(join(workspaceDir, '.agentstage'), { recursive: true });

      // 保存运行时配置
      await saveRuntimeConfig({
        pid: subprocess.pid!,
        port,
        startedAt: new Date().toISOString(),
      });

      s.stop('Runtime restarted successfully');
      console.log();
      consola.success('Agentstage Runtime is running');
      console.log(`  Web:    ${c.cyan(`http://localhost:${port}`)}`);
      console.log(`  Bridge: ${c.cyan(`ws://localhost:${port}/_bridge`)}`);
      console.log();
      console.log(`  Workspace: ${c.gray(workspaceDir)}`);

    } catch (error: any) {
      s.stop('Failed to start runtime');
      consola.error(error.message);
      process.exit(1);
    }
  });
