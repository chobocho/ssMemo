// In-memory StoragePort. The app falls back to it when IndexedDB cannot be opened (everything
// keeps working, but nothing survives a reload), and it is the reference implementation in tests.
import { createNextMeta } from './storagePort.ts';
import type { StoragePort, StoredDocument } from './storagePort.ts';

export function createMemoryStorage(): StoragePort {
  const documents = new Map<string, StoredDocument>();

  // Metadata is a flat record of strings and numbers, so a shallow copy is a full copy.
  // Copies keep callers from changing stored data by mutating what they were given.
  return {
    async listDocuments() {
      return { documents: [...documents.values()].map((document) => ({ ...document.meta })), corruptCount: 0 };
    },

    async getDocument(id) {
      const document = documents.get(id);
      return document ? { meta: { ...document.meta }, content: document.content } : undefined;
    },

    async saveDocument(draft, expectedRev) {
      const meta = createNextMeta(draft, documents.get(draft.id)?.meta.rev, expectedRev);
      documents.set(draft.id, { meta, content: draft.content });
      return { ...meta };
    },

    async deleteDocument(id) {
      return documents.delete(id);
    },
  };
}
