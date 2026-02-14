import { jsonRpcError, type JsonRpcId, type JsonRpcFailure } from './protocol.js'

export type ErrorKind =
  | 'INVALID_REQUEST'
  | 'INVALID_PARAMS'
  | 'METHOD_NOT_FOUND'
  | 'STORE_OFFLINE'
  | 'UNKNOWN_STORE_ID'
  | 'NOT_STORE_HOST'
  | 'VERSION_CONFLICT'
  | 'STORE_NOT_FOUND'
  | 'INVALID_STATE'
  | 'INVALID_ACTION_PAYLOAD'
  | 'INTERNAL_ERROR'
  | 'UNAUTHORIZED'

// JSON-RPC reserved codes:
// -32600 Invalid Request
// -32601 Method not found
// -32602 Invalid params
// Application/server errors should be -32000 to -32099.
export const ErrorCode: Record<ErrorKind, number> = {
  INVALID_REQUEST: -32600,
  INVALID_PARAMS: -32602,
  METHOD_NOT_FOUND: -32601,

  STORE_OFFLINE: -32010,
  UNKNOWN_STORE_ID: -32011,
  NOT_STORE_HOST: -32012,
  VERSION_CONFLICT: -32013,
  STORE_NOT_FOUND: -32014,

  INVALID_STATE: -32030,
  INVALID_ACTION_PAYLOAD: -32031,

  UNAUTHORIZED: -32020,
  INTERNAL_ERROR: -32099,
}

export class SemanticError extends Error {
  kind: ErrorKind
  code: number
  data?: Record<string, unknown>

  constructor(kind: ErrorKind, message: string, data?: Record<string, unknown>, code?: number) {
    super(message)
    this.kind = kind
    this.code = code ?? ErrorCode[kind]
    this.data = data
  }

  toJsonRpc(id: JsonRpcId | null): JsonRpcFailure {
    return jsonRpcError(id, this.code, this.message, { kind: this.kind, ...(this.data ?? {}) })
  }
}

export function semanticError(kind: ErrorKind, message: string, data?: Record<string, unknown>, code?: number) {
  return new SemanticError(kind, message, data, code)
}
