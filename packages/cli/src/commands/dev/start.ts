import { Command } from 'commander';
import * as p from '@clack/prompts';
import consola from 'consola';
import c from 'picocolors';
import { execa } from 'execa';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'pathe';
import {
  getWorkspaceDir,
  saveRuntimeConfig,
  isInitialized,
  readRuntimeConfig,
} from '../../utils/paths.js';
import { startTunnel, canStartTunnel, printTunnelInfo } from '../../utils/tunnel.js';
import { checkCloudflared, printInstallInstructions } from '../../utils/cloudflared.js';

interface RuntimeConfig {
  pid: number;
  port: number;
  startedAt: string;
  tunnelUrl?: string;
}

export const devStartCommand = new Command('start')
  .description('Start the Agentstage Runtime (Vite dev server with Bridge)')
  .option('-p, --port <port>', 'Port to run the web server on', '3000')
  .option('-t, --tunnel', 'Expose server to internet via Cloudflare Tunnel', false)
  .option('--open', 'Open browser automatically', false)
  .action(async (options) => {
    // 1. 检查是否已初始化
    if (!isInitialized()) {
      consola.error('Project not initialized. Please run `agentstage dev init` first.');
      process.exit(1);
    }

    const workspaceDir = await getWorkspaceDir();
    const port = parseInt(options.port, 10);

    // 2. 检查是否已运行
    const existingConfig = await readRuntimeConfig();
    if (existingConfig) {
      try {
        process.kill(existingConfig.pid, 0);
        consola.warn(
          `Runtime is already running (PID: ${existingConfig.pid}, Port: ${existingConfig.port})`
        );
        console.log(`  Web:    ${c.cyan(`http://localhost:${existingConfig.port}`)}`);
        if (existingConfig.tunnelUrl) {
          console.log(`  Public: ${c.cyan(c.underline(existingConfig.tunnelUrl))}`);
        }
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

    // 4. 检查 cloudflared (如果请求了 tunnel)
    let tunnelUrl: string | undefined;
    if (options.tunnel) {
      const canTunnel = await canStartTunnel();
      if (!canTunnel) {
        const info = await checkCloudflared();
        printInstallInstructions(info);
        consola.error('Cannot start with --tunnel: cloudflared not installed');
        process.exit(1);
      }
    }

    const s = p.spinner();
    s.start('Starting Agentstage Runtime...');

    try {
      // 5. 启动 Vite dev server
      const subprocess = execa('npx', ['vite', '--port', String(port), '--host'], {
        cwd: workspaceDir,
        detached: true,
        stdio: 'ignore',
      });

      await mkdir(join(workspaceDir, '.agentstage'), { recursive: true });

      // 6. 启动 tunnel (如果请求了)
      if (options.tunnel) {
        s.message('Starting Cloudflare Tunnel...');
        try {
          const tunnel = await startTunnel(port);
          tunnelUrl = tunnel.url;

          // Save tunnel info for stop command to use
          const tunnelModulePath = join(workspaceDir, '.agentstage', 'tunnel.mjs');
          // Write tunnel info for stop command to use
          await writeFile(
            tunnelModulePath,
            `export const tunnelUrl = '${tunnelUrl}';\nexport const tunnelPid = ${subprocess.pid};\n`
          );
        } catch (tunnelError: any) {
          s.stop('Tunnel failed to start');
          consola.warn(`Tunnel error: ${tunnelError.message}`);
          consola.info('Continuing without tunnel...');
          // Kill the vite process since we're failing
          subprocess.kill();
          process.exit(1);
        }
      }

      // 7. 保存运行时配置
      const config: RuntimeConfig = {
        pid: subprocess.pid!,
        port,
        startedAt: new Date().toISOString(),
        tunnelUrl,
      };
      await saveRuntimeConfig(config);

      // 8. 等待一下确保服务启动
      await new Promise((resolve) => setTimeout(resolve, 2000));

      s.stop('Runtime started successfully');
      console.log();
      consola.success('Agentstage Runtime is running');
      console.log(`  Web:     ${c.cyan(`http://localhost:${port}`)}`);
      if (tunnelUrl) {
        printTunnelInfo(tunnelUrl);
      }
      console.log(`  Bridge:  ${c.cyan(`ws://localhost:${port}/_bridge`)}`);
      console.log(`  Workspace: ${c.gray(workspaceDir)}`);
      console.log();

      if (options.open) {
        const openUrl = tunnelUrl || `http://localhost:${port}`;
        try {
          await execa('open', [openUrl]);
        } catch {
          // Ignore open errors
        }
      }

      // Keep process alive to maintain tunnel
      if (options.tunnel && tunnelUrl) {
        console.log(c.dim('Press Ctrl+C to stop'));
        process.on('SIGINT', async () => {
          console.log();
          consola.info('Shutting down...');
          subprocess.kill();
          process.exit(0);
        });
        // Keep running
        await new Promise(() => {});
      }
    } catch (error: any) {
      s.stop('Failed to start runtime');
      consola.error(error.message);
      process.exit(1);
    }
  });
