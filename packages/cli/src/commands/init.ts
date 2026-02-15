import { Command } from 'commander';
import * as p from '@clack/prompts';
import consola from 'consola';
import c from 'picocolors';
import { execa } from 'execa';
import { mkdir, writeFile, readFile, readdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, join, basename } from 'pathe';
import { homedir } from 'os';
import { setWorkspaceDir, getWorkspaceDir } from '../utils/paths.js';

export const initCommand = new Command('init')
  .description('Initialize a new Agentstage project')
  .argument('[name]', 'Project name', 'my-agentstage-app')
  .action(async (name) => {
    // 1. 选择工作目录模式
    const locationMode = await p.select({
      message: 'Where to store the project?',
      options: [
        { 
          value: 'default', 
          label: `Default (~/.agentstage/${name})`,
          hint: 'Recommended'
        },
        { 
          value: 'current', 
          label: 'Current directory (./.agentstage)' 
        },
        { 
          value: 'custom', 
          label: 'Custom path' 
        },
      ],
    });
    
    if (p.isCancel(locationMode)) {
      consola.info('Cancelled');
      return;
    }
    
    // 2. 确定目标目录
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
    
    // 3. 检查目录
    if (existsSync(targetDir)) {
      const files = await readdirSafe(targetDir);
      if (files.length > 0) {
        const shouldContinue = await p.confirm({
          message: `Directory ${c.cyan(targetDir)} is not empty. Continue?`,
          initialValue: false,
        });
        if (p.isCancel(shouldContinue) || !shouldContinue) {
          consola.info('Cancelled');
          return;
        }
        // 清空目录
        await rm(targetDir, { recursive: true });
      }
    }
    
    // 4. 保存工作目录配置
    await setWorkspaceDir(targetDir);
    
    const s = p.spinner();
    
    try {
      // 5. 创建项目
      s.start('Creating TanStack Start project...');
      await execa('npx', ['create-tsrouter@latest', basename(targetDir), '--template', 'file-router'], {
        cwd: resolve(targetDir, '..'),
        stdio: 'pipe',
      });
      s.stop('TanStack Start project created');
      
      // 6. 配置 Tailwind
      s.start('Configuring Tailwind CSS...');
      await execa('npx', ['tailwindcss', 'init', '-p'], {
        cwd: targetDir,
        stdio: 'pipe',
      });
      await configureTailwind(targetDir);
      s.stop('Tailwind CSS configured');
      
      // 7. 初始化 shadcn/ui
      s.start('Initializing shadcn/ui...');
      await execa('npx', ['shadcn@latest', 'init', '-y', '--base-color', 'neutral'], {
        cwd: targetDir,
        stdio: 'pipe',
      });
      s.stop('shadcn/ui initialized');
      
      // 8. 安装基础组件
      s.start('Installing base components...');
      await execa('npx', ['shadcn', 'add', 'button', 'card', 'input', '-y'], {
        cwd: targetDir,
        stdio: 'pipe',
      });
      s.stop('Base components installed');
      
      // 9. 安装 Bridge
      s.start('Installing @agentstage/bridge...');
      await execa('npm', ['install', '@agentstage/bridge'], {
        cwd: targetDir,
        stdio: 'pipe',
      });
      s.stop('@agentstage/bridge installed');
      
      // 10. 创建 Bridge 文件
      s.start('Creating Bridge Gateway...');
      await createBridgeFiles(targetDir);
      s.stop('Bridge Gateway created');
      
      // 11. 创建示例页面
      s.start('Creating demo page...');
      await createDemoPage(targetDir);
      s.stop('Demo page created');
      
      // 完成
      console.log();
      consola.success('Project created successfully!');
      console.log();
      console.log(`  Location: ${c.cyan(targetDir)}`);
      console.log();
      console.log(`  cd ${c.cyan(targetDir)}`);
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
