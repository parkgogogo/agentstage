import { Command } from 'commander';
import { devInitCommand } from './init.js';
import { devStartCommand } from './start.js';
import { devStopCommand } from './stop.js';
import { devStatusCommand } from './status.js';

export const devCommand = new Command('dev')
  .description('Development commands for Agentstage')
  .addCommand(devInitCommand)
  .addCommand(devStartCommand)
  .addCommand(devStopCommand)
  .addCommand(devStatusCommand);
