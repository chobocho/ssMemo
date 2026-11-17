// The open memos as a whole: which ones are in tabs, what the editor shows, how each one reaches
// storage, and what is remembered for the next visit. It knows nothing about the DOM; the editor,
// the tab list and the user-facing messages are passed in, so the whole flow is tested headlessly.
import { StorageError } from '../storage/storagePort.ts';
import type { DocumentListing, DocumentMeta, StoredDocument } from '../storage/storagePort.ts';
import { createAutosave } from './autosave.ts';
import type { Autosave, AutosaveState, AutosaveTimers } from './autosave.ts';
import type { DocumentStore } from './documentStore.ts';
import type { SessionStore, SessionTab } from './session.ts';
import type { TabManager } from './tabManager.ts';

export type SaveFailureReason = 'quota' | 'connection-lost' | 'other';

/** Something the user should be told. The UI turns it into a translated message. */
export type WorkspaceNotice =
  /** Stored memos could not be read; a blank memo was opened instead. */
  | { kind: 'load-failed' }
  /** The storage skipped this many damaged records. */
  | { kind: 'corrupt-records'; count: number }
  /** Another window changed the memo first, so the text was stored as a new memo with this title. */
  | { kind: 'saved-as-copy'; title: string }
  | { kind: 'save-failed'; reason: SaveFailureReason }
  /** No further tab can be opened. */
  | { kind: 'tab-limit' }
  /** The memo that was asked for no longer exists. */
  | { kind: 'memo-missing' };

/** The part of the per-tab editor the workspace needs (see editor/editorTabs.ts). */
export interface WorkspaceEditor {
  show(tabId: string, initialText: string, initialCursor?: number): void;
  getText(tabId: string): string | undefined;
  getCursor(tabId: string): number | undefined;
  remove(tabId: string): void;
}

export interface WorkspaceOptions {
  store: DocumentStore;
  sessionStore: SessionStore;
  tabs: TabManager;
  editor: WorkspaceEditor;
  createTabId: () => string;
  /** Title of a memo that has not been named, used when its first save creates it. */
  defaultTitle: string;
  idleDelayMs: number;
  maxWaitMs: number;
  timers: AutosaveTimers;
  onNotice: (notice: WorkspaceNotice) => void;
  /** Save state of the active tab; undefined while that tab has never been edited. */
  onSaveStateChange: (state: AutosaveState | undefined) => void;
}

export type CloseResult =
  | 'closed'
  /** The tab is still open because its changes could not be saved. */
  | 'unsaved';

export interface Workspace {
  /** Restores the tabs of the last visit, or the most recent memo, or a blank memo. Never rejects. */
  start(): Promise<void>;
  /** Opens a blank memo in a new tab. Returns false at the tab limit. */
  newMemo(): boolean;
  /** Shows a stored memo, in its existing tab if it has one. Resolves false if it could not be shown. */
  openMemo(documentId: string): Promise<boolean>;
  activateTab(tabId: string): void;
  /**
   * Saves the tab's pending changes and closes it. If they cannot be saved the tab stays open and
   * the result is 'unsaved'; calling again with `discardChanges` closes it anyway.
   */
  closeTab(tabId: string, discardChanges?: boolean): Promise<CloseResult>;
  listMemos(): Promise<DocumentListing>;
  /** Rejects with StorageError 'conflict' if the memo is gone or was changed in another window. */
  renameMemo(documentId: string, title: string): Promise<void>;
  /** Removes a memo and closes its tab. Resolves false if there was no such memo. */
  deleteMemo(documentId: string): Promise<boolean>;
  /** Call whenever the user changed the content of a tab. */
  handleEdit(tabId: string): void;
  /** Saves everything now; for when the page is hidden or closed. Never rejects. */
  flushAll(): Promise<void>;
  hasUnsavedChanges(): boolean;
}

interface OpenMemo {
  tabId: string;
  // The stored memo this tab belongs to. It stays undefined until the first save creates one.
  // That is deliberate: a tab that is blank because nothing could be loaded must never be saved
  // over an existing memo (ssMemoWeb lost memos that way), and a tab the user never typed in
  // should not leave an empty memo behind.
  meta: DocumentMeta | undefined;
  title: string;
  /** Text and cursor the editor starts from when the tab is shown for the first time. */
  initialText: string;
  initialCursor: number;
  autosave: Autosave;
  /** undefined until the tab is edited for the first time. */
  saveState: AutosaveState | undefined;
}

function saveFailureReason(error: unknown): SaveFailureReason {
  if (error instanceof StorageError && (error.kind === 'quota' || error.kind === 'connection-lost')) {
    return error.kind;
  }
  return 'other';
}

export function createWorkspace(options: WorkspaceOptions): Workspace {
  const { store, sessionStore, tabs, editor, onNotice } = options;
  const memos = new Map<string, OpenMemo>();
  let reportedSaveState: AutosaveState | undefined;

  const activeMemo = (): OpenMemo | undefined => {
    const activeId = tabs.getActiveId();
    return activeId === undefined ? undefined : memos.get(activeId);
  };

  const findByDocument = (documentId: string): OpenMemo | undefined =>
    [...memos.values()].find((memo) => memo.meta?.id === documentId);

  const reportSaveState = (state: AutosaveState | undefined): void => {
    if (state === reportedSaveState) return;
    reportedSaveState = state;
    options.onSaveStateChange(state);
  };

  // Not awaited: the session is a convenience and saving it never rejects.
  function persistSession(): void {
    const sessionTabs: SessionTab[] = [];
    for (const tab of tabs.getTabs()) {
      const memo = memos.get(tab.id);
      // A memo that was never saved has nothing to come back to.
      if (memo?.meta) {
        sessionTabs.push({ documentId: memo.meta.id, cursor: editor.getCursor(memo.tabId) ?? memo.initialCursor });
      }
    }
    void sessionStore.save({ tabs: sessionTabs, activeDocumentId: activeMemo()?.meta?.id });
  }

  async function saveMemo(memo: OpenMemo): Promise<void> {
    const text = editor.getText(memo.tabId);
    // A tab that was never shown has no editor content, so it cannot have been edited.
    if (text === undefined) return;
    if (!memo.meta) {
      memo.meta = await store.create(memo.title, text);
      persistSession();
      return;
    }
    const outcome = await store.save(memo.meta, text);
    // After a conflict the tab continues on the copy, so later saves do not conflict again.
    memo.meta = outcome.meta;
    if (outcome.savedAsCopy) {
      memo.title = outcome.meta.title;
      tabs.setTitle(memo.tabId, memo.title);
      persistSession();
      onNotice({ kind: 'saved-as-copy', title: memo.title });
    }
  }

  /** Adds a tab for a stored memo, or a blank one. Returns undefined at the tab limit. */
  function addTab(document: StoredDocument | undefined, initialCursor = 0): OpenMemo | undefined {
    const tabId = options.createTabId();
    const title = document?.meta.title ?? options.defaultTitle;
    if (tabs.open(tabId, title) === 'limit') {
      onNotice({ kind: 'tab-limit' });
      return undefined;
    }
    const memo: OpenMemo = {
      tabId,
      meta: document?.meta,
      title,
      initialText: document?.content ?? '',
      initialCursor,
      saveState: undefined,
      autosave: createAutosave({
        save: () => saveMemo(memo),
        idleDelayMs: options.idleDelayMs,
        maxWaitMs: options.maxWaitMs,
        timers: options.timers,
        onError: (error) => onNotice({ kind: 'save-failed', reason: saveFailureReason(error) }),
        onStateChange: (state) => {
          memo.saveState = state;
          tabs.setDirty(tabId, state !== 'saved');
          if (tabs.getActiveId() === tabId) reportSaveState(state);
        },
      }),
    };
    memos.set(tabId, memo);
    return memo;
  }

  function showActiveTab(): void {
    const memo = activeMemo();
    if (!memo) return;
    editor.show(memo.tabId, memo.initialText, memo.initialCursor);
    // The editor holds the text from now on; no need to keep a second copy of a large memo.
    memo.initialText = '';
    reportSaveState(memo.saveState);
  }

  // Leaving a tab is a natural moment to store it, rather than waiting for its timer.
  const saveActiveTab = (): void => {
    void activeMemo()?.autosave.flush();
  };

  function removeTab(memo: OpenMemo): void {
    memo.autosave.discard();
    memos.delete(memo.tabId);
    editor.remove(memo.tabId);
    tabs.close(memo.tabId);
    // There is always something to type into.
    if (memos.size === 0) addTab(undefined);
    showActiveTab();
    persistSession();
  }

  function activateTab(tabId: string): void {
    if (!memos.has(tabId) || tabs.getActiveId() === tabId) return;
    saveActiveTab();
    tabs.activate(tabId);
    showActiveTab();
    persistSession();
  }

  async function restoreTabs(): Promise<string | undefined> {
    const [session, listing] = await Promise.all([sessionStore.load(), store.list()]);
    if (listing.corruptCount > 0) {
      onNotice({ kind: 'corrupt-records', count: listing.corruptCount });
    }
    let activeTabId: string | undefined;
    for (const entry of session.tabs) {
      // A memo deleted in another window since the last visit is simply not restored.
      const document = await store.load(entry.documentId);
      if (!document) continue;
      const memo = addTab(document, entry.cursor);
      if (!memo) break;
      if (entry.documentId === session.activeDocumentId) activeTabId = memo.tabId;
    }
    if (memos.size === 0) {
      // No usable session: open the most recent memo whose content can be read.
      for (const meta of listing.documents) {
        const document = await store.load(meta.id);
        if (document) {
          addTab(document);
          break;
        }
      }
    }
    return activeTabId;
  }

  return {
    async start() {
      let activeTabId: string | undefined;
      try {
        activeTabId = await restoreTabs();
      } catch {
        onNotice({ kind: 'load-failed' });
      }
      if (memos.size === 0) addTab(undefined);
      if (activeTabId !== undefined) tabs.activate(activeTabId);
      showActiveTab();
    },

    newMemo() {
      saveActiveTab();
      if (!addTab(undefined)) return false;
      showActiveTab();
      persistSession();
      return true;
    },

    async openMemo(documentId) {
      const open = findByDocument(documentId);
      if (open) {
        activateTab(open.tabId);
        return true;
      }
      const document = await store.load(documentId);
      if (!document) {
        onNotice({ kind: 'memo-missing' });
        return false;
      }
      saveActiveTab();
      if (!addTab(document)) return false;
      showActiveTab();
      persistSession();
      return true;
    },

    activateTab,

    async closeTab(tabId, discardChanges = false) {
      const memo = memos.get(tabId);
      if (!memo) return 'closed';
      if (!discardChanges) {
        await memo.autosave.flush();
        if (memo.autosave.hasUnsavedChanges()) return 'unsaved';
      }
      removeTab(memo);
      return 'closed';
    },

    listMemos: () => store.list(),

    async renameMemo(documentId, title) {
      const open = findByDocument(documentId);
      if (open?.meta) {
        // Pending edits are written first, so the rename is based on the latest revision and the
        // save that follows does not mistake the rename for another window's change.
        await open.autosave.flush();
        open.meta = await store.rename(open.meta, title);
        open.title = open.meta.title;
        tabs.setTitle(open.tabId, open.title);
        return;
      }
      const document = await store.load(documentId);
      if (!document) {
        throw new StorageError('conflict', `Document ${documentId} no longer exists`);
      }
      await store.rename(document.meta, title);
    },

    async deleteMemo(documentId) {
      const open = findByDocument(documentId);
      if (open) {
        // A save still in flight would finish after the delete, look like a conflict and store the
        // text again as a copy. Let it finish, then stop this tab from saving ever again.
        await open.autosave.flush();
        open.autosave.discard();
      }
      const removed = await store.remove(documentId);
      if (open) removeTab(open);
      return removed;
    },

    handleEdit(tabId) {
      memos.get(tabId)?.autosave.notifyChange();
    },

    async flushAll() {
      await Promise.all([...memos.values()].map((memo) => memo.autosave.flush()));
      persistSession();
    },

    hasUnsavedChanges: () => [...memos.values()].some((memo) => memo.autosave.hasUnsavedChanges()),
  };
}
