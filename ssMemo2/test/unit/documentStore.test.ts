import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TITLE_LENGTH, createDocumentStore, findTitleProblem } from '../../src/app/documentStore.ts';
import type { DocumentStore } from '../../src/app/documentStore.ts';
import { createRandomId } from '../../src/app/randomId.ts';
import type { RandomSource } from '../../src/app/randomId.ts';
import { createMemoryStorage } from '../../src/storage/memoryStorage.ts';
import { StorageError } from '../../src/storage/storagePort.ts';
import type { DocumentSource, StoragePort } from '../../src/storage/storagePort.ts';

const START_TIME_MS = Date.UTC(2026, 0, 1);
const ONE_MINUTE_MS = 60_000;
const FILE_SOURCE: DocumentSource = { fileName: 'notes.txt', encoding: 'CP949', eol: 'crlf', hasBom: false };
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface Harness {
  store: DocumentStore;
  storage: StoragePort;
  /** Moves the fake clock forward. */
  advance(ms: number): void;
}

/** A store on memory storage with a controllable clock and predictable ids (id-1, id-2, ...). */
function createHarness(storage: StoragePort = createMemoryStorage()): Harness {
  let nowMs = START_TIME_MS;
  let idCount = 0;
  const store = createDocumentStore({
    storage,
    now: () => new Date(nowMs),
    createId: () => `id-${(idCount += 1)}`,
    conflictCopyTitle: (title) => `${title} (copy)`,
  });
  return { store, storage, advance: (ms) => { nowMs += ms; } };
}

function isoAfter(ms: number): string {
  return new Date(START_TIME_MS + ms).toISOString();
}

// --- findTitleProblem -------------------------------------------------------

test('findTitleProblem accepts ordinary titles', () => {
  assert.equal(findTitleProblem('memo'), undefined);
  assert.equal(findTitleProblem('회의 메모 ✅'), undefined);
  assert.equal(findTitleProblem('x'.repeat(MAX_TITLE_LENGTH)), undefined);
});

test('findTitleProblem rejects empty and blank titles', () => {
  assert.equal(findTitleProblem(''), 'empty');
  assert.equal(findTitleProblem('   \t '), 'empty');
});

test('findTitleProblem rejects titles over the length limit, ignoring surrounding spaces', () => {
  assert.equal(findTitleProblem('x'.repeat(MAX_TITLE_LENGTH + 1)), 'too-long');
  assert.equal(findTitleProblem(`  ${'x'.repeat(MAX_TITLE_LENGTH)}  `), undefined);
});

test('findTitleProblem rejects line breaks', () => {
  assert.equal(findTitleProblem('two\nlines'), 'line-break');
  assert.equal(findTitleProblem('carriage\rreturn'), 'line-break');
});

// --- create / load ----------------------------------------------------------

test('create stores a new document with a fresh id and the current time', async () => {
  const { store } = createHarness();
  const meta = await store.create('  first memo  ', 'hello');
  assert.deepEqual(meta, {
    id: 'id-1',
    title: 'first memo',
    createdAt: isoAfter(0),
    updatedAt: isoAfter(0),
    length: 5,
    rev: 1,
  });
  assert.deepEqual(await store.load('id-1'), { meta, content: 'hello' });
});

test('create records the file a document came from', async () => {
  const { store } = createHarness();
  const meta = await store.create('notes.txt', 'hello', FILE_SOURCE);
  assert.deepEqual(meta.source, FILE_SOURCE);
  assert.deepEqual((await store.load('id-1'))?.meta.source, FILE_SOURCE);
  assert.deepEqual((await store.list()).documents[0]?.source, FILE_SOURCE);
});

test('a document created without a source has none', async () => {
  const { store } = createHarness();
  const meta = await store.create('memo', 'hello');
  assert.equal('source' in meta, false);
});

test('create refuses an invalid title and stores nothing', async () => {
  const { store } = createHarness();
  await assert.rejects(store.create('   ', 'text'), /title/i);
  assert.deepEqual((await store.list()).documents, []);
});

test('load returns undefined for an unknown id', async () => {
  assert.equal(await createHarness().store.load('nope'), undefined);
});

// --- save -------------------------------------------------------------------

test('save replaces the content and moves the modification time, keeping title and creation time', async () => {
  const { store, advance } = createHarness();
  const created = await store.create('memo', 'v1');
  advance(ONE_MINUTE_MS);
  const outcome = await store.save(created, 'version two');
  assert.equal(outcome.savedAsCopy, false);
  assert.deepEqual(outcome.meta, {
    id: 'id-1',
    title: 'memo',
    createdAt: isoAfter(0),
    updatedAt: isoAfter(ONE_MINUTE_MS),
    length: 11,
    rev: 2,
  });
  assert.equal((await store.load('id-1'))?.content, 'version two');
});

test('save and rename keep the source of a file document', async () => {
  const { store } = createHarness();
  const created = await store.create('notes.txt', 'v1', FILE_SOURCE);
  const saved = await store.save(created, 'v2');
  assert.deepEqual(saved.meta.source, FILE_SOURCE);
  const renamed = await store.rename(saved.meta, 'my notes');
  assert.deepEqual(renamed.source, FILE_SOURCE);
  assert.deepEqual((await store.load('id-1'))?.meta.source, FILE_SOURCE);
});

test('the copy made after a conflict keeps the source too', async () => {
  const { store } = createHarness();
  const created = await store.create('notes.txt', 'original', FILE_SOURCE);
  await store.save(created, 'text from window B');
  const outcome = await store.save(created, 'text from window A');
  assert.equal(outcome.savedAsCopy, true);
  assert.deepEqual(outcome.meta.source, FILE_SOURCE);
});

test('save keeps both versions when another window saved first', async () => {
  const { store, advance } = createHarness();
  const created = await store.create('memo', 'original');
  // "Window B" saves first.
  const fromWindowB = await store.save(created, 'text from window B');
  advance(ONE_MINUTE_MS);
  // "Window A" still holds the first revision and saves its own text.
  const outcome = await store.save(created, 'text from window A');

  assert.equal(outcome.savedAsCopy, true);
  assert.deepEqual(outcome.meta, {
    id: 'id-2',
    title: 'memo (copy)',
    createdAt: isoAfter(ONE_MINUTE_MS),
    updatedAt: isoAfter(ONE_MINUTE_MS),
    length: 18,
    rev: 1,
  });
  assert.deepEqual(await store.load('id-1'), { meta: fromWindowB.meta, content: 'text from window B' });
  assert.equal((await store.load('id-2'))?.content, 'text from window A');
});

test('save keeps the text as a copy when the document was deleted elsewhere', async () => {
  const { store } = createHarness();
  const created = await store.create('memo', 'original');
  await store.remove('id-1');
  const outcome = await store.save(created, 'still being edited here');
  assert.equal(outcome.savedAsCopy, true);
  assert.equal((await store.load(outcome.meta.id))?.content, 'still being edited here');
});

test('save passes a failed write on instead of claiming success', async () => {
  const storage = createMemoryStorage();
  const { store } = createHarness({
    ...storage,
    saveDocument: async (draft, expectedRev) => {
      if (draft.content === 'will not fit') throw new StorageError('quota', 'full');
      return storage.saveDocument(draft, expectedRev);
    },
  });
  const created = await store.create('memo', 'v1');
  await assert.rejects(store.save(created, 'will not fit'), (error) => error instanceof StorageError && error.kind === 'quota');
  assert.equal((await store.load('id-1'))?.content, 'v1');
  assert.equal((await store.list()).documents.length, 1);
});

// --- rename / remove --------------------------------------------------------

test('rename changes only the title and counts as one revision', async () => {
  const { store, advance } = createHarness();
  const created = await store.create('old name', 'content stays');
  advance(ONE_MINUTE_MS);
  const renamed = await store.rename(created, '  new name ');
  // Renaming does not touch the content, so the modification time (used for sorting) stays put.
  assert.deepEqual(renamed, { ...created, title: 'new name', rev: 2 });
  assert.deepEqual(await store.load('id-1'), { meta: renamed, content: 'content stays' });
});

test('rename refuses an invalid title and leaves the document as it was', async () => {
  const { store } = createHarness();
  const created = await store.create('memo', 'text');
  await assert.rejects(store.rename(created, 'a\nb'), /title/i);
  assert.deepEqual((await store.load('id-1'))?.meta, created);
});

test('rename with stale metadata is a conflict and creates no copy', async () => {
  const { store } = createHarness();
  const created = await store.create('memo', 'v1');
  await store.save(created, 'v2 from another window');
  await assert.rejects(store.rename(created, 'new name'), (error) => error instanceof StorageError && error.kind === 'conflict');
  const listing = await store.list();
  assert.deepEqual(listing.documents.map((meta) => meta.title), ['memo']);
});

test('rename of a document that no longer exists is a conflict', async () => {
  const { store } = createHarness();
  const created = await store.create('memo', 'text');
  await store.remove('id-1');
  await assert.rejects(store.rename(created, 'new name'), (error) => error instanceof StorageError && error.kind === 'conflict');
});

test('remove deletes the document and reports whether it existed', async () => {
  const { store } = createHarness();
  await store.create('memo', 'text');
  assert.equal(await store.remove('id-1'), true);
  assert.equal(await store.remove('id-1'), false);
  assert.equal(await store.load('id-1'), undefined);
});

// --- list -------------------------------------------------------------------

test('list returns the most recently modified document first', async () => {
  const { store, advance } = createHarness();
  const oldest = await store.create('oldest', '');
  advance(ONE_MINUTE_MS);
  await store.create('middle', '');
  advance(ONE_MINUTE_MS);
  await store.create('newest', '');
  advance(ONE_MINUTE_MS);
  await store.save(oldest, 'edited last');
  const listing = await store.list();
  assert.deepEqual(listing.documents.map((meta) => meta.title), ['oldest', 'newest', 'middle']);
  assert.equal(listing.corruptCount, 0);
});

test('list orders documents with the same time by title so the order is stable', async () => {
  const { store } = createHarness();
  await store.create('b', '');
  await store.create('a', '');
  await store.create('c', '');
  assert.deepEqual((await store.list()).documents.map((meta) => meta.title), ['a', 'b', 'c']);
});

test('list reports how many damaged records the storage skipped', async () => {
  const storage = createMemoryStorage();
  const { store } = createHarness({ ...storage, listDocuments: async () => ({ documents: [], corruptCount: 3 }) });
  assert.deepEqual(await store.list(), { documents: [], corruptCount: 3 });
});

// --- createRandomId ---------------------------------------------------------

test('createRandomId uses crypto.randomUUID when the browser offers it', () => {
  const crypto = { randomUUID: () => 'from-random-uuid', getRandomValues: <T>(array: T): T => array };
  assert.equal(createRandomId(crypto), 'from-random-uuid');
});

test('createRandomId builds a version 4 UUID where randomUUID is missing', () => {
  // randomUUID exists only in secure contexts; a page opened via a LAN address does not have it.
  const fill = (value: number) => ({
    getRandomValues: <T>(array: T): T => {
      (array as unknown as Uint8Array).fill(value);
      return array;
    },
  });
  assert.equal(createRandomId(fill(0x00)), '00000000-0000-4000-8000-000000000000');
  assert.equal(createRandomId(fill(0xff)), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
});

test('createRandomId gives different ids on real randomness', () => {
  // Real randomness, but without randomUUID, to exercise the hand-built path.
  const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto) as RandomSource['getRandomValues'];
  const withoutRandomUuid: RandomSource = { getRandomValues };
  const first = createRandomId(withoutRandomUuid);
  const second = createRandomId(withoutRandomUuid);
  assert.match(first, UUID_V4_PATTERN);
  assert.match(second, UUID_V4_PATTERN);
  assert.notEqual(first, second);
});
