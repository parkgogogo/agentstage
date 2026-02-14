# bridge-store

A tiny WebSocket bridge that exposes a browser-side zustand store to Node/Agent.

## What it is
- **StoreBridge Server (Node)**: routes JSON-RPC messages between Agent/CLI and browser pages.
- **StoreBridge Browser (Browser)**: bridges a zustand store into the bridge network. Registers `{storeId, pageId, storeKey, meta, initialState}`, pushes updates, and accepts remote `setState/dispatch`.
- **StoreBridge SDK (Node)**: a DB-like SDK used by Agent/CLI to call `page.*` / `store.*` methods.

## Dev
```bash
pnpm -C packages/bridge-store dev
```

This runs:
- bridge server (`dev:server`)
- TypeScript typecheck in watch mode (`dev:typecheck`)

## StoreBridge SDK (DB-like)
```ts
import { StoreBridgeSdk } from 'bridge-store/node'

const bridge = await StoreBridgeSdk.connect('ws://127.0.0.1:8787')
const { storeId } = await bridge.page.resolve('demo:counter', 'main')
const { state } = await bridge.store.getState(storeId)
```

## Protocol (MVP)
- Browser -> Server notifications:
  - `host.register` (includes `pageId` + optional `storeKey`)
  - `host.stateChanged`
- Agent/Client -> Server requests:
  - `store.getMeta`, `store.getState`, `store.setState`, `store.dispatch`, `store.subscribe`
  - `page.listStores`, `page.getStoresMeta`, `page.resolve`
- Server -> Browser requests:
  - `client.setState`, `client.dispatch`
- Server -> subscribers notifications:
  - `store.stateChanged`
