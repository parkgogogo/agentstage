import { createBridgeStore } from 'agent-stage-bridge/browser'
import { z } from 'zod'

const schema = z.object({
  count: z.number(),
})

export const bridge = createBridgeStore({
  pageId: 'counter',
  storeKey: 'main',
  description: {
    schema,
    actions: {
      setCount: {
        description: 'Set the counter value',
        payload: z.object({ value: z.number() }),
      },
    },
    events: {
      reset: {
        description: 'Reset counter to 0',
      },
    },
  },
  createState: (set, get) => ({
    count: 0,
    dispatch: (action: { type: string; payload?: unknown }) => {
      switch (action.type) {
        case 'setCount':
          set({ count: (action.payload as { value: number }).value })
          break
        case 'reset':
          set({ count: 0 })
          break
      }
    },
  }),
})

// Hook for React components
export function useBridgeStore<T>(
  bridgeInstance: typeof bridge,
  selector: (state: { count: number }) => T
): T {
  const [value, setValue] = useState(selector(bridgeInstance.store.getState()))

  useEffect(() => {
    const unsubscribe = bridgeInstance.store.subscribe((state) => {
      setValue(selector(state))
    })
    return unsubscribe
  }, [bridgeInstance, selector])

  return value
}

import { useState, useEffect } from 'react'
