# bridge-store

A tiny WebSocket bridge that exposes a browser-side zustand store to Node/Agent.

## What it is
- **Bridge Server (Node)**: routes JSON-RPC messages between Agents/clients and browser pages.
- **Bridge Client (Browser)**: attaches a zustand store, registers `{storeId, meta, initialState}`, pushes updates, and accepts remote `setState/dispatch`.

## Dev
```bash
pnpm -C packages/bridge-store dev
```

## Protocol (MVP)
- Browser -> Server notifications:
  - `host.register`
  - `host.stateChanged`
- Agent/Client -> Server requests:
  - `store.getMeta`, `store.getState`, `store.setState`, `store.dispatch`, `store.subscribe`
- Server -> Browser requests:
  - `client.setState`, `client.dispatch`
- Server -> subscribers notifications:
  - `store.stateChanged`
