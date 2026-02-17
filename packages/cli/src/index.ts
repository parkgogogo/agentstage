#!/usr/bin/env node
import { Command } from 'commander';
import consola from 'consola';
import { initCommand } from './commands/init.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { restartCommand } from './commands/restart.js';
import { statusCommand } from './commands/status.js';
import { lsCommand } from './commands/ls.js';
import { inspectCommand } from './commands/inspect.js';
import { watchCommand } from './commands/watch.js';
import { execCommand } from './commands/exec.js';
import { addPageCommand } from './commands/add-page.js';
import { rmPageCommand } from './commands/rm-page.js';
import { componentsCommand } from './commands/components.js';
import { doctorCommand } from './commands/doctor.js';
import { resetCommand } from './commands/reset.js';
import { verifyCommand } from './commands/verify.js';

const program = new Command();

program
  .name('agentstage')
  .description('Agent UI Stage CLI - Create interactive UI for AI agents')
  .version('0.2.0');

// 注册命令
program.addCommand(initCommand);
program.addCommand(startCommand);
program.addCommand(stopCommand);
program.addCommand(restartCommand);
program.addCommand(statusCommand);
program.addCommand(lsCommand);
program.addCommand(inspectCommand);
program.addCommand(watchCommand);
program.addCommand(execCommand);
program.addCommand(addPageCommand);
program.addCommand(rmPageCommand);
program.addCommand(componentsCommand);
program.addCommand(doctorCommand);
program.addCommand(resetCommand);
program.addCommand(verifyCommand);

// 错误处理
program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error: any) {
  if (error.code !== 'commander.help' && error.code !== 'commander.version') {
    consola.error(error.message || 'Unknown error');
    process.exit(1);
  }
}
