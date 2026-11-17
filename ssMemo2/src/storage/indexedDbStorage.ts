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
import { StorageError, createNextMeta } from './storagePort.ts';
import type { DocumentListing, DocumentMeta, StoragePort, StoredDocument } from './storagePort.ts';

export const DATABASE_NAME = 'ssMemo2';
const DATABASE_VERSION = 1;
const META_STORE = 'docMeta';
const BODY_STORE = 'docBody';
const KEY_VALUE_STORE = 'kv';
const DOCUMENT_STORES = [META_STORE, BODY_STORE];

export interface IndexedDbStorage extends StoragePort {
  /** Releases the connection so other tabs can upgrade or delete the database. */
  close(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A clean copy of a stored metadata record, or undefined if the record is malformed. */
function parseMeta(value: unknown): DocumentMeta | undefined {
  if (!isRecord(value)) return undefined;
  const { id, title, createdAt, updatedAt, length, rev } = value;
  if (
    typeof id !== 'string' ||
    typeof title !== 'string' ||
    typeof createdAt !== 'string' ||
    typeof updatedAt !== 'string' ||
    typeof length !== 'number' ||
    typeof rev !== 'number'
  ) {
    return undefined;
  }
  return { id, title, createdAt, updatedAt, length, rev };
}

function parseContent(value: unknown): string | undefined {
  return isRecord(value) && typeof value.content === 'string' ? value.content : undefined;
}

function createSchema(database: IDBDatabase): void {
  database.createObjectStore(META_STORE, { keyPath: 'id' });
  database.createObjectStore(BODY_STORE, { keyPath: 'id' });
  database.createObjectStore(KEY_VALUE_STORE, { keyPath: 'key' });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => createSchema(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      reject(new StorageError('unavailable', 'IndexedDB could not be opened', { cause: request.error }));
    };
  });
}

/**
 * Runs `work` in one transaction over the document stores and resolves, once the transaction has
 * committed, with the value of the function `work` returned.
 *
 * `work` must issue its requests synchronously or from request callbacks (never after an await),
 * because a transaction commits as soon as it has no pending request. It can call `abort` to roll
 * everything back; the promise then rejects with the error passed to `abort`.
 */
function runTransaction<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  work: (transaction: IDBTransaction, abort: (error: unknown) => void) => () => T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(DOCUMENT_STORES, mode);
    let failure: unknown;
    const abort = (error: unknown): void => {
      failure = error;
      transaction.abort();
    };

    const readResult = work(transaction, abort);

    transaction.oncomplete = () => resolve(readResult());
    transaction.onabort = () => {
      if (failure instanceof StorageError) {
        reject(failure);
      } else {
        const cause = failure ?? transaction.error;
        reject(new StorageError('write-failed', 'The storage transaction was aborted', { cause }));
      }
    };
  });
}

function createStorage(database: IDBDatabase): IndexedDbStorage {
  return {
    listDocuments() {
      return runTransaction(database, 'readonly', (transaction) => {
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
      return runTransaction(database, 'readonly', (transaction) => {
        const metaRequest = transaction.objectStore(META_STORE).get(id);
        const bodyRequest = transaction.objectStore(BODY_STORE).get(id);
        return (): StoredDocument | undefined => {
          const meta = parseMeta(metaRequest.result);
          const content = parseContent(bodyRequest.result);
          return meta && content !== undefined ? { meta, content } : undefined;
        };
      });
    },

    saveDocument(draft, expectedRev) {
      return runTransaction(database, 'readwrite', (transaction, abort) => {
        const metaStore = transaction.objectStore(META_STORE);
        const existing = metaStore.get(draft.id);
        let meta: DocumentMeta | undefined;
        // The revision check and both writes share this transaction, so no other tab can save
        // between the check and the write.
        existing.onsuccess = () => {
          try {
            meta = createNextMeta(draft, parseMeta(existing.result)?.rev, expectedRev);
            metaStore.put(meta);
            transaction.objectStore(BODY_STORE).put({ id: draft.id, content: draft.content });
          } catch (error) {
            abort(error);
          }
        };
        return (): DocumentMeta => {
          if (!meta) throw new StorageError('write-failed', `Document ${draft.id} was not written`);
          return { ...meta };
        };
      });
    },

    deleteDocument(id) {
      return runTransaction(database, 'readwrite', (transaction) => {
        const metaStore = transaction.objectStore(META_STORE);
        // getKey answers "did it exist" without loading the record.
        const existing = metaStore.getKey(id);
        metaStore.delete(id);
        transaction.objectStore(BODY_STORE).delete(id);
        return (): boolean => existing.result !== undefined;
      });
    },

    close() {
      database.close();
    },
  };
}

export async function openIndexedDbStorage(factory: IDBFactory): Promise<IndexedDbStorage> {
  return createStorage(await openDatabase(factory));
}
