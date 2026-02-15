import { Command } from 'commander';
import * as p from '@clack/prompts';
import consola from 'consola';
import c from 'picocolors';
import { execa } from 'execa';
import { mkdir, writeFile, readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, join } from 'pathe';

export const initCommand = new Command('init')
  .description('Initialize a new Agentstage project with TanStack Start + Tailwind + shadcn/ui')
  .argument('[directory]', 'Target directory', '.')
  .action(async (directory) => {
    const targetDir = resolve(directory);
    const projectName = directory === '.' ? 'my-agentstage-app' : directory;
    
    // 检查目录
    if (existsSync(targetDir) && (await readdirSafe(targetDir)).length > 0) {
      const shouldContinue = await p.confirm({
        message: `Directory ${c.cyan(targetDir)} is not empty. Continue?`,
        initialValue: false,
      });
      if (p.isCancel(shouldContinue) || !shouldContinue) {
        consola.info('Cancelled');
        return;
      }
    }
    
    const s = p.spinner();
    
    try {
      // 1. 创建 TanStack Start 项目
      s.start('Creating TanStack Start project...');
      await execa('npx', ['create-tsrouter@latest', projectName, '--template', 'file-router'], {
        cwd: targetDir === process.cwd() ? process.cwd() : resolve(targetDir, '..'),
        stdio: 'pipe',
      });
      s.stop('TanStack Start project created');
      
      const projectDir = join(targetDir === process.cwd() ? process.cwd() : resolve(targetDir, '..'), projectName);
      
      // 2. 初始化 Tailwind CSS
      s.start('Configuring Tailwind CSS...');
      await execa('npx', ['tailwindcss', 'init', '-p'], {
        cwd: projectDir,
        stdio: 'pipe',
      });
      await configureTailwind(projectDir);
      s.stop('Tailwind CSS configured');
      
      // 3. 初始化 shadcn/ui
      s.start('Initializing shadcn/ui...');
      await execa('npx', ['shadcn@latest', 'init', '-y', '--base-color', 'neutral'], {
        cwd: projectDir,
        stdio: 'pipe',
      });
      s.stop('shadcn/ui initialized');
      
      // 4. 安装基础组件
      s.start('Installing base components...');
      await execa('npx', ['shadcn', 'add', 'button', 'card', 'input', '-y'], {
        cwd: projectDir,
        stdio: 'pipe',
      });
      s.stop('Base components installed');
      
      // 5. 安装 Bridge
      s.start('Installing @agentstage/bridge...');
      await execa('npm', ['install', '@agentstage/bridge'], {
        cwd: projectDir,
        stdio: 'pipe',
      });
      s.stop('@agentstage/bridge installed');
      
      // 6. 创建 Bridge API 路由
      s.start('Creating Bridge Gateway...');
      await createBridgeFiles(projectDir);
      s.stop('Bridge Gateway created');
      
      // 7. 创建示例页面
      s.start('Creating demo page...');
      await createDemoPage(projectDir);
      s.stop('Demo page created');
      
      // 完成
      console.log();
      consola.success('Project created successfully!');
      console.log();
      console.log(`  cd ${c.cyan(projectName)}`);
      console.log(`  ${c.cyan('agentstage start')}`);
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

async function configureTailwind(projectDir: string) {
  // 更新 tailwind.config.ts
  const tailwindConfig = `import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
`;
  await writeFile(join(projectDir, 'tailwind.config.ts'), tailwindConfig);
}

async function createBridgeFiles(projectDir: string) {
  // 创建 Bridge API 路由
  const bridgeApiRoute = `import { json } from '@tanstack/react-start';
import { createBridgeGateway } from '@agentstage/bridge';
import type { APIRoute } from '@tanstack/react-start';

const gateway = createBridgeGateway();

export const APIRoute: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  
  if (url.pathname === '/api/bridge/stores') {
    return json({ stores: gateway.listStores() });
  }
  
  return json({ error: 'Not found' }, { status: 404 });
};
`;
  
  await mkdir(join(projectDir, 'app', 'routes', 'api'), { recursive: true });
  await writeFile(join(projectDir, 'app', 'routes', 'api', 'bridge.ts'), bridgeApiRoute);
  
  // 创建动态页面路由
  const pageRoute = `import { createFileRoute } from '@tanstack/react-router';
import React from 'react';

export const Route = createFileRoute('/p/$pageId')({
  component: PageComponent,
});

function PageComponent() {
  const { pageId } = Route.useParams();
  const [Component, setComponent] = React.useState<React.ComponentType | null>(null);
  
  React.useEffect(() => {
    import(\`../pages/\${pageId}/page.tsx\`).then((mod) => {
      setComponent(() => mod.default);
    }).catch(() => {
      console.error(\`Page not found: \${pageId}\`);
    });
  }, [pageId]);
  
  if (!Component) return <div>Loading...</div>;
  return <Component />;
}
`;
  
  await writeFile(join(projectDir, 'app', 'routes', 'p.$pageId.tsx'), pageRoute);
}

async function createDemoPage(projectDir: string) {
  const demoPage = `import React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useStore } from 'zustand';
import { z } from 'zod';
import { createBridgeStore } from '@agentstage/bridge/browser';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export const Route = createFileRoute('/p/demo-counter')({
  component: DemoCounterPage,
});

interface State {
  count: number;
  dispatch: (action: { type: string; payload?: unknown }) => void;
}

const stateSchema = z.object({
  count: z.number().describe('Counter value'),
});

const bridge = createBridgeStore<State, {
  increment: { payload: { by: number } };
}>({
  pageId: 'demo-counter',
  storeKey: 'main',
  description: {
    schema: stateSchema,
    actions: {
      increment: {
        description: 'Increment counter by N',
        payload: z.object({ by: z.number() }),
      },
    },
  },
  createState: (set, get) => ({
    count: 0,
    dispatch: (action) => {
      if (action.type === 'increment') {
        const { by = 1 } = action.payload as { by?: number };
        set({ count: get().count + by });
      }
    },
  }),
});

const store = bridge.store;

function DemoCounterPage() {
  const count = useStore(store, (s) => s.count);

  React.useEffect(() => {
    let disconnect = () => {};
    bridge.connect().then((conn) => {
      disconnect = conn.disconnect;
    });
    return () => disconnect();
  }, []);

  return (
    <div className="p-8">
      <Card>
        <CardHeader>
          <CardTitle>Demo Counter</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-2xl font-mono">Count: {count}</p>
          <div className="flex gap-2">
            <Button onClick={() => store.getState().dispatch({ type: 'increment', payload: { by: 1 } })} >
              +1
            </Button>
            <Button onClick={() => store.getState().dispatch({ type: 'increment', payload: { by: 5 } })} >
              +5
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
`;
  
  await mkdir(join(projectDir, 'app', 'routes', 'pages', 'demo-counter'), { recursive: true });
  await writeFile(join(projectDir, 'app', 'routes', 'pages', 'demo-counter', 'page.tsx'), demoPage);
}
