import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AutosaveState } from '../../src/app/autosave.ts';
import { MAX_TITLE_LENGTH, createDocumentStore } from '../../src/app/documentStore.ts';
import { createSessionStore } from '../../src/app/session.ts';
import type { SessionState } from '../../src/app/session.ts';
import { createTabManager } from '../../src/app/tabManager.ts';
import type { TabManager } from '../../src/app/tabManager.ts';
import { createWorkspace } from '../../src/app/workspace.ts';
import type { Workspace, WorkspaceNotice } from '../../src/app/workspace.ts';
import type { WritableFile } from '../../src/app/localFiles.ts';
import { createMemoryStorage } from '../../src/storage/memoryStorage.ts';
import { NEW_DOCUMENT_REV, StorageError } from '../../src/storage/storagePort.ts';
import type { DocumentDraft, DocumentSource, StoragePort } from '../../src/storage/storagePort.ts';

const IDLE_DELAY_MS = 1000;
const MAX_WAIT_MS = 5000;
const START_TIME_MS = Date.UTC(2026, 0, 1);
const ONE_HOUR_MS = 3_600_000;
const DEFAULT_TITLE = 'New memo';

interface Harness {
  workspace: Workspace;
  storage: StoragePort;
  tabs: TabManager;
  /** Id of the tab the (fake) editor is showing. */
  visibleTab(): string | undefined;
  visibleText(): string | undefined;
  /** Simulates the user replacing the content of the visible tab. */
  type(text: string): void;
  /** Simulates moving the cursor in the visible tab. */
  moveCursor(position: number): void;
  notices: WorkspaceNotice[];
  /** Save states reported for the active tab, in order. */
  saveStates: (AutosaveState | undefined)[];
  titles(): string[];
  session(): Promise<SessionState>;
  /** Runs due timers and lets the resulting saves finish. */
  advance(ms: number): Promise<void>;
}

function createHarness(storage: StoragePort = createMemoryStorage(), maxTabs?: number): Harness {
  let nowMs = START_TIME_MS;
  let idCount = 0;
  let tabCount = 0;
  let nextHandle = 1;
  let visible: string | undefined;
  const texts = new Map<string, string>();
  const cursors = new Map<string, number>();
  const scheduled = new Map<number, { at: number; callback: () => void }>();
  const notices: WorkspaceNotice[] = [];
  const saveStates: (AutosaveState | undefined)[] = [];

  const tabs = createTabManager(maxTabs);
  const sessionStore = createSessionStore(storage);
  const workspace = createWorkspace({
    store: createDocumentStore({
      storage,
      now: () => new Date(nowMs),
      createId: () => `doc-${(idCount += 1)}`,
      conflictCopyTitle: (title) => `${title} (copy)`,
    }),
    sessionStore,
    tabs,
    // Behaves like the real per-tab editor: a tab's text exists once it has been shown.
    editor: {
      show(tabId, initialText, initialCursor = 0) {
        if (!texts.has(tabId)) {
          texts.set(tabId, initialText);
          cursors.set(tabId, Math.min(Math.max(initialCursor, 0), initialText.length));
        }
        visible = tabId;
      },
      getText: (tabId) => texts.get(tabId),
      getCursor: (tabId) => cursors.get(tabId),
      // Like the real editor: new content, cursor at the start, and no edit is reported.
      replace(tabId, text) {
        if (!texts.has(tabId)) return;
        texts.set(tabId, text);
        cursors.set(tabId, 0);
      },
      remove(tabId) {
        texts.delete(tabId);
        cursors.delete(tabId);
        if (visible === tabId) visible = undefined;
      },
    },
    createTabId: () => `tab-${(tabCount += 1)}`,
    defaultTitle: DEFAULT_TITLE,
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
    onSaveStateChange: (state) => saveStates.push(state),
  });

  const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  return {
    workspace,
    storage,
    tabs,
    visibleTab: () => visible,
    visibleText: () => (visible === undefined ? undefined : texts.get(visible)),
    type(text) {
      assert.ok(visible, 'no tab is visible');
      texts.set(visible, text);
      workspace.handleEdit(visible);
    },
    moveCursor(position) {
      assert.ok(visible, 'no tab is visible');
      cursors.set(visible, position);
    },
    notices,
    saveStates,
    titles: () => tabs.getTabs().map((tab) => tab.title),
    session: () => sessionStore.load(),
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
        await settle();
      }
      nowMs = target;
      await settle();
    },
  };
}

function draft(id: string, title: string, content: string, updatedAtMs: number): DocumentDraft {
  const timestamp = new Date(updatedAtMs).toISOString();
  return { id, title, content, createdAt: timestamp, updatedAt: timestamp };
}

/** Stores memos "older", "newer" (most recent) and returns the storage. */
async function storageWithTwoMemos(): Promise<StoragePort> {
  const storage = createMemoryStorage();
  await storage.saveDocument(draft('older', 'older memo', 'older text', START_TIME_MS - 2 * ONE_HOUR_MS), NEW_DOCUMENT_REV);
  await storage.saveDocument(draft('newer', 'newer memo', 'newer text', START_TIME_MS - ONE_HOUR_MS), NEW_DOCUMENT_REV);
  return storage;
}

async function stored(storage: StoragePort): Promise<[string, string][]> {
  const { documents } = await storage.listDocuments();
  const loaded = await Promise.all(documents.map((meta) => storage.getDocument(meta.id)));
  return loaded
    .map((document): [string, string] => [document?.meta.title ?? '', document?.content ?? ''])
    .sort(([left], [right]) => left.localeCompare(right));
}

function isConflict(error: unknown): boolean {
  return error instanceof StorageError && error.kind === 'conflict';
}

// --- starting ---------------------------------------------------------------

test('starting on an empty storage opens one blank tab and stores nothing', async () => {
  const harness = createHarness();
  await harness.workspace.start();
  await harness.advance(ONE_HOUR_MS);
  assert.deepEqual(harness.titles(), [DEFAULT_TITLE]);
  assert.equal(harness.visibleText(), '');
  assert.deepEqual((await harness.storage.listDocuments()).documents, []);
  assert.equal(harness.workspace.hasUnsavedChanges(), false);
  assert.deepEqual(harness.notices, []);
});

test('starting without a session opens the most recently modified memo', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  assert.deepEqual(harness.titles(), ['newer memo']);
  assert.equal(harness.visibleText(), 'newer text');
});

test('starting restores the tabs, their order, the active tab and the cursor of the last visit', async () => {
  const storage = await storageWithTwoMemos();
  await createSessionStore(storage).save({
    tabs: [
      { documentId: 'newer', cursor: 2 },
      { documentId: 'older', cursor: 5 },
    ],
    activeDocumentId: 'older',
  });
  const harness = createHarness(storage);
  await harness.workspace.start();
  assert.deepEqual(harness.titles(), ['newer memo', 'older memo']);
  assert.equal(harness.visibleText(), 'older text');
  assert.equal(harness.tabs.getActiveId(), harness.visibleTab());
  assert.equal((await harness.session()).tabs[1]?.cursor, 5);
});

test('starting skips session tabs whose memo no longer exists', async () => {
  const storage = await storageWithTwoMemos();
  await createSessionStore(storage).save({
    tabs: [
      { documentId: 'deleted-elsewhere', cursor: 0 },
      { documentId: 'older', cursor: 0 },
    ],
    activeDocumentId: 'deleted-elsewhere',
  });
  const harness = createHarness(storage);
  await harness.workspace.start();
  assert.deepEqual(harness.titles(), ['older memo']);
  assert.equal(harness.visibleText(), 'older text');
  assert.deepEqual(harness.notices, []);
});

test('starting falls back to the most recent memo when no session tab can be restored', async () => {
  const storage = await storageWithTwoMemos();
  await createSessionStore(storage).save({ tabs: [{ documentId: 'gone', cursor: 0 }], activeDocumentId: 'gone' });
  const harness = createHarness(storage);
  await harness.workspace.start();
  assert.deepEqual(harness.titles(), ['newer memo']);
});

test('loading memos is not treated as editing them', async () => {
  const storage = await storageWithTwoMemos();
  const before = await storage.listDocuments();
  const harness = createHarness(storage);
  await harness.workspace.start();
  await harness.advance(ONE_HOUR_MS);
  assert.deepEqual(await storage.listDocuments(), before);
  assert.equal(harness.workspace.hasUnsavedChanges(), false);
  assert.deepEqual(harness.tabs.getTabs().map((tab) => tab.dirty), [false]);
});

test('starting reports damaged records that the storage skipped', async () => {
  const storage = createMemoryStorage();
  const harness = createHarness({ ...storage, listDocuments: async () => ({ documents: [], corruptCount: 2 }) });
  await harness.workspace.start();
  assert.deepEqual(harness.notices, [{ kind: 'corrupt-records', count: 2 }]);
  assert.deepEqual(harness.titles(), [DEFAULT_TITLE]);
});

test('when loading fails, a blank tab is opened and stored memos are never overwritten', async () => {
  // ssMemoWeb showed an empty editor after a failed load and then saved it over the stored memo.
  const storage = await storageWithTwoMemos();
  let broken = true;
  const harness = createHarness({
    ...storage,
    listDocuments: async () => {
      if (broken) throw new StorageError('write-failed', 'cannot read');
      return storage.listDocuments();
    },
  });
  await harness.workspace.start();
  assert.deepEqual(harness.notices, [{ kind: 'load-failed' }]);
  assert.equal(harness.visibleText(), '');

  broken = false;
  harness.type('typed after the failed load');
  await harness.advance(IDLE_DELAY_MS);
  assert.deepEqual(await stored(storage), [
    [DEFAULT_TITLE, 'typed after the failed load'],
    ['newer memo', 'newer text'],
    ['older memo', 'older text'],
  ]);
});

// --- editing and saving -----------------------------------------------------

test('the first edit in a blank tab creates its memo after the idle delay', async () => {
  const harness = createHarness();
  await harness.workspace.start();
  harness.type('first words');
  assert.deepEqual(harness.tabs.getTabs().map((tab) => tab.dirty), [true]);
  await harness.advance(IDLE_DELAY_MS - 1);
  assert.deepEqual((await harness.storage.listDocuments()).documents, []);
  await harness.advance(1);
  assert.deepEqual(await stored(harness.storage), [[DEFAULT_TITLE, 'first words']]);
  assert.deepEqual(harness.tabs.getTabs().map((tab) => tab.dirty), [false]);
  assert.deepEqual(harness.saveStates, ['pending', 'saving', 'saved']);
  // The new memo is now part of the session, so a reload brings it back.
  assert.deepEqual((await harness.session()).tabs.map((tab) => tab.documentId), ['doc-1']);
});

test('later edits update the same memo instead of creating more', async () => {
  const harness = createHarness();
  await harness.workspace.start();
  for (const text of ['one', 'one two', 'one two three']) {
    harness.type(text);
    await harness.advance(IDLE_DELAY_MS);
  }
  const { documents } = await harness.storage.listDocuments();
  assert.equal(documents.length, 1);
  assert.equal(documents[0]?.rev, 3);
  assert.deepEqual(await stored(harness.storage), [[DEFAULT_TITLE, 'one two three']]);
});

test('each tab saves to its own memo, and leaving a tab saves it at once', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  await harness.workspace.openMemo('older');
  harness.type('older text, edited');

  const [newerTab] = harness.tabs.getTabs();
  assert.ok(newerTab);
  harness.workspace.activateTab(newerTab.id);
  // No timer has fired yet: switching away is what saved it.
  await harness.advance(0);
  assert.equal((await harness.storage.getDocument('older'))?.content, 'older text, edited');

  harness.type('newer text, edited');
  await harness.advance(IDLE_DELAY_MS);
  assert.deepEqual(await stored(harness.storage), [
    ['newer memo', 'newer text, edited'],
    ['older memo', 'older text, edited'],
  ]);
});

test('the reported save state is always that of the active tab', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  harness.type('newer text, edited');
  await harness.advance(IDLE_DELAY_MS);
  assert.deepEqual(harness.saveStates, ['pending', 'saving', 'saved']);

  // A tab that was never edited has no save state to show.
  await harness.workspace.openMemo('older');
  assert.equal(harness.saveStates.at(-1), undefined);

  const [newerTab] = harness.tabs.getTabs();
  assert.ok(newerTab);
  harness.workspace.activateTab(newerTab.id);
  assert.equal(harness.saveStates.at(-1), 'saved');
});

test('when another window saved first, the text is kept as a copy and the tab follows the copy', async () => {
  const storage = await storageWithTwoMemos();
  const harness = createHarness(storage);
  await harness.workspace.start();
  const original = await storage.getDocument('newer');
  assert.ok(original);
  await storage.saveDocument({ ...draft('newer', 'newer memo', 'from the other window', START_TIME_MS), createdAt: original.meta.createdAt }, original.meta.rev);

  harness.type('from this window');
  await harness.advance(IDLE_DELAY_MS);
  assert.deepEqual(harness.notices, [{ kind: 'saved-as-copy', title: 'newer memo (copy)' }]);
  assert.deepEqual(harness.titles(), ['newer memo (copy)']);
  assert.equal((await storage.getDocument('newer'))?.content, 'from the other window');

  harness.type('from this window, continued');
  await harness.advance(IDLE_DELAY_MS);
  assert.equal(harness.notices.length, 1);
  assert.equal((await storage.listDocuments()).documents.length, 3);
});

test('a failed save is reported with its reason and the tab stays unsaved', async () => {
  const storage = createMemoryStorage();
  const failures = [new StorageError('quota', 'full'), new StorageError('connection-lost', 'closed'), new StorageError('write-failed', 'x')];
  const harness = createHarness({
    ...storage,
    saveDocument: async () => {
      throw failures.shift() ?? new Error('unexpected');
    },
  });
  await harness.workspace.start();
  for (const reason of ['quota', 'connection-lost', 'other'] as const) {
    harness.type(`attempt ${reason}`);
    await harness.advance(IDLE_DELAY_MS);
    assert.deepEqual(harness.notices.at(-1), { kind: 'save-failed', reason });
    assert.equal(harness.workspace.hasUnsavedChanges(), true);
    assert.equal(harness.saveStates.at(-1), 'failed');
    assert.deepEqual(harness.tabs.getTabs().map((tab) => tab.dirty), [true]);
  }
});

test('flushAll saves every tab with pending changes at once', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  harness.type('newer, edited');
  harness.workspace.newMemo();
  harness.type('brand new');
  await harness.workspace.flushAll();
  assert.deepEqual(await stored(harness.storage), [
    [DEFAULT_TITLE, 'brand new'],
    ['newer memo', 'newer, edited'],
    ['older memo', 'older text'],
  ]);
  assert.equal(harness.workspace.hasUnsavedChanges(), false);
});

// --- tabs -------------------------------------------------------------------

test('newMemo adds a blank tab and shows it', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  assert.equal(harness.workspace.newMemo(), true);
  assert.deepEqual(harness.titles(), ['newer memo', DEFAULT_TITLE]);
  assert.equal(harness.visibleText(), '');
  assert.equal(harness.tabs.getActiveId(), harness.visibleTab());
});

test('at the tab limit nothing more is opened and the user is told', async () => {
  const harness = createHarness(await storageWithTwoMemos(), 1);
  await harness.workspace.start();
  assert.equal(harness.workspace.newMemo(), false);
  assert.equal(await harness.workspace.openMemo('older'), false);
  assert.deepEqual(harness.titles(), ['newer memo']);
  assert.deepEqual(harness.notices, [{ kind: 'tab-limit' }, { kind: 'tab-limit' }]);
  assert.equal(harness.visibleText(), 'newer text');
});

test('openMemo opens a memo in a new tab, or switches to the tab it is already in', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  assert.equal(await harness.workspace.openMemo('older'), true);
  assert.deepEqual(harness.titles(), ['newer memo', 'older memo']);
  assert.equal(harness.visibleText(), 'older text');

  const [newerTab] = harness.tabs.getTabs();
  assert.ok(newerTab);
  harness.workspace.activateTab(newerTab.id);
  assert.equal(await harness.workspace.openMemo('older'), true);
  assert.deepEqual(harness.titles(), ['newer memo', 'older memo']);
  assert.equal(harness.visibleText(), 'older text');
});

test('openMemo reports a memo that no longer exists', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  assert.equal(await harness.workspace.openMemo('gone'), false);
  assert.deepEqual(harness.notices, [{ kind: 'memo-missing' }]);
  assert.deepEqual(harness.titles(), ['newer memo']);
});

test('closeTab saves pending changes first and shows the neighbouring tab', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  await harness.workspace.openMemo('older');
  harness.type('older text, edited just before closing');
  const olderTab = harness.visibleTab();
  assert.ok(olderTab);

  assert.equal(await harness.workspace.closeTab(olderTab), 'closed');
  assert.equal((await harness.storage.getDocument('older'))?.content, 'older text, edited just before closing');
  assert.deepEqual(harness.titles(), ['newer memo']);
  assert.equal(harness.visibleText(), 'newer text');
});

test('closing the last tab leaves a fresh blank tab', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  const onlyTab = harness.visibleTab();
  assert.ok(onlyTab);
  assert.equal(await harness.workspace.closeTab(onlyTab), 'closed');
  assert.deepEqual(harness.titles(), [DEFAULT_TITLE]);
  assert.equal(harness.visibleText(), '');
  assert.notEqual(harness.visibleTab(), onlyTab);
});

test('closing an untouched blank tab creates no memo', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  harness.workspace.newMemo();
  const blankTab = harness.visibleTab();
  assert.ok(blankTab);
  assert.equal(await harness.workspace.closeTab(blankTab), 'closed');
  await harness.advance(ONE_HOUR_MS);
  assert.equal((await harness.storage.listDocuments()).documents.length, 2);
});

test('a tab whose changes cannot be saved is not closed unless the caller insists', async () => {
  const storage = await storageWithTwoMemos();
  const harness = createHarness({
    ...storage,
    saveDocument: async () => {
      throw new StorageError('quota', 'full');
    },
  });
  await harness.workspace.start();
  harness.type('cannot be stored');
  const tab = harness.visibleTab();
  assert.ok(tab);

  assert.equal(await harness.workspace.closeTab(tab), 'unsaved');
  assert.deepEqual(harness.titles(), ['newer memo']);
  assert.equal(harness.visibleText(), 'cannot be stored');

  // The user confirmed that the changes may be lost.
  assert.equal(await harness.workspace.closeTab(tab, true), 'closed');
  assert.deepEqual(harness.titles(), [DEFAULT_TITLE]);
  assert.equal(harness.workspace.hasUnsavedChanges(), false);
});

test('closeTab ignores an unknown tab', async () => {
  const harness = createHarness();
  await harness.workspace.start();
  assert.equal(await harness.workspace.closeTab('no-such-tab'), 'closed');
  assert.deepEqual(harness.titles(), [DEFAULT_TITLE]);
});

// --- managing memos ---------------------------------------------------------

test('listMemos returns the stored memos, most recent first', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  const listing = await harness.workspace.listMemos();
  assert.deepEqual(listing.documents.map((meta) => meta.title), ['newer memo', 'older memo']);
});

test('renameMemo renames an open memo, updates its tab and keeps unsaved edits', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  harness.type('newer text with unsaved edits');
  await harness.workspace.renameMemo('newer', 'renamed');
  assert.deepEqual(harness.titles(), ['renamed']);
  assert.deepEqual(await harness.storage.getDocument('newer').then((document) => [document?.meta.title, document?.content]), [
    'renamed',
    'newer text with unsaved edits',
  ]);
  // Saving afterwards must not see its own rename as a conflict.
  harness.type('typed after renaming');
  await harness.advance(IDLE_DELAY_MS);
  assert.deepEqual(harness.notices, []);
  assert.equal((await harness.storage.listDocuments()).documents.length, 2);
});

test('renameMemo renames a memo that is not open in any tab', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  await harness.workspace.renameMemo('older', 'archived');
  assert.equal((await harness.storage.getDocument('older'))?.meta.title, 'archived');
  assert.deepEqual(harness.titles(), ['newer memo']);
});

test('renameMemo rejects when the memo no longer exists', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  await assert.rejects(harness.workspace.renameMemo('gone', 'whatever'), isConflict);
});

test('deleteMemo removes an open memo, closes its tab, and pending edits do not bring it back', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  await harness.workspace.openMemo('older');
  harness.type('edited right before deleting');

  assert.equal(await harness.workspace.deleteMemo('older'), true);
  await harness.advance(ONE_HOUR_MS);
  assert.deepEqual(harness.titles(), ['newer memo']);
  assert.equal(harness.visibleText(), 'newer text');
  assert.deepEqual(await stored(harness.storage), [['newer memo', 'newer text']]);
  assert.deepEqual(harness.notices, []);
});

test('deleteMemo removes a memo that is not open and reports an unknown one', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  assert.equal(await harness.workspace.deleteMemo('older'), true);
  assert.equal(await harness.workspace.deleteMemo('older'), false);
  assert.deepEqual(await stored(harness.storage), [['newer memo', 'newer text']]);
  assert.deepEqual(harness.titles(), ['newer memo']);
});

// --- session ----------------------------------------------------------------

test('the session follows opening, switching and closing tabs', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  await harness.workspace.openMemo('older');
  assert.deepEqual(await harness.session(), {
    tabs: [
      { documentId: 'newer', cursor: 0 },
      { documentId: 'older', cursor: 0 },
    ],
    activeDocumentId: 'older',
  });

  const [newerTab, olderTab] = harness.tabs.getTabs();
  assert.ok(newerTab && olderTab);
  harness.workspace.activateTab(newerTab.id);
  await harness.advance(0);
  assert.equal((await harness.session()).activeDocumentId, 'newer');

  await harness.workspace.closeTab(olderTab.id);
  assert.deepEqual((await harness.session()).tabs.map((tab) => tab.documentId), ['newer']);
});

test('flushAll records where the cursor is in each tab', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  harness.moveCursor(4);
  await harness.workspace.flushAll();
  assert.deepEqual((await harness.session()).tabs, [{ documentId: 'newer', cursor: 4 }]);
});

test('a blank tab that was never saved is not part of the session', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  harness.workspace.newMemo();
  await harness.workspace.flushAll();
  const session = await harness.session();
  assert.deepEqual(session.tabs.map((tab) => tab.documentId), ['newer']);
  assert.equal(session.activeDocumentId, undefined);
});

// --- local files ------------------------------------------------------------

const FILE_SOURCE: DocumentSource = { fileName: 'notes.txt', encoding: 'CP949', eol: 'crlf', hasBom: false };

test('openFile shows the file in a new tab named after it', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  assert.equal(harness.workspace.openFile({ text: 'file text', source: FILE_SOURCE }), true);
  assert.deepEqual(harness.titles(), ['newer memo', 'notes.txt']);
  assert.equal(harness.visibleText(), 'file text');
  assert.equal(harness.tabs.getActiveId(), harness.visibleTab());
  assert.equal(harness.tabs.getTabs()[1]?.dirty, false);
  assert.equal(harness.workspace.hasUnsavedChanges(), false);
});

test('a file that is only looked at is not stored and not part of the session', async () => {
  const harness = createHarness();
  await harness.workspace.start();
  harness.workspace.openFile({ text: 'file text', source: FILE_SOURCE });
  await harness.advance(ONE_HOUR_MS);
  await harness.workspace.flushAll();
  assert.deepEqual((await harness.storage.listDocuments()).documents, []);
  assert.deepEqual((await harness.session()).tabs, []);
});

test('editing an opened file stores it as a document that remembers the file', async () => {
  const harness = createHarness();
  await harness.workspace.start();
  harness.workspace.openFile({ text: 'file text', source: FILE_SOURCE });
  harness.type('file text, edited');
  await harness.advance(IDLE_DELAY_MS);

  const { documents } = await harness.storage.listDocuments();
  assert.equal(documents.length, 1);
  assert.equal(documents[0]?.title, 'notes.txt');
  assert.deepEqual(documents[0]?.source, FILE_SOURCE);
  assert.deepEqual(await stored(harness.storage), [['notes.txt', 'file text, edited']]);
  assert.deepEqual((await harness.session()).tabs.map((tab) => tab.documentId), [documents[0]?.id]);
});

test('a stored file document keeps its source through later visits and edits', async () => {
  const storage = createMemoryStorage();
  const first = createHarness(storage);
  await first.workspace.start();
  first.workspace.openFile({ text: 'v1', source: FILE_SOURCE });
  first.type('v2');
  await first.workspace.flushAll();

  const second = createHarness(storage);
  await second.workspace.start();
  assert.deepEqual(second.titles(), ['notes.txt']);
  assert.equal(second.visibleText(), 'v2');
  second.type('v3');
  await second.workspace.flushAll();
  const { documents } = await storage.listDocuments();
  assert.equal(documents.length, 1);
  assert.deepEqual(documents[0]?.source, FILE_SOURCE);
});

test('openFile saves the tab that was showing before', async () => {
  const harness = createHarness();
  await harness.workspace.start();
  harness.type('typed into the memo');
  harness.workspace.openFile({ text: 'file text', source: FILE_SOURCE });
  await harness.advance(0);
  assert.deepEqual(await stored(harness.storage), [[DEFAULT_TITLE, 'typed into the memo']]);
});

test('openFile at the tab limit opens nothing and the user is told', async () => {
  const harness = createHarness(createMemoryStorage(), 1);
  await harness.workspace.start();
  assert.equal(harness.workspace.openFile({ text: 'file text', source: FILE_SOURCE }), false);
  assert.deepEqual(harness.titles(), [DEFAULT_TITLE]);
  assert.deepEqual(harness.notices, [{ kind: 'tab-limit' }]);
});

test('a file name that cannot be a title is fitted, and the source keeps the real name', async () => {
  const harness = createHarness();
  await harness.workspace.start();
  const longName = `${'n'.repeat(300)}.txt`;
  harness.workspace.openFile({ text: 'a', source: { ...FILE_SOURCE, fileName: longName } });
  harness.workspace.openFile({ text: 'b', source: { ...FILE_SOURCE, fileName: '   ' } });
  assert.deepEqual(harness.titles().slice(1), ['n'.repeat(MAX_TITLE_LENGTH), DEFAULT_TITLE]);

  harness.type('b, edited');
  harness.workspace.activateTab(harness.tabs.getTabs()[1]?.id ?? '');
  harness.type('a, edited');
  await harness.workspace.flushAll();
  const sources = (await harness.storage.listDocuments()).documents.map((meta) => meta.source?.fileName).sort();
  assert.deepEqual(sources, ['   ', longName]);
});

// --- the visible document and its encoding -----------------------------------

const FILE_BYTES = new Uint8Array([0xbe, 0xc8, 0xb3, 0xe7]);

test('getActiveDocument describes a memo tab as having no file', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  assert.deepEqual(harness.workspace.getActiveDocument(), {
    tabId: harness.visibleTab(),
    title: 'newer memo',
    source: undefined,
    originalBytes: undefined,
    localFile: undefined,
  });
});

test('getActiveDocument describes a freshly opened file with its source and bytes', async () => {
  const harness = createHarness();
  await harness.workspace.start();
  harness.workspace.openFile({ text: 'file text', source: FILE_SOURCE, bytes: FILE_BYTES });
  const active = harness.workspace.getActiveDocument();
  assert.equal(active?.title, 'notes.txt');
  assert.deepEqual(active?.source, FILE_SOURCE);
  assert.equal(active?.originalBytes, FILE_BYTES);
});

test('the bytes of a file are let go as soon as its text is edited', async () => {
  const harness = createHarness();
  await harness.workspace.start();
  harness.workspace.openFile({ text: 'file text', source: FILE_SOURCE, bytes: FILE_BYTES });
  harness.type('file text, edited');
  const active = harness.workspace.getActiveDocument();
  assert.equal(active?.originalBytes, undefined);
  assert.deepEqual(active?.source, FILE_SOURCE);
});

test('a file restored from an earlier visit has its source but no bytes', async () => {
  const storage = createMemoryStorage();
  const first = createHarness(storage);
  await first.workspace.start();
  first.workspace.openFile({ text: 'v1', source: FILE_SOURCE, bytes: FILE_BYTES });
  first.type('v2');
  await first.workspace.flushAll();

  const second = createHarness(storage);
  await second.workspace.start();
  const active = second.workspace.getActiveDocument();
  assert.deepEqual(active?.source, FILE_SOURCE);
  assert.equal(active?.originalBytes, undefined);
});

test('redecode replaces the text and the source of an untouched file without storing anything', async () => {
  const harness = createHarness();
  await harness.workspace.start();
  harness.workspace.openFile({ text: 'garbled', source: FILE_SOURCE, bytes: FILE_BYTES });
  const tabId = harness.visibleTab() ?? '';
  const utf8Source: DocumentSource = { ...FILE_SOURCE, encoding: 'UTF-8' };

  assert.equal(harness.workspace.redecode(tabId, 'readable', utf8Source), true);
  assert.equal(harness.visibleText(), 'readable');
  const active = harness.workspace.getActiveDocument();
  assert.deepEqual(active?.source, utf8Source);
  // Still the same bytes, so yet another encoding can be tried.
  assert.equal(active?.originalBytes, FILE_BYTES);
  await harness.advance(ONE_HOUR_MS);
  assert.equal(harness.workspace.hasUnsavedChanges(), false);
  assert.deepEqual((await harness.storage.listDocuments()).documents, []);
});

test('after redecode, the first edit stores the new text with the new source', async () => {
  const harness = createHarness();
  await harness.workspace.start();
  harness.workspace.openFile({ text: 'garbled', source: FILE_SOURCE, bytes: FILE_BYTES });
  const utf8Source: DocumentSource = { ...FILE_SOURCE, encoding: 'UTF-8' };
  harness.workspace.redecode(harness.visibleTab() ?? '', 'readable', utf8Source);
  harness.type('readable, edited');
  await harness.workspace.flushAll();
  const { documents } = await harness.storage.listDocuments();
  assert.deepEqual(documents[0]?.source, utf8Source);
  assert.deepEqual(await stored(harness.storage), [['notes.txt', 'readable, edited']]);
});

test('redecode is refused once the file was edited, so the edits are not thrown away', async () => {
  const harness = createHarness();
  await harness.workspace.start();
  harness.workspace.openFile({ text: 'file text', source: FILE_SOURCE, bytes: FILE_BYTES });
  harness.type('my edits');
  assert.equal(harness.workspace.redecode(harness.visibleTab() ?? '', 'another decoding', FILE_SOURCE), false);
  assert.equal(harness.visibleText(), 'my edits');
});

test('redecode is refused for a memo, a file without bytes and an unknown tab', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  assert.equal(harness.workspace.redecode(harness.visibleTab() ?? '', 'text', FILE_SOURCE), false);
  assert.equal(harness.visibleText(), 'newer text');

  harness.workspace.openFile({ text: 'file text', source: FILE_SOURCE });
  assert.equal(harness.workspace.redecode(harness.visibleTab() ?? '', 'text', FILE_SOURCE), false);
  assert.equal(harness.visibleText(), 'file text');
  assert.equal(harness.workspace.redecode('no-such-tab', 'text', FILE_SOURCE), false);
});

// --- saving to a local file -------------------------------------------------

const WRITABLE: WritableFile = { name: 'notes.txt', write: async () => undefined };
const UTF8_SOURCE: DocumentSource = { ...FILE_SOURCE, encoding: 'UTF-8' };

test('getText returns the current text of a tab and undefined for an unknown one', async () => {
  const harness = createHarness();
  await harness.workspace.start();
  harness.type('typed');
  assert.equal(harness.workspace.getText(harness.visibleTab() ?? ''), 'typed');
  assert.equal(harness.workspace.getText('no-such-tab'), undefined);
});

test('a file opened with write access can be written back without asking', async () => {
  const harness = createHarness();
  await harness.workspace.start();
  harness.workspace.openFile({ text: 'file text', source: FILE_SOURCE, writable: WRITABLE });
  assert.equal(harness.workspace.getActiveDocument()?.localFile, WRITABLE);
  // Unlike the bytes, the link to the file survives editing: that is when it is needed.
  harness.type('edited');
  assert.equal(harness.workspace.getActiveDocument()?.localFile, WRITABLE);
});

test('markSavedToFile on a file that was never stored updates what its first save will record', async () => {
  const harness = createHarness();
  await harness.workspace.start();
  harness.workspace.openFile({ text: 'file text', source: FILE_SOURCE, bytes: FILE_BYTES });
  const tabId = harness.visibleTab() ?? '';
  await harness.workspace.markSavedToFile(tabId, { source: UTF8_SOURCE, localFile: WRITABLE });

  const active = harness.workspace.getActiveDocument();
  assert.deepEqual(active?.source, UTF8_SOURCE);
  assert.equal(active?.localFile, WRITABLE);
  // The bytes describe the file as it was before it was rewritten.
  assert.equal(active?.originalBytes, undefined);
  assert.deepEqual((await harness.storage.listDocuments()).documents, []);

  harness.type('edited');
  await harness.workspace.flushAll();
  assert.deepEqual((await harness.storage.listDocuments()).documents[0]?.source, UTF8_SOURCE);
});

test('markSavedToFile on a stored file document stores the new source at once', async () => {
  const harness = createHarness();
  await harness.workspace.start();
  harness.workspace.openFile({ text: 'v1', source: FILE_SOURCE });
  harness.type('v2');
  await harness.workspace.flushAll();
  await harness.workspace.markSavedToFile(harness.visibleTab() ?? '', { source: UTF8_SOURCE });

  const { documents } = await harness.storage.listDocuments();
  assert.equal(documents.length, 1);
  assert.deepEqual(documents[0]?.source, UTF8_SOURCE);
  assert.deepEqual(await stored(harness.storage), [['notes.txt', 'v2']]);

  // Later edits build on the new revision instead of colliding with it.
  harness.type('v3');
  await harness.workspace.flushAll();
  assert.deepEqual(await stored(harness.storage), [['notes.txt', 'v3']]);
  assert.deepEqual(harness.notices, []);
});

test('markSavedToFile writes pending edits first, so no conflict copy appears', async () => {
  const harness = createHarness();
  await harness.workspace.start();
  harness.workspace.openFile({ text: 'v1', source: FILE_SOURCE });
  harness.type('v2');
  await harness.workspace.flushAll();
  harness.type('v3, not saved yet');
  await harness.workspace.markSavedToFile(harness.visibleTab() ?? '', { source: UTF8_SOURCE });
  await harness.workspace.flushAll();
  assert.deepEqual(await stored(harness.storage), [['notes.txt', 'v3, not saved yet']]);
  assert.deepEqual((await harness.storage.listDocuments()).documents[0]?.source, UTF8_SOURCE);
  assert.deepEqual(harness.notices, []);
});

test('markSavedToFile with an unchanged source writes nothing', async () => {
  const harness = createHarness();
  await harness.workspace.start();
  harness.workspace.openFile({ text: 'v1', source: FILE_SOURCE });
  harness.type('v2');
  await harness.workspace.flushAll();
  const before = (await harness.storage.listDocuments()).documents[0]?.rev;
  await harness.workspace.markSavedToFile(harness.visibleTab() ?? '', { source: { ...FILE_SOURCE } });
  assert.equal((await harness.storage.listDocuments()).documents[0]?.rev, before);
});

test('a memo saved to a file remembers the file but stays a memo', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  await harness.workspace.markSavedToFile(harness.visibleTab() ?? '', { localFile: WRITABLE });
  const active = harness.workspace.getActiveDocument();
  assert.equal(active?.localFile, WRITABLE);
  assert.equal(active?.source, undefined);
  const newer = (await harness.storage.getDocument('newer'))?.meta;
  assert.ok(newer);
  assert.equal('source' in newer, false);
});

test('markSavedToFile keeps the known file when the text was merely downloaded', async () => {
  const harness = createHarness();
  await harness.workspace.start();
  harness.workspace.openFile({ text: 'file text', source: FILE_SOURCE, writable: WRITABLE });
  await harness.workspace.markSavedToFile(harness.visibleTab() ?? '', { source: FILE_SOURCE });
  assert.equal(harness.workspace.getActiveDocument()?.localFile, WRITABLE);
});

test('markSavedToFile ignores an unknown tab and survives a storage failure', async () => {
  const storage = createMemoryStorage();
  let failing = false;
  const harness = createHarness({
    ...storage,
    saveDocument: async (draft, expectedRev) => {
      if (failing) throw new StorageError('write-failed', 'disk error');
      return storage.saveDocument(draft, expectedRev);
    },
  });
  await harness.workspace.start();
  await harness.workspace.markSavedToFile('no-such-tab', { source: UTF8_SOURCE });

  harness.workspace.openFile({ text: 'v1', source: FILE_SOURCE });
  harness.type('v2');
  await harness.workspace.flushAll();
  failing = true;
  // The file on disk was written; failing to note its new form must not look like a failed save.
  await harness.workspace.markSavedToFile(harness.visibleTab() ?? '', { source: UTF8_SOURCE, localFile: WRITABLE });
  assert.equal(harness.workspace.getActiveDocument()?.localFile, WRITABLE);
});

// --- the id of the memo on screen ---------------------------------------------

test('getActiveDocumentId gives the id of a stored memo and follows the tabs', async () => {
  const harness = createHarness(await storageWithTwoMemos());
  await harness.workspace.start();
  assert.equal(harness.workspace.getActiveDocumentId(), 'newer');
  await harness.workspace.openMemo('older');
  assert.equal(harness.workspace.getActiveDocumentId(), 'older');
});

test('a memo that was never stored has no id, and gets one with its first save', async () => {
  const harness = createHarness();
  await harness.workspace.start();
  assert.equal(harness.workspace.getActiveDocumentId(), undefined);
  harness.type('first words');
  // Typed, but not yet written.
  assert.equal(harness.workspace.getActiveDocumentId(), undefined);
  await harness.workspace.flushAll();
  const [stored] = (await harness.storage.listDocuments()).documents;
  assert.ok(stored);
  assert.equal(harness.workspace.getActiveDocumentId(), stored.id);
});
