# StoreBridge（bridge-store）架构设计说明（当前代码版本）

本文是对当前仓库中 **StoreBridge** 的“架构层面”说明：它解决什么问题、有哪些组件、它们如何通信。

> 关键词：Browser 内的 zustand store 是权威状态；Node/Agent 通过 WebSocket + JSON-RPC 对其进行 get/set/dispatch/subscribe；并支持按 `pageId` 分组、多 store。

---

## 1. 系统目标

**StoreBridge 的目标**：在 **Node 环境**（Agent/CLI）与 **浏览器环境**（页面/Tab）之间搭一座桥，使得 Node 能像操作“远程 DB / 远程对象”一样操作浏览器中运行的 zustand store：

- `getState(storeId)`
- `setState(storeId, state)`
- `dispatch(storeId, action)`
- `subscribe(storeId, onStateChanged)`

同时，浏览器侧可以通过 meta/schema（由 zod 转 JSON Schema）把“状态结构、动作列表、描述信息”暴露出来，供 Agent 做语义化决策。

---

## 2. 核心组件（3 件套）

- **StoreBridge Server**（Node）：WebSocket 服务端，负责路由/转发/索引/广播。
- **StoreBridge Browser**（Browser）：运行在页面里的桥接层，负责把 zustand store 接入桥中（register + stateChanged + 接收远程 set/dispatch）。
- **StoreBridge SDK**（Node）：运行在 Agent/CLI 侧的“易用对象”，把 JSON-RPC method 封装成可直接调用的 API（像 DB client）。

---

## 3. 架构总览（Mermaid）

```mermaid
flowchart LR
  subgraph Browser[Browser / Web Sandbox]
    UI[Page UI]
    ZS[Zustand Store\n(权威状态)]
    BB[StoreBridge Browser\n(桥接层)]
    UI -->|read/subscribe| ZS
    UI -->|dispatch (local)| ZS
    BB <-->|get/set/dispatch hooks| ZS
  end

  subgraph Node[Node / Local Machine]
    S[StoreBridge Server\n(WS + JSON-RPC Router)]
    SDK[StoreBridge SDK\n(Agent/CLI client)]
    Agent[Agent / CLI / Script]
    Agent -->|call SDK| SDK
    SDK <-->|WS JSON-RPC| S
  end

  BB <-->|WS JSON-RPC| S

  %% semantic grouping
  S -.->|indexes| IDX[(Registry\nstoreId->conn\npageId->stores\npageId+storeKey->storeId)]
```

### 这个图表达的关键点
- zustand store 在浏览器里，是“权威状态”。
- Node 侧不直接读写浏览器内存，只能通过 Bridge（WS JSON-RPC）进行。
- StoreBridge Server 不保存真实 store（只缓存快照 + 路由/索引）。

---

## 4. 数据/索引模型（pageId / storeKey / storeId）

为支持“多 page、多 store”，并避免 storeId 冲突：

- **storeId**：路由用的唯一 ID（随机生成，连接级唯一）
- **pageId**：语义分组（例如 `subagents-monitor` / `gobang`）
- **storeKey**：同一个 page 下不同 store 的角色名（例如 `main` / `ui` / `log`）

Server 内部维护索引：
- `storeId -> hostConnection`
- `pageId -> Set<storeId>`
- `pageId + storeKey -> storeId`

因此 Agent/CLI 可以：
- 先用 `page.resolve(pageId, storeKey)` 找到目标 storeId
- 再对该 storeId 做 `getState / dispatch / subscribe`

---

## 5. 协议与消息流（JSON-RPC 2.0 over WebSocket）

### 5.1 为什么用 JSON-RPC 2.0
主要为了解决：
- 并发请求-响应对应（`id`）
- 统一错误结构（`error`）
- 支持通知（notification，无 `id`）

### 5.2 关键消息流（Mermaid Sequence）

```mermaid
sequenceDiagram
  participant B as StoreBridge Browser
  participant S as StoreBridge Server
  participant N as StoreBridge SDK (Node)

  Note over B: 浏览器侧启动，拥有 zustand store
  B->>S: notif host.register {storeId,pageId,storeKey,meta,initialState,version}

  Note over N: Agent/CLI 通过 SDK 调用
  N->>S: req page.resolve {pageId,storeKey}
  S-->>N: res {storeId}

  N->>S: req store.subscribe {storeId}
  S-->>N: notif store.stateChanged {storeId,state,version,source="bridge.snapshot"}
  S-->>N: res {ok:true}

  N->>S: req store.dispatch {storeId,action}
  S->>B: req client.dispatch {action,expectedVersion,...}
  B-->>S: res {ok:true,version}
  S-->>N: res {ok:true,version}

  Note over B,S,N: 浏览器 store 变化时主动推送
  B->>S: notif host.stateChanged {storeId,state,version,source}
  S-->>N: notif store.stateChanged {storeId,state,version,source}
```

---

## 6. Meta / Schema（zod -> JSON Schema + description）

### 6.1 Browser 侧输入
Browser 侧（StoreBridge Browser）允许你用 **zod** 来描述：
- state 的结构（stateSchema）
- actions 的 payload 结构（payloadSchema）
- 描述信息（zod `.describe()` + action 的 `description` 字段）

### 6.2 wire meta（传输到 server 的 meta）
在 register 时，Browser 会把 zod 转为 JSON Schema：
- `meta.store.stateSchema`（JSON Schema，包含 description）
- `meta.store.actions[]`（type/description/payloadSchema...）

StoreBridge Server 将 meta 缓存起来，Node/Agent 可以：
- `store.getMeta(storeId)`
- `page.getStoresMeta(pageId)`

这让 Agent 可以“语义化地理解”当前 store 的状态结构与可执行动作。

---

## 7. 语义化错误（SemanticError）

由于 Agent 更适合按“语义码”分支处理异常，系统对错误做了标准化：

- JSON-RPC error 里包含 `error.data.kind`
- 例如：
  - `STORE_OFFLINE`
  - `VERSION_CONFLICT`
  - `STORE_NOT_FOUND`
  - `INVALID_STATE`
  - `INVALID_ACTION_PAYLOAD`

这样 Node SDK 可以在 `catch` 时拿到一个带 kind 的异常（或错误对象），便于 Agent 做策略判断。

---

## 8. 当前代码结构（仓库内）

```
packages/bridge-store/
  src/
    server/        # StoreBridge Server
    browser/       # StoreBridge Browser
    node/          # StoreBridge SDK
    shared/        # protocol/types/errors
  test/            # vitest 单元测试（server + browser 侧封装）
  examples/        # demo（浏览器 + node）
```

---

## 9. 当前测试策略（单元测试为主）

- Vitest 单元测试覆盖：
  - registry 索引逻辑（pageId/storeKey/storeId）
  - handlers 的关键方法与异常 case（offline、resolve miss 等）
  - browser 侧 createStoreBridgeBrowser 的 schema 转换与参数传递（mock attach 层）

> E2E（Playwright）尚未引入；后续如果要 CI 级别保证，可以再加。

---

## 10. 仍然刻意保持简单的地方（当前阶段）

- stateChanged 目前推全量（不是 diff/patch）
- unsubscribe 是本地取消回调（server 侧没有做订阅引用计数回收）
- StoreBridge Server 只缓存快照与索引，不做 DB 持久化

这些都是为了先把“桥”跑稳；等需求明确后再补。
