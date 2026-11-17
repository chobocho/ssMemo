// The storage boundary of the app. Everything above it (document store, autosave, UI) talks to
// this interface only, so IndexedDB can be replaced by the in-memory fallback when it is
// unavailable, and the logic can be tested without a browser.
import { isTextEncoding } from '../lib/encoding.ts';
import { isEol } from '../lib/textFile.ts';
import type { TextFormat } from '../lib/textFile.ts';

/** The local file a document was opened from, and the form that file is in. */
export interface DocumentSource extends TextFormat {
  fileName: string;
}

export interface DocumentMeta {
  /** Stable identifier. The title is just a field, so renaming never re-keys the document. */
  id: string;
  title: string;
  /** ISO 8601 timestamps. */
  createdAt: string;
  updatedAt: string;
  /** Content length in UTF-16 code units; lets a list show sizes without loading any content. */
  length: number;
  /** Incremented by every save. Lets a save detect that another window saved in between. */
  rev: number;
  /** Present only on documents that were opened from a local file. */
  source?: DocumentSource;
}

/** What a caller hands to saveDocument; the storage derives `length` and `rev`. */
export interface DocumentDraft {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  /** Leave out for a memo that did not come from a file; a save without it removes it. */
  source?: DocumentSource;
}

export interface StoredDocument {
  meta: DocumentMeta;
  content: string;
}

export interface DocumentListing {
  documents: DocumentMeta[];
  /** Records that were skipped because they are malformed; the app keeps working without them. */
  corruptCount: number;
}

/** Everything that can be read from the storage, for a backup. */
export interface DocumentSnapshot {
  documents: StoredDocument[];
  /** Stored items that could not be turned into a document and are therefore missing here. */
  corruptCount: number;
}

/** The `expectedRev` to pass to saveDocument when the document must not exist yet. */
export const NEW_DOCUMENT_REV = 0;

export type StorageErrorKind =
  /** The storage could not be opened at all. */
  | 'unavailable'
  /** A write was not committed. The caller's data is still unsaved. */
  | 'write-failed'
  /** A write was not committed because the browser's storage quota is exhausted. */
  | 'quota'
  /** The stored revision is not the one the caller expected. */
  | 'conflict'
  /** The connection was closed underneath the app (e.g. another tab upgraded the database). */
  | 'connection-lost';

export class StorageError extends Error {
  readonly kind: StorageErrorKind;

  constructor(kind: StorageErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StorageError';
    this.kind = kind;
  }
}

/**
 * The revision rule shared by every implementation: a save is accepted only when the stored
 * revision (`undefined` if the document does not exist) is the one the caller expects.
 * Returns the metadata to store, or throws StorageError 'conflict'.
 */
export function createNextMeta(draft: DocumentDraft, storedRev: number | undefined, expectedRev: number): DocumentMeta {
  const currentRev = storedRev ?? NEW_DOCUMENT_REV;
  if (currentRev !== expectedRev) {
    throw new StorageError(
      'conflict',
      `Document ${draft.id} is at revision ${currentRev} but revision ${expectedRev} was expected`,
    );
  }
  const meta: DocumentMeta = {
    id: draft.id,
    title: draft.title,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    length: draft.content.length,
    rev: currentRev + 1,
  };
  // The key is left out entirely for a plain memo, so stored records stay minimal.
  if (draft.source) meta.source = { ...draft.source };
  return meta;
}

/**
 * A clean copy of a stored source, or undefined if it is missing or malformed. A document whose
 * source cannot be read is still a perfectly good memo, so this never makes a record corrupt.
 */
export function parseDocumentSource(value: unknown): DocumentSource | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { fileName, encoding, eol, hasBom } = value as Record<string, unknown>;
  if (typeof fileName !== 'string' || fileName === '' || !isTextEncoding(encoding) || !isEol(eol) || typeof hasBom !== 'boolean') {
    return undefined;
  }
  return { fileName, encoding, eol, hasBom };
}

/** A copy that shares nothing with the original, so callers cannot change stored metadata. */
export function copyMeta(meta: DocumentMeta): DocumentMeta {
  const { source, ...rest } = meta;
  return source ? { ...rest, source: { ...source } } : rest;
}

export interface StoragePort {
  /** Metadata of every document, in no particular order. Never loads document content. */
  listDocuments(): Promise<DocumentListing>;

  getDocument(id: string): Promise<StoredDocument | undefined>;

  /** Every document with its content, read at one point in time, in no particular order. */
  getAllDocuments(): Promise<DocumentSnapshot>;

  /**
   * Stores the draft if the stored revision equals `expectedRev` (NEW_DOCUMENT_REV: the document
   * must not exist), and resolves with the new metadata only once the write is durable.
   * Rejects with StorageError 'conflict' otherwise, leaving the stored document untouched.
   */
  saveDocument(draft: DocumentDraft, expectedRev: number): Promise<DocumentMeta>;

  /**
   * Stores several documents in one step: either all of them are stored or nothing changes.
   * With `replaceAll`, every stored document that is not among them is deleted in the same step.
   * A draft whose id already exists replaces that document and continues its revision count, so
   * another window that still has the old version open notices the change when it saves.
   */
  writeDocuments(drafts: readonly DocumentDraft[], options: { replaceAll: boolean }): Promise<void>;

  /** Resolves to whether a document was actually removed. */
  deleteDocument(id: string): Promise<boolean>;

  /**
   * A small piece of app state stored under a name (settings, the open tabs). Kept apart from
   * documents. Resolves to undefined if the key was never set.
   */
  getValue(key: string): Promise<unknown>;

  /** `value` must be plain data (objects, arrays, strings, numbers, booleans, null). */
  setValue(key: string, value: unknown): Promise<void>;
}
