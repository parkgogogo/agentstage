import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'pathe';
import { getWorkspaceDir, isInitialized, readRuntimeConfig } from '../utils/paths.js';

export const addPageCommand = new Command('add-page')
  .description('Add a new page with Bridge store')
  .argument('<name>', 'Page name (e.g., counter, about)')
  .action(async (name) => {
    // 检查是否已初始化
    if (!isInitialized()) {
      consola.error('Project not initialized. Please run `agentstage init` first.');
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

      // 确保 routes 目录存在
      await mkdir(routesDir, { recursive: true });

      if (existsSync(pageFile)) {
        consola.error(`Page "${name}" already exists at src/routes/${name}.tsx`);
        process.exit(1);
      }

      const pageContent = `import { z } from 'zod';
import { createFileRoute } from '@tanstack/react-router';
import { createBridgeStore } from 'agent-stage-bridge/browser';
import { useEffect } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

// Define the page state schema
const StateSchema = z.object({
  count: z.number().default(0),
});

type State = z.infer<typeof StateSchema>;

// Create the bridge store for this page
const bridgeStore = createBridgeStore<State, { increment: { payload?: number }; decrement: {} }>({
  pageId: '${name}',
  storeKey: 'main',
  description: {
    schema: StateSchema,
    actions: {
      increment: {
        description: 'Increment the counter by a specified amount (default: 1)',
        payload: z.number().optional(),
      },
      decrement: {
        description: 'Decrement the counter by 1',
      },
    },
  },
  createState: (set) => ({
    count: 0,
    dispatch: (action) => {
      switch (action.type) {
        case 'increment':
          set((state) => ({ count: state.count + (action.payload ?? 1) }));
          break;
        case 'decrement':
          set((state) => ({ count: state.count - 1 }));
          break;
      }
    },
  }),
});

export const Route = createFileRoute('/${name}')({
  component: ${toPascalCase(name)}Page,
});

function ${toPascalCase(name)}Page() {
  // Connect to the bridge when the component mounts
  useEffect(() => {
    bridgeStore.connect().catch(console.error);
  }, []);

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>${toTitleCase(name)}</CardTitle>
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

      await writeFile(pageFile, pageContent);

      consola.success(`Page "${name}" created`);
      console.log(`  File:     ${c.cyan(`src/routes/${name}.tsx`)}`);
      const port = config?.port || 3000;
      console.log(`  URL:      ${c.cyan(`http://localhost:${port}/${name}`)}`);
      console.log(`  Route:    ${c.gray(`/${name}`)} (file-based, auto-registered by TanStack Router)`);
      console.log();
      console.log(`  The route is automatically registered by TanStack Router.`);
      console.log(`  No manual route configuration needed!`);

    } catch (error: any) {
      consola.error('Failed to create page:', error.message);
      process.exit(1);
    }
  });

function toPascalCase(str: string): string {
  return str.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

function toTitleCase(str: string): string {
  return str.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
