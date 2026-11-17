import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AutosaveState } from '../../src/app/autosave.ts';
import { createDocumentStore } from '../../src/app/documentStore.ts';
import { createMemoSession } from '../../src/app/memoSession.ts';
import type { MemoSession, SessionNotice } from '../../src/app/memoSession.ts';
import { createMemoryStorage } from '../../src/storage/memoryStorage.ts';
import { NEW_DOCUMENT_REV, StorageError } from '../../src/storage/storagePort.ts';
import type { DocumentDraft, StoragePort } from '../../src/storage/storagePort.ts';

const IDLE_DELAY_MS = 1000;
const MAX_WAIT_MS = 5000;
const START_TIME_MS = Date.UTC(2026, 0, 1);
const ONE_HOUR_MS = 3_600_000;

interface Harness {
  session: MemoSession;
  storage: StoragePort;
  /** The text currently shown in the (fake) editor. */
  editorText(): string;
  /** Simulates the user replacing the editor content. */
  type(text: string): void;
  notices: SessionNotice[];
  states: AutosaveState[];
  /** Runs due timers and lets the resulting saves finish. */
  advance(ms: number): Promise<void>;
}

function createHarness(storage: StoragePort = createMemoryStorage()): Harness {
  let nowMs = START_TIME_MS;
  let idCount = 0;
  let nextHandle = 1;
  let text = '';
  const scheduled = new Map<number, { at: number; callback: () => void }>();
  const notices: SessionNotice[] = [];
  const states: AutosaveState[] = [];

  const store = createDocumentStore({
    storage,
    now: () => new Date(nowMs),
    createId: () => `id-${(idCount += 1)}`,
    conflictCopyTitle: (title) => `${title} (copy)`,
  });

  const session = createMemoSession({
    store,
    editor: {
      getText: () => text,
      setText: (next) => {
        text = next;
      },
    },
    defaultTitle: 'New memo',
    idleDelayMs: IDLE_DELAY_MS,
    maxWaitMs: MAX_WAIT_MS,
    timers: {
      setTimeout: (callback, delayMs) => {
        const handle = nextHandle++;
        scheduled.set(handle, { at: nowMs + delayMs, callback });
        return handle;
      },
      clearTimeout: (handle) => {
        scheduled.delete(handle as number);
      },
    },
    onNotice: (notice) => notices.push(notice),
    onSaveStateChange: (state) => states.push(state),
  });

  return {
    session,
    storage,
    editorText: () => text,
    type(next) {
      text = next;
      session.handleEdit();
    },
    notices,
    states,
    async advance(ms) {
      const target = nowMs + ms;
      for (;;) {
        const due = [...scheduled.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort(([, left], [, right]) => left.at - right.at)[0];
        if (!due) break;
        const [handle, timer] = due;
        scheduled.delete(handle);
        nowMs = timer.at;
        timer.callback();
        await new Promise((resolve) => setImmediate(resolve));
      }
      nowMs = target;
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

function draft(id: string, title: string, content: string, updatedAtMs: number): DocumentDraft {
  const timestamp = new Date(updatedAtMs).toISOString();
  return { id, title, content, createdAt: timestamp, updatedAt: timestamp };
}

async function titlesAndContents(storage: StoragePort): Promise<[string, string][]> {
  const { documents } = await storage.listDocuments();
  const loaded = await Promise.all(documents.map((meta) => storage.getDocument(meta.id)));
  return loaded
    .map((document): [string, string] => [document?.meta.title ?? '', document?.content ?? ''])
    .sort(([left], [right]) => left.localeCompare(right));
}

// --- starting ---------------------------------------------------------------

test('starting on an empty storage shows an empty editor and creates nothing', async () => {
  const harness = createHarness();
  await harness.session.start();
  await harness.advance(ONE_HOUR_MS);
  assert.equal(harness.editorText(), '');
  assert.deepEqual((await harness.storage.listDocuments()).documents, []);
  assert.equal(harness.session.hasUnsavedChanges(), false);
  assert.deepEqual(harness.notices, []);
});

test('starting loads the most recently modified memo', async () => {
  const storage = createMemoryStorage();
  await storage.saveDocument(draft('old', 'old memo', 'older text', START_TIME_MS - 2 * ONE_HOUR_MS), NEW_DOCUMENT_REV);
  await storage.saveDocument(draft('new', 'new memo', 'newer text', START_TIME_MS - ONE_HOUR_MS), NEW_DOCUMENT_REV);
  const harness = createHarness(storage);
  await harness.session.start();
  assert.equal(harness.editorText(), 'newer text');
});

test('loading a memo is not treated as an edit', async () => {
  const storage = createMemoryStorage();
  const stored = await storage.saveDocument(draft('a', 'memo', 'stored text', START_TIME_MS - ONE_HOUR_MS), NEW_DOCUMENT_REV);
  const harness = createHarness(storage);
  await harness.session.start();
  await harness.advance(ONE_HOUR_MS);
  assert.equal(harness.session.hasUnsavedChanges(), false);
  assert.deepEqual((await storage.getDocument('a'))?.meta, stored);
  assert.deepEqual(harness.states, []);
});

test('starting skips a memo whose content is damaged and loads the next one', async () => {
  const storage = createMemoryStorage();
  await storage.saveDocument(draft('ok', 'readable', 'readable text', START_TIME_MS - 2 * ONE_HOUR_MS), NEW_DOCUMENT_REV);
  await storage.saveDocument(draft('bad', 'damaged', 'lost', START_TIME_MS - ONE_HOUR_MS), NEW_DOCUMENT_REV);
  const harness = createHarness({
    ...storage,
    getDocument: async (id) => (id === 'bad' ? undefined : storage.getDocument(id)),
  });
  await harness.session.start();
  assert.equal(harness.editorText(), 'readable text');
});

test('starting reports damaged records that the storage skipped', async () => {
  const storage = createMemoryStorage();
  const harness = createHarness({ ...storage, listDocuments: async () => ({ documents: [], corruptCount: 2 }) });
  await harness.session.start();
  assert.deepEqual(harness.notices, [{ kind: 'corrupt-records', count: 2 }]);
});

test('when loading fails the editor starts empty and existing memos are never overwritten', async () => {
  // ssMemoWeb showed an empty editor after a failed load and then saved it over the stored memo.
  const storage = createMemoryStorage();
  await storage.saveDocument(draft('a', 'precious', 'do not lose this', START_TIME_MS - ONE_HOUR_MS), NEW_DOCUMENT_REV);
  let listFails = true;
  const harness = createHarness({
    ...storage,
    listDocuments: async () => {
      if (listFails) throw new StorageError('write-failed', 'cannot read');
      return storage.listDocuments();
    },
  });
  await harness.session.start();
  assert.equal(harness.editorText(), '');
  assert.deepEqual(harness.notices, [{ kind: 'load-failed' }]);

  listFails = false;
  harness.type('typed after the failed load');
  await harness.advance(IDLE_DELAY_MS);
  assert.deepEqual(await titlesAndContents(storage), [
    ['New memo', 'typed after the failed load'],
    ['precious', 'do not lose this'],
  ]);
});

// --- saving -----------------------------------------------------------------

test('the first edit creates the memo, after the idle delay', async () => {
  const harness = createHarness();
  await harness.session.start();
  harness.type('first words');
  assert.equal(harness.session.hasUnsavedChanges(), true);
  await harness.advance(IDLE_DELAY_MS - 1);
  assert.deepEqual((await harness.storage.listDocuments()).documents, []);
  await harness.advance(1);
  assert.deepEqual(await titlesAndContents(harness.storage), [['New memo', 'first words']]);
  assert.equal(harness.session.hasUnsavedChanges(), false);
  assert.deepEqual(harness.states, ['pending', 'saving', 'saved']);
});

test('later edits update the same memo instead of creating more', async () => {
  const harness = createHarness();
  await harness.session.start();
  harness.type('one');
  await harness.advance(IDLE_DELAY_MS);
  harness.type('one two');
  await harness.advance(IDLE_DELAY_MS);
  harness.type('one two three');
  await harness.advance(IDLE_DELAY_MS);
  const { documents } = await harness.storage.listDocuments();
  assert.equal(documents.length, 1);
  assert.equal(documents[0]?.rev, 3);
  assert.deepEqual(await titlesAndContents(harness.storage), [['New memo', 'one two three']]);
});

test('edits to a loaded memo are saved back to that memo', async () => {
  const storage = createMemoryStorage();
  await storage.saveDocument(draft('a', 'memo', 'stored', START_TIME_MS - ONE_HOUR_MS), NEW_DOCUMENT_REV);
  const harness = createHarness(storage);
  await harness.session.start();
  harness.type('stored and edited');
  await harness.advance(IDLE_DELAY_MS);
  assert.deepEqual(await titlesAndContents(storage), [['memo', 'stored and edited']]);
});

test('flush saves at once', async () => {
  const harness = createHarness();
  await harness.session.start();
  harness.type('leaving now');
  await harness.session.flush();
  assert.deepEqual(await titlesAndContents(harness.storage), [['New memo', 'leaving now']]);
  assert.equal(harness.session.hasUnsavedChanges(), false);
});

// --- trouble while saving ---------------------------------------------------

test('when another window saved first, the text is kept as a copy and editing continues on the copy', async () => {
  const storage = createMemoryStorage();
  const original = await storage.saveDocument(draft('a', 'memo', 'v1', START_TIME_MS - ONE_HOUR_MS), NEW_DOCUMENT_REV);
  const harness = createHarness(storage);
  await harness.session.start();

  // Another window saves the same memo.
  await storage.saveDocument({ ...draft('a', 'memo', 'from the other window', START_TIME_MS), createdAt: original.createdAt }, original.rev);

  harness.type('from this window');
  await harness.advance(IDLE_DELAY_MS);
  assert.deepEqual(harness.notices, [{ kind: 'saved-as-copy', title: 'memo (copy)' }]);
  assert.deepEqual(await titlesAndContents(storage), [
    ['memo', 'from the other window'],
    ['memo (copy)', 'from this window'],
  ]);

  // Further typing goes to the copy; no second copy is made.
  harness.type('from this window, continued');
  await harness.advance(IDLE_DELAY_MS);
  assert.deepEqual(await titlesAndContents(storage), [
    ['memo', 'from the other window'],
    ['memo (copy)', 'from this window, continued'],
  ]);
  assert.equal(harness.notices.length, 1);
});

test('a failed save is reported with its reason and the text stays unsaved', async () => {
  const storage = createMemoryStorage();
  const failures: StorageError[] = [
    new StorageError('quota', 'full'),
    new StorageError('connection-lost', 'closed'),
    new StorageError('write-failed', 'aborted'),
  ];
  const harness = createHarness({
    ...storage,
    saveDocument: async () => {
      throw failures.shift() ?? new Error('unexpected');
    },
  });
  await harness.session.start();

  for (const reason of ['quota', 'connection-lost', 'other'] as const) {
    harness.type(`attempt ${reason}`);
    await harness.advance(IDLE_DELAY_MS);
    assert.deepEqual(harness.notices.at(-1), { kind: 'save-failed', reason });
    assert.equal(harness.session.hasUnsavedChanges(), true);
    assert.equal(harness.states.at(-1), 'failed');
  }
  assert.deepEqual((await storage.listDocuments()).documents, []);
});

test('saving succeeds again once the storage recovers', async () => {
  const storage = createMemoryStorage();
  let broken = true;
  const harness = createHarness({
    ...storage,
    saveDocument: async (document, expectedRev) => {
      if (broken) throw new StorageError('write-failed', 'aborted');
      return storage.saveDocument(document, expectedRev);
    },
  });
  await harness.session.start();
  harness.type('first try');
  await harness.advance(IDLE_DELAY_MS);
  broken = false;
  harness.type('second try');
  await harness.advance(IDLE_DELAY_MS);
  assert.deepEqual(await titlesAndContents(storage), [['New memo', 'second try']]);
  assert.equal(harness.session.hasUnsavedChanges(), false);
});
