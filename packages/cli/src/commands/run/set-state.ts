import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { join } from 'pathe';
import { isInitialized, readRuntimeConfig, getPagesDir } from '../../utils/paths.js';
import { BridgeClient } from 'agent-stage-bridge/sdk';
import { FileStore } from 'agent-stage-bridge';

export const runSetStateCommand = new Command('set-state')
  .description('Set state on a page')
  .argument('<page>', 'Page ID')
  .argument('<json>', 'State as JSON string')
  .option('--live', 'Also sync to connected browser via WebSocket', false)
  .option('--wait [timeoutMs]', 'Wait for browser ACK when using --live')
  .action(async (pageId, jsonStr, options) => {
    if (!isInitialized()) {
      consola.error('Project not initialized. Please run `agentstage dev init` first.');
      process.exit(1);
    }

    // Parse state
    let state: unknown;
    try {
      state = JSON.parse(jsonStr);
    } catch {
      consola.error('Invalid JSON state');
      process.exit(1);
    }

    const config = await readRuntimeConfig();

    // If --live is specified, require running runtime
    if (options.live) {
      if (!config) {
        consola.error('Runtime is not running. Start it first or remove --live flag.');
        process.exit(1);
      }

      const client = new BridgeClient(`ws://localhost:${config.port}/_bridge`);

      try {
        await client.connect();

        const store = await client.findStoreByKey(pageId, 'main');
        if (!store) {
          consola.error(`Page "${pageId}" is not connected. Make sure the page is open in browser.`);
          process.exit(1);
        }

        const waitForAck = options.wait !== undefined && options.wait !== false;
        const timeoutMs =
          typeof options.wait === 'string' && Number.isFinite(Number(options.wait))
            ? Number(options.wait)
            : 5000;

        if (waitForAck) {
          consola.info(`Setting state on "${pageId}" (waiting ${timeoutMs}ms)...`);
        } else {
          consola.info(`Setting state on "${pageId}"...`);
        }

        await client.setStateByKey(
          pageId,
          'main',
          state,
          waitForAck ? { waitForAck: true, timeoutMs } : {}
        );

        consola.success('State updated');
        console.log(`  Page: ${c.cyan(pageId)}`);
        console.log(`  State:`);
        console.log(c.gray(JSON.stringify(state, null, 2)));

        if (waitForAck) {
          console.log(`  ACK: ${c.green('received')}`);
        }
      } catch (error: any) {
        consola.error('Failed to set state:', error.message);
        process.exit(1);
      } finally {
        client.disconnect();
      }
    } else {
      // File-only mode (works without running server)
      const pagesDir = await getPagesDir();
      const fileStore = new FileStore({ pagesDir });

      try {
        const saved = await fileStore.save(pageId, {
          state,
          version: 0,
          updatedAt: new Date().toISOString(),
          pageId,
        });

        consola.success('State saved to file');
        console.log(`  Page: ${c.cyan(pageId)}`);
        console.log(`  File: ${c.gray(`${pagesDir}/${pageId}/store.json`)}`);
        console.log(`  Version: ${c.gray(saved.version)}`);
        console.log();
        console.log(c.dim('Note: State will apply when the page is next opened.'));
        console.log(c.dim('      Use --live to apply to a running browser immediately.'));
      } catch (error: any) {
        consola.error('Failed to save state:', error.message);
        process.exit(1);
      }
    }
  });
