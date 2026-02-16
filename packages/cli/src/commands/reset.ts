import { Command } from 'commander';
import * as p from '@clack/prompts';
import consola from 'consola';
import c from 'picocolors';
import { rm, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'pathe';
import { getWorkspaceDir, readRuntimeConfig, WORKSPACE_FILE } from '../utils/paths.js';

const PROJECT_NAME = 'webapp';

export const resetCommand = new Command('reset')
  .description('Reset Agentstage by removing the project and workspace configuration')
  .option('-y, --yes', 'Skip confirmation', false)
  .action(async (options) => {
    console.log();
    console.log(c.bold('Agentstage Reset'));
    console.log(c.gray('─'.repeat(50)));
    console.log();

    try {
      // 1. 检查 workspace 是否存在
      let workspaceDir: string;
      try {
        workspaceDir = await getWorkspaceDir();
      } catch (error: any) {
        consola.info('No workspace found. Nothing to reset.');
        console.log();
        return;
      }

      // 2. 显示要删除的内容
      console.log(c.yellow('The following will be deleted:'));
      console.log(`  • Project: ${c.cyan(workspaceDir)}`);
      console.log(`  • Config:  ${c.cyan(WORKSPACE_FILE)}`);
      console.log();

      // 3. 检查 runtime 是否在运行
      const config = await readRuntimeConfig();
      if (config) {
        try {
          process.kill(config.pid, 0);
          consola.warn('Runtime appears to be running. Please stop it first:');
          console.log(`  ${c.cyan('agentstage stop')}`);
          console.log();
          process.exit(1);
        } catch {
          // 进程不在运行，继续
        }
      }

      // 4. 确认
      if (!options.yes) {
        const confirmed = await p.confirm({
          message: 'Are you sure you want to delete everything?',
          initialValue: false,
        });

        if (p.isCancel(confirmed) || !confirmed) {
          consola.info('Cancelled');
          console.log();
          return;
        }
      }

      // 5. 删除项目目录
      const s = p.spinner();
      s.start('Deleting project...');

      if (existsSync(workspaceDir)) {
        // 使用 rimraf 风格删除（多次尝试）
        for (let i = 0; i < 3; i++) {
          try {
            await rm(workspaceDir, { recursive: true, force: true, maxRetries: 3 });
            break;
          } catch (err) {
            if (i === 2) throw err;
            await new Promise(r => setTimeout(r, 100));
          }
        }
      }

      // 6. 删除配置文件
      if (existsSync(WORKSPACE_FILE)) {
        await unlink(WORKSPACE_FILE);
      }

      s.stop('Project deleted');

      console.log();
      consola.success('Reset complete!');
      console.log();
      console.log('You can now run:');
      console.log(`  ${c.cyan('agentstage init')}  to create a new project`);
      console.log();

    } catch (error: any) {
      consola.error('Failed to reset:', error.message);
      process.exit(1);
    }
  });
