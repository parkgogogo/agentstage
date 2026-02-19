import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { isInitialized, readRuntimeConfig } from '../../utils/paths.js';
import { BridgeClient } from 'agent-stage-bridge/sdk';

export const runInspectCommand = new Command('inspect')
  .description('Inspect a page\'s state and schema')
  .argument('<page>', 'Page ID')
  .action(async (pageId) => {
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

      // Get description
      const description = await client.describe(store.id);

      // Get current state
      const state = await client.getState(store.id);

      console.log();
      console.log(c.bold('Page:'), c.cyan(pageId));
      console.log(c.bold('Store ID:'), c.gray(store.id));
      console.log(c.bold('Version:'), c.gray(store.version.toString()));
      console.log(c.bold('Connected:'), c.gray(store.connectedAt.toISOString()));
      console.log();

      if (description) {
        console.log(c.bold('Schema:'));
        console.log(c.gray(JSON.stringify(description.schema, null, 2)));
        console.log();

        console.log(c.bold('Actions:'));
        if (description.actions && Object.keys(description.actions).length > 0) {
          for (const [name, def] of Object.entries(description.actions)) {
            console.log(`  ${c.cyan(name)}`);
            console.log(`    ${c.gray(def.description || 'No description')}`);
            if (def.payload) {
              console.log(`    payload: ${c.gray(JSON.stringify(def.payload))}`);
            }
          }
        } else {
          console.log(c.gray('  No actions defined'));
        }
        console.log();

        if (description.events && Object.keys(description.events).length > 0) {
          console.log(c.bold('Events:'));
          for (const [name, def] of Object.entries(description.events)) {
            console.log(`  ${c.cyan(name)}`);
            console.log(`    ${c.gray(def.description || 'No description')}`);
          }
          console.log();
        }
      }

      console.log(c.bold('Current State:'));
      if (state) {
        console.log(c.gray(JSON.stringify(state.state, null, 2)));
      } else {
        console.log(c.gray('  No state available'));
      }
      console.log();

    } catch (error: any) {
      consola.error('Failed to inspect:', error.message);
      process.exit(1);
    } finally {
      client.disconnect();
    }
  });
