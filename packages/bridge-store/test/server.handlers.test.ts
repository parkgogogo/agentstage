import { describe, expect, it } from 'vitest'
import { BridgeRegistry } from '../src/server/registry.js'
import { handleNotification, handleRequest, handleResponse } from '../src/server/handlers.js'
import { MockWs } from './helpers/mockWs'
import { req, notif } from './helpers/rpc'

function lastSent(ws: any) {
  return ws.sent.at(-1)
}

describe('server handlers', () => {
  it('host.register stores meta/state and indexes by pageId/storeKey', () => {
    const reg = new BridgeRegistry()
    const ws = new MockWs() as any

    handleNotification(reg, ws, 'host.register', {
      storeId: 'p1#aaa',
      pageId: 'p1',
      storeKey: 'main',
      meta: { id: 'p1', title: 'P1', store: { actions: [{ type: 'x' }] } },
      initialState: { count: 0 },
      version: 7,
    })

    const host = reg.getHost('p1#aaa')!
    expect(host.pageId).toBe('p1')
    expect(host.storeKey).toBe('main')
    expect(host.version).toBe(7)
    expect(host.state).toEqual({ count: 0 })
    expect(reg.pageToStores.get('p1')?.has('p1#aaa')).toBe(true)
    expect(reg.pageToStoreKeys.get('p1')?.get('main')).toBe('p1#aaa')
  })

  it('store.getState returns cached snapshot', () => {
    const reg = new BridgeRegistry()
    const hostWs = new MockWs() as any
    const clientWs = new MockWs() as any

    handleNotification(reg, hostWs, 'host.register', {
      storeId: 'p1#aaa',
      pageId: 'p1',
      meta: { id: 'p1' },
      initialState: { count: 1 },
      version: 3,
    })

    handleRequest(reg, clientWs, req(1, 'store.getState', { storeId: 'p1#aaa' }) as any)

    expect(lastSent(clientWs)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { state: { count: 1 }, version: 3 },
    })
  })

  it('page.resolve maps pageId+storeKey to storeId', () => {
    const reg = new BridgeRegistry()
    const hostWs = new MockWs() as any
    const clientWs = new MockWs() as any

    handleNotification(reg, hostWs, 'host.register', {
      storeId: 'p1#aaa',
      pageId: 'p1',
      storeKey: 'main',
      meta: { id: 'p1' },
      initialState: {},
    })

    handleRequest(reg, clientWs, req(1, 'page.resolve', { pageId: 'p1', storeKey: 'main' }) as any)
    expect(lastSent(clientWs)).toEqual({ jsonrpc: '2.0', id: 1, result: { storeId: 'p1#aaa' } })
  })

  it('store.getState on offline store returns semantic error kind', () => {
    const reg = new BridgeRegistry()
    const clientWs = new MockWs() as any

    handleRequest(reg, clientWs, req(1, 'store.getState', { storeId: 'missing' }) as any)

    expect(lastSent(clientWs)).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      error: {
        code: -32010,
        message: 'Store offline',
        data: { kind: 'STORE_OFFLINE', storeId: 'missing' },
      },
    })
  })

  it('store.setState forwards to host as client.setState and returns response after handleResponse', () => {
    const reg = new BridgeRegistry()
    const hostWs = new MockWs() as any
    const clientWs = new MockWs() as any

    handleNotification(reg, hostWs, 'host.register', {
      storeId: 'p1#aaa',
      pageId: 'p1',
      meta: { id: 'p1' },
      initialState: { count: 1 },
      version: 9,
    })

    handleRequest(reg, clientWs, req(123, 'store.setState', { storeId: 'p1#aaa', state: { count: 2 } }) as any)

    // forwarded request id is internal forwardSeq=1
    expect(hostWs.sent[0]).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      method: 'client.setState',
      params: { state: { count: 2 }, expectedVersion: 9, source: 'agent' },
    })

    // host replies to forward id=1
    handleResponse(reg, { jsonrpc: '2.0', id: 1, result: { ok: true, version: 10 } })

    // client should get response with its own id=123
    expect(lastSent(clientWs)).toEqual({ jsonrpc: '2.0', id: 123, result: { ok: true, version: 10 } })
  })

  it('store.subscribe immediately emits snapshot notification if host is online', () => {
    const reg = new BridgeRegistry()
    const hostWs = new MockWs() as any
    const clientWs = new MockWs() as any

    handleNotification(reg, hostWs, 'host.register', {
      storeId: 'p1#aaa',
      pageId: 'p1',
      meta: { id: 'p1' },
      initialState: { count: 1 },
      version: 2,
    })

    handleRequest(reg, clientWs, req(1, 'store.subscribe', { storeId: 'p1#aaa' }) as any)

    // first message should be snapshot notification
    expect(clientWs.sent[0]).toEqual(
      notif('store.stateChanged', {
        storeId: 'p1#aaa',
        state: { count: 1 },
        version: 2,
        source: 'bridge.snapshot',
      }),
    )

    // second message is RPC result ok
    expect(clientWs.sent[1]).toEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } })
  })
})
