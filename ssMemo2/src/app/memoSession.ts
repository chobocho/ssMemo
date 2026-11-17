// One memo, end to end: what the editor shows at startup and how edits reach storage.
// It knows nothing about the DOM; the editor and the user-facing messages are passed in.
import { StorageError } from '../storage/storagePort.ts';
import type { DocumentMeta } from '../storage/storagePort.ts';
import { createAutosave } from './autosave.ts';
import type { AutosaveState, AutosaveTimers } from './autosave.ts';
import type { DocumentStore } from './documentStore.ts';

/** Something the user should be told. The UI turns it into a translated message. */
export type SessionNotice =
  /** Stored memos could not be read; the editor starts empty. */
  | { kind: 'load-failed' }
  /** The storage skipped this many damaged records. */
  | { kind: 'corrupt-records'; count: number }
  /** Another window changed the memo first, so the text was stored as a new memo with this title. */
  | { kind: 'saved-as-copy'; title: string }
  | { kind: 'save-failed'; reason: SaveFailureReason };

export type SaveFailureReason = 'quota' | 'connection-lost' | 'other';

/** The part of the editor the session needs. */
export interface EditorPort {
  getText(): string;
  /** Replaces the content without reporting it as an edit. */
  setText(text: string): void;
}

export interface MemoSessionOptions {
  store: DocumentStore;
  editor: EditorPort;
  /** Title given to the memo that the first edit creates. */
  defaultTitle: string;
  idleDelayMs: number;
  maxWaitMs: number;
  timers: AutosaveTimers;
  onNotice: (notice: SessionNotice) => void;
  onSaveStateChange: (state: AutosaveState) => void;
}

export interface MemoSession {
  /** Shows the most recently modified memo, or an empty editor if there is none. Never rejects. */
  start(): Promise<void>;
  /** Call whenever the user changed the editor content. */
  handleEdit(): void;
  /** Saves now; for when the page is hidden or closed. Never rejects. */
  flush(): Promise<void>;
  hasUnsavedChanges(): boolean;
}

function saveFailureReason(error: unknown): SaveFailureReason {
  if (error instanceof StorageError && (error.kind === 'quota' || error.kind === 'connection-lost')) {
    return error.kind;
  }
  return 'other';
}

export function createMemoSession(options: MemoSessionOptions): MemoSession {
  const { store, editor, defaultTitle, onNotice } = options;

  // The stored memo the editor content belongs to. It stays undefined until the first save
  // creates one. That is deliberate: an editor that is empty because nothing could be loaded must
  // never be saved over an existing memo (ssMemoWeb lost memos that way), and a visit without
  // typing should not leave an empty memo behind.
  let current: DocumentMeta | undefined;

  async function saveCurrent(): Promise<void> {
    const text = editor.getText();
    if (!current) {
      current = await store.create(defaultTitle, text);
      return;
    }
    const outcome = await store.save(current, text);
    // After a conflict, editing continues on the copy, so later saves do not conflict again.
    current = outcome.meta;
    if (outcome.savedAsCopy) {
      onNotice({ kind: 'saved-as-copy', title: outcome.meta.title });
    }
  }

  const autosave = createAutosave({
    save: saveCurrent,
    idleDelayMs: options.idleDelayMs,
    maxWaitMs: options.maxWaitMs,
    timers: options.timers,
    onError: (error) => onNotice({ kind: 'save-failed', reason: saveFailureReason(error) }),
    onStateChange: options.onSaveStateChange,
  });

  async function loadMostRecent(): Promise<void> {
    const listing = await store.list();
    if (listing.corruptCount > 0) {
      onNotice({ kind: 'corrupt-records', count: listing.corruptCount });
    }
    // Newest first. A memo whose content cannot be read is skipped, not shown as empty.
    for (const meta of listing.documents) {
      const document = await store.load(meta.id);
      if (document) {
        current = document.meta;
        editor.setText(document.content);
        return;
      }
    }
  }

  return {
    async start() {
      try {
        await loadMostRecent();
      } catch {
        onNotice({ kind: 'load-failed' });
      }
    },
    handleEdit: () => autosave.notifyChange(),
    flush: () => autosave.flush(),
    hasUnsavedChanges: () => autosave.hasUnsavedChanges(),
  };
}
