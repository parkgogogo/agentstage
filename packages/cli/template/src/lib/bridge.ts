import { createBridgeStore } from 'agent-stage-bridge/browser'
import { z } from 'zod'
import type { ZodSchema } from 'zod'

export interface Bridge {
  store: {
    getState: () => Record<string, unknown>
    subscribe: (callback: (state: Record<string, unknown>) => void) => () => void
    setState: (updater: (prev: Record<string, unknown>) => Record<string, unknown>) => void
  }
  connect: () => Promise<{ storeId: string }>
  isHydrated: boolean
  pageId: string
}

interface CreatePageBridgeOptions {
  pageId: string
  schema?: ZodSchema
  actions?: Record<string, { description: string; payload?: ZodSchema }>
  events?: Record<string, { description: string }>
}

// Default schema that accepts any object
const defaultSchema = z.record(z.unknown())

export function createPageBridge(options: CreatePageBridgeOptions): Bridge {
  const { pageId, schema = defaultSchema, actions = {}, events = {} } = options

  const bridge = createBridgeStore({
    pageId,
    storeKey: 'main',
    description: {
      schema,
      actions,
      events,
    },
    createState: () => ({
      // Initial state will be loaded from store.json by gateway
    }),
  })

  // Mount to window for debugging
  if (typeof window !== 'undefined') {
    ;(window as unknown as Record<string, unknown>)[`bridge_${pageId}`] = bridge
  }

  return bridge as unknown as Bridge
}

// Legacy export for compatibility
export const bridge = createPageBridge({
  pageId: 'counter',
})
