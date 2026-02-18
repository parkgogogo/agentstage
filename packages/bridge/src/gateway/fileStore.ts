import { mkdirSync, watch, type FSWatcher } from 'fs';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

export interface StoreData<T = unknown> {
  state: T;
  version: number;
  updatedAt: string;
  pageId: string;
}

export interface FileStoreOptions {
  pagesDir: string;
}

const PAGE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export class InvalidPageIdError extends Error {
  readonly pageId: string;

  constructor(pageId: string) {
    super(`Invalid pageId "${pageId}". pageId must match /^[a-zA-Z0-9_-]+$/.`);
    this.name = 'InvalidPageIdError';
    this.pageId = pageId;
  }
}

export class VersionConflictError extends Error {
  readonly pageId: string;
  readonly expectedVersion: number;
  readonly actualVersion: number | null;

  constructor(pageId: string, expectedVersion: number, actualVersion: number | null) {
    super(
      `Version conflict for "${pageId}": expected ${expectedVersion}, actual ${
        actualVersion === null ? 'null' : actualVersion
      }.`
    );
    this.name = 'VersionConflictError';
    this.pageId = pageId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

export function validatePageId(pageId: string): void {
  if (!PAGE_ID_PATTERN.test(pageId)) {
    throw new InvalidPageIdError(pageId);
  }
}

export class FileStore {
  private pagesDir: string;
  private watchers = new Map<string, FSWatcher>();
  private writeQueue: Array<{
    pageId: string;
    path: string;
    data: StoreData<unknown>;
    expectedVersion?: number;
    resolve: (savedData: StoreData<unknown>) => void;
    reject: (error: unknown) => void;
  }> = [];
  private processing = false;
  private versionClock = new Map<string, number>();

  constructor(options: FileStoreOptions) {
    this.pagesDir = options.pagesDir;
  }

  private getStorePath(pageId: string): string {
    return join(this.pagesDir, pageId, 'store.json');
  }

  async load<T>(pageId: string): Promise<StoreData<T> | null> {
    validatePageId(pageId);
    const path = this.getStorePath(pageId);

    try {
      const content = await readFile(path, 'utf8');
      const parsed = JSON.parse(content) as StoreData<T>;
      if (typeof parsed.version === 'number') {
        this.bumpVersionClock(pageId, parsed.version);
      }
      return parsed;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }

  async save<T>(pageId: string, data: StoreData<T>, expectedVersion?: number): Promise<StoreData<T>> {
    validatePageId(pageId);
    const path = this.getStorePath(pageId);

    return new Promise<StoreData<T>>((resolve, reject) => {
      this.writeQueue.push({
        pageId,
        path,
        data: data as StoreData<unknown>,
        expectedVersion,
        resolve: (savedData) => resolve(savedData as StoreData<T>),
        reject,
      });
      void this.processWriteQueue();
    });
  }

  private async processWriteQueue(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;

    while (this.writeQueue.length > 0) {
      const task = this.writeQueue.shift();
      if (!task) {
        continue;
      }

      try {
        const current = await this.readStoreData(task.path);
        const currentVersion = current?.version ?? null;

        if (task.expectedVersion !== undefined && currentVersion !== null && currentVersion !== task.expectedVersion) {
          throw new VersionConflictError(task.pageId, task.expectedVersion, currentVersion);
        }

        const nextVersion = this.nextVersion(task.pageId, current?.version ?? 0);
        const savedData: StoreData<unknown> = {
          ...task.data,
          pageId: task.pageId,
          version: nextVersion,
          updatedAt: new Date().toISOString(),
        };

        await this.writeAtomically(task.path, JSON.stringify(savedData, null, 2));
        task.resolve(savedData);
      } catch (error) {
        task.reject(error);
      }
    }

    this.processing = false;

    if (this.writeQueue.length > 0) {
      void this.processWriteQueue();
    }
  }

  private async writeAtomically(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tmpPath = `${path}.tmp`;
    await writeFile(tmpPath, content, 'utf8');
    await rename(tmpPath, path);
  }

  private async readStoreData(path: string): Promise<StoreData<unknown> | null> {
    try {
      const content = await readFile(path, 'utf8');
      return JSON.parse(content) as StoreData<unknown>;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private bumpVersionClock(pageId: string, version: number): void {
    const current = this.versionClock.get(pageId) ?? 0;
    if (version > current) {
      this.versionClock.set(pageId, version);
    }
  }

  private nextVersion(pageId: string, fileVersion: number): number {
    const clock = this.versionClock.get(pageId) ?? 0;
    const next = Math.max(clock, fileVersion) + 1;
    this.versionClock.set(pageId, next);
    return next;
  }

  watch<T>(pageId: string, callback: (data: StoreData<T>) => void): () => void {
    validatePageId(pageId);
    const path = this.getStorePath(pageId);
    const pageDir = dirname(path);

    const existing = this.watchers.get(pageId);
    if (existing) {
      existing.close();
      this.watchers.delete(pageId);
    }

    mkdirSync(pageDir, { recursive: true });

    const watcher = watch(pageDir, (_, filename) => {
      if (filename && filename.toString() !== 'store.json') {
        return;
      }

      void this.load<T>(pageId)
        .then((data) => {
          if (data) {
            callback(data);
          }
        })
        .catch(() => {
          // Ignore transient read/parse errors during file change events.
        });
    });

    watcher.on('error', () => {
      const activeWatcher = this.watchers.get(pageId);
      if (activeWatcher) {
        activeWatcher.close();
        this.watchers.delete(pageId);
      }
    });

    this.watchers.set(pageId, watcher);

    return () => {
      const activeWatcher = this.watchers.get(pageId);
      if (activeWatcher) {
        activeWatcher.close();
        this.watchers.delete(pageId);
      }
    };
  }

  destroy(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }

    this.watchers.clear();
  }
}
