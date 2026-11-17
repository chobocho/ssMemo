import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory as FakeIndexedDbFactory } from 'fake-indexeddb';
import { DATABASE_NAME } from '../../src/storage/indexedDbStorage.ts';
import { isSafeModeRequested, openStorage } from '../../src/storage/openStorage.ts';
import { NEW_DOCUMENT_REV } from '../../src/storage/storagePort.ts';
import type { DocumentDraft } from '../../src/storage/storagePort.ts';

const TIMESTAMP = '2026-01-01T00:00:00.000Z';
const SHORT_TIMEOUT_MS = 5;

function draft(id: string, content: string): DocumentDraft {
  return { id, title: id, content, createdAt: TIMESTAMP, updatedAt: TIMESTAMP };
}

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// --- openStorage ------------------------------------------------------------

test('openStorage uses IndexedDB when it works, and what is saved survives a reopen', async () => {
  const factory = new FakeIndexedDbFactory();
  const first = await openStorage({ getIndexedDb: () => factory, safeMode: false });
  assert.equal(first.mode, 'persistent');
  assert.equal(first.reason, undefined);
  await first.storage.saveDocument(draft('a', 'kept'), NEW_DOCUMENT_REV);

  const second = await openStorage({ getIndexedDb: () => factory, safeMode: false });
  assert.equal((await second.storage.getDocument('a'))?.content, 'kept');
});

test('openStorage in safe mode is temporary and never touches IndexedDB', async () => {
  const factory = new FakeIndexedDbFactory();
  let factoryRequested = false;
  const opened = await openStorage({
    getIndexedDb: () => {
      factoryRequested = true;
      return factory;
    },
    safeMode: true,
  });
  assert.equal(opened.mode, 'temporary');
  assert.equal(opened.reason, 'safe-mode');
  assert.equal(factoryRequested, false);
  assert.deepEqual(await factory.databases(), []);
});

test('openStorage falls back to temporary storage when the browser has no IndexedDB', async () => {
  const opened = await openStorage({ getIndexedDb: () => undefined, safeMode: false });
  assert.equal(opened.mode, 'temporary');
  assert.equal(opened.reason, 'unavailable');
});

test('openStorage falls back when even reading the IndexedDB property throws', async () => {
  const opened = await openStorage({
    getIndexedDb: () => {
      throw new DOMException('storage is blocked for this page', 'SecurityError');
    },
    safeMode: false,
  });
  assert.equal(opened.mode, 'temporary');
  assert.equal(opened.reason, 'unavailable');
  assert.equal((opened.error as DOMException).name, 'SecurityError');
});

test('openStorage falls back when the database does not open in time', async () => {
  const hangingFactory = { open: () => ({}) } as unknown as IDBFactory;
  const opened = await openStorage({ getIndexedDb: () => hangingFactory, safeMode: false, timeoutMs: SHORT_TIMEOUT_MS });
  assert.equal(opened.mode, 'temporary');
  assert.equal(opened.reason, 'unavailable');
});

test('the temporary storage works, starts empty, and is not shared between openings', async () => {
  const first = await openStorage({ getIndexedDb: () => undefined, safeMode: false });
  await first.storage.saveDocument(draft('a', 'only in memory'), NEW_DOCUMENT_REV);
  assert.equal((await first.storage.getDocument('a'))?.content, 'only in memory');

  const second = await openStorage({ getIndexedDb: () => undefined, safeMode: false });
  assert.deepEqual((await second.storage.listDocuments()).documents, []);
});

test('openStorage passes a lost connection on to the app', async () => {
  const factory = new FakeIndexedDbFactory();
  let lostCount = 0;
  await openStorage({ getIndexedDb: () => factory, safeMode: false, onConnectionLost: () => { lostCount += 1; } });
  await requestDone(factory.deleteDatabase(DATABASE_NAME));
  assert.equal(lostCount, 1);
});

// --- isSafeModeRequested ----------------------------------------------------

test('isSafeModeRequested accepts ?safe with or without a value', () => {
  for (const search of ['?safe', '?safe=', '?safe=1', '?safe=true', '?other=1&safe', '?safe&other=1']) {
    assert.equal(isSafeModeRequested(search), true, search);
  }
});

test('isSafeModeRequested is off by default and can be switched off explicitly', () => {
  for (const search of ['', '?', '?other=1', '?unsafe', '?safety=1', '?safe=0', '?safe=false', '?safe=off', '?safe=no']) {
    assert.equal(isSafeModeRequested(search), false, search);
  }
});
