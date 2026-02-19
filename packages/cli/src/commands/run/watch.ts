import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { isInitialized, readRuntimeConfig } from '../../utils/paths.js';
import { BridgeClient } from 'agent-stage-bridge/sdk';

export const runWatchCommand = new Command('watch')
  .description('Watch state changes on a page')
  .argument('<page>', 'Page ID')
  .option('-f, --format <type>', 'Output format (pretty|json)', 'pretty')
  .action(async (pageId, options) => {
    if (!isInitialized()) {
      consola.error('Project not initialized. Please run `agentstage dev init` first.');
      process.exit(1);
    }

    const config = await readRuntimeConfig();
    if (!config) {
      consola.error('Runtime is not running. Start it first with `agentstage dev start`.');
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

      consola.info(`Watching "${pageId}" for state changes...`);
      console.log(c.dim('Press Ctrl+C to stop'));
      console.log();

      // Print initial state
      const initialState = await client.getStateByKey(pageId, 'main');
      if (initialState) {
        printState('initial', initialState.state, initialState.version, options.format);
      }

      // Subscribe to changes
      client.subscribe(store.id);
      client.onEvent((event) => {
        if (event.storeId !== store.id) return;
        if (event.type === 'stateChanged') {
          printState('changed', event.state, event.version, options.format);
        } else if (event.type === 'disconnected') {
          console.log(c.yellow(`[${new Date().toISOString()}] Page disconnected`));
        }
      });

      // Keep running until interrupted
      await new Promise(() => {});
    } catch (error: any) {
      consola.error('Failed to watch:', error.message);
      process.exit(1);
    }
  });

function printState(
  type: 'initial' | 'changed',
  state: unknown,
  version: number,
  format: string
): void {
  const timestamp = new Date().toISOString();

  if (format === 'json') {
    console.log(
      JSON.stringify({
        timestamp,
        type,
        version,
        state,
      })
    );
  } else {
    const label = type === 'initial' ? c.blue('[initial]') : c.green('[changed]');
    console.log(`${c.gray(timestamp)} ${label} (v${version}):`);
    console.log(c.gray(JSON.stringify(state, null, 2)));
    console.log();
  }
}
