// ========================================
// Data Source Factory
// ========================================
import { IndexedDbSource } from './indexeddb.js';
import { RestSource } from './rest.js';

export function createDataSource(config) {
    if (config.mode === 'rest') {
        return new RestSource(config.rest);
    }
    return new IndexedDbSource(config.indexedDB);
}
