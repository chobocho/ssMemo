// ========================================
// Application API Wrapper
// ========================================
import { createDataSource } from './data-sources/index.js';
import { MemorySource } from './data-sources/memory.js';
import { STORAGE_CONFIG } from './storage-config.js';

let dataSource = createDataSource(STORAGE_CONFIG);
let usingFallback = false;

async function fallbackToMemory(reason) {
    if (usingFallback) return;
    usingFallback = true;
    console.warn('[ssMemo] IndexedDB 실패 → 메모리 저장소로 폴백:', reason);
    dataSource = new MemorySource();
    await dataSource.init();
    AppAPI.showMessage(
        '저장소 경고',
        '브라우저 저장소(IndexedDB)에 접근할 수 없어 임시 메모리 저장으로 동작합니다. 새로고침 시 변경 내용이 유지되지 않을 수 있습니다.'
    );
}

export const AppAPI = {
    async init() {
        try {
            if (dataSource?.init) await dataSource.init();
        } catch (err) {
            await fallbackToMemory(err);
        }
    },

    async getNoteByDate(key) {
        try {
            return await dataSource.getNoteByDate(key);
        } catch (err) {
            await fallbackToMemory(err);
            return dataSource.getNoteByDate(key);
        }
    },

    async saveOrUpdateNoteByDate(key, content) {
        try {
            return await dataSource.saveOrUpdateNoteByDate(key, content);
        } catch (err) {
            await fallbackToMemory(err);
            return dataSource.saveOrUpdateNoteByDate(key, content);
        }
    },

    isUsingFallback() {
        return usingFallback;
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

    async confirm(title, message) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'custom-modal-overlay';
            modal.innerHTML = `
                <div class="custom-modal">
                    <div class="custom-modal-header">${this.escapeHtml(title)}</div>
                    <div class="custom-modal-body">${this.escapeHtml(message)}</div>
                    <div class="custom-modal-footer">
                        <button class="custom-modal-btn custom-modal-btn-cancel">취소</button>
                        <button class="custom-modal-btn custom-modal-btn-danger">확인</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            const cleanup = (result) => {
                modal.remove();
                resolve(result);
            };

            modal.querySelector('.custom-modal-btn-cancel')
                .addEventListener('click', () => cleanup(false));
            modal.querySelector('.custom-modal-btn-danger')
                .addEventListener('click', () => cleanup(true));
            modal.addEventListener('click', (e) => {
                if (e.target === modal) cleanup(false);
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

    showLoading(message = '파일을 불러오는 중...') {
        let overlay = document.getElementById('loading-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'loading-overlay';
            overlay.className = 'loading-overlay';
            overlay.innerHTML = `
                <div class="loading-overlay-icon">⏳</div>
                <div class="loading-overlay-message"></div>
            `;
            document.body.appendChild(overlay);
        }
        overlay.querySelector('.loading-overlay-message').textContent = message;
        overlay.style.display = 'flex';
    },

    hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.remove();
    },
};
