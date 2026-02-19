import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { join } from 'pathe';
import { isInitialized, readRuntimeConfig, getPagesDir } from '../../utils/paths.js';
import { BridgeClient } from 'agent-stage-bridge/sdk';
import { FileStore } from 'agent-stage-bridge';

export const runGetStateCommand = new Command('get-state')
  .description('Get state from a page')
  .argument('<page>', 'Page ID')
  .option('-f, --file', 'Read from file instead of live connection', false)
  .option('-p, --pretty', 'Pretty print JSON', true)
  .action(async (pageId, options) => {
    if (!isInitialized()) {
      consola.error('Project not initialized. Please run `agentstage dev init` first.');
      process.exit(1);
    }

    const config = await readRuntimeConfig();

    // Live mode: read from connected browser
    if (!options.file && config) {
      const client = new BridgeClient(`ws://localhost:${config.port}/_bridge`);

      try {
        await client.connect();

        const store = await client.findStoreByKey(pageId, 'main');
        if (!store) {
          consola.error(`Page "${pageId}" is not connected. Use --file to read from disk.`);
          process.exit(1);
        }

        const state = await client.getStateByKey(pageId, 'main');
        if (state) {
          if (options.pretty) {
            console.log(JSON.stringify(state.state, null, 2));
          } else {
            console.log(JSON.stringify(state.state));
          }
        } else {
          console.log('{}');
        }
      } catch (error: any) {
        consola.error('Failed to get state:', error.message);
        process.exit(1);
      } finally {
        client.disconnect();
      }
    } else {
      // File mode: read from store.json
      const pagesDir = await getPagesDir();
      const fileStore = new FileStore({ pagesDir });

      try {
        const data = await fileStore.load(pageId);
        if (data) {
          if (options.pretty) {
            console.log(JSON.stringify(data.state, null, 2));
          } else {
            console.log(JSON.stringify(data.state));
          }
        } else {
          console.log('{}');
        }
      } catch (error: any) {
        consola.error('Failed to read state:', error.message);
        process.exit(1);
      }
    }
  });
