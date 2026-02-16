import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { getWorkspaceDir, readRuntimeConfig, isInitialized } from '../utils/paths.js';

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export const statusCommand = new Command('status')
  .description('Show the Agentstage Runtime status')
  .action(async () => {
    // 1. 检查是否已初始化
    if (!isInitialized()) {
      consola.error('Project not initialized. Please run `agentstage init` first.');
      process.exit(1);
    }

    const workspaceDir = await getWorkspaceDir();

    console.log();
    console.log(c.bold('Agentstage Runtime'));
    console.log(c.gray('─'.repeat(40)));
    console.log(`Workspace: ${c.cyan(workspaceDir)}`);

    // 2. 读取运行时配置
    const config = await readRuntimeConfig();

    if (!config) {
      console.log(`Status:    ${c.red('●')} Stopped`);
      console.log();
      console.log(c.gray('Run `agentstage start` to start the runtime.'));
      console.log();
      return;
    }

    // 3. 检查进程是否存活
    const running = isRunning(config.pid);

    if (running) {
      console.log(`Status:    ${c.green('●')} Running`);
      console.log(`PID:       ${config.pid}`);
      console.log(`Port:      ${config.port}`);
      console.log(`Started:   ${new Date(config.startedAt).toLocaleString()}`);
      console.log(`Web:       ${c.cyan(`http://localhost:${config.port}`)}`);
      console.log(`Bridge:    ${c.cyan(`ws://localhost:${config.port}/_bridge`)}`);
    } else {
      console.log(`Status:    ${c.yellow('●')} Dead (PID file exists but process not found)`);
      console.log();
      console.log(c.gray('Run `agentstage start` to restart the runtime.'));
    }

    console.log();
  });
