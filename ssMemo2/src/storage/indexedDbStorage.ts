// IndexedDB-backed StoragePort.
//
// Layout (version 1):
//   docMeta  keyPath "id"   DocumentMeta records
//   docBody  keyPath "id"   { id, content }
//   kv       keyPath "key"  settings and session state (used by later roadmap items; created now
//                           so adding them needs no version upgrade)
// Metadata and content are separate records so listing never reads document bodies. Both are
// always written in one transaction, so they cannot get out of step.
//
// Every operation resolves only on the transaction's "complete" event. A request's "success"
// event is not enough: the transaction can still abort afterwards (for example when the quota is
// exhausted), which is how ssMemoWeb came to report saves that were never stored.
//
// Every failure is turned into a StorageError with a kind the app can act on:
//   unavailable      the database cannot be opened      -> fall back to memory storage
//   write-failed     a write was rolled back            -> the document stays unsaved
//   quota            same, because storage is full
//   conflict         another tab saved first            -> see storagePort.ts
//   connection-lost  the connection is gone             -> the page has to be reloaded
import { NEW_DOCUMENT_REV, StorageError, copyMeta, createNextMeta, parseDocumentSource } from './storagePort.ts';
import type { DocumentListing, DocumentMeta, DocumentSnapshot, StoragePort, StoredDocument } from './storagePort.ts';

export const DATABASE_NAME = 'ssMemo2';
const DATABASE_VERSION = 1;
const META_STORE = 'docMeta';
const BODY_STORE = 'docBody';
const KEY_VALUE_STORE = 'kv';
const DOCUMENT_STORES: readonly string[] = [META_STORE, BODY_STORE];
const VALUE_STORES: readonly string[] = [KEY_VALUE_STORE];

// Opening normally takes milliseconds. A request that is blocked by another tab or stuck in a
// broken browser profile fires no event at all, so only a timeout can end the wait.
const DEFAULT_OPEN_TIMEOUT_MS = 5000;
const FIRST_REVISION = 1;
const QUOTA_ERROR_NAME = 'QuotaExceededError';

export interface IndexedDbStorage extends StoragePort {
  /** Releases the connection so other tabs can upgrade or delete the database. */
  close(): void;
}

export interface OpenOptions {
  /** How long to wait for the database to open before reporting it as unavailable. */
  timeoutMs?: number;
  /** Called once if the connection is closed underneath the app. */
  onConnectionLost?: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCount(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum;
}

/**
 * A clean copy of a stored metadata record, or undefined if the record is malformed. Unknown
 * extra fields are ignored, so records written by a newer version of the app stay readable.
 */
function parseMeta(value: unknown): DocumentMeta | undefined {
  if (!isRecord(value)) return undefined;
  const { id, title, createdAt, updatedAt, length, rev } = value;
  if (
    typeof id !== 'string' ||
    typeof title !== 'string' ||
    typeof createdAt !== 'string' ||
    typeof updatedAt !== 'string' ||
    !isCount(length, 0) ||
    !isCount(rev, FIRST_REVISION)
  ) {
    return undefined;
  }
  const meta: DocumentMeta = { id, title, createdAt, updatedAt, length, rev };
  // A source that cannot be read is dropped; the document itself is still good.
  const source = parseDocumentSource(value.source);
  if (source) meta.source = source;
  return meta;
}

function parseContent(value: unknown): string | undefined {
  return isRecord(value) && typeof value.content === 'string' ? value.content : undefined;
}

/** Turns the reason a write transaction aborted into the error the app should see. */
export function classifyWriteFailure(cause: unknown): StorageError {
  if (isRecord(cause) && cause.name === QUOTA_ERROR_NAME) {
    return new StorageError('quota', 'The browser storage quota is exhausted', { cause });
  }
  return new StorageError('write-failed', 'The storage transaction was aborted', { cause });
}

function createSchema(database: IDBDatabase): void {
  database.createObjectStore(META_STORE, { keyPath: 'id' });
  database.createObjectStore(BODY_STORE, { keyPath: 'id' });
  database.createObjectStore(KEY_VALUE_STORE, { keyPath: 'key' });
}

function openDatabase(factory: IDBFactory, timeoutMs: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (message: string, cause?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new StorageError('unavailable', message, { cause }));
    };
    const timer = setTimeout(() => fail(`IndexedDB did not open within ${timeoutMs} ms`), timeoutMs);

    let request: IDBOpenDBRequest;
    try {
      // Throws when storage is blocked for the page, or when there is no IndexedDB at all.
      request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      fail('IndexedDB is not accessible', error);
      return;
    }

    request.onupgradeneeded = () => createSchema(request.result);
    // Also reached when the stored database is newer than this build (VersionError).
    request.onerror = () => fail('IndexedDB could not be opened', request.error);
    request.onsuccess = () => {
      if (settled) {
        // The app has already moved on to the fallback; an unused open connection would only
        // block other tabs from upgrading the database.
        request.result.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(request.result);
    };
  });
}

/**
 * Runs `work` in one transaction over `storeNames` and resolves, once the transaction has
 * committed, with the value of the function `work` returned.
 *
 * `work` must issue its requests synchronously or from request callbacks (never after an await),
 * because a transaction commits as soon as it has no pending request. It can call `abort` to roll
 * everything back; the promise then rejects with the error passed to `abort`.
 */
function runTransaction<T>(
  database: IDBDatabase,
  storeNames: readonly string[],
  mode: IDBTransactionMode,
  work: (transaction: IDBTransaction, abort: (error: unknown) => void) => () => T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction([...storeNames], mode);
    } catch (error) {
      // The connection is closing or closed; no transaction can be started on it any more.
      reject(new StorageError('connection-lost', 'The storage connection is closed', { cause: error }));
      return;
    }

    let failure: unknown;
    const abort = (error: unknown): void => {
      failure = error;
      transaction.abort();
    };

    const readResult = work(transaction, abort);

    transaction.oncomplete = () => resolve(readResult());
    transaction.onabort = () => {
      reject(failure instanceof StorageError ? failure : classifyWriteFailure(failure ?? transaction.error));
    };
  });
}

function createStorage(database: IDBDatabase, onConnectionLost: () => void): IndexedDbStorage {
  let connected = true;

  const disconnect = (notify: boolean): void => {
    if (!connected) return;
    connected = false;
    database.close();
    if (notify) onConnectionLost();
  };

  // Another tab wants to upgrade or delete the database. Holding on would block that tab forever.
  database.onversionchange = () => disconnect(true);
  // The browser closed the connection itself (site data cleared, disk error).
  database.onclose = () => disconnect(true);

  const run = <T>(
    storeNames: readonly string[],
    mode: IDBTransactionMode,
    work: (transaction: IDBTransaction, abort: (error: unknown) => void) => () => T,
  ): Promise<T> => {
    if (!connected) {
      return Promise.reject(new StorageError('connection-lost', 'The storage connection is closed'));
    }
    return runTransaction(database, storeNames, mode, work);
  };

  return {
    listDocuments() {
      return run(DOCUMENT_STORES, 'readonly', (transaction) => {
        const request = transaction.objectStore(META_STORE).getAll();
        return (): DocumentListing => {
          const documents: DocumentMeta[] = [];
          let corruptCount = 0;
          for (const record of request.result) {
            const meta = parseMeta(record);
            if (meta) documents.push(meta);
            else corruptCount += 1;
          }
          return { documents, corruptCount };
        };
      });
    },

    getDocument(id) {
      return run(DOCUMENT_STORES, 'readonly', (transaction) => {
        const metaRequest = transaction.objectStore(META_STORE).get(id);
        const bodyRequest = transaction.objectStore(BODY_STORE).get(id);
        return (): StoredDocument | undefined => {
          const meta = parseMeta(metaRequest.result);
          const content = parseContent(bodyRequest.result);
          return meta && content !== undefined ? { meta, content } : undefined;
        };
      });
    },

    getAllDocuments() {
      // One transaction, so the snapshot is consistent even while another tab is saving.
      return run(DOCUMENT_STORES, 'readonly', (transaction) => {
        const metaRequest = transaction.objectStore(META_STORE).getAll();
        const bodyRequest = transaction.objectStore(BODY_STORE).getAll();
        // O(n) time and space in the number of stored records.
        return (): DocumentSnapshot => {
          const bodies = new Map<unknown, unknown>();
          for (const record of bodyRequest.result) {
            if (isRecord(record)) bodies.set(record.id, record);
          }
          const documents: StoredDocument[] = [];
          let corruptCount = 0;
          for (const record of metaRequest.result) {
            const meta = parseMeta(record);
            const key: unknown = isRecord(record) ? record.id : undefined;
            const content = parseContent(bodies.get(key));
            bodies.delete(key);
            if (meta && content !== undefined) documents.push({ meta, content });
            else corruptCount += 1;
          }
          // Whatever is left is text without metadata: it exists but cannot be exported.
          return { documents, corruptCount: corruptCount + bodies.size };
        };
      });
    },

    saveDocument(draft, expectedRev) {
      return run(DOCUMENT_STORES, 'readwrite', (transaction, abort) => {
        const metaStore = transaction.objectStore(META_STORE);
        const existing = metaStore.get(draft.id);
        let meta: DocumentMeta | undefined;
        // The revision check and both writes share this transaction, so no other tab can save
        // between the check and the write.
        existing.onsuccess = () => {
          try {
            // A malformed stored record counts as absent, so creating the id anew repairs it.
            meta = createNextMeta(draft, parseMeta(existing.result)?.rev, expectedRev);
            metaStore.put(meta);
            transaction.objectStore(BODY_STORE).put({ id: draft.id, content: draft.content });
          } catch (error) {
            abort(error);
          }
        };
        return (): DocumentMeta => {
          if (!meta) throw new StorageError('write-failed', `Document ${draft.id} was not written`);
          return copyMeta(meta);
        };
      });
    },

    writeDocuments(drafts, { replaceAll }) {
      return run(DOCUMENT_STORES, 'readwrite', (transaction, abort) => {
        const metaStore = transaction.objectStore(META_STORE);
        const bodyStore = transaction.objectStore(BODY_STORE);
        // The revisions are read, the old records removed and the new ones written inside one
        // transaction: a failure at any point rolls all of it back, also the removal.
        const existing = metaStore.getAll();
        existing.onsuccess = () => {
          try {
            const revisions = new Map<string, number>();
            for (const record of existing.result) {
              const meta = parseMeta(record);
              if (meta) revisions.set(meta.id, meta.rev);
            }
            if (replaceAll) {
              metaStore.clear();
              bodyStore.clear();
            }
            for (const draft of drafts) {
              const storedRev = revisions.get(draft.id);
              metaStore.put(createNextMeta(draft, storedRev, storedRev ?? NEW_DOCUMENT_REV));
              bodyStore.put({ id: draft.id, content: draft.content });
            }
          } catch (error) {
            abort(error);
          }
        };
        return (): void => undefined;
      });
    },

    deleteDocument(id) {
      return run(DOCUMENT_STORES, 'readwrite', (transaction) => {
        const metaStore = transaction.objectStore(META_STORE);
        // getKey answers "did it exist" without loading the record.
        const existing = metaStore.getKey(id);
        metaStore.delete(id);
        transaction.objectStore(BODY_STORE).delete(id);
        return (): boolean => existing.result !== undefined;
      });
    },

    getValue(key) {
      return run(VALUE_STORES, 'readonly', (transaction) => {
        const request = transaction.objectStore(KEY_VALUE_STORE).get(key);
        return (): unknown => (isRecord(request.result) ? request.result.value : undefined);
      });
    },

    setValue(key, value) {
      return run(VALUE_STORES, 'readwrite', (transaction, abort) => {
        try {
          transaction.objectStore(KEY_VALUE_STORE).put({ key, value });
        } catch (error) {
          // Thrown synchronously when the value cannot be stored (it holds a function, for example).
          abort(error);
        }
        return (): void => undefined;
      });
    },

    close() {
      disconnect(false);
    },
  };
}

/** Rejects with StorageError 'unavailable' when the database cannot be opened. */
export async function openIndexedDbStorage(factory: IDBFactory, options: OpenOptions = {}): Promise<IndexedDbStorage> {
  const database = await openDatabase(factory, options.timeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS);
  return createStorage(database, options.onConnectionLost ?? (() => undefined));
}
