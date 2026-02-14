# agentstage — 项目文档 + 技术方案（MVP）

> 目标：把「Agent 用 UI 表达/交互」变成一个可复用、可演化的本地舞台。
> 
> 本文档是当前阶段的 **单一真相来源（Single Source of Truth）**，用于防止遗忘与后续对齐。

---

## 1. 产品定位（一句话）
**agentstage** 是一个本地运行的“Agent UI 舞台”：
- 我（Agent）选择/复用页面资产（Page Modules）来向用户呈现信息或进行交互。
- 页面不是 DSL，而是 **真实 React/TSX 页面模块**。
- 页面与 Agent 通过一个 **Bridge** 连接：Agent 能 `get/set state`、执行 `actions`、订阅变更；Web UI 也能向 Agent 发“消息/请求”。

## 2. 核心原则（第一性原理）
1) **Page Module 必须存在**：像 bash 脚本一样，是“可变层”。
2) **不要 DSL**：场景覆盖用 Web/React 的表达力解决。
3) **一层 State（避免双真相）**：不引入“server state + client store”两套权威状态。
4) **Browser 沙箱现实**：若 store 初始化在浏览器内存里，Node 不能直接访问；必须用 Bridge 跨进程通信。
5) **Agent 是主人**：资产库/选择策略/操作 SOP 都以 Agent 视角设计；用户是消费者。

## 3. MVP 范围（先做什么）
### 3.1 先不做
- SQLite/持久化（后续再上）
- 复杂权限体系（先 localhost + token）
- Tailscale 暴露（后续）
- “页面内对话框改页面（patch 落盘 + HMR）” 的完整闭环（可预留 UI）

### 3.2 MVP 要跑通的场景
**subagents monitor**：
- Agent 运行 `openclaw ...` 得到 subagent 列表（数据源在 Agent 手里）
- Agent 把结果写入 agentstage 的 store
- 用户打开页面立即看到列表更新
- 用户在页面里可以发一个事件（例如：`ui.requestRefresh` / `ui.message`），Agent 监听到后再刷新写回

## 4. 关键概念
### 4.1 Store（唯一权威状态）
- zustand store 在 **浏览器侧初始化**（当前阶段的设想）
- 这个 store 是“唯一权威状态”（single source of truth）
- 任何变更都可通过 Bridge 进行（Agent 也能改、UI 也能改）

> 注：由于 store 在浏览器沙箱，Node 不能直接读写，因此必须通过 Bridge 提供远程访问能力。

### 4.2 Bridge（Node ↔ Browser）
- Node 运行一个 WebSocket Server（Bridge Server）
- 每个页面实例（store host）通过 WebSocket 连接 Node，注册 `storeId`
- Agent/CLI 通过同一个 Bridge 与特定 `storeId` 通信

### 4.3 Store Schema（自描述能力）
每个页面资产提供 `meta.json`，内含：
- `stateSchema`：state 的 JSON Schema（至少用于文档/约束；后续可用于校验）
- `actions`：可执行 actions 列表 + payload schema + danger 标记
- `events`：UI 可以发给 Agent 的事件类型（例如 `ui.message`, `ui.requestRefresh`）

这些信息必须可被 Node/Agent 获取（用于决策“如何操作页面”）。

## 5. 一层 State 的实现方式（为什么不是“两层 state”）
- React 渲染必然需要“当前 snapshot”在组件里，这只是渲染缓存，不是第二套权威。
- Bridge 的职责是：让外部（Agent/CLI）能够 **读写/订阅** 浏览器侧 store。

## 6. Bridge 协议（建议：JSON-RPC 2.0 + notifications）
为了简洁、可扩展、带请求 ID，对外协议使用 JSON-RPC 2.0 风格：

### 6.1 消息 Envelope
- Request: `{ "jsonrpc": "2.0", "id": "...", "method": "...", "params": {...} }`
- Response: `{ "jsonrpc": "2.0", "id": "...", "result": {...} }` / `{..., "error": {...} }`
- Notification: `{ "jsonrpc": "2.0", "method": "...", "params": {...} }`

### 6.2 核心方法（MVP）
#### Store Host（Browser）→ Bridge（Node）
- `host.register`
  - params: `{ storeId, meta, initialState }`
  - meta: 从页面的 `meta.json` 提取（schema/actions/events）

- `host.stateChanged` (notification)
  - params: `{ storeId, state, version, source? }`

#### Agent/Client → Bridge（Node）
- `store.getMeta`
  - params: `{ storeId }`
  - result: `{ meta }`

- `store.getState`
  - params: `{ storeId }`
  - result: `{ state, version }`

- `store.setState`
  - params: `{ storeId, state, expectedVersion? }`
  - result: `{ ok: true, version }`

- `store.dispatch`
  - params: `{ storeId, action: { type, payload? }, expectedVersion? }`
  - result: `{ ok: true, version }`

- `store.subscribe` (server-side subscription)
  - params: `{ storeId }`
  - Node 对订阅者推送 notification：`store.stateChanged`

#### UI → Agent 事件（通过 store 或单独通道）
MVP 建议先把“消息/请求”也作为 store 的一部分（例如 state.messages[]），并通过 `store.dispatch` 触发。
如要分离事件队列，可后续加：
- `host.event` / `agent.event`。

### 6.3 多实例支持
所有方法都带 `{storeId}` 参数。
Node 维护：
- `storeId -> host websocket`（唯一 host；冲突策略：后注册拒绝或抢占）
- `storeId -> subscribers[]`

## 7. 约束与风险（必须承认）
1) **页面不开着，store 不存在**（权威状态在浏览器内存）。
2) **同 storeId 多 host 冲突**：必须定义抢占/拒绝策略。
3) **安全**：Bridge 先仅监听 localhost，并使用 token。
4) **循环更新**：所有变更带 `source` + `version`，订阅方去重。

## 8. MVP 资产：subagents-monitor（meta.json + state/actions）
### 8.1 state（建议）
- `updatedAt`
- `filters.activeMinutes`
- `summary.running/total`
- `items[]`（sessionKey/label/status/ageSec/lastMessage）
- `log[]`（可选，记录 UI→Agent 与 Agent→UI 的消息）

### 8.2 actions（建议）
- `subagents.setData`（Agent 写入列表/summary）
- `subagents.requestRefresh`（UI 请求 Agent 刷新）
- `ui.message`（UI 发文本）

Agent 对 `requestRefresh/message` 的响应策略写进 skill SOP。

## 9. 实现计划（一步一步）

> 工程形态：**Monorepo + pnpm workspace**。
> 当前 MVP 聚焦第一个包：`packages/bridge-store`（Bridge Server + Bridge Client）。

### Step 1 — Bridge Store（Node Bridge Server + Browser Bridge Client）
- 位置：`agentstage/packages/bridge-store`
- Bridge Server（Node, ws）：`src/server/*`
- Bridge Client（Browser, zustand adapter）：`src/client/*`
- 协议：JSON-RPC 2.0（MVP 先做全量 state 推送）
- 内置 examples：
  - `examples/browser-demo`（页面侧 store + attach bridge）
  - `examples/node-demo`（Node 侧控制端 demo）

### Step 2 — subagents-monitor 页面
- 使用 shadcn + tailwind
- meta.json 内声明 state schema + actions/events

### Step 3 — Agent 侧 watcher（OpenClaw）
- 监听 UI 发出的事件/action（例如 `subagents.requestRefresh`）
- 运行 `openclaw ...`，通过 bridge 写入/dispatch 更新页面 state

### Step 4 — Skill（SOP + catalog）
- Skill 作为 SOP + 资产目录
- 将页面 meta.json 同步到 skill（未来自动生成 catalog）

---

## 10. 近期未决策清单（实现时需要最终拍板）
- Host 冲突策略：同 storeId 多 host 连接时（reject / last-wins）
- stateChanged 推送策略：全量 vs diff（MVP 全量）
- setState 并发：是否使用 expectedVersion（建议有，但可选）

