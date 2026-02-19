import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { readRuntimeConfig, isInitialized, getWorkspaceDir } from '../../utils/paths.js';
import { checkCloudflared } from '../../utils/cloudflared.js';

export const devStatusCommand = new Command('status')
  .description('Check the Agentstage Runtime status')
  .action(async () => {
    if (!isInitialized()) {
      consola.error('Project not initialized. Please run `agentstage dev init` first.');
      process.exit(1);
    }

    const workspaceDir = await getWorkspaceDir();
    const config = await readRuntimeConfig();

    console.log();
    console.log(c.bold('Workspace:'), c.cyan(workspaceDir));
    console.log();

    // Check cloudflared
    const cloudflared = await checkCloudflared();
    console.log(c.bold('Cloudflare Tunnel:'));
    if (cloudflared.installed) {
      console.log(`  Status: ${c.green('✓ installed')}`);
      console.log(`  Version: ${c.gray(cloudflared.version || 'unknown')}`);
    } else {
      console.log(`  Status: ${c.yellow('✗ not installed')}`);
      console.log(`  Install: ${c.gray(cloudflared.installCommand)}`);
    }
    console.log();

    // Check runtime
    console.log(c.bold('Runtime:'));
    if (!config) {
      console.log(`  Status: ${c.gray('stopped')}`);
    } else {
      try {
        process.kill(config.pid, 0);
        console.log(`  Status: ${c.green('running')}`);
        console.log(`  PID: ${c.gray(config.pid)}`);
        console.log(`  Port: ${c.cyan(config.port)}`);
        console.log(`  Local: ${c.cyan(`http://localhost:${config.port}`)}`);
        if (config.tunnelUrl) {
          console.log(`  Public: ${c.cyan(c.underline(config.tunnelUrl))}`);
        }
        console.log(`  Bridge: ${c.cyan(`ws://localhost:${config.port}/_bridge`)}`);
        console.log(`  Started: ${c.gray(new Date(config.startedAt).toLocaleString())}`);
      } catch {
        console.log(`  Status: ${c.yellow('stale (process not found)')}`);
        console.log(`  Last PID: ${c.gray(config.pid)}`);
        console.log(`  Last Port: ${c.gray(config.port)}`);
      }
    }
    console.log();
  });
