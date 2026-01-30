// ========================================
// IndexedDB Data Source
// ========================================
export class IndexedDbSource {
    constructor(options) {
        this.options = options;
        this.db = null;
    }

    async init() {
        this.db = await this.openDb();
    }

    async getNoteByDate(key) {
        const db = await this.ensureDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.options.storeName, 'readonly');
            const store = tx.objectStore(this.options.storeName);
            const req = store.get(key);

            req.onsuccess = () => {
                const record = req.result;
                resolve({
                    key,
                    content: record?.content ?? '',
                    updatedAt: record?.updatedAt ?? null,
                });
            };
            req.onerror = () => reject(req.error);
        });
    }

    async saveOrUpdateNoteByDate(key, content) {
        const db = await this.ensureDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.options.storeName, 'readwrite');
            const store = tx.objectStore(this.options.storeName);
            const record = {
                key,
                content,
                updatedAt: new Date().toISOString(),
            };
            const req = store.put(record);

            req.onsuccess = () => resolve(record);
            req.onerror = () => reject(req.error);
        });
    }

    async ensureDb() {
        if (!this.db) {
            this.db = await this.openDb();
        }
        return this.db;
    }

    openDb() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.options.dbName, this.options.version);

            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(this.options.storeName)) {
                    db.createObjectStore(this.options.storeName, { keyPath: 'key' });
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}
