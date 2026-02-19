import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'pathe';
import { getWorkspaceDir, isInitialized } from '../../utils/paths.js';

export const pageSetUiCommand = new Command('set-ui')
  .description('Set the UI spec for a page')
  .argument('<name>', 'Page name')
  .argument('[json]', 'UI spec as JSON string (omit to read from stdin)')
  .action(async (name, jsonStr) => {
    if (!isInitialized()) {
      consola.error('Project not initialized. Please run `agentstage init` first.');
      process.exit(1);
    }

    // 读取 JSON
    let uiSpec: unknown;
    if (jsonStr) {
      try {
        uiSpec = JSON.parse(jsonStr);
      } catch {
        consola.error('Invalid JSON provided');
        process.exit(1);
      }
    } else {
      // 从 stdin 读取
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      const input = Buffer.concat(chunks).toString();
      if (!input.trim()) {
        consola.error('No JSON provided. Use: echo \'{...}\' | agentstage page set-ui <name> --stdin');
        process.exit(1);
      }
      try {
        uiSpec = JSON.parse(input);
      } catch {
        consola.error('Invalid JSON from stdin');
        process.exit(1);
      }
    }

    // 验证基本结构
    if (!uiSpec || typeof uiSpec !== 'object' || !('root' in uiSpec) || !('elements' in uiSpec)) {
      consola.error('Invalid UI spec. Must have "root" and "elements" fields');
      process.exit(1);
    }

    const workspaceDir = await getWorkspaceDir();
    const uiFile = join(workspaceDir, 'src', 'pages', name, 'ui.json');

    // 检查页面是否存在
    if (!existsSync(join(workspaceDir, 'src', 'pages', name))) {
      consola.error(`Page "${name}" not found. Create it first with: agentstage page add ${name}`);
      process.exit(1);
    }

    try {
      await writeFile(uiFile, JSON.stringify(uiSpec, null, 2));
      consola.success(`UI spec updated for page "${name}"`);
      console.log(`  File: ${c.gray(`src/pages/${name}/ui.json`)}`);
    } catch (error: any) {
      consola.error('Failed to write UI spec:', error.message);
      process.exit(1);
    }
  });
