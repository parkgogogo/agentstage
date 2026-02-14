import { describe, expect, it } from 'vitest'
import { BridgeRegistry } from '../src/server/registry.js'
import { MockWs } from './helpers/mockWs'

describe('BridgeRegistry', () => {
  it('indexes hosts by pageId and storeKey and unindexes on removal', () => {
    const reg = new BridgeRegistry()
    const ws = new MockWs() as any

    reg.setHost('s1', {
      ws,
      storeId: 's1',
      pageId: 'p1',
      storeKey: 'main',
      meta: { id: 'p1' },
      state: { a: 1 },
      version: 0,
    })

    reg.setHost('s2', {
      ws,
      storeId: 's2',
      pageId: 'p1',
      storeKey: 'ui',
      meta: { id: 'p1' },
      state: { b: 2 },
      version: 0,
    })

    expect(Array.from(reg.pageToStores.get('p1') ?? [])).toEqual(['s1', 's2'])
    expect(reg.pageToStoreKeys.get('p1')?.get('main')).toBe('s1')
    expect(reg.pageToStoreKeys.get('p1')?.get('ui')).toBe('s2')

    reg.removeWs(ws)

    expect(reg.pageToStores.get('p1')).toBeUndefined()
    expect(reg.pageToStoreKeys.get('p1')).toBeUndefined()
    expect(reg.hosts.size).toBe(0)
  })

  it('last-wins replacement updates indexes', () => {
    const reg = new BridgeRegistry()
    const ws1 = new MockWs() as any
    const ws2 = new MockWs() as any

    reg.setHost('s1', {
      ws: ws1,
      storeId: 's1',
      pageId: 'p1',
      storeKey: 'main',
      meta: { id: 'p1' },
      state: { a: 1 },
      version: 0,
    })

    // replace with different pageId/storeKey
    reg.setHost('s1', {
      ws: ws2,
      storeId: 's1',
      pageId: 'p2',
      storeKey: 'main',
      meta: { id: 'p2' },
      state: { a: 2 },
      version: 0,
    })

    expect(reg.pageToStores.get('p1')).toBeUndefined()
    expect(reg.pageToStores.get('p2')?.has('s1')).toBe(true)
    expect(reg.pageToStoreKeys.get('p2')?.get('main')).toBe('s1')
  })
})
