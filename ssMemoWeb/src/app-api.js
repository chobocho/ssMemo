// ========================================
// Application API Wrapper
// ========================================
import { createDataSource } from './data-sources/index.js';
import { STORAGE_CONFIG } from './storage-config.js';

const dataSource = createDataSource(STORAGE_CONFIG);

export const AppAPI = {
    async init() {
        if (dataSource?.init) {
            await dataSource.init();
        }
    },

    async getNoteByDate(key) {
        return dataSource.getNoteByDate(key);
    },

    async saveOrUpdateNoteByDate(key, content) {
        return dataSource.saveOrUpdateNoteByDate(key, content);
    },

    async showMessage(title, message) {
        alert(`${title}\n\n${message}`);
    },

    openURL(url) {
        if (window?.go?.main?.App?.OpenURL) {
            return window.go.main.App.OpenURL(url);
        }
        window.open(url, '_blank', 'noopener');
    },
};
