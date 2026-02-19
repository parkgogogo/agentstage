import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'pathe';
import { getWorkspaceDir, isInitialized, readRuntimeConfig, getPagesDir } from '../../utils/paths.js';
import { FileStore } from 'agent-stage-bridge';
import { printAgentErrorHelp, printAgentSuccess, printAgentHint } from '../../utils/agent-helper.js';

// 从 stdin 读取数据
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export const pageAddCommand = new Command('add')
  .description('Add a new page with json-render UI')
  .argument('<name>', 'Page name (e.g., counter, about)')
  .option('-u, --ui <json>', 'UI spec as JSON string (or use --ui-stdin)')
  .option('--ui-stdin', 'Read UI spec from stdin')
  .option('-s, --state <json>', 'Initial state as JSON string (or use --state-stdin)')
  .option('--state-stdin', 'Read state from stdin')
  .action(async (name, options) => {
    // 检查是否已初始化
    if (!isInitialized()) {
      printAgentErrorHelp('Project not initialized');
      process.exit(1);
    }

    if (!/^[a-z0-9-]+$/.test(name)) {
      printAgentErrorHelp('Page name contains invalid characters');
      process.exit(1);
    }

    try {
      const workspaceDir = await getWorkspaceDir();
      const config = await readRuntimeConfig();
      const routesDir = join(workspaceDir, 'src', 'routes');
      const pagesDir = join(workspaceDir, 'src', 'pages', name);
      const pageFile = join(routesDir, `${name}.tsx`);

      // 确保目录存在
      await mkdir(routesDir, { recursive: true });
      await mkdir(pagesDir, { recursive: true });

      if (existsSync(pageFile)) {
        printAgentErrorHelp(`Page "${name}" already exists`);
        process.exit(1);
      }

      // 生成 .tsx 路由文件
      const pageContent = generateTsxContent(name);
      await writeFile(pageFile, pageContent);

      // 处理 UI
      let uiContent: Record<string, unknown>;
      if (options.uiStdin) {
        // 从 stdin 读取 UI
        const input = await readStdin();
        try {
          uiContent = JSON.parse(input);
        } catch {
          printAgentErrorHelp('Invalid UI JSON from stdin', 'Make sure your stdin contains valid JSON');
          process.exit(1);
        }
      } else if (options.ui) {
        try {
          uiContent = JSON.parse(options.ui);
        } catch {
          printAgentErrorHelp('Invalid UI JSON format');
          process.exit(1);
        }
      } else {
        uiContent = generateDefaultUi(name);
      }
      await writeFile(join(pagesDir, 'ui.json'), JSON.stringify(uiContent, null, 2));

      // 处理 State
      let stateContent: Record<string, unknown>;
      let hasCustomState = false;
      
      if (options.stateStdin) {
        // 从 stdin 读取 state
        const input = await readStdin();
        try {
          stateContent = { state: JSON.parse(input) };
          hasCustomState = true;
        } catch {
          printAgentErrorHelp('Invalid state JSON from stdin');
          process.exit(1);
        }
      } else if (options.state) {
        try {
          stateContent = { state: JSON.parse(options.state) };
          hasCustomState = true;
        } catch {
          printAgentErrorHelp('Invalid state JSON format');
          process.exit(1);
        }
      } else {
        stateContent = generateDefaultState(name);
      }

      if (hasCustomState) {
        // 使用自定义 state，直接写入
        const pagesDirPath = await getPagesDir();
        const fileStore = new FileStore({ pagesDir: pagesDirPath });
        await fileStore.save(name, {
          state: stateContent.state,
          version: 1,
          updatedAt: new Date().toISOString(),
          pageId: name,
        });
      } else {
        // 默认空 state
        await writeFile(join(pagesDir, 'store.json'), JSON.stringify(stateContent, null, 2));
      }

      // 输出结果
      const port = config?.port || 3000;
      
      if (options.ui) {
        // 提供了完整 UI
        printAgentSuccess(
          `Page "${name}" created with custom UI and state`,
          [
            `Start dev server: agentstage dev start`,
            `Open http://localhost:${port}/${name} to see your page`,
            `Update state: agentstage run set-state ${name} '{"key": "value"}'`
          ]
        );
      } else {
        // 默认 UI，输出 prompts
        consola.success(`Page "${name}" created`);
        console.log(`  Route: ${c.cyan(`src/routes/${name}.tsx`)}`);
        console.log(`  UI:    ${c.cyan(`src/pages/${name}/ui.json`)}`);
        console.log(`  Store: ${c.cyan(`src/pages/${name}/store.json`)}`);
        console.log(`  URL:   ${c.cyan(`http://localhost:${port}/${name}`)}`);
        console.log();
        console.log(c.bold('─'.repeat(60)));
        console.log(c.bold('🤖 AI Prompts'));
        console.log(c.bold('─'.repeat(60)));
        console.log();
        console.log(c.dim('Send this to AI to generate UI:'));
        console.log();
        console.log(generatePromptContent(name));
        console.log(c.bold('─'.repeat(60)));
        console.log();
        printAgentHint(`Or provide UI directly: agentstage page add ${name} --ui '{...}' --state '{...}'`);
      }

    } catch (error: any) {
      printAgentErrorHelp('Failed to create page', error.message);
      process.exit(1);
    }
  });

function generateTsxContent(name: string): string {
  const pascalName = toPascalCase(name);

  return `import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import { PageRenderer } from '../components/PageRenderer'
import { createPageBridge } from '../lib/bridge'

export const Route = createFileRoute('/${name}')({
  component: ${pascalName}Page,
})

function ${pascalName}Page() {
  const bridge = useMemo(() => createPageBridge({
    pageId: '${name}',
  }), [])

  return <PageRenderer pageId="${name}" bridge={bridge} />
}
`;
}

function generateDefaultUi(name: string): Record<string, unknown> {
  const titleName = toTitleCase(name);

  return {
    root: 'main',
    elements: {
      main: {
        type: 'Stack',
        props: {
          direction: 'vertical',
          gap: 'md',
          align: 'center',
        },
        children: ['title', 'hint'],
      },
      title: {
        type: 'Heading',
        props: {
          text: titleName,
          level: 'h1',
        },
      },
      hint: {
        type: 'Text',
        props: {
          text: 'Page created. Use AI to generate UI or edit ui.json directly.',
          variant: 'muted',
        },
      },
    },
  };
}

function generateDefaultState(name: string): Record<string, unknown> {
  return {
    state: {},
    version: 1,
    updatedAt: new Date().toISOString(),
    pageId: name,
  };
}

function toPascalCase(str: string): string {
  return str.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

function toTitleCase(str: string): string {
  return str.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function generatePromptContent(name: string): string {
  const titleName = toTitleCase(name);

  return `# Generate UI for "${titleName}" page

Output JSON format:
\`\`\`json
{
  "root": "main",
  "elements": {
    "element-id": {
      "type": "ComponentName",
      "props": { ... },
      "children": ["child-id-1"],
      "on": { "press": { "action": "setState", "params": {...} } }
    }
  }
}
\`\`\`

## Components

**Layout**: Stack(direction, gap, align, justify), Card(title, description), Separator
**Typography**: Heading(text, level), Text(text, variant), Badge(text, variant)  
**Inputs**: Input(label, name, type, placeholder), Button(label, variant)
**Data**: Table(columns, rows), Tabs(tabs), Dialog(title, openPath)

## State Bindings
- Read: \`{ "$state": "/path" }\`
- Write: \`{ "$bindState": "/path" }\`
- List item: \`{ "$item": "field" }\`

## Actions
- \`setState\`: { statePath: string, value: any }
- \`pushState\`: { statePath: string, value: any }
- \`removeState\`: { statePath: string, index: number }

## Usage
\`\`\`bash
agentstage page add ${name} --ui '{"root":"main",...}' --state '{"count":0}'
\`\`\`

Generate UI for: [describe your page here]`;
}
