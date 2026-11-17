// Documents as the app sees them: validated titles, ids, timestamps, newest-first listing, and
// the rule for what happens when two windows save the same document.
import { NEW_DOCUMENT_REV, StorageError } from '../storage/storagePort.ts';
import type {
  DocumentDraft,
  DocumentListing,
  DocumentMeta,
  DocumentSource,
  StoragePort,
  StoredDocument,
} from '../storage/storagePort.ts';

export const MAX_TITLE_LENGTH = 100;

const LINE_BREAK_PATTERN = /[\r\n]/;
const LINE_BREAK_RUNS = /[\r\n]+/g;

export type TitleProblem = 'empty' | 'too-long' | 'line-break';

/**
 * What is wrong with a title the user typed, or undefined if it is acceptable. Surrounding
 * spaces are ignored because the title is stored trimmed. The UI turns the result into a message.
 */
export function findTitleProblem(title: string): TitleProblem | undefined {
  const trimmed = title.trim();
  if (trimmed.length === 0) return 'empty';
  if (LINE_BREAK_PATTERN.test(trimmed)) return 'line-break';
  if (trimmed.length > MAX_TITLE_LENGTH) return 'too-long';
  return undefined;
}

/**
 * A title made from any text, for names that come from outside (a file name can be longer than a
 * title may be). Line breaks become spaces and the text is cut to the allowed length; `fallback`
 * is used when nothing is left.
 */
export function toValidTitle(text: string, fallback: string): string {
  const title = text.replace(LINE_BREAK_RUNS, ' ').trim().slice(0, MAX_TITLE_LENGTH).trim();
  return title === '' ? fallback : title;
}

export interface DocumentStoreOptions {
  storage: StoragePort;
  now: () => Date;
  createId: () => string;
  /** Title for the copy made when another window changed the same document first. */
  conflictCopyTitle: (title: string) => string;
}

export interface SaveOutcome {
  meta: DocumentMeta;
  /** True when the text was stored as a new document because another window had saved first. */
  savedAsCopy: boolean;
}

export interface DocumentStore {
  /** Most recently modified first. */
  list(): Promise<DocumentListing>;
  /** `source` is given for a document that was opened from a local file. */
  create(title: string, content: string, source?: DocumentSource): Promise<DocumentMeta>;
  load(id: string): Promise<StoredDocument | undefined>;
  /**
   * Stores new content for the document described by `current` (the metadata from the last load
   * or save). Never overwrites a newer version: see SaveOutcome.savedAsCopy.
   */
  save(current: DocumentMeta, content: string): Promise<SaveOutcome>;
  /** Rejects with StorageError 'conflict' if the document changed since `current` was read. */
  rename(current: DocumentMeta, title: string): Promise<DocumentMeta>;
  remove(id: string): Promise<boolean>;
}

// Callers are expected to check with findTitleProblem first and show a message; this is the guard
// that keeps an invalid title out of storage if they do not.
function normalizeTitle(title: string): string {
  const problem = findTitleProblem(title);
  if (problem) {
    throw new Error(`Invalid document title: ${problem}`);
  }
  return title.trim();
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

// ISO 8601 timestamps sort correctly as plain text. Title and id break ties so the order is stable.
function newestFirst(left: DocumentMeta, right: DocumentMeta): number {
  return (
    compareText(right.updatedAt, left.updatedAt) || compareText(left.title, right.title) || compareText(left.id, right.id)
  );
}

/** A draft carrying `fields`, plus the source if there is one. Drafts without a source have no such key. */
function toDraft(fields: Omit<DocumentDraft, 'source'>, source: DocumentSource | undefined): DocumentDraft {
  return source ? { ...fields, source } : fields;
}

function isConflict(error: unknown): boolean {
  return error instanceof StorageError && error.kind === 'conflict';
}

export function createDocumentStore(options: DocumentStoreOptions): DocumentStore {
  const { storage, now, createId, conflictCopyTitle } = options;

  return {
    async list() {
      const listing = await storage.listDocuments();
      return { documents: listing.documents.sort(newestFirst), corruptCount: listing.corruptCount };
    },

    async create(title, content, source) {
      const normalizedTitle = normalizeTitle(title);
      const timestamp = now().toISOString();
      return storage.saveDocument(
        toDraft({ id: createId(), title: normalizedTitle, content, createdAt: timestamp, updatedAt: timestamp }, source),
        NEW_DOCUMENT_REV,
      );
    },

    load(id) {
      return storage.getDocument(id);
    },

    async save(current, content) {
      const timestamp = now().toISOString();
      try {
        const meta = await storage.saveDocument(
          toDraft(
            { id: current.id, title: current.title, content, createdAt: current.createdAt, updatedAt: timestamp },
            current.source,
          ),
          current.rev,
        );
        return { meta, savedAsCopy: false };
      } catch (error) {
        if (!isConflict(error)) throw error;
        // Another window saved or deleted this document first. Overwriting would lose that
        // window's text and giving up would lose this one's, so this text becomes a new document.
        const meta = await storage.saveDocument(
          toDraft(
            {
              id: createId(),
              title: conflictCopyTitle(current.title),
              content,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            current.source,
          ),
          NEW_DOCUMENT_REV,
        );
        return { meta, savedAsCopy: true };
      }
    },

    async rename(current, title) {
      const normalizedTitle = normalizeTitle(title);
      const stored = await storage.getDocument(current.id);
      if (!stored) {
        throw new StorageError('conflict', `Document ${current.id} no longer exists`);
      }
      // One write, guarded by the revision: if the document changed after `current` was read the
      // write is refused, so stale content is never written back under the new title.
      // The modification time is kept because the content did not change.
      return storage.saveDocument(
        toDraft(
          {
            id: current.id,
            title: normalizedTitle,
            content: stored.content,
            createdAt: current.createdAt,
            updatedAt: current.updatedAt,
          },
          current.source,
        ),
        current.rev,
      );
    },

    remove(id) {
      return storage.deleteDocument(id);
    },
  };
}
