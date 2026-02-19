import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { isInitialized, readRuntimeConfig } from '../../utils/paths.js';
import { BridgeClient } from 'agent-stage-bridge/sdk';

export const runExecCommand = new Command('exec')
  .description('Execute an action on a page (requires live connection)')
  .argument('<page>', 'Page ID')
  .argument('<action>', 'Action name')
  .argument('[payload]', 'Action payload as JSON', '{}')
  .option('--wait [timeoutMs]', 'Wait for browser ACK (default: 5000ms)')
  .action(async (pageId, actionName, payloadStr, options) => {
    if (!isInitialized()) {
      consola.error('Project not initialized. Please run `agentstage dev init` first.');
      process.exit(1);
    }

    const config = await readRuntimeConfig();
    if (!config) {
      consola.error('Runtime is not running. Start it first with `agentstage dev start`.');
      process.exit(1);
    }

    // Parse payload
    let payload: unknown;
    try {
      payload = JSON.parse(payloadStr);
    } catch {
      consola.error('Invalid JSON payload');
      process.exit(1);
    }

    const client = new BridgeClient(`ws://localhost:${config.port}/_bridge`);

    try {
      await client.connect();

      // Find store by pageId
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

      // Dispatch action
      if (waitForAck) {
        consola.info(`Executing "${actionName}" on "${pageId}" (waiting ${timeoutMs}ms)...`);
      } else {
        consola.info(`Executing "${actionName}" on "${pageId}"...`);
      }

      await client.dispatch(store.id, {
        type: actionName,
        payload,
      });

      if (waitForAck) {
        // Subscribe and wait for state change
        const state = await new Promise<unknown>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error(`Timeout waiting for state change after ${timeoutMs}ms`));
          }, timeoutMs);

          client.subscribe(store.id);
          const unsubscribe = client.onEvent((event) => {
            if (event.type === 'stateChanged' && event.storeId === store.id) {
              clearTimeout(timer);
              unsubscribe();
              resolve(event.state);
            }
          });
        });

        consola.success('Action executed');
        console.log(`  Page: ${c.cyan(pageId)}`);
        console.log(`  Action: ${c.cyan(actionName)}`);
        console.log(`  New state:`);
        console.log(c.gray(JSON.stringify(state, null, 2)));
      } else {
        consola.success('Action dispatched (no ACK wait)');
        console.log(`  Page: ${c.cyan(pageId)}`);
        console.log(`  Action: ${c.cyan(actionName)}`);
      }
    } catch (error: any) {
      consola.error('Failed to execute action:', error.message);
      process.exit(1);
    } finally {
      client.disconnect();
    }
  });
