import { EventEmitter } from 'events';
import type { WebSocket as WebSocketType } from 'ws';

/**
 * Mock WebSocket for unit testing
 */
export class MockWebSocket extends EventEmitter implements Partial<WebSocketType> {
  public readyState: number = 1; // OPEN
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;
  
  sentMessages: unknown[] = [];
  url: string;
  
  constructor(url: string) {
    super();
    this.url = url;
    // Simulate async connection
    setTimeout(() => this.emit('open'), 0);
  }
  
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sentMessages.push(data);
  }
  
  close(): void {
    this.readyState = 3; // CLOSED
    this.emit('close');
  }
  
  // Helper to simulate receiving a message
  simulateMessage(data: string): void {
    this.emit('message', Buffer.from(data));
  }
  
  // Helper to simulate error
  simulateError(error: Error): void {
    this.emit('error', error);
  }
}

/**
 * Create a mock WebSocket constructor
 */
export function createMockWebSocket() {
  return MockWebSocket as unknown as typeof WebSocketType;
}
