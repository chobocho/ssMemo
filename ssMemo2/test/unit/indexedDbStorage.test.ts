// Runs IndexedDbStorage against fake-indexeddb, an in-process IndexedDB implementation, so the
// real transaction semantics are exercised without a browser. Each test gets its own factory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory as FakeIndexedDbFactory } from 'fake-indexeddb';
import { DATABASE_NAME, openIndexedDbStorage } from '../../src/storage/indexedDbStorage.ts';
import { NEW_DOCUMENT_REV, StorageError } from '../../src/storage/storagePort.ts';
import type { DocumentDraft } from '../../src/storage/storagePort.ts';
import { defineStorageContract } from '../helpers/storageContract.ts';

const TIMESTAMP = '2026-01-01T00:00:00.000Z';

function draft(id: string, content: string): DocumentDraft {
  return { id, title: id, content, createdAt: TIMESTAMP, updatedAt: TIMESTAMP };
}

/** Opens the database directly, bypassing the storage, to inspect what was really written. */
function openRaw(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

defineStorageContract('IndexedDbStorage', async () => openIndexedDbStorage(new FakeIndexedDbFactory()));

test('IndexedDbStorage: the database has the document and key-value stores', async () => {
  const factory = new FakeIndexedDbFactory();
  const storage = await openIndexedDbStorage(factory);
  storage.close();
  const database = await openRaw(factory);
  assert.deepEqual([...database.objectStoreNames].sort(), ['docBody', 'docMeta', 'kv']);
  database.close();
});

test('IndexedDbStorage: documents are still there after closing and reopening', async () => {
  const factory = new FakeIndexedDbFactory();
  const first = await openIndexedDbStorage(factory);
  const meta = await first.saveDocument(draft('a', 'kept across sessions'), NEW_DOCUMENT_REV);
  first.close();

  const second = await openIndexedDbStorage(factory);
  assert.deepEqual(await second.getDocument('a'), { meta, content: 'kept across sessions' });
  assert.deepEqual((await second.listDocuments()).documents, [meta]);
  second.close();
});

test('IndexedDbStorage: content and metadata are stored in separate records', async () => {
  // Listing must not have to read document bodies, which can be megabytes each.
  const factory = new FakeIndexedDbFactory();
  const storage = await openIndexedDbStorage(factory);
  await storage.saveDocument(draft('a', 'body text'), NEW_DOCUMENT_REV);
  storage.close();

  const database = await openRaw(factory);
  const transaction = database.transaction(['docMeta', 'docBody'], 'readonly');
  const metaRequest = transaction.objectStore('docMeta').get('a');
  const bodyRequest = transaction.objectStore('docBody').get('a');
  await new Promise<void>((resolve) => {
    transaction.oncomplete = () => resolve();
  });
  assert.equal('content' in (metaRequest.result as object), false);
  assert.deepEqual(bodyRequest.result, { id: 'a', content: 'body text' });
  database.close();
});

test('IndexedDbStorage: a second connection sees writes and its stale save is a conflict', async () => {
  // Two browser tabs share one database: the tab that saves second must not overwrite the first.
  const factory = new FakeIndexedDbFactory();
  const tabA = await openIndexedDbStorage(factory);
  const tabB = await openIndexedDbStorage(factory);

  const created = await tabA.saveDocument(draft('a', 'from tab A'), NEW_DOCUMENT_REV);
  assert.equal((await tabB.getDocument('a'))?.content, 'from tab A');

  const savedByB = await tabB.saveDocument(draft('a', 'from tab B'), created.rev);
  assert.equal(savedByB.rev, 2);
  await assert.rejects(
    tabA.saveDocument(draft('a', 'tab A again, unaware of B'), created.rev),
    (error) => error instanceof StorageError && error.kind === 'conflict',
  );
  assert.equal((await tabA.getDocument('a'))?.content, 'from tab B');
  tabA.close();
  tabB.close();
});

test('IndexedDbStorage: values are still there after closing and reopening', async () => {
  const factory = new FakeIndexedDbFactory();
  const first = await openIndexedDbStorage(factory);
  await first.setValue('settings', { language: 'ko' });
  first.close();

  const second = await openIndexedDbStorage(factory);
  assert.deepEqual(await second.getValue('settings'), { language: 'ko' });
  second.close();
});

test('IndexedDbStorage: two connections updating the same value do not lose each other\'s change', async () => {
  // Two browser tabs each add to a list at the same moment. With a separate read and write, one
  // of the additions would be overwritten.
  const factory = new FakeIndexedDbFactory();
  const tabA = await openIndexedDbStorage(factory);
  const tabB = await openIndexedDbStorage(factory);
  const add = (storage: typeof tabA, item: string): Promise<void> =>
    storage.updateValue('trash', (current) => [...(Array.isArray(current) ? (current as string[]) : []), item]);
  await Promise.all([add(tabA, 'from A'), add(tabB, 'from B'), add(tabA, 'from A again')]);
  const stored = (await tabB.getValue('trash')) as string[];
  assert.deepEqual([...stored].sort(), ['from A', 'from A again', 'from B']);
  tabA.close();
  tabB.close();
});
