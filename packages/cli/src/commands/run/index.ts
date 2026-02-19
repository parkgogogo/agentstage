import { Command } from 'commander';
import { runExecCommand } from './exec.js';
import { runSetStateCommand } from './set-state.js';
import { runWatchCommand } from './watch.js';
import { runInspectCommand } from './inspect.js';

export const runCommand = new Command('run')
  .description('Runtime commands for controlling pages (Agent operations)')
  .addCommand(runExecCommand)
  .addCommand(runSetStateCommand)
  .addCommand(runWatchCommand)
  .addCommand(runInspectCommand);
