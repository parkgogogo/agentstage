import { Command } from 'commander';
import consola from 'consola';
import { unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { getPidFile, readRuntimeConfig, removeRuntimeConfig, isInitialized } from '../utils/paths.js';

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

export const stopCommand = new Command('stop')
  .description('Stop the Agentstage Runtime')
  .action(async () => {
    // 1. 检查是否已初始化
    if (!isInitialized()) {
      consola.error('Project not initialized. Please run `agentstage init` first.');
      process.exit(1);
    }

    // 2. 读取运行时配置
    const config = await readRuntimeConfig();

    if (!config) {
      consola.info('Runtime is not running');
      return;
    }

    // 3. 停止进程
    try {
      await killProcess(config.pid);
      await removeRuntimeConfig();

      // 兼容旧版本：删除 pid 文件
      const pidFile = await getPidFile();
      if (existsSync(pidFile)) {
        await unlink(pidFile).catch(() => {});
      }

      consola.success('Runtime stopped');

    } catch (error: any) {
      consola.error('Failed to stop runtime:', error.message);
      process.exit(1);
    }
  });
