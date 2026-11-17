import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PINNED_MEMOS_KEY, createMemoPins, parsePinnedIds } from '../../src/app/memoPins.ts';
import { createMemoryStorage } from '../../src/storage/memoryStorage.ts';
import { StorageError } from '../../src/storage/storagePort.ts';
import type { StoragePort } from '../../src/storage/storagePort.ts';

function failing(storage: StoragePort): StoragePort {
  const fail = async (): Promise<never> => {
    throw new StorageError('connection-lost', 'closed');
  };
  return { ...storage, getValue: fail, setValue: fail, updateValue: fail };
}

test('nothing is pinned to begin with', async () => {
  const pins = createMemoPins(createMemoryStorage());
  assert.equal(pins.has('a'), false);
  assert.deepEqual([...(await pins.refresh())], []);
  assert.deepEqual([...pins.ids()], []);
});

test('toggling pins a memo, toggling again unpins it', async () => {
  const pins = createMemoPins(createMemoryStorage());
  assert.equal(await pins.toggle('a'), true);
  assert.equal(pins.has('a'), true);
  assert.equal(pins.has('b'), false);
  assert.equal(await pins.toggle('a'), false);
  assert.equal(pins.has('a'), false);
});

test('several memos can be pinned at once', async () => {
  const pins = createMemoPins(createMemoryStorage());
  await pins.toggle('a');
  await pins.toggle('b');
  assert.deepEqual([...pins.ids()].sort(), ['a', 'b']);
  await pins.toggle('a');
  assert.deepEqual([...pins.ids()], ['b']);
});

test('pins are still there at the next visit, once they have been read', async () => {
  const storage = createMemoryStorage();
  await createMemoPins(storage).toggle('a');
  const later = createMemoPins(storage);
  // Not known before reading; the app reads at start-up.
  assert.equal(later.has('a'), false);
  assert.deepEqual([...(await later.refresh())], ['a']);
  assert.equal(later.has('a'), true);
});

test('two windows pinning at the same moment do not lose each other\'s pin', async () => {
  const storage = createMemoryStorage();
  const windowA = createMemoPins(storage);
  const windowB = createMemoPins(storage);
  await Promise.all([windowA.toggle('a'), windowB.toggle('b')]);
  assert.deepEqual([...(await windowA.refresh())].sort(), ['a', 'b']);
});

test('a toggle does what the window showed, even if another window got there first', async () => {
  // Both windows show the memo as not pinned and both ask to pin it. It must end up pinned, once.
  const storage = createMemoryStorage();
  const windowA = createMemoPins(storage);
  const windowB = createMemoPins(storage);
  assert.equal(await windowA.toggle('a'), true);
  assert.equal(await windowB.toggle('a'), true);
  assert.deepEqual(await storage.getValue(PINNED_MEMOS_KEY), ['a']);
  assert.equal(windowB.has('a'), true);
});

test('a pin that cannot be stored is not shown as set', async () => {
  const pins = createMemoPins(failing(createMemoryStorage()));
  await assert.rejects(pins.toggle('a'), (error) => error instanceof StorageError);
  assert.equal(pins.has('a'), false);
});

test('pins that cannot be read leave what was known, and reading never fails', async () => {
  const storage = createMemoryStorage();
  let broken = false;
  const pins = createMemoPins({
    ...storage,
    getValue: async (key) => {
      if (broken) throw new StorageError('connection-lost', 'closed');
      return storage.getValue(key);
    },
  });
  await pins.toggle('a');
  broken = true;
  assert.deepEqual([...(await pins.refresh())], ['a']);
  assert.equal(pins.has('a'), true);
});

test('forgetting drops the pin of a memo that is gone', async () => {
  const storage = createMemoryStorage();
  const pins = createMemoPins(storage);
  await pins.toggle('a');
  await pins.toggle('b');
  await pins.forget('a');
  assert.equal(pins.has('a'), false);
  assert.deepEqual(await storage.getValue(PINNED_MEMOS_KEY), ['b']);
  // A memo that was never pinned is forgotten without a fuss.
  await pins.forget('never pinned');
  assert.deepEqual(await storage.getValue(PINNED_MEMOS_KEY), ['b']);
});

test('forgetting never fails, whatever the storage does', async () => {
  const pins = createMemoPins(failing(createMemoryStorage()));
  await pins.forget('a');
  assert.equal(pins.has('a'), false);
});

test('parsePinnedIds keeps the ids and drops everything else', () => {
  assert.deepEqual(parsePinnedIds(['a', 'b']), ['a', 'b']);
  assert.deepEqual(parsePinnedIds(['a', 1, '', null, 'a', { id: 'x' }, 'b']), ['a', 'b']);
  for (const value of [undefined, null, 'a', 5, {}, true]) assert.deepEqual(parsePinnedIds(value), [], String(value));
});

test('damaged stored pins do not stop pinning from working', async () => {
  const storage = createMemoryStorage();
  await storage.setValue(PINNED_MEMOS_KEY, { not: 'a list' });
  const pins = createMemoPins(storage);
  assert.deepEqual([...(await pins.refresh())], []);
  assert.equal(await pins.toggle('a'), true);
  assert.deepEqual(await storage.getValue(PINNED_MEMOS_KEY), ['a']);
});
