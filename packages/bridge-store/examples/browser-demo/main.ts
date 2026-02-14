import { createStore } from 'zustand/vanilla'
import { attachZustandBridge } from 'bridge-store/client'

type State = {
  count: number
  inc: () => void
  dispatch: (action: { type: string; payload?: any }) => void
}

const store = createStore<State>((set, get) => ({
  count: 0,
  inc: () => set({ count: get().count + 1 }),
  dispatch: (action) => {
    if (action.type === 'counter.inc') get().inc()
    if (action.type === 'counter.add') set({ count: get().count + Number(action.payload?.n ?? 0) })
  },
}))

const app = document.querySelector<HTMLDivElement>('#app')!

function render() {
  const s = store.getState()
  app.innerHTML = `
    <div style="font-family: ui-sans-serif; padding: 16px;">
      <h2>bridge-store browser demo</h2>
      <div>count: <b>${s.count}</b></div>
      <button id="inc" style="margin-top: 12px;">inc (local)</button>
      <div style="margin-top: 8px; color: #666;">storeId: demo:counter</div>
    </div>
  `
  app.querySelector<HTMLButtonElement>('#inc')!.onclick = () => s.inc()
}

store.subscribe(render)
render()

// Attach to bridge
attachZustandBridge({
  bridgeUrl: 'ws://127.0.0.1:8787',
  storeId: 'demo:counter',
  meta: {
    id: 'demo:counter',
    title: 'Counter Demo',
    store: {
      actions: [
        { type: 'counter.inc' },
        { type: 'counter.add', payloadSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] } },
      ],
    },
  },
  store,
})
