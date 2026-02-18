import { existsSync } from 'fs';
import { appendFile, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type SinkMode = 'console' | 'file' | 'both' | 'disabled';

interface LogEntry {
  level: LogLevel;
  message: string;
  data?: unknown;
  timestamp: string;
}

export interface LoggerSink {
  write(entry: LogEntry): Promise<void> | void;
  clear?(): Promise<void>;
  flush?(): Promise<void>;
}

interface LoggerRuntimeOptions {
  level: LogLevel;
  mode: SinkMode;
  logDir: string;
  fileName: string;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const TEST_DEFAULT_DIR = join(process.cwd(), '.agentstage-test-logs');

function normalizeLogLevel(value: string | undefined): LogLevel {
  if (!value) {
    return 'info';
  }
  const level = value.toLowerCase();
  if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
    return level;
  }
  return 'info';
}

function normalizeSinkMode(value: string | undefined): SinkMode {
  if (!value) {
    return process.env.NODE_ENV === 'test' ? 'disabled' : 'both';
  }
  const mode = value.toLowerCase();
  if (mode === 'console' || mode === 'file' || mode === 'both' || mode === 'disabled') {
    return mode;
  }
  return process.env.NODE_ENV === 'test' ? 'disabled' : 'both';
}

function defaultOptions(): LoggerRuntimeOptions {
  return {
    level: normalizeLogLevel(process.env.BRIDGE_LOG_LEVEL),
    mode: normalizeSinkMode(process.env.BRIDGE_LOG_SINK),
    logDir: process.env.BRIDGE_LOG_DIR || (process.env.NODE_ENV === 'test' ? TEST_DEFAULT_DIR : join(homedir(), '.agentstage', 'logs')),
    fileName: process.env.BRIDGE_LOG_FILE || 'bridge.log',
  };
}

function toLine(entry: LogEntry): string {
  const dataStr = entry.data !== undefined ? ` ${JSON.stringify(entry.data)}` : '';
  return `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${dataStr}\n`;
}

class FileBatchSink implements LoggerSink {
  private readonly path: string;
  private queue: string[] = [];
  private writing = false;
  private flushScheduled = false;
  private initialized = false;

  constructor(path: string) {
    this.path = path;
  }

  async write(entry: LogEntry): Promise<void> {
    this.queue.push(toLine(entry));
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      setTimeout(() => {
        this.flushScheduled = false;
        void this.flush();
      }, 10);
    }
  }

  async flush(): Promise<void> {
    if (this.writing || this.queue.length === 0) {
      return;
    }

    this.writing = true;
    try {
      if (!this.initialized) {
        await mkdir(join(this.path, '..'), { recursive: true });
        this.initialized = true;
      }

      while (this.queue.length > 0) {
        const chunk = this.queue.splice(0, this.queue.length).join('');
        await appendFile(this.path, chunk, 'utf8');
      }
    } finally {
      this.writing = false;
    }
  }

  async clear(): Promise<void> {
    this.queue = [];
    await mkdir(join(this.path, '..'), { recursive: true });
    await writeFile(this.path, '', 'utf8');
  }
}

class ConsoleSink implements LoggerSink {
  write(entry: LogEntry): void {
    if (entry.level === 'error') {
      console.error(entry.message, entry.data ?? '');
    } else if (entry.level === 'warn') {
      console.warn(entry.message, entry.data ?? '');
    } else {
      console.log(entry.message, entry.data ?? '');
    }
  }
}

class DisabledSink implements LoggerSink {
  write(): void {}
}

class CompositeSink implements LoggerSink {
  private sinks: LoggerSink[];

  constructor(sinks: LoggerSink[]) {
    this.sinks = sinks;
  }

  async write(entry: LogEntry): Promise<void> {
    for (const sink of this.sinks) {
      await sink.write(entry);
    }
  }

  async clear(): Promise<void> {
    for (const sink of this.sinks) {
      if (sink.clear) {
        await sink.clear();
      }
    }
  }

  async flush(): Promise<void> {
    for (const sink of this.sinks) {
      if (sink.flush) {
        await sink.flush();
      }
    }
  }
}

function createBuiltinSink(options: LoggerRuntimeOptions): LoggerSink {
  const logPath = join(options.logDir, options.fileName);
  switch (options.mode) {
    case 'disabled':
      return new DisabledSink();
    case 'console':
      return new ConsoleSink();
    case 'file':
      return new FileBatchSink(logPath);
    case 'both':
    default:
      return new CompositeSink([new ConsoleSink(), new FileBatchSink(logPath)]);
  }
}

let runtimeOptions = defaultOptions();
let activeSink: LoggerSink = createBuiltinSink(runtimeOptions);

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[runtimeOptions.level];
}

function write(level: LogLevel, message: string, data?: unknown): void {
  if (!shouldLog(level)) {
    return;
  }

  const entry: LogEntry = {
    level,
    message,
    data,
    timestamp: new Date().toISOString(),
  };

  void activeSink.write(entry);
}

export const logger = {
  configure(overrides: Partial<LoggerRuntimeOptions> = {}) {
    runtimeOptions = {
      ...runtimeOptions,
      ...overrides,
    };
    activeSink = createBuiltinSink(runtimeOptions);
  },

  setSink(sink: LoggerSink) {
    activeSink = sink;
  },

  debug(message: string, data?: unknown) {
    write('debug', message, data);
  },

  info(message: string, data?: unknown) {
    write('info', message, data);
  },

  warn(message: string, data?: unknown) {
    write('warn', message, data);
  },

  error(message: string, data?: unknown) {
    write('error', message, data);
  },

  wsMessage(direction: 'in' | 'out', clientType: string, data: string) {
    const arrow = direction === 'in' ? '->' : '<-';
    write('debug', `[WS] ${arrow} [${clientType}] ${data}`);
  },

  getLogPath(): string {
    return join(runtimeOptions.logDir, runtimeOptions.fileName);
  },

  async clear(): Promise<void> {
    if (activeSink.clear) {
      await activeSink.clear();
      return;
    }

    const logPath = this.getLogPath();
    if (existsSync(logPath)) {
      await writeFile(logPath, '', 'utf8');
    }
  },

  async flush(): Promise<void> {
    if (activeSink.flush) {
      await activeSink.flush();
    }
  },
};
