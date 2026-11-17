// What was open when the page was last used, so the next visit continues where it stopped:
// which memos were open in tabs, in what order, which one was showing, and where the cursor was.
import type { StoragePort } from '../storage/storagePort.ts';
import { MAX_TABS } from './tabManager.ts';

export interface SessionTab {
  documentId: string;
  /** Cursor offset in the document, in UTF-16 code units. */
  cursor: number;
}

export interface SessionState {
  /** In tab order. A memo that was never saved has no document yet and is not listed. */
  tabs: SessionTab[];
  activeDocumentId: string | undefined;
}

const SESSION_KEY = 'session';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Turns whatever was stored into a usable session. Entries that make no sense are dropped or
 * repaired one by one, so a partly damaged record still restores the tabs that are fine.
 * Whether the documents still exist is checked later, when they are opened.
 */
export function parseSession(value: unknown): SessionState {
  if (!isRecord(value) || !Array.isArray(value.tabs)) {
    return { tabs: [], activeDocumentId: undefined };
  }
  const tabs: SessionTab[] = [];
  const seen = new Set<string>();
  for (const entry of value.tabs as unknown[]) {
    if (tabs.length >= MAX_TABS) break;
    if (!isRecord(entry)) continue;
    const { documentId, cursor } = entry;
    if (typeof documentId !== 'string' || documentId === '' || seen.has(documentId)) continue;
    seen.add(documentId);
    const validCursor = typeof cursor === 'number' && Number.isInteger(cursor) && cursor >= 0;
    tabs.push({ documentId, cursor: validCursor ? cursor : 0 });
  }
  const { activeDocumentId } = value;
  return {
    tabs,
    activeDocumentId: typeof activeDocumentId === 'string' && seen.has(activeDocumentId) ? activeDocumentId : undefined,
  };
}

export interface SessionStore {
  /** Never rejects: an unreadable session comes back empty. */
  load(): Promise<SessionState>;
  /** Resolves to false if the session could not be stored. */
  save(state: SessionState): Promise<boolean>;
}

// Like settings, the session is a convenience: failing to read or write it must never get in the
// way of editing or produce an error message of its own.
export function createSessionStore(storage: StoragePort): SessionStore {
  return {
    async load() {
      try {
        return parseSession(await storage.getValue(SESSION_KEY));
      } catch {
        return { tabs: [], activeDocumentId: undefined };
      }
    },
    async save(state) {
      try {
        await storage.setValue(SESSION_KEY, state);
        return true;
      } catch {
        return false;
      }
    },
  };
}
