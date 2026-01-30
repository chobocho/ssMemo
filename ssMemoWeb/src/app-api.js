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
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'custom-modal-overlay';
            modal.innerHTML = `
                <div class="custom-modal">
                    <div class="custom-modal-header">${this.escapeHtml(title)}</div>
                    <div class="custom-modal-body">${this.escapeHtml(message)}</div>
                    <div class="custom-modal-footer">
                        <button class="custom-modal-btn">확인</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            const btn = modal.querySelector('.custom-modal-btn');
            const closeModal = () => {
                modal.remove();
                resolve();
            };

            btn.addEventListener('click', closeModal);
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeModal();
            });
        });
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    openURL(url) {
        if (window?.go?.main?.App?.OpenURL) {
            return window.go.main.App.OpenURL(url);
        }
        window.open(url, '_blank', 'noopener');
    },
};
