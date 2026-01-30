// ========================================
// Note Search UI
// ========================================
import { state } from './state.js';
import { CONSTANTS } from './constants.js';

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
                this.find({ startFromBeginning: false });
            }
        });
    },

    find({ startFromBeginning }) {
        const noteEditor = document.getElementById('note-editor');
        if (!noteEditor || !state.elements.noteSearchInput) return;

        const query = state.elements.noteSearchInput.value;
        if (!query) return;

        const content = noteEditor.value;
        const startIndex = startFromBeginning ? 0 : noteEditor.selectionEnd;
        let matchIndex = content.indexOf(query, startIndex);

        if (matchIndex === -1 && startIndex > 0) {
            matchIndex = content.indexOf(query, 0);
        }

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
        const noteEditor = document.getElementById('note-editor');
        if (!noteEditor || !state.elements.noteSearchInput) return;

        const query = state.elements.noteSearchInput.value;
        if (!query) return;

        const content = noteEditor.value;
        const startIndex = noteEditor.selectionStart - 1;

        if (startIndex < 0) return;

        let matchIndex = content.lastIndexOf(query, startIndex);

        if (matchIndex === -1) {
            matchIndex = content.lastIndexOf(query, content.length);
        }

        if (matchIndex === -1) {
            this.showMiss();
            return;
        }

        state.elements.noteSearchInput.classList.remove('note-search-miss');
        noteEditor.focus();
        noteEditor.setSelectionRange(matchIndex, matchIndex + query.length);
        this.scrollToIndex(noteEditor, matchIndex);
    },

    showMiss() {
        state.elements.noteSearchInput.classList.add('note-search-miss');
        setTimeout(() => {
            state.elements.noteSearchInput.classList.remove('note-search-miss');
        }, CONSTANTS.SEARCH_MISS_DURATION);
    },

    scrollToIndex(noteEditor, index) {
        const textBefore = noteEditor.value.slice(0, index);
        const lineIndex = textBefore.split('\n').length - 1;
        const style = window.getComputedStyle(noteEditor);
        const lineHeight = parseFloat(style.lineHeight) || 24;
        const paddingTop = parseFloat(style.paddingTop) || 0;
        const targetTop = (lineIndex * lineHeight) + paddingTop;
        const offset = noteEditor.clientHeight / 3;
        noteEditor.scrollTop = Math.max(0, targetTop - offset);
    }
};
