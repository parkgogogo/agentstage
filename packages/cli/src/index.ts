#!/usr/bin/env node
import { Command } from 'commander';
import consola from 'consola';

// New command structure
import { devCommand } from './commands/dev/index.js';
import { pageCommand } from './commands/page/index.js';
import { runCommand } from './commands/run/index.js';

const program = new Command();

program
  .name('agentstage')
  .description('Agent UI Stage CLI - Create interactive UI for AI agents')
  .version('0.2.0');

// New command structure
program.addCommand(devCommand);
program.addCommand(pageCommand);
program.addCommand(runCommand);

// Error handling
program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error: any) {
  if (error.code !== 'commander.help' && error.code !== 'commander.version') {
    consola.error(error.message || 'Unknown error');
    process.exit(1);
  }
}
