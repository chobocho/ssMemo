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

    async getRecord(key) {
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

    async saveRecord(key, content) {
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

    // prefix와 일치하는 키를 가진 레코드 목록을 반환. prefix가 없으면 전체.
    async listKeys(prefix = '') {
        const db = await this.ensureDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.options.storeName, 'readonly');
            const store = tx.objectStore(this.options.storeName);
            const req = store.openCursor();
            const out = [];
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (!cursor) { resolve(out); return; }
                if (!prefix || cursor.key.startsWith(prefix)) {
                    const v = cursor.value;
                    out.push({
                        key: cursor.key,
                        content: v?.content ?? '',
                        updatedAt: v?.updatedAt ?? null,
                    });
                }
                cursor.continue();
            };
            req.onerror = () => reject(req.error);
        });
    }

    async deleteKey(key) {
        const db = await this.ensureDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.options.storeName, 'readwrite');
            const store = tx.objectStore(this.options.storeName);
            const req = store.delete(key);
            req.onsuccess = () => resolve(true);
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
