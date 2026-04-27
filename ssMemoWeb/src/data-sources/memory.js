// ========================================
// In-memory 데이터 소스 (IndexedDB 폴백용)
// ========================================
export class MemorySource {
    constructor() {
        this.store = new Map();
    }

    async init() { /* nothing */ }

    async getNoteByDate(key) {
        const record = this.store.get(key);
        return {
            key,
            content: record?.content ?? '',
            updatedAt: record?.updatedAt ?? null,
        };
    }

    async saveOrUpdateNoteByDate(key, content) {
        const record = {
            key,
            content,
            updatedAt: new Date().toISOString(),
        };
        this.store.set(key, record);
        return record;
    }
}
