import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { execa } from 'execa';
import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'pathe';
import { getWorkspaceDir, readRuntimeConfig, isInitialized } from '../utils/paths.js';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  details?: string[];
}

export const doctorCommand = new Command('doctor')
  .description('Diagnose Agentstage environment and runtime issues')
  .option('--fix', 'Attempt to fix common issues')
  .action(async (options) => {
    console.log();
    console.log(c.bold('Agentstage Doctor'));
    console.log(c.gray('─'.repeat(50)));
    console.log();

    const results: CheckResult[] = [];

    // 1. Check workspace
    if (!isInitialized()) {
      results.push({
        name: 'Workspace',
        status: 'error',
        message: 'Not initialized',
        details: ['Run: agentstage init'],
      });
    } else {
      try {
        const workspaceDir = await getWorkspaceDir();
        results.push({
          name: 'Workspace',
          status: 'ok',
          message: `Found at ${workspaceDir}`,
        });

        // Check project structure
        const checks = [
          { path: 'src/routes', name: 'Routes directory' },
          { path: 'src/components/ui', name: 'UI components' },
          { path: 'package.json', name: 'Package.json' },
        ];

        for (const check of checks) {
          const fullPath = join(workspaceDir, check.path);
          if (existsSync(fullPath)) {
            results.push({
              name: check.name,
              status: 'ok',
              message: `Found (${check.path})`,
            });
          } else {
            results.push({
              name: check.name,
              status: 'error',
              message: `Missing: ${check.path}`,
            });
          }
        }

        // Check bridge plugin in vite.config.ts
        const viteConfigPath = join(workspaceDir, 'vite.config.ts');
        if (existsSync(viteConfigPath)) {
          const viteConfig = await import('fs/promises').then(fs => fs.readFile(viteConfigPath, 'utf8'));
          if (viteConfig.includes('bridgePlugin')) {
            results.push({
              name: 'Bridge plugin',
              status: 'ok',
              message: 'Configured in vite.config.ts',
            });
          } else {
            results.push({
              name: 'Bridge plugin',
              status: 'error',
              message: 'Missing bridgePlugin() in vite.config.ts',
            });
          }
        } else {
          results.push({
            name: 'Bridge plugin',
            status: 'error',
            message: 'vite.config.ts not found',
          });
        }
      } catch (error: any) {
        results.push({
          name: 'Workspace',
          status: 'error',
          message: error.message,
        });
      }
    }

    // 2. Check runtime status
    const config = await readRuntimeConfig();

    if (config) {
      try {
        process.kill(config.pid, 0);
        results.push({
          name: 'Runtime',
          status: 'ok',
          message: 'Running',
          details: [`PID: ${config.pid}`, `Port: ${config.port}`],
        });
      } catch {
        results.push({
          name: 'Runtime',
          status: 'error',
          message: 'Not running (stale config file)',
          details: ['Run: agentstage start'],
        });
      }
    } else {
      results.push({
        name: 'Runtime',
        status: 'warn',
        message: 'Not started',
        details: ['Run: agentstage start'],
      });
    }

    // 3. Check ports
    const portChecks = [
      { port: 3000, name: 'Web Port (3000)' },
      { port: 42069, name: 'DevTools Port (42069)' },
    ];

    for (const { port, name } of portChecks) {
      try {
        const { stdout } = await execa('lsof', ['-ti', `:${port}`], { reject: false });
        if (stdout.trim()) {
          results.push({
            name,
            status: 'warn',
            message: `Port ${port} is in use`,
            details: [`PID: ${stdout.trim()}`, 'May cause startup issues'],
          });
        } else {
          results.push({
            name,
            status: 'ok',
            message: `Port ${port} is available`,
          });
        }
      } catch {
        results.push({
          name,
          status: 'ok',
          message: `Port ${port} (unable to check)`,
        });
      }
    }

    // 4. Check dependencies
    try {
      const workspaceDir = await getWorkspaceDir();
      const nodeModulesPath = join(workspaceDir, 'node_modules');
      const bridgePath = join(nodeModulesPath, '@agentstage', 'bridge');

      if (!existsSync(nodeModulesPath)) {
        results.push({
          name: 'Dependencies',
          status: 'error',
          message: 'node_modules not found',
          details: ['Run: npm install'],
        });
      } else if (!existsSync(bridgePath)) {
        results.push({
          name: 'Dependencies',
          status: 'error',
          message: '@agentstage/bridge not installed',
          details: ['Run: npm install @agentstage/bridge'],
        });
      } else {
        results.push({
          name: 'Dependencies',
          status: 'ok',
          message: 'Core dependencies installed',
        });
      }
    } catch (error: any) {
      results.push({
        name: 'Dependencies',
        status: 'error',
        message: error.message,
      });
    }

    // Print results
    console.log();
    for (const result of results) {
      const icon = result.status === 'ok' ? c.green('✓') :
                   result.status === 'warn' ? c.yellow('⚠') : c.red('✗');
      const statusColor = result.status === 'ok' ? c.green :
                          result.status === 'warn' ? c.yellow : c.red;

      console.log(`${icon} ${c.bold(result.name)}: ${statusColor(result.message)}`);

      if (result.details) {
        for (const detail of result.details) {
          console.log(`  ${c.gray('→')} ${detail}`);
        }
      }
    }

    // Summary
    console.log();
    console.log(c.gray('─'.repeat(50)));

    const errors = results.filter(r => r.status === 'error').length;
    const warnings = results.filter(r => r.status === 'warn').length;

    if (errors > 0) {
      console.log(c.red(`Found ${errors} error(s), ${warnings} warning(s)`));
      console.log();
      console.log('To fix issues, try:');
      console.log(`  ${c.cyan('agentstage doctor --fix')}  (attempt automatic fixes)`);
      console.log(`  ${c.cyan('agentstage stop && agentstage start')}  (restart runtime)`);
    } else if (warnings > 0) {
      console.log(c.yellow(`Found ${warnings} warning(s), all checks passed`));
    } else {
      console.log(c.green('All checks passed!'));
    }

    console.log();

    // Fix mode
    if (options.fix && (errors > 0 || warnings > 0)) {
      console.log(c.bold('Attempting fixes...'));
      console.log();

      // Try to kill stale processes
      try {
        const { stdout } = await execa('lsof', ['-ti', ':3000'], { reject: false });
        if (stdout.trim()) {
          console.log(`Killing process on port 3000: ${stdout.trim()}`);
          try {
            process.kill(parseInt(stdout.trim()), 'SIGKILL');
            console.log(c.green('✓ Killed'));
          } catch (e) {
            console.log(c.red('✗ Failed to kill'));
          }
        }
      } catch {
        // ignore
      }

      console.log();
      console.log('Fixes applied. Run ' + c.cyan('agentstage start') + ' to start runtime.');
      console.log();
    }

    process.exit(errors > 0 ? 1 : 0);
  });
