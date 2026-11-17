// Deleted memos, kept for a while so that deleting one can be undone.
//
// The trash is one stored value next to the documents, not a mark on them. Everything that reads
// documents (the memo list, the open tabs, backups, the import) therefore keeps seeing only memos
// that exist, and a build that knows no trash simply ignores it.
//
// Two rules keep a memo from getting lost on the way:
// - It is written to the trash before it is deleted, and written back before it leaves the trash.
//   If the second step fails, the memo exists twice instead of not at all.
// - Every change to the trash is one atomic update of the stored value, so two windows deleting at
//   the same time cannot overwrite each other's entry.
//
// The value is read and written as a whole, which is why the trash is limited in size as well as
// in age. Backups do not contain it.
import { NEW_DOCUMENT_REV, StorageError, parseDocumentSource } from '../storage/storagePort.ts';
import type { DocumentDraft, DocumentMeta, StoragePort } from '../storage/storagePort.ts';

export const TRASH_KEY = 'trash';

export interface TrashLimits {
  maxEntries: number;
  /** Entries deleted longer ago than this are dropped. */
  maxAgeDays: number;
  /** Upper bound for the texts in the trash together, in UTF-16 code units. */
  maxCharacters: number;
}

export const TRASH_LIMITS: TrashLimits = { maxEntries: 30, maxAgeDays: 30, maxCharacters: 5_000_000 };

const MS_PER_DAY = 86_400_000;

export interface TrashEntry {
  /** Identifies the entry. The id of the memo will not do: the same memo can be deleted twice. */
  entryId: string;
  /** ISO 8601. */
  deletedAt: string;
  /** Everything needed to store the memo again. */
  document: DocumentDraft;
}

/** What a list of the trash shows; the text itself is left out. */
export interface TrashedMemo {
  entryId: string;
  title: string;
  length: number;
  deletedAt: string;
}

export interface TrashOptions {
  storage: StoragePort;
  now(): Date;
  createId(): string;
  limits?: TrashLimits;
}

export interface Trash {
  /**
   * Moves a stored memo into the trash. Resolves to false if there is no such memo. Rejects if
   * that could not be done; the memo is then still stored.
   */
  discard(documentId: string): Promise<boolean>;
  /** Most recently deleted first. */
  list(): Promise<TrashedMemo[]>;
  /**
   * Stores the memo again and resolves with its metadata, or with undefined if the entry is not
   * in the trash any more. A memo that uses the same id by now is never overwritten: the restored
   * one gets a new id then.
   */
  restore(entryId: string): Promise<DocumentMeta | undefined>;
  /** Deletes one entry for good. */
  remove(entryId: string): Promise<void>;
  /** Deletes every entry for good. */
  empty(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function parseEntry(value: unknown): TrashEntry | undefined {
  if (!isRecord(value) || !isRecord(value.document)) return undefined;
  const { entryId, deletedAt } = value;
  const { id, title, content, createdAt, updatedAt } = value.document;
  if (!isName(entryId) || !isTimestamp(deletedAt) || !isName(id)) return undefined;
  if (typeof title !== 'string' || typeof content !== 'string' || !isTimestamp(createdAt) || !isTimestamp(updatedAt)) {
    return undefined;
  }
  const document: DocumentDraft = { id, title, content, createdAt, updatedAt };
  // A memo whose file description is damaged is still a perfectly good memo.
  const source = parseDocumentSource(value.document.source);
  if (source) document.source = source;
  return { entryId, deletedAt, document };
}

/** The usable entries of a stored trash. Anything damaged is skipped, never an error. */
export function parseTrash(value: unknown): TrashEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: TrashEntry[] = [];
  for (const item of value) {
    const entry = parseEntry(item);
    if (entry) entries.push(entry);
  }
  return entries;
}

/**
 * The entries that may stay, most recently deleted first: none older than the age limit, no more
 * than the allowed number, and together no longer than the allowed length. The newest entry stays
 * whatever its length, or deleting a large memo would silently be final.
 * O(n log n) time in the number of entries.
 */
export function pruneTrash(entries: readonly TrashEntry[], now: Date, limits: TrashLimits): TrashEntry[] {
  const oldestAllowed = now.getTime() - limits.maxAgeDays * MS_PER_DAY;
  const newestFirst = entries
    // An entry dated in the future passes: the clock may have been set back since.
    .filter((entry) => Date.parse(entry.deletedAt) >= oldestAllowed)
    // Reversed first, so that of two entries with the same time the one added later comes first.
    .reverse()
    .sort((left, right) => Date.parse(right.deletedAt) - Date.parse(left.deletedAt))
    .slice(0, limits.maxEntries);

  const kept: TrashEntry[] = [];
  let characters = 0;
  for (const entry of newestFirst) {
    characters += entry.document.content.length;
    if (kept.length > 0 && characters > limits.maxCharacters) break;
    kept.push(entry);
  }
  return kept;
}

function toDraft({ meta, content }: { meta: DocumentMeta; content: string }): DocumentDraft {
  const draft: DocumentDraft = { id: meta.id, title: meta.title, content, createdAt: meta.createdAt, updatedAt: meta.updatedAt };
  if (meta.source) draft.source = meta.source;
  return draft;
}

function isConflict(error: unknown): boolean {
  return error instanceof StorageError && error.kind === 'conflict';
}

export function createTrash(options: TrashOptions): Trash {
  const { storage, now, createId } = options;
  const limits = options.limits ?? TRASH_LIMITS;

  /** Applies `edit` to the stored trash in one step and drops what is over the limits. */
  const change = (edit: (entries: TrashEntry[]) => TrashEntry[]): Promise<void> =>
    storage.updateValue(TRASH_KEY, (current) => pruneTrash(edit(parseTrash(current)), now(), limits));

  const without =
    (entryId: string) =>
    (entries: TrashEntry[]): TrashEntry[] =>
      entries.filter((entry) => entry.entryId !== entryId);

  // Reading only hides what is over the limits; it is removed with the next change.
  const read = async (): Promise<TrashEntry[]> => pruneTrash(parseTrash(await storage.getValue(TRASH_KEY)), now(), limits);

  return {
    async discard(documentId) {
      const stored = await storage.getDocument(documentId);
      if (!stored) return false;
      const entry: TrashEntry = { entryId: createId(), deletedAt: now().toISOString(), document: toDraft(stored) };
      await change((entries) => [...entries, entry]);
      try {
        await storage.deleteDocument(documentId);
      } catch (error) {
        // The memo is still stored, so it should not sit in the trash as well. If this fails
        // too, the copy in the trash does no harm.
        await change(without(entry.entryId)).catch(() => undefined);
        throw error;
      }
      return true;
    },

    async list() {
      return (await read()).map((entry) => ({
        entryId: entry.entryId,
        title: entry.document.title,
        length: entry.document.content.length,
        deletedAt: entry.deletedAt,
      }));
    },

    async restore(entryId) {
      const entry = (await read()).find((candidate) => candidate.entryId === entryId);
      if (!entry) return undefined;
      let meta: DocumentMeta;
      try {
        meta = await storage.saveDocument(entry.document, NEW_DOCUMENT_REV);
      } catch (error) {
        if (!isConflict(error)) throw error;
        // The id is in use again, for example because the memo came back from a backup. That
        // memo may hold other text, so the restored one is stored next to it.
        meta = await storage.saveDocument({ ...entry.document, id: createId() }, NEW_DOCUMENT_REV);
      }
      // The memo is back, which is what was asked for. If the entry cannot be removed now, it
      // stays in the trash as a harmless copy.
      await change(without(entryId)).catch(() => undefined);
      return meta;
    },

    remove(entryId) {
      return change(without(entryId));
    },

    empty() {
      return storage.setValue(TRASH_KEY, []);
    },
  };
}
