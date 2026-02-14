import WebSocket from 'ws'
import type { JsonRpcFailure, JsonRpcId } from '../shared/protocol.js'
import { SemanticError } from '../shared/errors.js'
import type { PageId, StageAction, StageMeta, StoreId, StoreKey } from '../shared/types.js'

type StateChanged = {
  storeId: StoreId
  state: unknown
  version: number
  source?: string
}

type RpcResponseOk = { jsonrpc: '2.0'; id: JsonRpcId; result: any }

type RpcResponseErr = { jsonrpc: '2.0'; id: JsonRpcId | null; error: JsonRpcFailure['error'] }

type RpcNotification = { jsonrpc: '2.0'; method: string; params?: any }

type AnyMsg = RpcResponseOk | RpcResponseErr | RpcNotification

export type StoreBridgeSdkOptions = {
  url: string // ws://127.0.0.1:8787?token=...
}

/**
 * StoreBridge SDK (Node side).
 * Used by Agent/CLI to talk to StoreBridge Server.
 */
export class StoreBridgeSdk {
  private ws: WebSocket
  private nextId = 1
  private pending = new Map<JsonRpcId, { resolve: (v: any) => void; reject: (e: any) => void }>()

  private stateSubs = new Map<StoreId, Set<(ev: StateChanged) => void>>()
  private hostOfflineSubs = new Map<StoreId, Set<() => void>>()

  private constructor(ws: WebSocket) {
    this.ws = ws

    this.ws.on('message', (data) => {
      this.onMessage(String(data))
    })

    this.ws.on('close', () => {
      for (const [id, p] of this.pending.entries()) {
        p.reject(new Error('WS closed'))
        this.pending.delete(id)
      }
    })
  }

  static async connect(url: string | StoreBridgeSdkOptions): Promise<StoreBridgeSdk> {
    const u = typeof url === 'string' ? url : url.url
    const ws = new WebSocket(u)
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve())
      ws.once('error', (e) => reject(e))
    })
    return new StoreBridgeSdk(ws)
  }

  close() {
    this.ws.close()
  }

  private send(msg: any) {
    this.ws.send(JSON.stringify(msg))
  }

  private request(method: string, params?: any): Promise<any> {
    const id = this.nextId++
    this.send({ jsonrpc: '2.0', id, method, params })
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
  }

  private onMessage(raw: string) {
    let msg: AnyMsg
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }

    // notification
    if ((msg as any).method && !(msg as any).id) {
      const n = msg as RpcNotification
      if (n.method === 'store.stateChanged') {
        const p = n.params as StateChanged
        const subs = this.stateSubs.get(p.storeId)
        if (subs) for (const cb of subs) cb(p)
      }
      if (n.method === 'store.hostOffline') {
        const storeId = n.params?.storeId as StoreId
        const subs = this.hostOfflineSubs.get(storeId)
        if (subs) for (const cb of subs) cb()
      }
      return
    }

    // response
    if ('id' in (msg as any) && ('result' in (msg as any) || 'error' in (msg as any))) {
      const id = (msg as any).id as JsonRpcId
      const pending = this.pending.get(id)
      if (!pending) return
      this.pending.delete(id)

      if ('result' in (msg as any)) {
        pending.resolve((msg as any).result)
      } else {
        const err = (msg as any).error
        const kind = err?.data?.kind as string | undefined
        if (kind) {
          pending.reject(new SemanticError(kind as any, err.message, err.data, err.code))
          return
        }
        pending.reject(err)
      }
    }
  }

  page = {
    listStores: async (pageId: PageId) => {
      return this.request('page.listStores', { pageId }) as Promise<{ stores: Array<{ storeId: StoreId; pageId: PageId; storeKey: StoreKey | null; version: number }> }>
    },

    getStoresMeta: async (pageId: PageId) => {
      return this.request('page.getStoresMeta', { pageId }) as Promise<{ stores: Array<{ storeId: StoreId; pageId: PageId; storeKey: StoreKey | null; meta: StageMeta | null; version: number }> }>
    },

    resolve: async (pageId: PageId, storeKey: StoreKey) => {
      return this.request('page.resolve', { pageId, storeKey }) as Promise<{ storeId: StoreId }>
    },
  }

  store = {
    getMeta: async (storeId: StoreId) => {
      return this.request('store.getMeta', { storeId }) as Promise<{ meta: StageMeta | null }>
    },

    getState: async (storeId: StoreId) => {
      return this.request('store.getState', { storeId }) as Promise<{ state: unknown; version: number }>
    },

    setState: async (storeId: StoreId, state: unknown, opts?: { expectedVersion?: number; source?: string }) => {
      return this.request('store.setState', { storeId, state, expectedVersion: opts?.expectedVersion, source: opts?.source }) as Promise<any>
    },

    dispatch: async (storeId: StoreId, action: StageAction, opts?: { expectedVersion?: number; source?: string }) => {
      return this.request('store.dispatch', { storeId, action, expectedVersion: opts?.expectedVersion, source: opts?.source }) as Promise<any>
    },

    subscribe: async (storeId: StoreId, cb: (ev: StateChanged) => void) => {
      const set = this.stateSubs.get(storeId) ?? new Set()
      set.add(cb)
      this.stateSubs.set(storeId, set)

      await this.request('store.subscribe', { storeId })

      return () => {
        const cur = this.stateSubs.get(storeId)
        if (!cur) return
        cur.delete(cb)
        if (cur.size === 0) this.stateSubs.delete(storeId)
      }
    },
  }
}

// (no deprecated aliases)
