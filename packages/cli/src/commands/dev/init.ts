import { Command } from 'commander';
import * as p from '@clack/prompts';
import consola from 'consola';
import c from 'picocolors';
import { execa } from 'execa';
import { mkdir, writeFile, readdir, readFile, cp } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, join, dirname } from 'pathe';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { setWorkspaceDir } from '../../utils/paths.js';
import { checkCloudflared, printInstallInstructions } from '../../utils/cloudflared.js';

const PROJECT_NAME = 'webapp';

// Get the template directory path (works in both dev and prod)
function getTemplateDir(): string {
  const currentFilePath = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFilePath);

  // Production: template is next to dist
  // From dist/commands/dev/init.js -> dist/ -> package root
  const prodPath = join(currentDir, '..', '..', '..', 'template');
  // Development: template is in the source
  // From packages/cli/src/commands/dev/init.ts -> packages/cli/
  const devPath = join(currentDir, '..', '..', '..', '..', 'template');

  if (existsSync(prodPath)) {
    return prodPath;
  }
  if (existsSync(devPath)) {
    return devPath;
  }

  // Fallback: try current working directory relative paths
  const cwdProdPath = join(process.cwd(), 'packages', 'cli', 'template');
  if (existsSync(cwdProdPath)) {
    return cwdProdPath;
  }

  throw new Error('Template directory not found. Please ensure the CLI is properly installed.');
}

export const devInitCommand = new Command('init')
  .description('Initialize a new Agentstage project')
  .option('-y, --yes', 'Use default settings (non-interactive)', false)
  .option('--skip-cloudflared-check', 'Skip cloudflared installation check', false)
  .action(async (options) => {
    const name = PROJECT_NAME;
    const useDefault = options.yes;

    // 1. Check cloudflared installation
    if (!options.skipCloudflaredCheck) {
      const cloudflaredInfo = await checkCloudflared();
      if (!cloudflaredInfo.installed) {
        printInstallInstructions(cloudflaredInfo);

        const shouldContinue = await p.confirm({
          message: 'Continue with initialization? (You can install cloudflared later)',
          initialValue: true,
        });

        if (p.isCancel(shouldContinue) || !shouldContinue) {
          consola.info('Cancelled');
          process.exit(0);
        }
      } else {
        consola.success(`Cloudflare Tunnel available: ${c.dim(cloudflaredInfo.version)}`);
      }
    }

    // 2. 选择工作目录模式
    let locationMode: string;
    if (useDefault) {
      locationMode = 'default';
    } else {
      const result = await p.select({
        message: 'Where to store the project?',
        options: [
          {
            value: 'default',
            label: `Default (~/.agentstage/${name})`,
            hint: 'Recommended',
          },
          {
            value: 'current',
            label: 'Current directory (./.agentstage)',
          },
          {
            value: 'custom',
            label: 'Custom path',
          },
        ],
      });

      if (p.isCancel(result)) {
        consola.info('Cancelled');
        return;
      }
      locationMode = result as string;
    }

    // 3. 确定目标目录
    let targetDir: string;
    switch (locationMode) {
      case 'default':
        targetDir = join(homedir(), '.agentstage', name);
        break;
      case 'current':
        targetDir = join(process.cwd(), '.agentstage');
        break;
      case 'custom':
        const customPath = await p.text({
          message: 'Enter custom path:',
          placeholder: '/path/to/project',
          validate: (value) => {
            if (!value || value.trim() === '') {
              return 'Path is required';
            }
          },
        });
        if (p.isCancel(customPath)) {
          consola.info('Cancelled');
          return;
        }
        targetDir = resolve(customPath);
        break;
      default:
        targetDir = join(homedir(), '.agentstage', name);
    }

    // 4. 检查目录
    if (existsSync(targetDir)) {
      const files = await readdirSafe(targetDir);
      if (files.length > 0) {
        // 项目已存在，提示并退出
        console.log();
        consola.info('Project already initialized!');
        console.log(`  Location: ${c.cyan(targetDir)}`);
        console.log();
        console.log(`  cd ${c.cyan(targetDir)}`);
        console.log(`  ${c.cyan('agentstage dev start')}`);
        console.log();
        return;
      }
    }

    // 5. 保存工作目录配置
    await setWorkspaceDir(targetDir);

    const s = p.spinner();

    try {
      // 6. 复制模板文件
      s.start('Creating project from template...');
      const templateDir = getTemplateDir();
      await mkdir(targetDir, { recursive: true });
      await copyTemplateFiles(templateDir, targetDir);
      s.stop('Project template copied');

      // 7. 更新 package.json 中的 workspace 依赖
      s.start('Configuring project...');
      await configurePackageJson(targetDir);
      s.stop('Project configured');

      // 8. 安装依赖
      s.start('Installing dependencies...');
      await installDependencies(targetDir);
      s.stop('Dependencies installed');

      // 完成
      console.log();
      consola.success('Project created successfully!');
      console.log();
      console.log(`  Location: ${c.cyan(targetDir)}`);
      console.log();
      console.log(`  cd ${c.cyan(targetDir)}`);
      console.log(`  ${c.cyan('agentstage dev start')}`);
      console.log();
      console.log(c.dim('To expose your server to the internet:'));
      console.log(`  ${c.cyan('agentstage dev start --tunnel')}`);
      console.log();
    } catch (error: any) {
      s.stop('Failed to create project');
      consola.error(error.message);
      process.exit(1);
    }
  });

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function copyTemplateFiles(templateDir: string, targetDir: string): Promise<void> {
  const entries = await readdir(templateDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(templateDir, entry.name);
    const destPath = join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await mkdir(destPath, { recursive: true });
      await copyTemplateFiles(srcPath, destPath);
    } else {
      await cp(srcPath, destPath);
    }
  }
}

async function configurePackageJson(targetDir: string): Promise<void> {
  const packageJsonPath = join(targetDir, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));

  // Replace workspace:* with actual version or local path
  // In dev mode (monorepo), use file: protocol to reference the local bridge package
  // Check if we're in the monorepo by looking for packages/bridge from the CLI location
  // From packages/cli/src/commands/dev/init.ts -> packages/cli/src/ -> packages/cli/ -> packages/
  const currentFilePath = fileURLToPath(import.meta.url);
  const localBridgePath = resolve(join(dirname(currentFilePath), '..', '..', '..', '..', 'bridge'));
  const isDev = existsSync(localBridgePath);

  if (isDev) {
    // In dev mode, use file: protocol to reference the local bridge package
    // This works with both npm and pnpm
    packageJson.dependencies['@agentstage/bridge'] = `file:${localBridgePath}`;
  } else {
    // Use npm version for production
    packageJson.dependencies['@agentstage/bridge'] = '^0.1.0';
  }

  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
}

async function installDependencies(targetDir: string): Promise<void> {
  // Check if we're in the monorepo by looking for packages/bridge from the CLI location
  // From packages/cli/src/commands/dev/init.ts -> packages/cli/src/ -> packages/cli/ -> packages/
  const currentFilePath = fileURLToPath(import.meta.url);
  const localBridgePath = resolve(join(dirname(currentFilePath), '..', '..', '..', '..', 'bridge'));
  const isDev = existsSync(localBridgePath);

  if (isDev) {
    // In development mode (monorepo), use pnpm
    try {
      await execa('pnpm', ['install'], { cwd: targetDir, stdio: 'pipe' });
    } catch {
      // Fallback to npm if pnpm is not available
      await execa('npm', ['install'], { cwd: targetDir, stdio: 'pipe' });
    }
  } else {
    // In production, use npm
    await execa('npm', ['install'], { cwd: targetDir, stdio: 'pipe' });
  }
}
