import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeStorageFacts, formatBytes, readStorageFacts, requestPersistence } from '../../src/app/storageDurability.ts';
import type { StorageManagerPort } from '../../src/app/storageDurability.ts';

const MEBIBYTE = 1024 * 1024;

/** A storage manager that records which of its methods were called. */
function manager(options: { persisted: boolean; grant?: boolean; usage?: number; quota?: number }): StorageManagerPort & { calls: string[] } {
  const calls: string[] = [];
  let persisted = options.persisted;
  return {
    calls,
    async persisted() {
      calls.push('persisted');
      return persisted;
    },
    async persist() {
      calls.push('persist');
      persisted = options.grant ?? false;
      return persisted;
    },
    async estimate() {
      calls.push('estimate');
      const estimate: { usage?: number; quota?: number } = {};
      if (options.usage !== undefined) estimate.usage = options.usage;
      if (options.quota !== undefined) estimate.quota = options.quota;
      return estimate;
    },
  };
}

const failing: StorageManagerPort = {
  persisted: async () => {
    throw new Error('not allowed');
  },
  persist: async () => {
    throw new Error('not allowed');
  },
  estimate: async () => {
    throw new Error('not allowed');
  },
};

test('readStorageFacts reports whether the browser may evict the data, and how full the storage is', async () => {
  assert.deepEqual(await readStorageFacts(manager({ persisted: true, usage: 3 * MEBIBYTE, quota: 100 * MEBIBYTE })), {
    durability: 'persistent',
    usageBytes: 3 * MEBIBYTE,
    quotaBytes: 100 * MEBIBYTE,
  });
  assert.equal((await readStorageFacts(manager({ persisted: false }))).durability, 'best-effort');
});

test('reading the facts does not ask for anything', async () => {
  const storage = manager({ persisted: false, grant: true });
  await readStorageFacts(storage);
  assert.equal(storage.calls.includes('persist'), false);
});

test('a browser without the storage manager, or with parts of it missing, gives unknowns instead of errors', async () => {
  const unknown = { durability: 'unknown', usageBytes: undefined, quotaBytes: undefined };
  assert.deepEqual(await readStorageFacts(undefined), unknown);
  assert.deepEqual(await readStorageFacts({}), unknown);
  assert.deepEqual(await readStorageFacts(failing), unknown);
  // Only the estimate is there.
  assert.deepEqual(await readStorageFacts({ estimate: async () => ({ usage: 5 }) }), { durability: 'unknown', usageBytes: 5, quotaBytes: undefined });
});

test('requestPersistence asks only when the storage is not persistent yet', async () => {
  const already = manager({ persisted: true });
  assert.equal(await requestPersistence(already), 'persistent');
  assert.deepEqual(already.calls, ['persisted']);

  const granted = manager({ persisted: false, grant: true });
  assert.equal(await requestPersistence(granted), 'persistent');
  assert.deepEqual(granted.calls, ['persisted', 'persist']);

  const refused = manager({ persisted: false, grant: false });
  assert.equal(await requestPersistence(refused), 'best-effort');
});

test('requestPersistence never rejects', async () => {
  assert.equal(await requestPersistence(undefined), 'unknown');
  assert.equal(await requestPersistence({}), 'unknown');
  assert.equal(await requestPersistence(failing), 'unknown');
  // A browser that can tell but cannot be asked.
  assert.equal(await requestPersistence({ persisted: async () => false }), 'best-effort');
});

test('formatBytes picks a unit that keeps the number short', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(3 * MEBIBYTE), '3.0 MB');
  assert.equal(formatBytes(2.5 * 1024 * MEBIBYTE), '2.5 GB');
  assert.equal(formatBytes(5000 * 1024 * MEBIBYTE), '5000.0 GB');
});

test('describeStorageFacts puts durability and usage on one line', () => {
  assert.equal(describeStorageFacts({ durability: 'persistent', usageBytes: 3 * MEBIBYTE, quotaBytes: 100 * MEBIBYTE }), 'persistent, 3.0 MB of 100.0 MB used');
  assert.equal(describeStorageFacts({ durability: 'best-effort', usageBytes: 3 * MEBIBYTE, quotaBytes: undefined }), 'best-effort, 3.0 MB used');
  assert.equal(describeStorageFacts({ durability: 'unknown', usageBytes: undefined, quotaBytes: undefined }), 'unknown');
  assert.equal(describeStorageFacts({ durability: 'best-effort', usageBytes: undefined, quotaBytes: 5 }), 'best-effort');
});
