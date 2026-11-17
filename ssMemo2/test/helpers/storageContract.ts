// The behaviour every StoragePort implementation must have. The in-memory fallback and the
// IndexedDB storage both run this suite, so the app behaves the same on either.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEW_DOCUMENT_REV, StorageError } from '../../src/storage/storagePort.ts';
import type { DocumentDraft, StoragePort } from '../../src/storage/storagePort.ts';

const CREATED_AT = '2026-01-01T00:00:00.000Z';
const UPDATED_AT = '2026-01-02T00:00:00.000Z';
const ONE_MEBIBYTE = 1024 * 1024;

function draft(id: string, content: string, overrides: Partial<DocumentDraft> = {}): DocumentDraft {
  return { id, title: `title of ${id}`, content, createdAt: CREATED_AT, updatedAt: CREATED_AT, ...overrides };
}

function isConflict(error: unknown): boolean {
  return error instanceof StorageError && error.kind === 'conflict';
}

/** Registers the contract tests for the storage produced by `createStorage` (a fresh, empty one per call). */
export function defineStorageContract(label: string, createStorage: () => Promise<StoragePort>): void {
  test(`${label}: an empty storage lists nothing and finds nothing`, async () => {
    const storage = await createStorage();
    assert.deepEqual(await storage.listDocuments(), { documents: [], corruptCount: 0 });
    assert.equal(await storage.getDocument('missing'), undefined);
    assert.equal(await storage.deleteDocument('missing'), false);
  });

  test(`${label}: creating a document stores it at revision 1`, async () => {
    const storage = await createStorage();
    const meta = await storage.saveDocument(draft('a', 'hello'), NEW_DOCUMENT_REV);
    assert.deepEqual(meta, { id: 'a', title: 'title of a', createdAt: CREATED_AT, updatedAt: CREATED_AT, length: 5, rev: 1 });
    assert.deepEqual(await storage.getDocument('a'), { meta, content: 'hello' });
  });

  test(`${label}: listing returns metadata without the content`, async () => {
    const storage = await createStorage();
    await storage.saveDocument(draft('a', 'first'), NEW_DOCUMENT_REV);
    await storage.saveDocument(draft('b', 'second!'), NEW_DOCUMENT_REV);
    const listing = await storage.listDocuments();
    assert.equal(listing.corruptCount, 0);
    assert.deepEqual(
      listing.documents.map((meta) => [meta.id, meta.length]).sort(),
      [['a', 5], ['b', 7]],
    );
    for (const meta of listing.documents) {
      assert.equal('content' in meta, false);
    }
  });

  test(`${label}: saving with the current revision replaces the content`, async () => {
    const storage = await createStorage();
    const created = await storage.saveDocument(draft('a', 'old'), NEW_DOCUMENT_REV);
    const updated = await storage.saveDocument(
      draft('a', 'newer text', { title: 'renamed', updatedAt: UPDATED_AT }),
      created.rev,
    );
    assert.deepEqual(updated, { id: 'a', title: 'renamed', createdAt: CREATED_AT, updatedAt: UPDATED_AT, length: 10, rev: 2 });
    assert.deepEqual(await storage.getDocument('a'), { meta: updated, content: 'newer text' });
  });

  test(`${label}: saving with a stale revision is a conflict and changes nothing`, async () => {
    const storage = await createStorage();
    const created = await storage.saveDocument(draft('a', 'one'), NEW_DOCUMENT_REV);
    const second = await storage.saveDocument(draft('a', 'two'), created.rev);
    // Another window still holds revision 1 and tries to save over revision 2.
    await assert.rejects(storage.saveDocument(draft('a', 'from a stale window'), created.rev), isConflict);
    assert.deepEqual(await storage.getDocument('a'), { meta: second, content: 'two' });
  });

  test(`${label}: creating a document whose id already exists is a conflict`, async () => {
    const storage = await createStorage();
    await storage.saveDocument(draft('a', 'original'), NEW_DOCUMENT_REV);
    await assert.rejects(storage.saveDocument(draft('a', 'duplicate'), NEW_DOCUMENT_REV), isConflict);
    assert.equal((await storage.getDocument('a'))?.content, 'original');
  });

  test(`${label}: updating a document that no longer exists is a conflict`, async () => {
    const storage = await createStorage();
    const created = await storage.saveDocument(draft('a', 'text'), NEW_DOCUMENT_REV);
    await storage.deleteDocument('a');
    await assert.rejects(storage.saveDocument(draft('a', 'text 2'), created.rev), isConflict);
    assert.equal(await storage.getDocument('a'), undefined);
  });

  test(`${label}: deleting removes the document and reports whether it existed`, async () => {
    const storage = await createStorage();
    await storage.saveDocument(draft('a', 'text'), NEW_DOCUMENT_REV);
    assert.equal(await storage.deleteDocument('a'), true);
    assert.equal(await storage.getDocument('a'), undefined);
    assert.deepEqual((await storage.listDocuments()).documents, []);
    assert.equal(await storage.deleteDocument('a'), false);
  });

  test(`${label}: a deleted id can be created again from revision 1`, async () => {
    const storage = await createStorage();
    await storage.saveDocument(draft('a', 'first life'), NEW_DOCUMENT_REV);
    await storage.deleteDocument('a');
    const recreated = await storage.saveDocument(draft('a', 'second life'), NEW_DOCUMENT_REV);
    assert.equal(recreated.rev, 1);
  });

  test(`${label}: returned objects are copies, not live references`, async () => {
    const storage = await createStorage();
    const meta = await storage.saveDocument(draft('a', 'text'), NEW_DOCUMENT_REV);
    meta.title = 'changed by the caller';
    const loaded = await storage.getDocument('a');
    assert.equal(loaded?.meta.title, 'title of a');
    if (loaded) loaded.meta.title = 'changed again';
    const listing = await storage.listDocuments();
    assert.equal(listing.documents[0]?.title, 'title of a');
  });

  test(`${label}: the draft given to save is not kept by reference`, async () => {
    const storage = await createStorage();
    const input = draft('a', 'text');
    await storage.saveDocument(input, NEW_DOCUMENT_REV);
    input.title = 'changed after saving';
    assert.equal((await storage.getDocument('a'))?.meta.title, 'title of a');
  });

  test(`${label}: content survives a round trip byte for byte`, async () => {
    const storage = await createStorage();
    const samples: Record<string, string> = {
      empty: '',
      korean: '한글 메모\n둘째 줄',
      emoji: 'done ✅ 🟩 👨‍👩‍👧',
      controlCharacters: 'a\u0000b\tc\r\nd',
      loneSurrogate: 'x\ud83dy',
      large: 'memo line\n'.repeat(ONE_MEBIBYTE / 10),
    };
    for (const [id, content] of Object.entries(samples)) {
      const meta = await storage.saveDocument(draft(id, content), NEW_DOCUMENT_REV);
      assert.equal(meta.length, content.length, id);
      assert.equal((await storage.getDocument(id))?.content, content, id);
    }
  });
}
