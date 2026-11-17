// The storage boundary of the app. Everything above it (document store, autosave, UI) talks to
// this interface only, so IndexedDB can be replaced by the in-memory fallback when it is
// unavailable, and the logic can be tested without a browser.

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
}

/** What a caller hands to saveDocument; the storage derives `length` and `rev`. */
export interface DocumentDraft {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
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
  return {
    id: draft.id,
    title: draft.title,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    length: draft.content.length,
    rev: currentRev + 1,
  };
}

export interface StoragePort {
  /** Metadata of every document, in no particular order. Never loads document content. */
  listDocuments(): Promise<DocumentListing>;

  getDocument(id: string): Promise<StoredDocument | undefined>;

  /**
   * Stores the draft if the stored revision equals `expectedRev` (NEW_DOCUMENT_REV: the document
   * must not exist), and resolves with the new metadata only once the write is durable.
   * Rejects with StorageError 'conflict' otherwise, leaving the stored document untouched.
   */
  saveDocument(draft: DocumentDraft, expectedRev: number): Promise<DocumentMeta>;

  /** Resolves to whether a document was actually removed. */
  deleteDocument(id: string): Promise<boolean>;
}
