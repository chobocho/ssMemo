// ========================================
// Storage Configuration
// ========================================
export const STORAGE_CONFIG = {
    mode: 'indexeddb', // 'indexeddb' | 'rest'
    indexedDB: {
        dbName: 'ssMemo',
        storeName: 'notes',
        version: 1,
    },
    rest: {
        baseUrl: '/api',
        timeoutMs: 10000,
    },
};
