import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const LOG_DIR = join(homedir(), '.agentstage', 'logs');
const LOG_FILE = join(LOG_DIR, 'bridge.log');

let logInitialized = false;

function ensureLogDir() {
  if (!logInitialized) {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
    logInitialized = true;
  }
}

function formatMessage(level: string, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const dataStr = data !== undefined ? ' ' + JSON.stringify(data) : '';
  return `[${timestamp}] [${level}] ${message}${dataStr}\n`;
}

export const logger = {
  debug(message: string, data?: unknown) {
    ensureLogDir();
    const line = formatMessage('DEBUG', message, data);
    appendFileSync(LOG_FILE, line);
  },

  info(message: string, data?: unknown) {
    ensureLogDir();
    const line = formatMessage('INFO', message, data);
    appendFileSync(LOG_FILE, line);
    // Also log to console for visibility
    console.log(message, data ?? '');
  },

  warn(message: string, data?: unknown) {
    ensureLogDir();
    const line = formatMessage('WARN', message, data);
    appendFileSync(LOG_FILE, line);
    console.warn(message, data ?? '');
  },

  error(message: string, data?: unknown) {
    ensureLogDir();
    const line = formatMessage('ERROR', message, data);
    appendFileSync(LOG_FILE, line);
    console.error(message, data ?? '');
  },

  // Log WebSocket message with direction
  wsMessage(direction: 'in' | 'out', clientType: string, data: string) {
    ensureLogDir();
    const timestamp = new Date().toISOString();
    const arrow = direction === 'in' ? '->' : '<-';
    const line = `[${timestamp}] [WS] ${arrow} [${clientType}] ${data}\n`;
    appendFileSync(LOG_FILE, line);
  },

  getLogPath(): string {
    return LOG_FILE;
  },

  clear() {
    ensureLogDir();
    if (existsSync(LOG_FILE)) {
      // Truncate file
      const fs = require('fs');
      fs.writeFileSync(LOG_FILE, '');
    }
  }
};
