// ========================================
// Note Search UI
// ========================================
import { state } from './state.js';
import { CONSTANTS } from './constants.js';
import { findNextIndex, findPrevIndex, countNewlines } from './utils.js';

export const NoteSearchUI = {
    setup() {
        state.elements.noteSearchInput = document.getElementById('noteSearchInput');
        state.elements.noteSearchBtn = document.getElementById('noteSearchBtn');
        state.elements.noteSearchPrevBtn = document.getElementById('noteSearchPrevBtn');
        state.elements.noteSearchNextBtn = document.getElementById('noteSearchNextBtn');

        if (!state.elements.noteSearchInput || !state.elements.noteSearchBtn ||
            !state.elements.noteSearchPrevBtn || !state.elements.noteSearchNextBtn) return;

        state.elements.noteSearchBtn.addEventListener('click', () => {
            this.find({ startFromBeginning: true });
        });

        state.elements.noteSearchPrevBtn.addEventListener('click', () => {
            this.findPrev();
        });

        state.elements.noteSearchNextBtn.addEventListener('click', () => {
            this.find({ startFromBeginning: false });
        });

        state.elements.noteSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.find({ startFromBeginning: true });
            }
        });
    },

    find({ startFromBeginning }) {
        const noteEditor = this.getCurrentEditor();
        if (!noteEditor || !state.elements.noteSearchInput) return;

        const query = state.elements.noteSearchInput.value;
        if (!query) return;

        const startIndex = startFromBeginning ? 0 : noteEditor.selectionEnd;
        const matchIndex = findNextIndex(noteEditor.value, query, startIndex);

        if (matchIndex === -1) {
            this.showMiss();
            return;
        }

        state.elements.noteSearchInput.classList.remove('note-search-miss');
        noteEditor.focus();
        noteEditor.setSelectionRange(matchIndex, matchIndex + query.length);
        this.scrollToIndex(noteEditor, matchIndex);
    },

    findPrev() {
        const noteEditor = this.getCurrentEditor();
        if (!noteEditor || !state.elements.noteSearchInput) return;

        const query = state.elements.noteSearchInput.value;
        if (!query) return;

        const startIndex = noteEditor.selectionStart - 1;
        if (startIndex < 0) return;

        const matchIndex = findPrevIndex(noteEditor.value, query, startIndex);

        if (matchIndex === -1) {
            this.showMiss();
            return;
        }

        state.elements.noteSearchInput.classList.remove('note-search-miss');
        noteEditor.focus();
        noteEditor.setSelectionRange(matchIndex, matchIndex + query.length);
        this.scrollToIndex(noteEditor, matchIndex);
    },

    getCurrentEditor() {
        // 현재 활성화된 에디터를 찾습니다
        const activeContainer = document.querySelector('.note-editor-container:not(.hidden)');
        if (!activeContainer) return null;

        const editor = activeContainer.querySelector('.note-editor');
        return editor;
    },

    showMiss() {
        state.elements.noteSearchInput.classList.add('note-search-miss');
        setTimeout(() => {
            state.elements.noteSearchInput.classList.remove('note-search-miss');
        }, CONSTANTS.SEARCH_MISS_DURATION);
    },

    scrollToIndex(noteEditor, index) {
        // split 배열 할당 없이 매치 위치의 줄 번호 계산 — 5MB 파일 검색에서도 저비용.
        const lineIndex = countNewlines(noteEditor.value, index);
        const style = window.getComputedStyle(noteEditor);
        const lineHeight = parseFloat(style.lineHeight) || 24;
        const paddingTop = parseFloat(style.paddingTop) || 0;
        const targetTop = (lineIndex * lineHeight) + paddingTop;
        const offset = noteEditor.clientHeight / 3;
        noteEditor.scrollTop = Math.max(0, targetTop - offset);
    }
};
