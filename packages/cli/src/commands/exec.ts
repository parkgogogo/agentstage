import { Command } from 'commander';
import consola from 'consola';
import { homedir } from 'os';
import { join } from 'pathe';
import { FileStore } from 'agent-stage-bridge';
import { BridgeClient } from 'agent-stage-bridge/sdk';
import { isInitialized, readRuntimeConfig } from '../utils/paths.js';

export const execCommand = new Command('exec')
  .description('Execute an action on a page or set state')
  .argument('<page>', 'Page ID')
  .argument('[action]', 'Action name')
  .argument('[payload]', 'Action payload as JSON')
  .option('-s, --state <json>', 'Set state directly')
  .option('--wait [timeoutMs]', 'Wait for browser ACK (optional timeout in ms)')
  .action(async (pageId, action, payload, options) => {
    try {
      if (!isInitialized()) {
        consola.error('Project not initialized. Please run `agentstage init` first.');
        process.exit(1);
      }

      const pagesDir = join(homedir(), '.agentstage', 'webapp', 'pages');
      const fileStore = new FileStore({ pagesDir });
      const storePath = join(pagesDir, pageId, 'store.json');

      if (options.state) {
        const state = JSON.parse(options.state);
        const waitForAck = options.wait !== undefined && options.wait !== false;

        if (waitForAck) {
          const timeoutMs =
            typeof options.wait === 'string' && Number.isFinite(Number(options.wait))
              ? Number(options.wait)
              : 5000;
          const config = await readRuntimeConfig();

          if (!config) {
            consola.error('Bridge runtime is not running. Start it first or remove --wait.');
            process.exit(1);
          }

          const client = new BridgeClient(`ws://localhost:${config.port}/_bridge`);
          await client.connect();
          try {
            const result = await client.setStateByKey(pageId, 'main', state, {
              waitForAck: true,
              timeoutMs,
            });
            consola.success(`State updated with ACK (${storePath}, v${result.version})`);
          } finally {
            client.disconnect();
          }
        } else {
          const saved = await fileStore.save(pageId, {
            state,
            version: 0,
            updatedAt: new Date().toISOString(),
            pageId,
          });

          consola.success(`State updated (${storePath}, v${saved.version})`);
        }
      } else if (action) {
        // 保留命令参数兼容性，但文件模式仅支持直接写 state
        if (payload) {
          JSON.parse(payload);
        }
        consola.error('File mode only supports --state. Action dispatch requires a live Bridge connection.');
        process.exit(1);
      } else {
        consola.error('Please specify an action or use --state');
        process.exit(1);
      }

    } catch (error: any) {
      consola.error('Failed to execute:', error.message);
      process.exit(1);
    }
  });
