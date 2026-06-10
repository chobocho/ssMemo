// ========================================
// In-memory 데이터 소스 (IndexedDB 폴백용)
// ========================================
export class MemorySource {
    constructor() {
        this.store = new Map();
    }

    async init() { /* nothing */ }

    async getRecord(key) {
        const record = this.store.get(key);
        return {
            key,
            content: record?.content ?? '',
            updatedAt: record?.updatedAt ?? null,
        };
    }

    async saveRecord(key, content) {
        const record = {
            key,
            content,
            updatedAt: new Date().toISOString(),
        };
        this.store.set(key, record);
        return record;
    }

    async listKeys(prefix = '') {
        const out = [];
        for (const [key, rec] of this.store.entries()) {
            if (!prefix || key.startsWith(prefix)) {
                out.push({
                    key,
                    content: rec.content,
                    updatedAt: rec.updatedAt,
                });
            }
        }
        return out;
    }

    async deleteKey(key) {
        return this.store.delete(key);
    }
}
