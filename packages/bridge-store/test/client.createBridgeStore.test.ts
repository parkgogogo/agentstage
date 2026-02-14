import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createStoreBridgeBrowser } from '../src/browser/bridgeStore.js'

// We stub attachStoreBridgeBrowser so this test stays unit-level.
vi.mock('../src/browser/zustand.js', async () => {
  return {
    attachStoreBridgeBrowser: vi.fn(async (opts: any) => {
      return {
        pageId: opts.pageId,
        storeKey: opts.storeKey,
        storeId: opts.storeId ?? `${opts.pageId}#deadbeef`,
        rpc: { notify: vi.fn(), request: vi.fn() },
        close: vi.fn(),
      }
    }),
  }
})

const { attachStoreBridgeBrowser } = await import('../src/browser/zustand.js')

describe('createBridgeStore', () => {
  it('converts zod schemas to JSON schema and passes pageId/storeKey to attach', async () => {
    const stateSchema = z.object({ count: z.number().describe('Counter value') })

    const res = await createStoreBridgeBrowser({
      bridgeUrl: 'ws://127.0.0.1:8787',
      pageId: 'demo:counter',
      storeKey: 'main',
      meta: {
        id: 'demo:counter',
        title: 'Counter',
        store: {
          stateSchema,
          actions: [
            {
              type: 'counter.add',
              description: 'Add N',
              payloadSchema: z.object({ n: z.number().describe('Increment amount') }),
            },
          ],
        },
      },
      createState: (set, get) => ({
        count: 0,
        dispatch: (action: any) => {
          if (action.type === 'counter.add') set({ count: get().count + action.payload.n })
        },
      }),
    })

    expect(res.storeId).toContain('demo:counter#')

    const call = (attachStoreBridgeBrowser as any).mock.calls.at(-1)?.[0]
    expect(call.pageId).toBe('demo:counter')
    expect(call.storeKey).toBe('main')

    // zod schemas should have been converted to JSON Schema with descriptions
    const meta = call.meta
    expect(meta.store.stateSchema.description || meta.store.stateSchema.properties?.count?.description).toBeTruthy()

    const action = meta.store.actions.find((a: any) => a.type === 'counter.add')
    expect(action.description).toBe('Add N')
    expect(action.payloadSchema.properties.n.description).toBe('Increment amount')
  })
})
