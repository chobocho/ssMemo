// ========================================
// Application API Wrapper
// ========================================
import { createDataSource } from './data-sources/index.js';
import { MemorySource } from './data-sources/memory.js';
import { STORAGE_CONFIG } from './storage-config.js';
import { escapeHtml } from './markdown.js';

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

// 모달 overlay에 ESC 닫기를 연결. 모달이 겹쳐 있으면 최상단 overlay만 반응.
// 반환된 detach 함수를 모달 정리 시 반드시 호출해 document 리스너를 해제한다.
function attachEscToClose(overlay, onClose) {
    const onKey = (e) => {
        if (e.key !== 'Escape') return;
        const overlays = document.querySelectorAll('.custom-modal-overlay');
        if (overlays[overlays.length - 1] !== overlay) return;
        e.preventDefault();
        onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
}

export const AppAPI = {
    async init() {
        try {
            if (dataSource?.init) await dataSource.init();
        } catch (err) {
            await fallbackToMemory(err);
        }
    },

    async getRecord(key) {
        try {
            return await dataSource.getRecord(key);
        } catch (err) {
            await fallbackToMemory(err);
            return dataSource.getRecord(key);
        }
    },

    async saveRecord(key, content) {
        try {
            return await dataSource.saveRecord(key, content);
        } catch (err) {
            await fallbackToMemory(err);
            return dataSource.saveRecord(key, content);
        }
    },

    async listKeys(prefix = '') {
        try {
            return await dataSource.listKeys(prefix);
        } catch (err) {
            await fallbackToMemory(err);
            return dataSource.listKeys(prefix);
        }
    },

    async deleteKey(key) {
        try {
            return await dataSource.deleteKey(key);
        } catch (err) {
            await fallbackToMemory(err);
            return dataSource.deleteKey(key);
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
                    <div class="custom-modal-header">${escapeHtml(title)}</div>
                    <div class="custom-modal-body">${escapeHtml(message)}</div>
                    <div class="custom-modal-footer">
                        <button class="custom-modal-btn">확인</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            const btn = modal.querySelector('.custom-modal-btn');
            const closeModal = () => {
                detachEsc();
                modal.remove();
                resolve();
            };
            const detachEsc = attachEscToClose(modal, closeModal);

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
                    <div class="custom-modal-header">${escapeHtml(title)}</div>
                    <div class="custom-modal-body">${escapeHtml(message)}</div>
                    <div class="custom-modal-footer">
                        <button class="custom-modal-btn custom-modal-btn-cancel">취소</button>
                        <button class="custom-modal-btn custom-modal-btn-danger">확인</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            const cleanup = (result) => {
                detachEsc();
                modal.remove();
                resolve(result);
            };
            const detachEsc = attachEscToClose(modal, () => cleanup(false));

            modal.querySelector('.custom-modal-btn-cancel')
                .addEventListener('click', () => cleanup(false));
            modal.querySelector('.custom-modal-btn-danger')
                .addEventListener('click', () => cleanup(true));
            modal.addEventListener('click', (e) => {
                if (e.target === modal) cleanup(false);
            });
        });
    },

    // 옵션 중 하나를 고르는 모달. options: [{value, label, isCurrent?}].
    // 사용자가 선택하면 value를, 취소(취소 버튼/배경 클릭/ESC)하면 null을 반환.
    async choose(title, message, options) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'custom-modal-overlay';
            modal.innerHTML = `
                <div class="custom-modal">
                    <div class="custom-modal-header"></div>
                    <div class="custom-modal-body"></div>
                    <div class="custom-modal-choices"></div>
                    <div class="custom-modal-footer">
                        <button class="custom-modal-btn custom-modal-btn-cancel">취소</button>
                    </div>
                </div>
            `;
            modal.querySelector('.custom-modal-header').textContent = title;
            modal.querySelector('.custom-modal-body').textContent = message;
            document.body.appendChild(modal);

            const cleanup = (val) => { detachEsc(); modal.remove(); resolve(val); };
            const detachEsc = attachEscToClose(modal, () => cleanup(null));

            const choicesEl = modal.querySelector('.custom-modal-choices');
            (options || []).forEach((opt) => {
                const btn = document.createElement('button');
                btn.className = 'custom-modal-btn custom-modal-choice'
                    + (opt.isCurrent ? ' is-current' : '');
                btn.textContent = opt.label;
                btn.addEventListener('click', () => cleanup(opt.value));
                choicesEl.appendChild(btn);
            });

            modal.querySelector('.custom-modal-btn-cancel')
                .addEventListener('click', () => cleanup(null));
            modal.addEventListener('click', (e) => {
                if (e.target === modal) cleanup(null);
            });
        });
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
