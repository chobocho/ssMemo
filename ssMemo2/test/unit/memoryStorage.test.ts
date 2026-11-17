import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../../src/storage/memoryStorage.ts';
import { defineStorageContract } from '../helpers/storageContract.ts';

defineStorageContract('MemoryStorage', async () => createMemoryStorage());

test('MemoryStorage: stored values work in a browser without structuredClone', async () => {
  // This storage is the fallback for browsers where IndexedDB cannot be used, which are often
  // old ones. It must not depend on a function those may lack. (The whole-page tests run in such
  // an environment, and until a caller stopped swallowing the error nobody noticed.)
  const original = globalThis.structuredClone;
  Reflect.deleteProperty(globalThis, 'structuredClone');
  try {
    const storage = createMemoryStorage();
    assert.equal(await storage.getValue('never set'), undefined);
    await storage.setValue('settings', { language: 'ko', sizes: [1, 2.5], nested: { on: true, nothing: null } });
    assert.deepEqual(await storage.getValue('settings'), { language: 'ko', sizes: [1, 2.5], nested: { on: true, nothing: null } });
    await storage.setValue('nothing', null);
    assert.equal(await storage.getValue('nothing'), null);
  } finally {
    globalThis.structuredClone = original;
  }
});
