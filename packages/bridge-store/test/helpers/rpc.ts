export function req(id: number | string, method: string, params?: any) {
  return { jsonrpc: '2.0', id, method, params }
}

export function notif(method: string, params?: any) {
  return { jsonrpc: '2.0', method, params }
}
