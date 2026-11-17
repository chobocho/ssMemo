import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRASH_KEY, TRASH_LIMITS, createTrash, parseTrash, pruneTrash } from '../../src/app/trash.ts';
import type { Trash, TrashEntry, TrashLimits } from '../../src/app/trash.ts';
import { createMemoryStorage } from '../../src/storage/memoryStorage.ts';
import { NEW_DOCUMENT_REV, StorageError } from '../../src/storage/storagePort.ts';
import type { DocumentDraft, DocumentSource, StoragePort } from '../../src/storage/storagePort.ts';

const CREATED_AT = '2026-01-01T00:00:00.000Z';
const UPDATED_AT = '2026-01-02T00:00:00.000Z';
const START = Date.parse('2026-03-01T00:00:00.000Z');
const ONE_MINUTE = 60_000;
const ONE_DAY = 24 * 60 * ONE_MINUTE;
const SOURCE: DocumentSource = { fileName: 'notes.txt', encoding: 'CP949', eol: 'crlf', hasBom: false };

function draft(id: string, content = `text of ${id}`, overrides: Partial<DocumentDraft> = {}): DocumentDraft {
  return { id, title: `title of ${id}`, content, createdAt: CREATED_AT, updatedAt: UPDATED_AT, ...overrides };
}

interface Harness {
  storage: StoragePort;
  trash: Trash;
  /** Moves the clock forward. */
  wait(ms: number): void;
  store(...drafts: DocumentDraft[]): Promise<void>;
  storedIds(): Promise<string[]>;
  titlesInTrash(): Promise<string[]>;
}

function createHarness(options: { limits?: TrashLimits; storage?: StoragePort } = {}): Harness {
  const storage = options.storage ?? createMemoryStorage();
  let time = START;
  let nextId = 1;
  const trash = createTrash({
    storage,
    now: () => new Date(time),
    createId: () => `new-${nextId++}`,
    ...(options.limits ? { limits: options.limits } : {}),
  });
  return {
    storage,
    trash,
    wait: (ms) => {
      time += ms;
    },
    store: async (...drafts) => {
      for (const item of drafts) await storage.saveDocument(item, NEW_DOCUMENT_REV);
    },
    storedIds: async () => (await storage.listDocuments()).documents.map((meta) => meta.id).sort(),
    titlesInTrash: async () => (await trash.list()).map((memo) => memo.title),
  };
}

function entry(entryId: string, deletedAt: number, content = 'x'): TrashEntry {
  return { entryId, deletedAt: new Date(deletedAt).toISOString(), document: draft(`doc-${entryId}`, content) };
}

// --- discard ----------------------------------------------------------------

test('a discarded memo leaves the stored memos and appears in the trash', async () => {
  const { trash, store, storedIds } = createHarness();
  await store(draft('a', 'hello'), draft('b'));
  assert.equal(await trash.discard('a'), true);
  assert.deepEqual(await storedIds(), ['b']);
  assert.deepEqual(await trash.list(), [
    { entryId: 'new-1', title: 'title of a', length: 5, deletedAt: new Date(START).toISOString() },
  ]);
});

test('discarding a memo that does not exist reports so and changes nothing', async () => {
  const { trash, store, storedIds } = createHarness();
  await store(draft('a'));
  assert.equal(await trash.discard('missing'), false);
  assert.deepEqual(await storedIds(), ['a']);
  assert.deepEqual(await trash.list(), []);
});

test('the trash lists the most recently deleted memo first', async () => {
  const { trash, store, wait, titlesInTrash } = createHarness();
  await store(draft('a'), draft('b'), draft('c'));
  await trash.discard('b');
  wait(ONE_MINUTE);
  await trash.discard('a');
  wait(ONE_MINUTE);
  await trash.discard('c');
  assert.deepEqual(await titlesInTrash(), ['title of c', 'title of a', 'title of b']);
});

test('an empty memo can be discarded and restored like any other', async () => {
  const { trash, store, storage } = createHarness();
  await store(draft('a', ''));
  await trash.discard('a');
  assert.equal((await trash.list())[0]?.length, 0);
  await trash.restore('new-1');
  assert.equal((await storage.getDocument('a'))?.content, '');
});

// --- restore ----------------------------------------------------------------

test('restoring brings the memo back as it was and takes it out of the trash', async () => {
  const { trash, store, storage } = createHarness();
  await store(draft('a', 'hello', { source: SOURCE }));
  await trash.discard('a');
  const meta = await trash.restore('new-1');
  assert.deepEqual(meta, { id: 'a', title: 'title of a', createdAt: CREATED_AT, updatedAt: UPDATED_AT, length: 5, rev: 1, source: SOURCE });
  assert.deepEqual(await storage.getDocument('a'), { meta, content: 'hello' });
  assert.deepEqual(await trash.list(), []);
});

test('restoring never overwrites a memo that uses the same id by now', async () => {
  // The same memo came back from a backup in the meantime, with other text.
  const { trash, store, storage, storedIds } = createHarness();
  await store(draft('a', 'deleted version'));
  await trash.discard('a');
  await store(draft('a', 'version from a backup'));
  const meta = await trash.restore('new-1');
  assert.equal(meta?.id, 'new-2');
  assert.deepEqual(await storedIds(), ['a', 'new-2']);
  assert.equal((await storage.getDocument('a'))?.content, 'version from a backup');
  assert.equal((await storage.getDocument('new-2'))?.content, 'deleted version');
  assert.deepEqual(await trash.list(), []);
});

test('restoring an entry that is no longer in the trash does nothing', async () => {
  const { trash, store, storedIds } = createHarness();
  await store(draft('a'));
  await trash.discard('a');
  assert.equal(await trash.restore('no-such-entry'), undefined);
  assert.deepEqual(await storedIds(), []);
  assert.equal((await trash.list()).length, 1);
});

test('a memo can be deleted, restored and deleted again', async () => {
  const { trash, store, storedIds } = createHarness();
  await store(draft('a'));
  await trash.discard('a');
  await trash.restore('new-1');
  assert.equal(await trash.discard('a'), true);
  assert.deepEqual(await storedIds(), []);
  assert.deepEqual((await trash.list()).map((memo) => memo.entryId), ['new-2']);
});

test('two deleted versions of the same memo are both kept', async () => {
  const { trash, store, wait, storage } = createHarness();
  await store(draft('a', 'first version'));
  await trash.discard('a');
  wait(ONE_MINUTE);
  await store(draft('a', 'second version'));
  await trash.discard('a');
  assert.equal((await trash.list()).length, 2);
  await trash.restore('new-1');
  assert.equal((await storage.getDocument('a'))?.content, 'first version');
});

// --- remove / empty ---------------------------------------------------------

test('removing deletes one entry for good and leaves the others', async () => {
  const { trash, store, titlesInTrash, storage } = createHarness();
  await store(draft('a'), draft('b'));
  await trash.discard('a');
  await trash.discard('b');
  await trash.remove('new-1');
  assert.deepEqual(await titlesInTrash(), ['title of b']);
  // The text is really gone from the storage, not merely hidden.
  assert.equal(JSON.stringify(await storage.getValue(TRASH_KEY)).includes('text of a'), false);
  // Removing what is not there is not an error.
  await trash.remove('new-1');
  assert.deepEqual(await titlesInTrash(), ['title of b']);
});

test('emptying deletes everything in the trash and nothing else', async () => {
  const { trash, store, storedIds, storage } = createHarness();
  await store(draft('a'), draft('b'), draft('c'));
  await trash.discard('a');
  await trash.discard('b');
  await trash.empty();
  assert.deepEqual(await trash.list(), []);
  assert.deepEqual(await storedIds(), ['c']);
  assert.equal(JSON.stringify(await storage.getValue(TRASH_KEY)).includes('text of'), false);
});

// --- limits -----------------------------------------------------------------

test('the limits are generous enough for everyday use', () => {
  assert.ok(TRASH_LIMITS.maxEntries >= 10);
  assert.ok(TRASH_LIMITS.maxAgeDays >= 7);
  // A stored value is read and written as a whole, so it must stay small.
  assert.ok(TRASH_LIMITS.maxCharacters <= 10_000_000);
});

test('pruning keeps the newest entries when there are too many', () => {
  const limits: TrashLimits = { maxEntries: 2, maxAgeDays: 30, maxCharacters: 1000 };
  const kept = pruneTrash([entry('old', START), entry('newest', START + 2), entry('newer', START + 1)], new Date(START + 3), limits);
  assert.deepEqual(kept.map((item) => item.entryId), ['newest', 'newer']);
});

test('pruning drops entries older than the age limit, exactly at the limit they stay', () => {
  const limits: TrashLimits = { maxEntries: 10, maxAgeDays: 30, maxCharacters: 1000 };
  const entries = [entry('fresh', START), entry('old', START - ONE_DAY)];
  const at = (ms: number): string[] => pruneTrash(entries, new Date(START + ms), limits).map((item) => item.entryId);
  assert.deepEqual(at(29 * ONE_DAY), ['fresh', 'old']);
  assert.deepEqual(at(29 * ONE_DAY + 1), ['fresh']);
  assert.deepEqual(at(30 * ONE_DAY), ['fresh']);
  assert.deepEqual(at(30 * ONE_DAY + 1), []);
});

test('an entry dated in the future is kept: the clock may have been set back', () => {
  const limits: TrashLimits = { maxEntries: 10, maxAgeDays: 30, maxCharacters: 1000 };
  assert.equal(pruneTrash([entry('future', START + 400 * ONE_DAY)], new Date(START), limits).length, 1);
});

test('pruning drops the oldest entries when the texts together are too long', () => {
  const limits: TrashLimits = { maxEntries: 10, maxAgeDays: 30, maxCharacters: 10 };
  const entries = [entry('a', START, 'x'.repeat(4)), entry('b', START + 1, 'x'.repeat(4)), entry('c', START + 2, 'x'.repeat(4))];
  assert.deepEqual(pruneTrash(entries, new Date(START + 3), limits).map((item) => item.entryId), ['c', 'b']);
  // Exactly at the limit nothing is dropped.
  const exact = [entry('a', START, 'x'.repeat(5)), entry('b', START + 1, 'x'.repeat(5))];
  assert.equal(pruneTrash(exact, new Date(START + 3), limits).length, 2);
});

test('the newest entry is kept even when it alone is longer than the limit', () => {
  // Otherwise deleting a large memo would silently be final.
  const limits: TrashLimits = { maxEntries: 10, maxAgeDays: 30, maxCharacters: 10 };
  const entries = [entry('small', START, 'x'), entry('huge', START + 1, 'x'.repeat(50))];
  assert.deepEqual(pruneTrash(entries, new Date(START + 2), limits).map((item) => item.entryId), ['huge']);
});

test('pruning does not change the list it is given', () => {
  const limits: TrashLimits = { maxEntries: 1, maxAgeDays: 30, maxCharacters: 1000 };
  const entries = [entry('a', START), entry('b', START + 1)];
  pruneTrash(entries, new Date(START + 2), limits);
  assert.deepEqual(entries.map((item) => item.entryId), ['a', 'b']);
});

test('the trash applies the limits when a memo is discarded, and hides expired entries when listing', async () => {
  const { trash, store, wait, titlesInTrash, storage } = createHarness({ limits: { maxEntries: 2, maxAgeDays: 30, maxCharacters: 1000 } });
  await store(draft('a'), draft('b'), draft('c'), draft('d'));
  await trash.discard('a');
  wait(ONE_MINUTE);
  await trash.discard('b');
  wait(ONE_MINUTE);
  await trash.discard('c');
  assert.deepEqual(await titlesInTrash(), ['title of c', 'title of b']);
  wait(31 * ONE_DAY);
  assert.deepEqual(await titlesInTrash(), []);
  // Listing only reads. The expired texts leave the storage with the next change.
  await trash.discard('d');
  assert.deepEqual(await titlesInTrash(), ['title of d']);
  assert.equal(JSON.stringify(await storage.getValue(TRASH_KEY)).includes('text of b'), false);
});

test('an expired entry cannot be restored', async () => {
  const { trash, store, wait, storedIds } = createHarness();
  await store(draft('a'));
  await trash.discard('a');
  wait((TRASH_LIMITS.maxAgeDays + 1) * ONE_DAY);
  assert.equal(await trash.restore('new-1'), undefined);
  assert.deepEqual(await storedIds(), []);
});

// --- damaged data -----------------------------------------------------------

test('parseTrash accepts what the trash stores', async () => {
  const { trash, store, storage } = createHarness();
  await store(draft('a', 'hello', { source: SOURCE }));
  await trash.discard('a');
  assert.deepEqual(parseTrash(await storage.getValue(TRASH_KEY)), [
    { entryId: 'new-1', deletedAt: new Date(START).toISOString(), document: draft('a', 'hello', { source: SOURCE }) },
  ]);
});

test('parseTrash returns nothing for a value that is not a list', () => {
  for (const value of [undefined, null, 'text', 42, {}, true]) assert.deepEqual(parseTrash(value), []);
});

test('parseTrash skips damaged entries and keeps the good ones', () => {
  const good = entry('good', START);
  const damaged: unknown[] = [
    null,
    'text',
    { ...good, entryId: '' },
    { ...good, entryId: 7 },
    { ...good, deletedAt: 'not a date' },
    { ...good, deletedAt: undefined },
    { ...good, document: undefined },
    { ...good, document: { ...good.document, content: undefined } },
    { ...good, document: { ...good.document, title: 5 } },
    { ...good, document: { ...good.document, id: '' } },
    { ...good, document: { ...good.document, createdAt: 12 } },
  ];
  assert.deepEqual(parseTrash([...damaged, good]), [good]);
});

test('parseTrash drops a damaged file description but keeps the memo', () => {
  const good = entry('good', START);
  const parsed = parseTrash([{ ...good, document: { ...good.document, source: { fileName: 5 } } }]);
  assert.deepEqual(parsed, [good]);
});

test('a damaged stored trash does not stop the trash from working', async () => {
  const { trash, store, storage, titlesInTrash } = createHarness();
  await storage.setValue(TRASH_KEY, { not: 'a list' });
  assert.deepEqual(await trash.list(), []);
  await store(draft('a'));
  assert.equal(await trash.discard('a'), true);
  assert.deepEqual(await titlesInTrash(), ['title of a']);
});

// --- failures ---------------------------------------------------------------

test('when the trash cannot be written, the memo is not deleted', async () => {
  const storage = createMemoryStorage();
  const { trash, store, storedIds } = createHarness({
    storage: {
      ...storage,
      updateValue: async () => {
        throw new StorageError('quota', 'full');
      },
    },
  });
  await store(draft('a'));
  await assert.rejects(trash.discard('a'), (error) => error instanceof StorageError && error.kind === 'quota');
  assert.deepEqual(await storedIds(), ['a']);
});

test('when the memo cannot be deleted, it does not stay in the trash as well', async () => {
  const storage = createMemoryStorage();
  const { trash, store, storedIds } = createHarness({
    storage: {
      ...storage,
      deleteDocument: async () => {
        throw new StorageError('write-failed', 'aborted');
      },
    },
  });
  await store(draft('a'));
  await assert.rejects(trash.discard('a'), (error) => error instanceof StorageError && error.kind === 'write-failed');
  assert.deepEqual(await storedIds(), ['a']);
  assert.deepEqual(await trash.list(), []);
});

test('when a memo cannot be written back, it stays in the trash', async () => {
  const storage = createMemoryStorage();
  let failSaving = false;
  const { trash, store, storedIds } = createHarness({
    storage: {
      ...storage,
      saveDocument: async (item, expectedRev) => {
        if (failSaving) throw new StorageError('quota', 'full');
        return storage.saveDocument(item, expectedRev);
      },
    },
  });
  await store(draft('a'));
  await trash.discard('a');
  failSaving = true;
  await assert.rejects(trash.restore('new-1'), (error) => error instanceof StorageError && error.kind === 'quota');
  assert.deepEqual(await storedIds(), []);
  assert.equal((await trash.list()).length, 1);
});

test('a restored memo counts as restored even if the trash could not be tidied afterwards', async () => {
  // The memo is back, which is what was asked for. The copy left in the trash does no harm.
  const storage = createMemoryStorage();
  let failUpdating = false;
  const { trash, store, storedIds } = createHarness({
    storage: {
      ...storage,
      updateValue: async (key, update) => {
        if (failUpdating) throw new StorageError('write-failed', 'aborted');
        return storage.updateValue(key, update);
      },
    },
  });
  await store(draft('a'));
  await trash.discard('a');
  failUpdating = true;
  assert.equal((await trash.restore('new-1'))?.id, 'a');
  assert.deepEqual(await storedIds(), ['a']);
});
