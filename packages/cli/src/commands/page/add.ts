import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'pathe';
import { getWorkspaceDir, isInitialized, readRuntimeConfig } from '../../utils/paths.js';

export const pageAddCommand = new Command('add')
  .description('Add a new page with Bridge store')
  .argument('<name>', 'Page name (e.g., counter, about)')
  .option('--no-types', 'Skip generating type definitions')
  .action(async (name, options) => {
    // 检查是否已初始化
    if (!isInitialized()) {
      consola.error('Project not initialized. Please run `agentstage dev init` first.');
      process.exit(1);
    }

    if (!/^[a-z0-9-]+$/.test(name)) {
      consola.error('Page name must be lowercase letters, numbers, and hyphens');
      process.exit(1);
    }

    try {
      const workspaceDir = await getWorkspaceDir();
      const config = await readRuntimeConfig();
      const routesDir = join(workspaceDir, 'src', 'routes');
      const pageFile = join(routesDir, `${name}.tsx`);
      const typesDir = join(workspaceDir, '.agentstage', 'types');

      // 确保 routes 目录存在
      await mkdir(routesDir, { recursive: true });

      if (existsSync(pageFile)) {
        consola.error(`Page "${name}" already exists at src/routes/${name}.tsx`);
        process.exit(1);
      }

      const pageContent = generatePageContent(name);

      await writeFile(pageFile, pageContent);

      // 生成类型定义
      if (options.types) {
        await mkdir(typesDir, { recursive: true });
        const typeContent = generateTypeContent(name);
        await writeFile(join(typesDir, `${name}.d.ts`), typeContent);
      }

      consola.success(`Page "${name}" created`);
      console.log(`  File:     ${c.cyan(`src/routes/${name}.tsx`)}`);
      const port = config?.port || 3000;
      console.log(`  URL:      ${c.cyan(`http://localhost:${port}/${name}`)}`);
      console.log(`  Route:    ${c.gray(`/${name}`)} (file-based, auto-registered by TanStack Router)`);
      if (options.types) {
        console.log(`  Types:    ${c.gray(`.agentstage/types/${name}.d.ts`)}`);
      }
      console.log();
      console.log(`  The route is automatically registered by TanStack Router.`);
      console.log(`  No manual route configuration needed!`);

    } catch (error: any) {
      consola.error('Failed to create page:', error.message);
      process.exit(1);
    }
  });

function generatePageContent(name: string): string {
  const pascalCase = toPascalCase(name);
  const titleCase = toTitleCase(name);

  return `import { z } from 'zod';
import { createFileRoute } from '@tanstack/react-router';
import { createBridgeStore } from 'agent-stage-bridge/browser';
import { useEffect } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

// Define the page state schema
const StateSchema = z.object({
  count: z.number().default(0),
});

export type ${pascalCase}State = z.infer<typeof StateSchema>;

// Define available actions
export interface ${pascalCase}Actions {
  increment: { by?: number };
  decrement: {};
  reset: {};
}

// Create the bridge store for this page
export const ${camelCase(name)}Store = createBridgeStore<${pascalCase}State, ${pascalCase}Actions>({
  pageId: '${name}',
  storeKey: 'main',
  description: {
    schema: StateSchema,
    actions: {
      increment: {
        description: 'Increment the counter by a specified amount (default: 1)',
        payload: z.object({ by: z.number().optional() }),
      },
      decrement: {
        description: 'Decrement the counter by 1',
      },
      reset: {
        description: 'Reset counter to 0',
      },
    },
  },
  createState: (set) => ({
    count: 0,
    dispatch: (action) => {
      switch (action.type) {
        case 'increment':
          set((state) => ({ count: state.count + (action.payload?.by ?? 1) }));
          break;
        case 'decrement':
          set((state) => ({ count: state.count - 1 }));
          break;
        case 'reset':
          set({ count: 0 });
          break;
      }
    },
  }),
});

export const Route = createFileRoute('/${name}')({
  component: ${pascalCase}Page,
});

function ${pascalCase}Page() {
  // Connect to the bridge when the component mounts
  useEffect(() => {
    ${camelCase(name)}Store.connect().catch(console.error);
  }, []);

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>${titleCase}</CardTitle>
            <CardDescription>
              This page is connected to the Agentstage Bridge.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Edit this page at src/routes/${name}.tsx
            </p>
            <div className="flex gap-2">
              <Button variant="outline">Action 1</Button>
              <Button>Action 2</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
`;
}

function generateTypeContent(name: string): string {
  const pascalCase = toPascalCase(name);

  return `// Auto-generated types for page: ${name}
// This file is generated by \`agentstage page add ${name}\`

export interface ${pascalCase}State {
  count: number;
}

export interface ${pascalCase}Actions {
  increment: { by?: number };
  decrement: {};
  reset: {};
}

// Usage in Agent code:
// import type { ${pascalCase}State, ${pascalCase}Actions } from '../.agentstage/types/${name}';
`;
}

function toPascalCase(str: string): string {
  return str.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

function toTitleCase(str: string): string {
  return str.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function camelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}
