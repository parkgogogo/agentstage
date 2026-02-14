import { createBridgeStore } from 'bridge-store/client'
import { z } from 'zod'

type State = {
  count: number
  inc: () => void
  dispatch: (action: { type: string; payload?: any }) => void
}

const { store, storeId } = await createBridgeStore<State>({
  bridgeUrl: 'ws://127.0.0.1:8787',
  meta: {
    id: 'demo:counter',
    title: 'Counter Demo',
    store: {
      // This schema describes the *wire* state (JSON-serializable subset). Functions are not part of the schema.
      stateSchema: z.object({
        count: z.number().describe('Counter value'),
      }),
      actions: [
        { type: 'counter.inc', description: 'Increment by 1' },
        {
          type: 'counter.add',
          description: 'Add N to counter',
          payloadSchema: z.object({ n: z.number().describe('Increment amount') }),
        },
      ],
    },
  },
  createState: (set, get) => ({
    count: 0,
    inc: () => set({ count: get().count + 1 }),
    dispatch: (action) => {
      if (action.type === 'counter.inc') get().inc()
      if (action.type === 'counter.add') set({ count: get().count + Number(action.payload?.n ?? 0) })
    },
  }),
})

const app = document.querySelector<HTMLDivElement>('#app')!

function render() {
  const s = store.getState()
  app.innerHTML = `
    <div style="font-family: ui-sans-serif; padding: 16px;">
      <h2>bridge-store browser demo</h2>
      <div>count: <b>${s.count}</b></div>
      <button id="inc" style="margin-top: 12px;">inc (local)</button>
      <div style="margin-top: 8px; color: #666;">storeId: ${storeId}</div>
    </div>
  `
  app.querySelector<HTMLButtonElement>('#inc')!.onclick = () => s.inc()
}

store.subscribe(render)
render()

console.log('[bridge-store] storeId =', storeId)

// Bridge is attached by createBridgeStore() above.
