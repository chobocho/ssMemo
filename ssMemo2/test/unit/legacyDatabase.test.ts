import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory as FakeIndexedDbFactory } from 'fake-indexeddb';
import { DATABASE_NAME, openIndexedDbStorage } from '../../src/storage/indexedDbStorage.ts';
import { LEGACY_DATABASE_NAME, LEGACY_STORE_NAME, readLegacyRecords } from '../../src/storage/legacyDatabase.ts';
import { NEW_DOCUMENT_REV } from '../../src/storage/storagePort.ts';

const UPDATED_AT = '2025-06-01T10:00:00.000Z';

interface OldDatabaseOptions {
  version?: number;
  storeName?: string;
  records?: unknown[];
}

/** Creates the database the way ssMemoWeb did: one store keyed by "key". */
function createOldDatabase(factory: IDBFactory, options: OldDatabaseOptions = {}): Promise<void> {
  const storeName = options.storeName ?? LEGACY_STORE_NAME;
  return new Promise((resolve, reject) => {
    const request = factory.open(LEGACY_DATABASE_NAME, options.version ?? 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'key' });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(storeName, 'readwrite');
      for (const record of options.records ?? []) transaction.objectStore(storeName).put(record);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

async function databaseNames(factory: IDBFactory): Promise<(string | undefined)[]> {
  return (await factory.databases()).map((info) => info.name).sort();
}

function deleteDatabase(factory: IDBFactory, name: string): Promise<'deleted' | 'blocked'> {
  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => resolve('deleted');
    request.onblocked = () => resolve('blocked');
    request.onerror = () => reject(request.error);
  });
}

const RECORDS = [
  { key: 'memo:Shopping', content: 'milk', updatedAt: UPDATED_AT },
  { key: 'memo:Ideas', content: 'write tests', updatedAt: UPDATED_AT },
  { key: '__CALC_MEMORY__', content: '{}', updatedAt: UPDATED_AT },
];

test('where the old app was never used, nothing is found and no database is left behind', async () => {
  const factory = new FakeIndexedDbFactory();
  assert.equal(await readLegacyRecords(factory), undefined);
  // Merely opening a database creates it; looking must not do that.
  assert.deepEqual(await databaseNames(factory), []);
  // And asking twice is no different.
  assert.equal(await readLegacyRecords(factory), undefined);
  assert.deepEqual(await databaseNames(factory), []);
});

test('every record of the old app is read as it is stored', async () => {
  const factory = new FakeIndexedDbFactory();
  await createOldDatabase(factory, { records: RECORDS });
  const records = await readLegacyRecords(factory);
  assert.deepEqual([...(records ?? [])].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))), [
    { key: '__CALC_MEMORY__', content: '{}', updatedAt: UPDATED_AT },
    { key: 'memo:Ideas', content: 'write tests', updatedAt: UPDATED_AT },
    { key: 'memo:Shopping', content: 'milk', updatedAt: UPDATED_AT },
  ]);
});

test('an old database without any record gives an empty list, not "nothing found"', async () => {
  const factory = new FakeIndexedDbFactory();
  await createOldDatabase(factory);
  assert.deepEqual(await readLegacyRecords(factory), []);
});

test('reading changes nothing in the old database', async () => {
  const factory = new FakeIndexedDbFactory();
  await createOldDatabase(factory, { version: 3, records: RECORDS });
  await readLegacyRecords(factory);
  const [info] = await factory.databases();
  assert.deepEqual(info, { name: LEGACY_DATABASE_NAME, version: 3 });
  assert.equal((await readLegacyRecords(factory))?.length, RECORDS.length);
});

test('a database of that name without the store of the old app counts as nothing found', async () => {
  const factory = new FakeIndexedDbFactory();
  await createOldDatabase(factory, { storeName: 'something-else', records: RECORDS });
  assert.equal(await readLegacyRecords(factory), undefined);
});

test('the old database is not kept open', async () => {
  // An open connection would keep the old app, or the browser, from ever removing its database.
  const factory = new FakeIndexedDbFactory();
  await createOldDatabase(factory, { records: RECORDS });
  await readLegacyRecords(factory);
  assert.equal(await deleteDatabase(factory, LEGACY_DATABASE_NAME), 'deleted');
});

test('the database of this app is not touched', async () => {
  const factory = new FakeIndexedDbFactory();
  const storage = await openIndexedDbStorage(factory);
  await storage.saveDocument({ id: 'a', title: 'Mine', content: 'kept', createdAt: UPDATED_AT, updatedAt: UPDATED_AT }, NEW_DOCUMENT_REV);
  await createOldDatabase(factory, { records: RECORDS });
  await readLegacyRecords(factory);
  assert.equal((await storage.getDocument('a'))?.content, 'kept');
  assert.deepEqual(await databaseNames(factory), [LEGACY_DATABASE_NAME, DATABASE_NAME].sort());
  storage.close();
});

test('a browser that refuses access makes reading fail instead of reporting an empty result', async () => {
  const refusing = {
    open: () => {
      throw new Error('access denied');
    },
  } as unknown as IDBFactory;
  await assert.rejects(readLegacyRecords(refusing), /access denied/);
});

test('a database that never answers is given up on', async () => {
  const silent = { open: () => ({}) } as unknown as IDBFactory;
  await assert.rejects(readLegacyRecords(silent, 20), /did not open/);
});
