// How IndexedDbStorage behaves when IndexedDB itself misbehaves. TODO.md requires the app to keep
// working when the database is damaged or unavailable, so every failure must surface as a typed
// StorageError the app can react to, never as a hang or a silently lost write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory as FakeIndexedDbFactory } from 'fake-indexeddb';
import { DATABASE_NAME, classifyWriteFailure, openIndexedDbStorage } from '../../src/storage/indexedDbStorage.ts';
import { NEW_DOCUMENT_REV, StorageError } from '../../src/storage/storagePort.ts';
import type { DocumentDraft, StorageErrorKind } from '../../src/storage/storagePort.ts';

const TIMESTAMP = '2026-01-01T00:00:00.000Z';
const SHORT_TIMEOUT_MS = 5;
const NEWER_DATABASE_VERSION = 99;

function draft(id: string, content: string): DocumentDraft {
  return { id, title: id, content, createdAt: TIMESTAMP, updatedAt: TIMESTAMP };
}

function rejectsWith(kind: StorageErrorKind): (error: unknown) => boolean {
  return (error) => error instanceof StorageError && error.kind === kind;
}

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Writes raw records straight into the database, bypassing the storage's own validation. */
async function plantRecords(factory: IDBFactory, records: { docMeta?: unknown[]; docBody?: unknown[] }): Promise<void> {
  const database = await requestDone(factory.open(DATABASE_NAME));
  const transaction = database.transaction(['docMeta', 'docBody'], 'readwrite');
  for (const record of records.docMeta ?? []) transaction.objectStore('docMeta').put(record);
  for (const record of records.docBody ?? []) transaction.objectStore('docBody').put(record);
  await new Promise<void>((resolve) => {
    transaction.oncomplete = () => resolve();
  });
  database.close();
}

/** A factory whose databases report every transaction they start, so a test can sabotage one. */
function factoryWithTransactionHook(real: IDBFactory, onTransaction: (transaction: IDBTransaction) => void): IDBFactory {
  return {
    open(name: string, version?: number) {
      const request = real.open(name, version);
      request.addEventListener('success', () => {
        const database = request.result;
        const startTransaction = database.transaction.bind(database);
        database.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
          const transaction = startTransaction(...args);
          onTransaction(transaction);
          return transaction;
        }) as IDBDatabase['transaction'];
      });
      return request;
    },
  } as IDBFactory;
}

// --- opening ----------------------------------------------------------------

test('open: a factory that throws is reported as unavailable', async () => {
  const factory = {
    open: () => {
      throw new DOMException('storage is blocked for this page', 'SecurityError');
    },
  } as unknown as IDBFactory;
  await assert.rejects(openIndexedDbStorage(factory), rejectsWith('unavailable'));
});

test('open: a missing factory is reported as unavailable', async () => {
  await assert.rejects(openIndexedDbStorage(undefined as unknown as IDBFactory), rejectsWith('unavailable'));
});

test('open: a database written by a newer app version is reported as unavailable', async () => {
  const factory = new FakeIndexedDbFactory();
  (await requestDone(factory.open(DATABASE_NAME, NEWER_DATABASE_VERSION))).close();
  await assert.rejects(openIndexedDbStorage(factory), rejectsWith('unavailable'));
});

test('open: an open request that never answers times out as unavailable', async () => {
  // A blocked upgrade or a broken profile can leave the request pending forever.
  const factory = { open: () => ({}) } as unknown as IDBFactory;
  await assert.rejects(openIndexedDbStorage(factory, { timeoutMs: SHORT_TIMEOUT_MS }), rejectsWith('unavailable'));
});

test('open: a connection that arrives after the timeout is closed, not leaked', async () => {
  let closed = false;
  const lateRequest = { result: { close: () => { closed = true; } }, onsuccess: undefined as (() => void) | undefined };
  const factory = { open: () => lateRequest } as unknown as IDBFactory;
  await assert.rejects(openIndexedDbStorage(factory, { timeoutMs: SHORT_TIMEOUT_MS }), rejectsWith('unavailable'));
  lateRequest.onsuccess?.();
  assert.equal(closed, true);
});

// --- connection -------------------------------------------------------------

test('connection: operations after close are rejected as connection-lost', async () => {
  const storage = await openIndexedDbStorage(new FakeIndexedDbFactory());
  storage.close();
  await assert.rejects(storage.listDocuments(), rejectsWith('connection-lost'));
  await assert.rejects(storage.saveDocument(draft('a', 'text'), NEW_DOCUMENT_REV), rejectsWith('connection-lost'));
  await assert.rejects(storage.getValue('settings'), rejectsWith('connection-lost'));
  await assert.rejects(storage.setValue('settings', {}), rejectsWith('connection-lost'));
});

test('connection: when another tab needs the database, it is released and the app is told once', async () => {
  const factory = new FakeIndexedDbFactory();
  let lostCount = 0;
  const storage = await openIndexedDbStorage(factory, { onConnectionLost: () => { lostCount += 1; } });
  await storage.saveDocument(draft('a', 'text'), NEW_DOCUMENT_REV);

  // Deleting (or upgrading) the database from elsewhere sends "versionchange" to this connection.
  // If the storage held on to it, this request would stay blocked.
  await requestDone(factory.deleteDatabase(DATABASE_NAME));

  assert.equal(lostCount, 1);
  await assert.rejects(storage.getDocument('a'), rejectsWith('connection-lost'));
  storage.close();
  assert.equal(lostCount, 1);
});

// --- writes -----------------------------------------------------------------

test('write: a failure after an earlier write in the same transaction rolls everything back', async () => {
  const storage = await openIndexedDbStorage(new FakeIndexedDbFactory());
  // The metadata write succeeds, then the content write fails because a function cannot be stored.
  const unstorable = { ...draft('a', ''), content: (() => undefined) as unknown as string };
  await assert.rejects(storage.saveDocument(unstorable, NEW_DOCUMENT_REV), rejectsWith('write-failed'));
  assert.deepEqual(await storage.listDocuments(), { documents: [], corruptCount: 0 });
  assert.equal(await storage.getDocument('a'), undefined);
});

test('write: a transaction that aborts after every request succeeded is not reported as saved', async () => {
  // This is how a quota error arrives, and the case ssMemoWeb reported as a successful save.
  const factory = factoryWithTransactionHook(new FakeIndexedDbFactory(), (transaction) => {
    if (transaction.mode !== 'readwrite') return;
    const openStore = transaction.objectStore.bind(transaction);
    transaction.objectStore = (name: string) => {
      const store = openStore(name);
      if (name !== 'docBody') return store;
      const put = store.put.bind(store);
      store.put = (...args: Parameters<IDBObjectStore['put']>) => {
        const request = put(...args);
        request.addEventListener('success', () => transaction.abort());
        return request;
      };
      return store;
    };
  });
  const storage = await openIndexedDbStorage(factory);
  await assert.rejects(storage.saveDocument(draft('a', 'text'), NEW_DOCUMENT_REV), rejectsWith('write-failed'));
  assert.equal(await storage.getDocument('a'), undefined);
});

test('write: the storage keeps working after a failed save', async () => {
  const storage = await openIndexedDbStorage(new FakeIndexedDbFactory());
  const unstorable = { ...draft('a', ''), content: (() => undefined) as unknown as string };
  await assert.rejects(storage.saveDocument(unstorable, NEW_DOCUMENT_REV), rejectsWith('write-failed'));
  const meta = await storage.saveDocument(draft('a', 'second attempt'), NEW_DOCUMENT_REV);
  assert.equal(meta.rev, 1);
  assert.equal((await storage.getDocument('a'))?.content, 'second attempt');
});

test('classifyWriteFailure tells an exhausted quota apart from other aborts', () => {
  const quota = classifyWriteFailure(new DOMException('disk full', 'QuotaExceededError'));
  assert.equal(quota.kind, 'quota');
  assert.equal((quota.cause as DOMException).name, 'QuotaExceededError');

  assert.equal(classifyWriteFailure(new DOMException('aborted', 'AbortError')).kind, 'write-failed');
  assert.equal(classifyWriteFailure(null).kind, 'write-failed');
  assert.equal(classifyWriteFailure(undefined).kind, 'write-failed');
});

// --- damaged records --------------------------------------------------------

test('damaged: malformed metadata records are skipped and counted, the rest is listed', async () => {
  const factory = new FakeIndexedDbFactory();
  const storage = await openIndexedDbStorage(factory);
  const good = await storage.saveDocument(draft('good', 'fine'), NEW_DOCUMENT_REV);
  await plantRecords(factory, {
    docMeta: [
      { id: 'no-title', createdAt: TIMESTAMP, updatedAt: TIMESTAMP, length: 1, rev: 1 },
      { id: 'wrong-types', title: 42, createdAt: TIMESTAMP, updatedAt: TIMESTAMP, length: '1', rev: 1 },
      { id: 'fraction-rev', title: 't', createdAt: TIMESTAMP, updatedAt: TIMESTAMP, length: 1, rev: 1.5 },
      { id: 'zero-rev', title: 't', createdAt: TIMESTAMP, updatedAt: TIMESTAMP, length: 1, rev: 0 },
      { id: 'negative-length', title: 't', createdAt: TIMESTAMP, updatedAt: TIMESTAMP, length: -1, rev: 1 },
    ],
  });
  const listing = await storage.listDocuments();
  assert.deepEqual(listing.documents, [good]);
  assert.equal(listing.corruptCount, 5);
});

test('damaged: unknown extra fields do not make a record malformed', async () => {
  // A newer version of the app may add fields; an older one must still read the document.
  const factory = new FakeIndexedDbFactory();
  const storage = await openIndexedDbStorage(factory);
  await plantRecords(factory, {
    docMeta: [{ id: 'a', title: 't', createdAt: TIMESTAMP, updatedAt: TIMESTAMP, length: 4, rev: 3, futureField: true }],
    docBody: [{ id: 'a', content: 'text', futureField: true }],
  });
  assert.deepEqual(await storage.getDocument('a'), {
    meta: { id: 'a', title: 't', createdAt: TIMESTAMP, updatedAt: TIMESTAMP, length: 4, rev: 3 },
    content: 'text',
  });
});

test('damaged: a malformed source is dropped and the document stays readable', async () => {
  // Losing the note about the original file is harmless; losing the text would not be.
  const factory = new FakeIndexedDbFactory();
  const storage = await openIndexedDbStorage(factory);
  const meta = (id: string, source: unknown): unknown => ({ id, title: 't', createdAt: TIMESTAMP, updatedAt: TIMESTAMP, length: 4, rev: 1, source });
  const sources: Record<string, unknown> = {
    'not-an-object': 'notes.txt',
    'unknown-encoding': { fileName: 'a.txt', encoding: 'EBCDIC', eol: 'lf', hasBom: false },
    'unknown-eol': { fileName: 'a.txt', encoding: 'UTF-8', eol: 'nel', hasBom: false },
    'no-name': { fileName: '', encoding: 'UTF-8', eol: 'lf', hasBom: false },
    'bom-not-a-flag': { fileName: 'a.txt', encoding: 'UTF-8', eol: 'lf', hasBom: 'yes' },
  };
  await plantRecords(factory, {
    docMeta: Object.entries(sources).map(([id, source]) => meta(id, source)),
    docBody: Object.keys(sources).map((id) => ({ id, content: 'text' })),
  });
  const listing = await storage.listDocuments();
  assert.equal(listing.corruptCount, 0);
  assert.equal(listing.documents.length, Object.keys(sources).length);
  for (const id of Object.keys(sources)) {
    const document = await storage.getDocument(id);
    assert.equal(document?.content, 'text', id);
    assert.equal(document && 'source' in document.meta, false, id);
  }
});

test('damaged: a valid source with extra fields is read without them', async () => {
  const factory = new FakeIndexedDbFactory();
  const storage = await openIndexedDbStorage(factory);
  await plantRecords(factory, {
    docMeta: [
      {
        id: 'a', title: 't', createdAt: TIMESTAMP, updatedAt: TIMESTAMP, length: 4, rev: 1,
        source: { fileName: 'a.txt', encoding: 'UTF-16LE', eol: 'cr', hasBom: true, futureField: 1 },
      },
    ],
    docBody: [{ id: 'a', content: 'text' }],
  });
  assert.deepEqual((await storage.getDocument('a'))?.meta.source, { fileName: 'a.txt', encoding: 'UTF-16LE', eol: 'cr', hasBom: true });
});

test('damaged: a document with missing or malformed parts is treated as absent', async () => {
  const factory = new FakeIndexedDbFactory();
  const storage = await openIndexedDbStorage(factory);
  const meta = (id: string): unknown => ({ id, title: 't', createdAt: TIMESTAMP, updatedAt: TIMESTAMP, length: 1, rev: 1 });
  await plantRecords(factory, {
    docMeta: [meta('no-body'), meta('bad-body'), { id: 'bad-meta', title: null }],
    docBody: [{ id: 'bad-body', content: 123 }, { id: 'bad-meta', content: 'text' }, { id: 'no-meta', content: 'text' }],
  });
  for (const id of ['no-body', 'bad-body', 'bad-meta', 'no-meta']) {
    assert.equal(await storage.getDocument(id), undefined, id);
  }
});

test('damaged: getAllDocuments leaves out what cannot be read and says how much that was', async () => {
  const factory = new FakeIndexedDbFactory();
  const storage = await openIndexedDbStorage(factory);
  const good = await storage.saveDocument(draft('good', 'fine'), NEW_DOCUMENT_REV);
  const meta = (id: string): unknown => ({ id, title: 't', createdAt: TIMESTAMP, updatedAt: TIMESTAMP, length: 1, rev: 1 });
  await plantRecords(factory, {
    docMeta: [meta('no-body'), meta('bad-body'), { id: 'bad-meta', title: null }],
    docBody: [{ id: 'bad-body', content: 123 }, { id: 'bad-meta', content: 'text' }, { id: 'no-meta', content: 'orphaned text' }],
  });
  const snapshot = await storage.getAllDocuments();
  assert.deepEqual(snapshot.documents, [{ meta: good, content: 'fine' }]);
  // Text without usable metadata counts too: it exists but will be missing from a backup.
  assert.equal(snapshot.corruptCount, 4);
});

test('damaged: a malformed record can be replaced by creating the document anew', async () => {
  const factory = new FakeIndexedDbFactory();
  const storage = await openIndexedDbStorage(factory);
  await plantRecords(factory, { docMeta: [{ id: 'a', title: null }] });
  const meta = await storage.saveDocument(draft('a', 'repaired'), NEW_DOCUMENT_REV);
  assert.equal(meta.rev, 1);
  assert.deepEqual(await storage.listDocuments(), { documents: [meta], corruptCount: 0 });
});

test('write: writeDocuments stores all or nothing, even when it was to replace everything', async () => {
  const storage = await openIndexedDbStorage(new FakeIndexedDbFactory());
  const before = await storage.saveDocument(draft('old', 'precious'), NEW_DOCUMENT_REV);
  // The second draft cannot be stored because a function is not data.
  const unstorable = { ...draft('bad', 'x'), content: (() => undefined) as unknown as string };
  await assert.rejects(storage.writeDocuments([draft('new', 'fine'), unstorable], { replaceAll: true }), rejectsWith('write-failed'));
  assert.deepEqual(await storage.getAllDocuments(), { documents: [{ meta: before, content: 'precious' }], corruptCount: 0 });
});

test('write: a value that cannot be stored is reported as a failed write', async () => {
  const storage = await openIndexedDbStorage(new FakeIndexedDbFactory());
  await assert.rejects(storage.setValue('settings', { callback: () => undefined }), rejectsWith('write-failed'));
  assert.equal(await storage.getValue('settings'), undefined);
});
