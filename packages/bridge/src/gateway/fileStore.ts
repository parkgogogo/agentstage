import { mkdirSync, watch, type FSWatcher } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
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

export class FileStore {
  private pagesDir: string;
  private watchers = new Map<string, FSWatcher>();

  constructor(options: FileStoreOptions) {
    this.pagesDir = options.pagesDir;
  }

  private getStorePath(pageId: string): string {
    return join(this.pagesDir, pageId, 'store.json');
  }

  async load<T>(pageId: string): Promise<StoreData<T> | null> {
    const path = this.getStorePath(pageId);

    try {
      const content = await readFile(path, 'utf8');
      return JSON.parse(content) as StoreData<T>;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }

  async save<T>(pageId: string, data: StoreData<T>): Promise<void> {
    const path = this.getStorePath(pageId);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
  }

  watch<T>(pageId: string, callback: (data: StoreData<T>) => void): () => void {
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
