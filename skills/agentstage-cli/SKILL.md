---
name: agentstage-cli
description: Guide for using Agentstage CLI to create interactive UI pages controlled by AI agents. Use when you need to (1) Initialize an Agentstage project with 'agentstage init', (2) Create or manage UI pages with 'agentstage add-page', (3) Start/stop the Runtime service with 'agentstage start/stop', (4) Execute actions or inspect pages with 'agentstage exec/inspect', (5) Add shadcn/ui components with 'agentstage components add'. Essential for building agent-controlled user interfaces with React, Tailwind, and real-time state synchronization.
---

# Agentstage CLI

## Overview

Agentstage is a framework for creating interactive UI pages that can be controlled by AI agents through a CLI. It combines:

- **Vite** - Fast development server with HMR
- **TanStack Router** - File-based routing for React
- **Tailwind CSS** - Utility-first styling
- **shadcn/ui** - Pre-built accessible components
- **Bridge** - Real-time state synchronization between agents and browser pages via WebSocket

Use this skill when building agent-controlled dashboards, forms, or interactive UIs.

## Core Concepts

### Workspace Directory

Agentstage CLI operates on a single workspace directory (stored in `~/.config/agentstage/workspace`).

The workspace contains:
```
~/.agentstage/webapp/          # Default location (fixed name)
├── src/routes/                # TanStack Router file-based routes
│   ├── __root.tsx             # Root layout
│   ├── index.tsx              # Home page (/)
│   └── <page>.tsx             # Your UI pages (e.g., counter.tsx -> /counter)
├── src/components/ui/         # shadcn/ui components
├── vite.config.ts             # Vite config with bridgePlugin()
└── .agentstage/runtime.json   # Runtime config (PID, port)
```

### Single-Port Architecture

Agentstage uses a simplified single-port architecture:

| Service | URL |
|---------|-----|
| Web App | http://localhost:3000 |
| Bridge Gateway | ws://localhost:3000/_bridge |

The Bridge WebSocket is automatically mounted on the Vite dev server via `bridgePlugin()` - no separate service needed.

### File-Based Routing

TanStack Router uses **file-based routing**. Files in `src/routes/` automatically become URL paths:

| File | URL Path |
|------|----------|
| `routes/index.tsx` | `/` |
| `routes/counter.tsx` | `/counter` |
| `routes/todo-list.tsx` | `/todo-list` |

Each page exposes a **Bridge Store** with:
- **State** - Current data (e.g., `{ count: 5 }`)
- **Actions** - Operations that modify state (e.g., `increment`, `reset`)
- **Schema** - Zod schema describing state structure

Agents control pages by:
1. Connecting to Bridge Gateway (`ws://localhost:3000/_bridge`)
2. Dispatching actions or setting state directly
3. Subscribing to real-time state changes

## Quick Start

### Initialize Project

```bash
agentstage init              # Interactive mode
agentstage init --yes        # Non-interactive, use defaults
```

The project is always named `webapp`. Choose workspace location:
- **Default**: `~/.agentstage/webapp/` (recommended)
- **Current**: `./.agentstage/` in current directory
- **Custom**: Specify any path

This creates a complete project with Vite + TanStack Router + Tailwind + shadcn/ui + Bridge.

**Note**: If already initialized, shows existing project location.

### Start Runtime

```bash
agentstage start             # Start on default port 3000
agentstage start -p 3001     # Start on custom port
```

Starts the Vite dev server with Bridge WebSocket automatically mounted:
- Web server: http://localhost:3000
- Bridge Gateway: ws://localhost:3000/_bridge

### Check Status

```bash
agentstage status
```

Shows:
```
Agentstage Runtime
────────────────────────────────────────
Workspace: ~/.agentstage/webapp
Status:    ● Running
PID:       12345
Port:      3000
Started:   2026-02-16T10:30:00.000Z
Web:       http://localhost:3000
Bridge:    ws://localhost:3000/_bridge
```

## Managing Pages

### List Pages

```bash
agentstage ls
```

Output:
```
Pages:

  ○ / (home)
  ● /counter             (online)
      └─ main            v5 {count: 5}
  ○ /todo-list           (offline)

Runtime is running. Bridge: ws://localhost:3000/_bridge
```

### Add New Page

```bash
agentstage add-page counter
```

Creates `src/routes/counter.tsx` with a Bridge Store and basic UI. The file automatically becomes `/counter` URL.

**File routing rules:**
- `routes/index.tsx` → `/`
- `routes/counter.tsx` → `/counter`
- `routes/todo-list.tsx` → `/todo-list`

### Remove Page

```bash
agentstage rm-page counter
```

Deletes `src/routes/counter.tsx`.

## Controlling Pages

### Inspect Page Capabilities

```bash
agentstage inspect counter
```

Shows schema, actions, and current state (requires page to be open in browser):
```
Page: counter
────────────────────────────────────────
Status: ● Online

Schema:
  count: number

Actions:
  increment - Increment the counter by a specified amount (default: 1)
    payload: number (optional)
  decrement - Decrement the counter by 1

Current State:
  { "count": 5 }
```

### Execute Action

```bash
agentstage exec counter increment '{"payload": 10}'
```

Dispatches the `increment` action with payload `10`.

### Watch Real-time Changes

```bash
agentstage watch counter
```

Streams all state changes from the page (press Ctrl+C to exit).

## shadcn/ui Components

### List Installed Components

```bash
agentstage components list
```

Shows installed components:
```
Installed (3):
  button  card  input
```

### List Available Components

```bash
agentstage components available
```

Shows all available components from shadcn/ui registry.

### Install Component

```bash
agentstage components add button
agentstage components add card input dialog
```

Uses `npx shadcn@latest add` internally.

### Search Components

```bash
agentstage components search drop
```

Finds dropdown-menu, dropzone, etc.

### View Component

```bash
agentstage components view button
```

Preview component code before installing.

## Page Implementation Pattern

When implementing a page, follow this pattern:

**⚠️ 重要：编辑完文件后务必运行 `npm run type-check` 检查类型。**

```typescript
// src/routes/my-page.tsx
import { z } from 'zod';
import { createFileRoute } from '@tanstack/react-router';
import { createBridgeStore } from '@agentstage/bridge/browser';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

// Define the page state schema
const StateSchema = z.object({
  items: z.array(z.string()).default([]),
});

type State = z.infer<typeof StateSchema>;

// Create the bridge store for this page
const bridgeStore = createBridgeStore<State, {
  addItem: { payload: string };
  removeItem: { payload: number };
}>({
  pageId: 'my-page',
  storeKey: 'main',
  description: {
    schema: StateSchema,
    actions: {
      addItem: {
        description: 'Add a new item to the list',
        payload: z.string(),
      },
      removeItem: {
        description: 'Remove item by index',
        payload: z.number(),
      },
    },
  },
  createState: (set) => ({
    items: [],
    dispatch: (action) => {
      switch (action.type) {
        case 'addItem':
          set((state) => ({ items: [...state.items, action.payload] }));
          break;
        case 'removeItem':
          set((state) => ({
            items: state.items.filter((_, i) => i !== action.payload),
          }));
          break;
      }
    },
  }),
});

export const Route = createFileRoute('/my-page')({
  component: MyPage,
});

function MyPage() {
  // Connect to the bridge when the component mounts
  if (typeof window !== 'undefined') {
    bridgeStore.connect().catch(console.error);
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>My Page</CardTitle>
            <CardDescription>
              This page is connected to the Agentstage Bridge.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>Edit this page at src/routes/my-page.tsx</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

**编辑完成后，立即运行：**
```bash
npm run type-check
```

## Type Checking

**重要：每次编辑文件后，必须运行 type-check 命令检查 TypeScript 类型。**

```bash
npm run type-check    # 检查 TypeScript 类型，不生成输出文件
```

在以下场景必须执行 type-check：
- 创建或修改页面组件后
- 添加或更新 shadcn/ui 组件后
- 修改 Bridge Store 定义后
- 安装新依赖后

Type checking 能及早发现问题：
- React hooks 使用错误
- Bridge Store 类型不匹配
- 组件 props 类型错误
- 缺少必要的导入

## Best Practices

### Page Design

1. **Expose clear actions** - Agents should understand what operations are available
2. **Include descriptions** - Every action should have a `description` field
3. **Use Zod schemas** - Type-safe state and action payloads
4. **Handle errors** - Pages should gracefully handle invalid actions

### State Management

1. **Keep state minimal** - Only expose what agents need to control
2. **Derive UI state** - Use selectors to derive computed values
3. **Batch updates** - Multiple rapid changes should be batched

### Security

1. **Validate payloads** - Zod schemas protect against malformed data
2. **Sanitize inputs** - Never render user input without sanitization
3. **Rate limiting** - Consider implementing action rate limits for public pages

## Troubleshooting

### Runtime won't start

```bash
agentstage status        # Check if already running
agentstage stop          # Force stop if stale PID
agentstage start         # Try again
```

### Page not found

```bash
agentstage ls            # Verify page exists
# Check file location: src/routes/<name>.tsx
```

### Bridge connection failed

```bash
agentstage status        # Verify server is running on port 3000
# Check if firewall blocks WebSocket connections to port 3000
```

### Component not found

```bash
agentstage components list    # Check if installed
agentstage components add <component>    # Install if missing
```

## Resources

### references/
- `page-templates.md` - Common page implementation patterns
