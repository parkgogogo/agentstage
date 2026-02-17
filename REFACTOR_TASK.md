# 架构改造任务：Browser-side Store → File-based Store

## 问题背景
当前架构中，store 存在于 Browser 内存（zustand），是"唯一真相源"。这导致：
1. 页面关闭后 state 丢失
2. Agent 必须在浏览器打开时才能工作
3. 无法持久化和恢复状态

## 目标架构
```
┌─────────────────────────────────────────────────────────────┐
│                        File System                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ page-a/      │  │ page-b/      │  │ ...          │      │
│  │  ├─ page.tsx │  │  ├─ page.tsx │  │              │      │
│  │  ├─ meta.json│  │  ├─ meta.json│  │              │      │
│  │  └─ store.json│ │  └─ store.json│ │              │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└──────────────────────────┬──────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
    ┌────────────┐  ┌────────────┐  ┌────────────┐
    │   SDK/CLI  │  │  Gateway   │  │  Browser   │
    │            │  │            │  │            │
    │ 直接读写   │  │ 文件+WS    │  │ 渲染缓存   │
    │ 文件       │  │ 桥接       │  │ + 事件源   │
    └────────────┘  └────────────┘  └────────────┘
```

## store.json 格式
```json
{
  "state": { /* 页面状态 */ },
  "version": 42,
  "updatedAt": "2026-02-17T08:30:00.000Z",
  "pageId": "demo-counter"
}
```

## 改造清单

### Phase 1: 创建文件存储模块
- [ ] 创建 `packages/bridge/src/gateway/fileStore.ts`
- [ ] 实现 `loadStore(pageId): StoreData`
- [ ] 实现 `saveStore(pageId, data): void`
- [ ] 实现 `watchStore(pageId, callback): Unsubscribe`

### Phase 2: 改造 Gateway
- [ ] 修改 `createBridgeGateway.ts`
- [ ] Browser 连接时发送文件中的初始状态
- [ ] Browser stateChanged 时写入文件并广播
- [ ] SDK/Client 请求时直接读写文件

### Phase 3: 改造 Browser 端
- [ ] 修改 `createBridgeStore.ts`
- [ ] 连接时接收初始状态并初始化 zustand
- [ ] dispatch 发送到 Gateway，由 Gateway 写文件

### Phase 4: 改造 SDK
- [ ] 修改 `BridgeClient.ts`
- [ ] `setState` 直接写文件（通过 Gateway API）
- [ ] `getState` 直接读文件

### Phase 5: 类型和兼容性
- [ ] 更新类型定义
- [ ] 确保错误处理（文件不存在、权限等）

## 开始 Phase 1

请先创建 `packages/bridge/src/gateway/fileStore.ts`：

```typescript
import { readFile, writeFile, watch, existsSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFile);

export interface StoreData<T = unknown> {
  state: T;
  version: number;
  updatedAt: string;
  pageId: string;
}

export interface FileStoreOptions {
  pagesDir: string;
}

export class FileStore {
  private pagesDir: string;
  private watchers = new Map<string, ReturnType<typeof watch>>();

  constructor(options: FileStoreOptions) {
    this.pagesDir = options.pagesDir;
  }

  private getStorePath(pageId: string): string {
    return join(this.pagesDir, pageId, 'store.json');
  }

  async load<T>(pageId: string): Promise<StoreData<T> | null> {
    const path = this.getStorePath(pageId);
    // TODO: 实现
  }

  async save<T>(pageId: string, data: StoreData<T>): Promise<void> {
    const path = this.getStorePath(pageId);
    // TODO: 实现
  }

  watch<T>(pageId: string, callback: (data: StoreData<T>) => void): () => void {
    // TODO: 实现文件监听
  }

  destroy(): void {
    // 清理所有 watcher
  }
}
```

请完成 Phase 1 的实现。
