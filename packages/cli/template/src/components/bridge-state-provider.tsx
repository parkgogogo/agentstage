import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import type { Bridge } from '../lib/bridge'

interface BridgeStateContextValue {
  state: Record<string, unknown>
  get: (path: string) => unknown
  set: (path: string, value: unknown) => void
  update: (updates: Record<string, unknown>) => void
}

const BridgeStateContext = createContext<BridgeStateContextValue | null>(null)

interface BridgeStateProviderProps {
  bridge: Bridge
  children: ReactNode
}

export function BridgeStateProvider({ bridge, children }: BridgeStateProviderProps) {
  const [state, setLocalState] = useState(() => bridge.store.getState())

  useEffect(() => {
    return bridge.store.subscribe((newState) => {
      setLocalState(newState)
    })
  }, [bridge])

  const value: BridgeStateContextValue = {
    state,
    get: (path: string) => {
      const parts = path.split('/').filter(Boolean)
      let current: unknown = state
      for (const part of parts) {
        if (current === null || current === undefined) return undefined
        current = (current as Record<string, unknown>)[part]
      }
      return current
    },
    set: (path: string, value: unknown) => {
      const parts = path.split('/').filter(Boolean)
      bridge.store.setState((prev) => {
        const next = { ...prev }
        let current: Record<string, unknown> = next
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i]
          if (!(part in current) || typeof current[part] !== 'object') {
            current[part] = {}
          }
          current = current[part] as Record<string, unknown>
        }
        current[parts[parts.length - 1]] = value
        return next
      })
    },
    update: (updates: Record<string, unknown>) => {
      bridge.store.setState((prev) => {
        const next = { ...prev }
        for (const [path, value] of Object.entries(updates)) {
          const parts = path.split('/').filter(Boolean)
          let current: Record<string, unknown> = next
          for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i]
            if (!(part in current) || typeof current[part] !== 'object') {
              current[part] = {}
            }
            current = current[part] as Record<string, unknown>
          }
          current[parts[parts.length - 1]] = value
        }
        return next
      })
    },
  }

  return (
    <BridgeStateContext.Provider value={value}>
      {children}
    </BridgeStateContext.Provider>
  )
}

export function useBridgeStateContext(): BridgeStateContextValue {
  const context = useContext(BridgeStateContext)
  if (!context) {
    throw new Error('useBridgeStateContext must be used within BridgeStateProvider')
  }
  return context
}
