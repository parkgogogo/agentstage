import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { readRuntimeConfig, removeRuntimeConfig, isInitialized } from '../../utils/paths.js';

export const devStopCommand = new Command('stop')
  .description('Stop the Agentstage Runtime')
  .action(async () => {
    if (!isInitialized()) {
      consola.error('Project not initialized. Please run `agentstage dev init` first.');
      process.exit(1);
    }

    const config = await readRuntimeConfig();
    if (!config) {
      consola.warn('Runtime is not running');
      return;
    }

    try {
      // Check if process exists
      process.kill(config.pid, 0);

      // Kill the process
      process.kill(config.pid, 'SIGTERM');

      // Wait a bit and check if it's still running
      await new Promise((resolve) => setTimeout(resolve, 1000));

      try {
        process.kill(config.pid, 0);
        // Still running, force kill
        process.kill(config.pid, 'SIGKILL');
      } catch {
        // Process already stopped
      }

      await removeRuntimeConfig();

      consola.success('Runtime stopped');
      console.log(`  PID: ${c.gray(config.pid)}`);
      console.log(`  Port: ${c.gray(config.port)}`);
      if (config.tunnelUrl) {
        console.log(`  Tunnel: ${c.gray(config.tunnelUrl)}`);
      }
    } catch {
      // Process doesn't exist, clean up stale config
      await removeRuntimeConfig();
      consola.info('Runtime was not running (stale config cleaned up)');
    }
  });
