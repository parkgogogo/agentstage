import { Command } from 'commander';
import * as p from '@clack/prompts';
import consola from 'consola';
import c from 'picocolors';
import { execa } from 'execa';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'pathe';
import { getWorkspaceDir, saveRuntimeConfig, isInitialized, readRuntimeConfig } from '../utils/paths.js';

export const startCommand = new Command('start')
  .description('Start the Agentstage Runtime (Vite dev server with Bridge)')
  .option('-p, --port <port>', 'Port to run the web server on', '3000')
  .action(async (options) => {
    // 1. 检查是否已初始化
    if (!isInitialized()) {
      consola.error('Project not initialized. Please run `agentstage init` first.');
      process.exit(1);
    }

    const workspaceDir = await getWorkspaceDir();
    const port = parseInt(options.port, 10);

    // 2. 检查是否已运行
    const existingConfig = await readRuntimeConfig();
    if (existingConfig) {
      try {
        process.kill(existingConfig.pid, 0);
        consola.warn(`Runtime is already running (PID: ${existingConfig.pid}, Port: ${existingConfig.port})`);
        console.log(`  Web:    ${c.cyan(`http://localhost:${existingConfig.port}`)}`);
        console.log(`  Bridge: ${c.cyan(`ws://localhost:${existingConfig.port}/_bridge`)}`);
        return;
      } catch {
        // 进程不存在，继续启动
      }
    }

    // 3. 检查是否需要安装依赖
    const nodeModulesPath = join(workspaceDir, 'node_modules');
    if (!existsSync(nodeModulesPath)) {
      const s = p.spinner();
      s.start('Installing dependencies...');
      try {
        await execa('npm', ['install'], { cwd: workspaceDir, stdio: 'pipe' });
        s.stop('Dependencies installed');
      } catch (error: any) {
        s.stop('Failed to install dependencies');
        consola.error(error.message);
        process.exit(1);
      }
    }

    const s = p.spinner();
    s.start('Starting Agentstage Runtime...');

    try {
      // 4. 启动 Vite dev server
      // WebSocket 会通过 bridgePlugin() 自动挂载到 Vite server
      const subprocess = execa('npx', ['vite', '--port', String(port), '--host'], {
        cwd: workspaceDir,
        detached: true,
        stdio: 'ignore',
      });

      await mkdir(join(workspaceDir, '.agentstage'), { recursive: true });

      // 5. 保存运行时配置
      await saveRuntimeConfig({
        pid: subprocess.pid!,
        port,
        startedAt: new Date().toISOString(),
      });

      // 6. 等待一下确保服务启动
      await new Promise(resolve => setTimeout(resolve, 2000));

      s.stop('Runtime started successfully');
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
