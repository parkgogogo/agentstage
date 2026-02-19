import { Command } from 'commander';
import { pageAddCommand } from './add.js';
import { pageRmCommand } from './rm.js';
import { pageLsCommand } from './ls.js';
import { pageManifestCommand } from './manifest.js';

export const pageCommand = new Command('page')
  .description('Page management commands')
  .addCommand(pageAddCommand)
  .addCommand(pageRmCommand)
  .addCommand(pageLsCommand)
  .addCommand(pageManifestCommand);
