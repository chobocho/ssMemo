import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionStore, parseSession } from '../../src/app/session.ts';
import type { SessionState } from '../../src/app/session.ts';
import { MAX_TABS } from '../../src/app/tabManager.ts';
import { createMemoryStorage } from '../../src/storage/memoryStorage.ts';
import { StorageError } from '../../src/storage/storagePort.ts';

const EMPTY: SessionState = { tabs: [], activeDocumentId: undefined };
const sample: SessionState = {
  tabs: [
    { documentId: 'a', cursor: 12 },
    { documentId: 'b', cursor: 0 },
  ],
  activeDocumentId: 'b',
};

// --- parseSession -----------------------------------------------------------

test('parseSession returns an empty session for missing or unusable input', () => {
  for (const value of [undefined, null, 'text', 42, [], { tabs: 'not a list' }]) {
    assert.deepEqual(parseSession(value), EMPTY);
  }
});

test('parseSession accepts a valid session', () => {
  assert.deepEqual(parseSession(sample), sample);
});

test('parseSession drops tabs without a usable document id and keeps the others', () => {
  const parsed = parseSession({
    tabs: [{ documentId: 'a', cursor: 1 }, { cursor: 5 }, { documentId: '' }, { documentId: 7 }, null, 'b', { documentId: 'c', cursor: 2 }],
    activeDocumentId: 'c',
  });
  assert.deepEqual(parsed, { tabs: [{ documentId: 'a', cursor: 1 }, { documentId: 'c', cursor: 2 }], activeDocumentId: 'c' });
});

test('parseSession replaces unusable cursor positions by the start of the document', () => {
  const cursors = [-1, 1.5, Number.NaN, '3', undefined, null];
  const parsed = parseSession({ tabs: cursors.map((cursor, index) => ({ documentId: `d${index}`, cursor })) });
  assert.deepEqual(parsed.tabs.map((tab) => tab.cursor), cursors.map(() => 0));
});

test('parseSession keeps only the first tab of a document listed twice', () => {
  const parsed = parseSession({ tabs: [{ documentId: 'a', cursor: 1 }, { documentId: 'b', cursor: 2 }, { documentId: 'a', cursor: 9 }] });
  assert.deepEqual(parsed.tabs, [{ documentId: 'a', cursor: 1 }, { documentId: 'b', cursor: 2 }]);
});

test('parseSession forgets an active document that is not among the tabs', () => {
  assert.equal(parseSession({ tabs: [{ documentId: 'a', cursor: 0 }], activeDocumentId: 'gone' }).activeDocumentId, undefined);
  assert.equal(parseSession({ tabs: [{ documentId: 'a', cursor: 0 }], activeDocumentId: 42 }).activeDocumentId, undefined);
});

test('parseSession never restores more tabs than the tab limit', () => {
  const tabs = Array.from({ length: MAX_TABS + 5 }, (_, index) => ({ documentId: `d${index}`, cursor: 0 }));
  const parsed = parseSession({ tabs, activeDocumentId: `d${MAX_TABS + 2}` });
  assert.equal(parsed.tabs.length, MAX_TABS);
  // The active document fell outside the limit, so it is no longer active.
  assert.equal(parsed.activeDocumentId, undefined);
});

// --- createSessionStore -----------------------------------------------------

test('the session store returns an empty session until one is saved, then what was saved', async () => {
  const store = createSessionStore(createMemoryStorage());
  assert.deepEqual(await store.load(), EMPTY);
  assert.equal(await store.save(sample), true);
  assert.deepEqual(await store.load(), sample);
});

test('the session store returns an empty session when storage cannot be read', async () => {
  const storage = createMemoryStorage();
  const store = createSessionStore({
    ...storage,
    getValue: async () => {
      throw new StorageError('connection-lost', 'closed');
    },
  });
  assert.deepEqual(await store.load(), EMPTY);
});

test('the session store reports a failed save instead of throwing', async () => {
  const storage = createMemoryStorage();
  const store = createSessionStore({
    ...storage,
    setValue: async () => {
      throw new StorageError('quota', 'full');
    },
  });
  assert.equal(await store.save(sample), false);
});

test('session and settings are stored under different keys', async () => {
  const storage = createMemoryStorage();
  await storage.setValue('settings', { language: 'ko' });
  await createSessionStore(storage).save(sample);
  assert.deepEqual(await storage.getValue('settings'), { language: 'ko' });
});
