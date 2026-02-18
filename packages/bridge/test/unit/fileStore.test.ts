import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  FileStore,
  InvalidPageIdError,
  VersionConflictError,
  validatePageId,
} from '../../src/gateway/fileStore.js';

describe('FileStore', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors in tests.
      }
    }
    tempDirs.length = 0;
  });

  function createStore() {
    const dir = mkdtempSync(join(tmpdir(), 'bridge-filestore-'));
    tempDirs.push(dir);
    return new FileStore({ pagesDir: dir });
  }

  it('should reject invalid pageId on validatePageId', () => {
    expect(() => validatePageId('../secrets')).toThrow(InvalidPageIdError);
    expect(() => validatePageId('valid_page-1')).not.toThrow();
  });

  it('should reject invalid pageId on load/save entry', async () => {
    const store = createStore();

    await expect(store.load('../../etc/passwd')).rejects.toBeInstanceOf(InvalidPageIdError);
    await expect(
      store.save('../../etc/passwd', {
        state: { count: 1 },
        version: 0,
        updatedAt: new Date().toISOString(),
        pageId: '../../etc/passwd',
      })
    ).rejects.toBeInstanceOf(InvalidPageIdError);
  });

  it('should enforce CAS with expectedVersion', async () => {
    const store = createStore();
    await store.save('counter', {
      state: { count: 1 },
      version: 0,
      updatedAt: new Date().toISOString(),
      pageId: 'counter',
    });

    await expect(
      store.save(
        'counter',
        {
          state: { count: 2 },
          version: 999,
          updatedAt: new Date().toISOString(),
          pageId: 'counter',
        },
        0
      )
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('should assign monotonic versions from server', async () => {
    const store = createStore();

    const first = await store.save('counter', {
      state: { count: 1 },
      version: 999,
      updatedAt: new Date().toISOString(),
      pageId: 'counter',
    });

    const second = await store.save(
      'counter',
      {
        state: { count: 2 },
        version: 0,
        updatedAt: new Date().toISOString(),
        pageId: 'counter',
      },
      first.version
    );

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
  });
});
