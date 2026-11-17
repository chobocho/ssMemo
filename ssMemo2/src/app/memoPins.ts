// Memos the user pinned, which the memo list shows before all others.
//
// The pins are one stored value next to the documents, a list of ids, and not a property of the
// documents: pinning does not count as a change of the memo, so it neither moves it in the list
// nor collides with what another window is typing into it. Backups do not contain them.
import type { StoragePort } from '../storage/storagePort.ts';

export const PINNED_MEMOS_KEY = 'pinnedMemos';

export interface MemoPins {
  /** Whether the memo is pinned, as far as this window knows (see refresh). */
  has(id: string): boolean;
  /** The pinned ids as this window last read or changed them. */
  ids(): ReadonlySet<string>;
  /**
   * Reads the stored pins, which another window may have changed, and resolves with them.
   * Never rejects: if they cannot be read, what was known stays.
   */
  refresh(): Promise<ReadonlySet<string>>;
  /**
   * Pins the memo if this window shows it as not pinned, and unpins it otherwise. Resolves to
   * whether it is pinned now. Rejects if that could not be stored; nothing is changed then.
   */
  toggle(id: string): Promise<boolean>;
  /** Drops the pin of a memo that no longer exists. Never rejects. */
  forget(id: string): Promise<void>;
}

/** The ids in a stored list of pins. Anything else in it is dropped, and so are repetitions. */
export function parsePinnedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  for (const item of value) {
    if (typeof item === 'string' && item !== '') ids.add(item);
  }
  return [...ids];
}

export function createMemoPins(storage: StoragePort): MemoPins {
  let known: ReadonlySet<string> = new Set();

  /**
   * Stores the memo as pinned or not. Read and written in one step, so the pins another window
   * sets at the same moment are kept.
   */
  async function store(id: string, pinned: boolean): Promise<void> {
    let stored: string[] = [];
    await storage.updateValue(PINNED_MEMOS_KEY, (current) => {
      const others = parsePinnedIds(current).filter((other) => other !== id);
      stored = pinned ? [...others, id] : others;
      return stored;
    });
    known = new Set(stored);
  }

  return {
    has: (id) => known.has(id),
    ids: () => known,

    async refresh() {
      try {
        known = new Set(parsePinnedIds(await storage.getValue(PINNED_MEMOS_KEY)));
      } catch {
        // A convenience: the list is merely shown without, or with outdated, pins.
      }
      return known;
    },

    async toggle(id) {
      // What the user saw decides, not what is stored: if another window pinned the memo in the
      // meantime, a tap on "pin" must not undo that.
      const pinned = !known.has(id);
      await store(id, pinned);
      return pinned;
    },

    async forget(id) {
      try {
        await store(id, false);
      } catch {
        // The id of a memo that is gone does no harm in the list.
      }
    },
  };
}
