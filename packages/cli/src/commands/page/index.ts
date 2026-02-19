import { Command } from 'commander';
import { pageAddCommand } from './add.js';
import { pageRmCommand } from './rm.js';
import { pageLsCommand } from './ls.js';
import { pageManifestCommand } from './manifest.js';
import { pageSetUiCommand } from './set-ui.js';
import { pageGetUiCommand } from './get-ui.js';

export const pageCommand = new Command('page')
  .description('Page management commands')
  .addCommand(pageAddCommand)
  .addCommand(pageRmCommand)
  .addCommand(pageLsCommand)
  .addCommand(pageSetUiCommand)
  .addCommand(pageGetUiCommand)
  .addCommand(pageManifestCommand);
