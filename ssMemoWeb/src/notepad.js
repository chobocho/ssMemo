// ========================================
// Notepad Management
// ========================================
import { state } from './state.js';
import { CONSTANTS } from './constants.js';
import { NoteSearchUI } from './note-search.js';
import { AppAPI } from './app-api.js';

// Cache DOM elements
let notePanel = null;
let noteEditor = null;
let lineNumbers = null;
let charCountEl = null;

export const Notepad = {
    async open() {
        notePanel = document.getElementById('note-panel');
        noteEditor = document.getElementById('note-editor');
        lineNumbers = document.getElementById('line-numbers');
        charCountEl = document.getElementById('note-char-count');

        if (!notePanel || !noteEditor || !lineNumbers || !charCountEl) return;

        notePanel.classList.remove('hidden');
        noteEditor.focus();

        try {
            const note = await AppAPI.getNoteByDate(CONSTANTS.NOTEPAD_KEY);
            noteEditor.value = note.content || '';
        } catch (e) {
            console.error('Failed to load notepad content:', e);
            noteEditor.value = '';
        }

        state.notepad.lastSavedContent = noteEditor.value;
        state.notepad.isDirty = false;

        this.updateLineNumbers();
        this.updateCharCount();

        noteEditor.oninput = () => {
            this.updateLineNumbers();
            this.updateCharCount();
            lineNumbers.scrollTop = noteEditor.scrollTop;
            state.notepad.isDirty = noteEditor.value !== state.notepad.lastSavedContent;
        };

        noteEditor.onscroll = () => {
            lineNumbers.scrollTop = noteEditor.scrollTop;
        };

        noteEditor.onkeydown = (e) => this.handleKeyDown(e);
        noteEditor.oncontextmenu = (e) => this.handleContextMenu(e);

        this.startAutoSave();
    },

    async close() {
        if (notePanel && !notePanel.classList.contains('hidden')) {
            await this.save();
            notePanel.classList.add('hidden');
            this.stopAutoSave();
        }
    },

    async save() {
        if (!noteEditor) return "저장할 데이터가 없습니다.";

        const content = noteEditor.value;
        if (!state.notepad.isDirty || content === state.notepad.lastSavedContent) {
            return "변경된 내용이 없습니다.";
        }

        let retMsg = "저장에 성공했습니다.";
        try {
            await AppAPI.saveOrUpdateNoteByDate(CONSTANTS.NOTEPAD_KEY, content);
            state.notepad.lastSavedContent = content;
            state.notepad.isDirty = false;
            console.log('Notepad auto-saved');
        } catch (e) {
            console.error('Failed to save notepad:', e);
            retMsg = "저장에 실패했습니다.";
        }
        return retMsg;
    },

    async saveWithNotification() {
        const msg = await this.save();
        await AppAPI.showMessage('메모 저장', msg);
    },

    startAutoSave() {
        if (state.notepad.autoSaveTimer) clearInterval(state.notepad.autoSaveTimer);
        state.notepad.autoSaveTimer = setInterval(() => this.save(), CONSTANTS.AUTO_SAVE_INTERVAL);
    },

    stopAutoSave() {
        if (state.notepad.autoSaveTimer) {
            clearInterval(state.notepad.autoSaveTimer);
            state.notepad.autoSaveTimer = null;
        }
    },

    insertDivider() {
        if (!noteEditor) return;

        const divider = '─'.repeat(CONSTANTS.DIVIDER_LENGTH);
        const cursorPos = noteEditor.selectionStart;
        const textBefore = noteEditor.value.substring(0, cursorPos);
        const textAfter = noteEditor.value.substring(noteEditor.selectionEnd);

        const prefix = (textBefore.length > 0 && !textBefore.endsWith('\n')) ? '\n' : '';
        const suffix = (textAfter.length > 0 && !textAfter.startsWith('\n')) ? '\n' : '';

        const newText = textBefore + prefix + divider + suffix + textAfter;
        noteEditor.value = newText;

        const newCursorPos = cursorPos + prefix.length + divider.length + suffix.length;
        noteEditor.setSelectionRange(newCursorPos, newCursorPos);

        this.updateLineNumbers();
        this.updateCharCount();
        state.notepad.isDirty = noteEditor.value !== state.notepad.lastSavedContent;
    },

    insertSymbol(symbol) {
        if (!noteEditor) return;

        const cursorPos = noteEditor.selectionStart;
        const textBefore = noteEditor.value.substring(0, cursorPos);
        const textAfter = noteEditor.value.substring(noteEditor.selectionEnd);

        const newText = textBefore + symbol + textAfter;
        noteEditor.value = newText;

        const newCursorPos = cursorPos + symbol.length;
        noteEditor.setSelectionRange(newCursorPos, newCursorPos);

        this.updateLineNumbers();
        this.updateCharCount();
        state.notepad.isDirty = noteEditor.value !== state.notepad.lastSavedContent;
    },

    updateCharCount() {
        if (!noteEditor || !charCountEl) return;
        charCountEl.textContent = `글자수: ${noteEditor.value.length}`;
    },

    updateLineNumbers() {
        if (!noteEditor || !lineNumbers) return;

        const lines = noteEditor.value.split('\n');
        const lineCount = lines.length;
        let lineNumbersHTML = '';
        for (let i = 1; i <= lineCount; i++) {
            lineNumbersHTML += `<div>${i}</div>`;
        }
        lineNumbers.innerHTML = lineNumbersHTML;
        lineNumbers.scrollTop = noteEditor.scrollTop;
    },

    handleContextMenu(e) {
        if (!noteEditor) return;

        const start = noteEditor.selectionStart;
        const end = noteEditor.selectionEnd;

        if (start === end) return;

        const selectedText = noteEditor.value.substring(start, end).trim();
        const urlPattern = /^(https?:\/\/|www\.)/i;
        if (urlPattern.test(selectedText)) {
            e.preventDefault();

            let url = selectedText;
            if (url.startsWith('www.')) {
                url = 'https://' + url;
            }

            AppAPI.openURL(url);
        }
    },

    handleKeyDown(e) {
        if (e.ctrlKey && (e.key === 'I' || e.key === 'i')) {
            e.preventDefault();
            state.elements.noteSearchInput?.focus();
            return;
        }

        if (e.key === 'PageUp' || (e.altKey && (e.key === 'B' || e.key === 'b'))) {
            e.preventDefault();
            if (noteEditor) noteEditor.scrollTop -= noteEditor.clientHeight;
            return;
        }

        if (e.key === 'PageDown' || (e.altKey && (e.key === 'F' || e.key === 'f'))) {
            e.preventDefault();
            if (noteEditor) noteEditor.scrollTop += noteEditor.clientHeight;
            return;
        }

        if (e.ctrlKey && (e.key === '6' || e.key === 'h' || e.key === 'H')) {
            e.preventDefault();
            if (noteEditor) {
                noteEditor.setSelectionRange(0, 0);
                noteEditor.scrollTop = 0;
            }
            return;
        }

        if (e.ctrlKey && (e.key === '4' || e.key === 'e' || e.key === 'E')) {
            e.preventDefault();
            if (noteEditor) {
                const endPos = noteEditor.value.length;
                noteEditor.setSelectionRange(endPos, endPos);
                noteEditor.scrollTop = noteEditor.scrollHeight;
            }
            return;
        }

        if (e.ctrlKey && (e.key === ',' || e.key === 'b' || e.key === 'B')) {
            e.preventDefault();
            NoteSearchUI.findPrev();
            return;
        }

        if (e.ctrlKey && (e.key === 'n' || e.key === 'N' || e.key === '.')) {
            e.preventDefault();
            NoteSearchUI.find({ startFromBeginning: false });
            return;
        }

        if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
            e.preventDefault();
            this.insertDivider();
            return;
        }

        if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
            e.preventDefault();
            this.insertSymbol('→');
            return;
        }

        if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
            e.preventDefault();
            this.insertSymbol('✅');
            return;
        }

        if (e.ctrlKey && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
            e.preventDefault();
            this.insertSymbol('□');
            return;
        }

        if (e.ctrlKey && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
            e.preventDefault();
            this.insertSymbol('※');
            return;
        }

        if (e.ctrlKey && e.shiftKey && (e.key === 'Z' || e.key === 'z')) {
            e.preventDefault();
            this.insertSymbol('🟩');
            return;
        }

        if (e.ctrlKey && e.shiftKey && (e.key === 'X' || e.key === 'x')) {
            e.preventDefault();
            this.insertSymbol('❎');
            return;
        }
    },

    splitNoteIntoChunks(len) {
        if (!noteEditor) return;

        const content = noteEditor.value;
        if (!len || len <= 0 || content.length <= len) return;

        const delimiter = "\n\n<----------[절취선]---------->\n\n";
        const btn = document.querySelector('button[onclick^="splitNoteIntoChunks"]');
        
        // 1. 구분자가 이미 존재하면 모두 없애기
        if (content.includes(delimiter)) {
            // escape special characters for regex
            const escapedDelimiter = delimiter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Remove delimiters and potentially leading/trailing newlines added around them
            // We'll use a simple replace first.
            const newContent = content.split(delimiter).join('');
            noteEditor.value = newContent;

            if (btn) {
                btn.textContent = '➗';
                btn.title = `${len}자 크기로 나누기`;
            }
            if ( state.elements.noteSearchInput.value === '절취선') {
                state.elements.noteSearchInput.value = '';
            }
        } else {
            let newContent = "";
            for (let i = 0; i < content.length; i += len) {
                if (i > 0) {
                    newContent += delimiter;
                }
                newContent += content.substring(i, i + len);
            }
            noteEditor.value = newContent;

            if (btn) {
                btn.textContent = '➕';
                btn.title = '절취선 문구 삭제';
            }
            state.elements.noteSearchInput.value = '절취선';
        }

        this.updateLineNumbers();
        this.updateCharCount();
        state.notepad.isDirty = noteEditor.value !== state.notepad.lastSavedContent;
    },

    showHelpPanel() {
        const helpText = `메모장 단축키
Alt + B - 페이지 위로
Alt + F - 페이지 아래로

Ctrl + Ｉ - 검색
Ctrl + < - 이전 검색 결과로 이동
Ctrl + > - 다음 검색 결과로 이동

Ctrl + L - 구분선 삽입

기호 삽입:
Ctrl + Shift + A - →
Ctrl + Shift + C - ✅ (체크마크)
Ctrl + Shift + O - □ (박스)
Ctrl + Shift + R - ※
Ctrl + Shift + X - ❎
Ctrl + Shift + Z - 🟩

URL을 드래그 후 우클릭하면 해당 URL로 이동합니다.
`;

        AppAPI.showMessage('메모장 도움말', helpText);
    }
};

window.openNotePanel = () => Notepad.open();
window.closeNotePanel = () => Notepad.close();
window.saveNotePad = () => Notepad.save();
window.saveNotePadWithNoti = () => Notepad.saveWithNotification();
window.showNoteHelpPanel = () => Notepad.showHelpPanel();
window.splitNoteIntoChunks = (len) => Notepad.splitNoteIntoChunks(len);