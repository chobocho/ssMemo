import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEGACY_MIGRATION_KEY, createLegacyImport, parseLegacyRecords, planLegacyImport } from '../../src/app/legacyImport.ts';
import type { LegacyImportNotice, LegacyMemo } from '../../src/app/legacyImport.ts';
import { MAX_TITLE_LENGTH } from '../../src/app/documentStore.ts';
import { createMemoryStorage } from '../../src/storage/memoryStorage.ts';
import { NEW_DOCUMENT_REV, StorageError } from '../../src/storage/storagePort.ts';
import type { StoragePort, StoredDocument } from '../../src/storage/storagePort.ts';

const OLD_TIME = '2025-06-01T10:00:00.000Z';
const NOW = new Date('2026-03-01T00:00:00.000Z');
const SINGLE_TITLE = 'Old single memo';

function record(key: string, content: unknown = 'text', updatedAt: unknown = OLD_TIME): unknown {
  return { key, content, updatedAt };
}

function stored(id: string, title: string, content: string): StoredDocument {
  return { meta: { id, title, createdAt: OLD_TIME, updatedAt: OLD_TIME, length: content.length, rev: 1 }, content };
}

function sequentialIds(): () => string {
  let next = 1;
  return () => `new-${next++}`;
}

// --- parseLegacyRecords -----------------------------------------------------

test('records whose key starts with "memo:" are memos, titled by the rest of the key', () => {
  const memos = parseLegacyRecords([record('memo:Shopping', 'milk'), record('memo:Ideas: 2025', 'tests')], SINGLE_TITLE);
  assert.deepEqual(memos, [
    { title: 'Shopping', content: 'milk', updatedAt: OLD_TIME },
    { title: 'Ideas: 2025', content: 'tests', updatedAt: OLD_TIME },
  ]);
});

test('the single memo of the earliest version is taken along under a title of its own', () => {
  assert.deepEqual(parseLegacyRecords([record('NOTEPAD', 'from long ago')], SINGLE_TITLE), [
    { title: SINGLE_TITLE, content: 'from long ago', updatedAt: OLD_TIME },
  ]);
});

test('what is not a memo is left out: calculator variables, other keys, damaged records', () => {
  const records = [
    record('__CALC_MEMORY__', '{"x":1}'),
    record('settings', 'something'),
    record('memo', 'no colon, so not a memo'),
    null,
    'text',
    7,
    [],
    { content: 'no key' },
    { key: 5, content: 'key is not text' },
    // Written out: passing undefined to record() would put the default text in.
    { key: 'memo:No text', updatedAt: OLD_TIME },
    record('memo:Text is a number', 12),
    record('memo:Kept', 'kept'),
  ];
  assert.deepEqual(parseLegacyRecords(records, SINGLE_TITLE).map((memo) => memo.title), ['Kept']);
});

test('empty memos are left out: the old app always kept one, even if nothing was ever written', () => {
  const memos = parseLegacyRecords([record('memo:Empty', ''), record('NOTEPAD', ''), record('memo:Blank lines', '\n \n')], SINGLE_TITLE);
  // Text made of blanks was typed by somebody and stays.
  assert.deepEqual(memos.map((memo) => memo.title), ['Blank lines']);
});

test('a time that cannot be read is dropped, the memo is kept', () => {
  for (const updatedAt of [null, undefined, 'yesterday', 1717236000000]) {
    // Written out for the same reason: record() would replace undefined by a valid time.
    const memos = parseLegacyRecords([{ key: 'memo:A', content: 'x', updatedAt }], SINGLE_TITLE);
    assert.deepEqual(memos, [{ title: 'A', content: 'x', updatedAt: undefined }], String(updatedAt));
  }
});

test('a title the new app would not accept is made acceptable', () => {
  const long = 'x'.repeat(MAX_TITLE_LENGTH + 50);
  const memos = parseLegacyRecords([record(`memo:${long}`), record('memo:two\nlines'), record('memo:'), record('memo:   ')], SINGLE_TITLE);
  assert.deepEqual(memos.map((memo) => memo.title), ['x'.repeat(MAX_TITLE_LENGTH), 'two lines', SINGLE_TITLE, SINGLE_TITLE]);
});

// --- planLegacyImport -------------------------------------------------------

const MEMOS: LegacyMemo[] = [
  { title: 'Shopping', content: 'milk', updatedAt: OLD_TIME },
  { title: 'Ideas', content: 'tests', updatedAt: undefined },
];

test('every memo that is not here yet becomes a new memo that keeps its time', () => {
  const plan = planLegacyImport(MEMOS, { existing: [], now: NOW, createId: sequentialIds() });
  assert.deepEqual(plan, {
    drafts: [
      { id: 'new-1', title: 'Shopping', content: 'milk', createdAt: OLD_TIME, updatedAt: OLD_TIME },
      // Without a time of its own it counts as changed now.
      { id: 'new-2', title: 'Ideas', content: 'tests', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() },
    ],
    unchanged: 0,
  });
});

test('a memo that is here already with the same title and text is not imported again', () => {
  const plan = planLegacyImport(MEMOS, { existing: [stored('a', 'Shopping', 'milk')], now: NOW, createId: sequentialIds() });
  assert.deepEqual(plan.drafts.map((draft) => draft.title), ['Ideas']);
  assert.equal(plan.unchanged, 1);
});

test('the same title with other text, or the same text under another title, is a memo of its own', () => {
  const existing = [stored('a', 'Shopping', 'milk and eggs'), stored('b', 'Other title', 'tests')];
  const plan = planLegacyImport(MEMOS, { existing, now: NOW, createId: sequentialIds() });
  assert.deepEqual(plan.drafts.map((draft) => draft.title), ['Shopping', 'Ideas']);
  assert.equal(plan.unchanged, 0);
  // Nothing that is stored gets a draft with its id: an import only ever adds.
  assert.deepEqual(plan.drafts.map((draft) => draft.id), ['new-1', 'new-2']);
});

test('two old records that are the same memo are imported once', () => {
  const twice: LegacyMemo[] = [
    { title: 'Same', content: 'x', updatedAt: OLD_TIME },
    { title: 'Same', content: 'x', updatedAt: undefined },
  ];
  const plan = planLegacyImport(twice, { existing: [], now: NOW, createId: sequentialIds() });
  assert.equal(plan.drafts.length, 1);
  assert.equal(plan.unchanged, 1);
});

test('nothing to import gives an empty plan', () => {
  assert.deepEqual(planLegacyImport([], { existing: [stored('a', 'A', 'x')], now: NOW, createId: sequentialIds() }), { drafts: [], unchanged: 0 });
});

// --- createLegacyImport -----------------------------------------------------

interface Harness {
  storage: StoragePort;
  notices: LegacyImportNotice[];
  /** What the user was asked, in order. */
  questions: { found: number; missing: number }[];
  steps: string[];
  run(): Promise<void>;
  migrateOnce(): Promise<void>;
  storedTitles(): Promise<string[]>;
}

interface Setup {
  records?: unknown[] | undefined;
  readFails?: boolean;
  answer?: boolean;
  storage?: StoragePort;
}

function createHarness(setup: Setup = {}): Harness {
  const storage = setup.storage ?? createMemoryStorage();
  const notices: LegacyImportNotice[] = [];
  const questions: { found: number; missing: number }[] = [];
  const steps: string[] = [];
  const legacyImport = createLegacyImport({
    storage,
    readRecords: async () => {
      steps.push('read');
      if (setup.readFails) throw new Error('blocked');
      return 'records' in setup ? setup.records : [record('memo:Shopping', 'milk'), record('memo:Ideas', 'tests')];
    },
    flushAll: async () => {
      steps.push('flush');
    },
    confirm: async (summary) => {
      steps.push('ask');
      questions.push(summary);
      return setup.answer ?? true;
    },
    onNotice: (notice) => notices.push(notice),
    now: () => NOW,
    createId: sequentialIds(),
    singleMemoTitle: SINGLE_TITLE,
  });
  return {
    storage,
    notices,
    questions,
    steps,
    run: () => legacyImport.run(),
    migrateOnce: () => legacyImport.migrateOnce(),
    storedTitles: async () => (await storage.listDocuments()).documents.map((meta) => meta.title).sort(),
  };
}

test('the memos of the old app are added after the user agreed', async () => {
  const harness = createHarness();
  await harness.run();
  assert.deepEqual(harness.questions, [{ found: 2, missing: 2 }]);
  assert.deepEqual(await harness.storedTitles(), ['Ideas', 'Shopping']);
  assert.deepEqual(harness.notices, [{ kind: 'legacy-imported', added: 2 }]);
  // Pending edits are written before what is stored is compared with what was found.
  assert.deepEqual(harness.steps, ['read', 'flush', 'ask']);
});

test('the memos that were already here stay as they are', async () => {
  const harness = createHarness();
  const mine = await harness.storage.saveDocument({ id: 'mine', title: 'Shopping', content: 'my own list', createdAt: OLD_TIME, updatedAt: OLD_TIME }, NEW_DOCUMENT_REV);
  await harness.run();
  assert.deepEqual(await harness.storage.getDocument('mine'), { meta: mine, content: 'my own list' });
  assert.deepEqual(await harness.storedTitles(), ['Ideas', 'Shopping', 'Shopping']);
});

test('backing out of the question imports nothing and says nothing', async () => {
  const harness = createHarness({ answer: false });
  await harness.run();
  assert.deepEqual(await harness.storedTitles(), []);
  assert.deepEqual(harness.notices, []);
});

test('importing a second time finds everything in place and does not even ask', async () => {
  const harness = createHarness();
  await harness.run();
  await harness.run();
  assert.equal(harness.questions.length, 1);
  assert.deepEqual(await harness.storedTitles(), ['Ideas', 'Shopping']);
  assert.deepEqual(harness.notices.at(-1), { kind: 'legacy-up-to-date', count: 2 });
});

test('the question tells how many of the memos are not here yet', async () => {
  const harness = createHarness();
  await harness.storage.saveDocument({ id: 'a', title: 'Shopping', content: 'milk', createdAt: OLD_TIME, updatedAt: OLD_TIME }, NEW_DOCUMENT_REV);
  await harness.run();
  assert.deepEqual(harness.questions, [{ found: 2, missing: 1 }]);
  assert.deepEqual(harness.notices, [{ kind: 'legacy-imported', added: 1 }]);
});

test('no old database, an empty one, or one without memos are all "nothing found"', async () => {
  for (const records of [undefined, [], [record('__CALC_MEMORY__', '{}'), record('memo:Empty', '')]]) {
    const harness = createHarness({ records });
    await harness.run();
    assert.deepEqual(harness.notices, [{ kind: 'legacy-nothing' }]);
    assert.deepEqual(harness.questions, []);
  }
});

test('an old database that cannot be read is reported, and nothing is changed', async () => {
  const harness = createHarness({ readFails: true });
  await harness.run();
  assert.deepEqual(harness.notices, [{ kind: 'legacy-failed' }]);
  assert.deepEqual(await harness.storedTitles(), []);
});

test('when the memos cannot be written, none of them is, and that is reported', async () => {
  const storage = createMemoryStorage();
  const harness = createHarness({
    storage: {
      ...storage,
      writeDocuments: async () => {
        throw new StorageError('quota', 'full');
      },
    },
  });
  await harness.run();
  assert.deepEqual(harness.notices, [{ kind: 'legacy-failed' }]);
  assert.deepEqual(await harness.storedTitles(), []);
});

test('all memos are written in one step', async () => {
  const storage = createMemoryStorage();
  const writes: number[] = [];
  const harness = createHarness({
    storage: {
      ...storage,
      writeDocuments: async (drafts, options) => {
        writes.push(drafts.length);
        assert.equal(options.replaceAll, false);
        return storage.writeDocuments(drafts, options);
      },
    },
  });
  await harness.run();
  assert.deepEqual(writes, [2]);
});

// --- migrateOnce ------------------------------------------------------------

test('at startup the memos of the old app come over without a question', async () => {
  const harness = createHarness();
  await harness.migrateOnce();
  assert.deepEqual(harness.questions, []);
  assert.deepEqual(await harness.storedTitles(), ['Ideas', 'Shopping']);
  assert.deepEqual(harness.notices, [{ kind: 'legacy-migrated', added: 2 }]);
  assert.deepEqual(harness.steps, ['read', 'flush']);
});

test('once migrated, a memo that was deleted here does not come back at the next start', async () => {
  const harness = createHarness();
  await harness.migrateOnce();
  const { documents } = await harness.storage.listDocuments();
  for (const meta of documents) await harness.storage.deleteDocument(meta.id);

  await harness.migrateOnce();
  assert.deepEqual(await harness.storedTitles(), []);
  assert.equal(harness.notices.length, 1);
  // The old database is not even opened again.
  assert.deepEqual(harness.steps, ['read', 'flush']);
});

test('memos that are here already are not doubled, and nothing is said', async () => {
  const storage = createMemoryStorage();
  await storage.saveDocument({ id: 'a', title: 'Shopping', content: 'milk', createdAt: OLD_TIME, updatedAt: OLD_TIME }, NEW_DOCUMENT_REV);
  await storage.saveDocument({ id: 'b', title: 'Ideas', content: 'tests', createdAt: OLD_TIME, updatedAt: OLD_TIME }, NEW_DOCUMENT_REV);
  const harness = createHarness({ storage });
  await harness.migrateOnce();
  assert.deepEqual(await harness.storedTitles(), ['Ideas', 'Shopping']);
  assert.deepEqual(harness.notices, []);
  assert.notEqual(await storage.getValue(LEGACY_MIGRATION_KEY), undefined);
});

test('where the old app left nothing, the migration stays open for a later start', async () => {
  for (const records of [undefined, [], [record('__CALC_MEMORY__', '{}')]]) {
    const harness = createHarness({ records });
    await harness.migrateOnce();
    assert.deepEqual(harness.notices, []);
    assert.equal(await harness.storage.getValue(LEGACY_MIGRATION_KEY), undefined);
  }
});

test('a failed migration is silent, changes nothing, and is tried again at the next start', async () => {
  const unreadable = createHarness({ readFails: true });
  await unreadable.migrateOnce();
  assert.deepEqual(unreadable.notices, []);
  assert.equal(await unreadable.storage.getValue(LEGACY_MIGRATION_KEY), undefined);

  const memory = createMemoryStorage();
  let failing = true;
  const storage: StoragePort = {
    ...memory,
    writeDocuments: (drafts, options) =>
      failing ? Promise.reject(new StorageError('quota', 'full')) : memory.writeDocuments(drafts, options),
  };
  const harness = createHarness({ storage });
  await harness.migrateOnce();
  assert.deepEqual(await harness.storedTitles(), []);
  assert.deepEqual(harness.notices, []);

  failing = false;
  await harness.migrateOnce();
  assert.deepEqual(await harness.storedTitles(), ['Ideas', 'Shopping']);
  assert.deepEqual(harness.notices, [{ kind: 'legacy-migrated', added: 2 }]);
});

test('the menu command still works after the migration, and finds everything in place', async () => {
  const harness = createHarness();
  await harness.migrateOnce();
  await harness.run();
  assert.deepEqual(harness.notices.at(-1), { kind: 'legacy-up-to-date', count: 2 });
});
