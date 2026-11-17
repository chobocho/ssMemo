// In-memory StoragePort. The app falls back to it when IndexedDB cannot be opened (everything
// keeps working, but nothing survives a reload), and it is the reference implementation in tests.
import { NEW_DOCUMENT_REV, copyMeta, createNextMeta } from './storagePort.ts';
import type { StoragePort, StoredDocument } from './storagePort.ts';

export function createMemoryStorage(): StoragePort {
  const documents = new Map<string, StoredDocument>();
  const values = new Map<string, unknown>();

  // Copies keep callers from changing stored data by mutating what they were given.
  return {
    async listDocuments() {
      return { documents: [...documents.values()].map((document) => copyMeta(document.meta)), corruptCount: 0 };
    },

    async getDocument(id) {
      const document = documents.get(id);
      return document ? { meta: copyMeta(document.meta), content: document.content } : undefined;
    },

    async getAllDocuments() {
      const all = [...documents.values()].map((document) => ({ meta: copyMeta(document.meta), content: document.content }));
      return { documents: all, corruptCount: 0 };
    },

    async saveDocument(draft, expectedRev) {
      const meta = createNextMeta(draft, documents.get(draft.id)?.meta.rev, expectedRev);
      documents.set(draft.id, { meta, content: draft.content });
      return copyMeta(meta);
    },

    async writeDocuments(drafts, { replaceAll }) {
      // Every new record is prepared before anything is changed, so a failure changes nothing.
      const written = new Map<string, StoredDocument>();
      for (const draft of drafts) {
        const storedRev = documents.get(draft.id)?.meta.rev;
        written.set(draft.id, { meta: createNextMeta(draft, storedRev, storedRev ?? NEW_DOCUMENT_REV), content: draft.content });
      }
      if (replaceAll) documents.clear();
      for (const [id, document] of written) documents.set(id, document);
    },

    async deleteDocument(id) {
      return documents.delete(id);
    },

    // structuredClone copies on the way in and out, as IndexedDB does.
    async getValue(key) {
      return structuredClone(values.get(key));
    },

    async setValue(key, value) {
      values.set(key, structuredClone(value));
    },
  };
}
