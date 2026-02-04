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

// 파일 탭 관리 상태
const fileTabs = {
    slots: Array(7).fill(null), // 각 슬롯의 파일 정보 {fileName, content}
    currentTab: 'main', // 현재 활성 탭
    wrapStates: { main: false, 0: false, 1: false, 2: false, 3: false, 4: false, 5: false, 6: false } // 각 탭의 줄바꿈 상태
};

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

        // 탭 클릭 핸들러 설정
        this.setupTabClickHandlers();

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
            const currentEditor = fileTabs.currentTab === 'main'
                ? noteEditor
                : document.getElementById(`note-editor-${fileTabs.currentTab}`);
            if (currentEditor) currentEditor.scrollTop -= currentEditor.clientHeight;
            return;
        }

        if (e.key === 'PageDown' || (e.altKey && (e.key === 'F' || e.key === 'f'))) {
            e.preventDefault();
            const currentEditor = fileTabs.currentTab === 'main'
                ? noteEditor
                : document.getElementById(`note-editor-${fileTabs.currentTab}`);
            if (currentEditor) currentEditor.scrollTop += currentEditor.clientHeight;
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
    },

    async loadFileFromDisk() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.txt,.md,.py,.java,.go,.c,.cpp,text/*';

        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const content = await file.text();

                // 빈 슬롯 찾기
                const emptySlotIndex = fileTabs.slots.findIndex(slot => slot === null);

                if (emptySlotIndex === -1) {
                    await AppAPI.showMessage('파일 불러오기 실패', '최대 7개의 파일만 열 수 있습니다.');
                    return;
                }

                // 슬롯에 파일 정보 저장
                fileTabs.slots[emptySlotIndex] = {
                    fileName: file.name,
                    content: content
                };

                // 해당 탭 표시 및 내용 설정
                this.showFileTab(emptySlotIndex);
                this.loadFileToEditor(emptySlotIndex);
                this.switchTab(emptySlotIndex);

                await AppAPI.showMessage('파일 불러오기', `파일 "${file.name}"을 불러왔습니다.`);
            } catch (error) {
                console.error('Failed to read file:', error);
                await AppAPI.showMessage('파일 불러오기 실패', '파일을 읽을 수 없습니다.');
            }
        };

        input.click();
    },

    showFileTab(index) {
        const tab = document.querySelector(`.note-tab[data-tab="${index}"]`);
        if (!tab) return;

        const fileInfo = fileTabs.slots[index];
        if (!fileInfo) return;

        // 탭 표시 및 파일명 설정
        tab.classList.remove('note-tab-hidden');
        const labelEl = tab.querySelector('.note-tab-label');
        if (labelEl) {
            labelEl.textContent = fileInfo.fileName;
        }
    },

    hideFileTab(index) {
        const tab = document.querySelector(`.note-tab[data-tab="${index}"]`);
        if (!tab) return;

        tab.classList.add('note-tab-hidden');
        tab.classList.remove('note-tab-active');
    },

    loadFileToEditor(index) {
        const fileInfo = fileTabs.slots[index];
        if (!fileInfo) return;

        const editor = document.getElementById(`note-editor-${index}`);
        const lineNumEl = document.getElementById(`line-numbers-${index}`);

        if (!editor || !lineNumEl) return;

        editor.value = fileInfo.content;

        // 줄 번호 업데이트
        const lines = fileInfo.content.split('\n');
        const lineCount = lines.length;
        let lineNumbersHTML = '';
        for (let i = 1; i <= lineCount; i++) {
            lineNumbersHTML += `<div>${i}</div>`;
        }
        lineNumEl.innerHTML = lineNumbersHTML;

        // 스크롤 동기화
        editor.onscroll = () => {
            lineNumEl.scrollTop = editor.scrollTop;
        };

        // 키보드 이벤트 핸들러 연결 (검색 단축키 지원)
        editor.onkeydown = (e) => this.handleKeyDown(e);
    },

    switchTab(tabId) {
        // 모든 탭과 컨테이너 비활성화
        document.querySelectorAll('.note-tab').forEach(tab => {
            tab.classList.remove('note-tab-active');
        });

        document.querySelectorAll('.note-editor-container').forEach(container => {
            container.classList.add('hidden');
        });

        // 선택된 탭과 컨테이너 활성화
        const targetTab = document.querySelector(`.note-tab[data-tab="${tabId}"]`);
        const targetContainer = document.getElementById(`note-container-${tabId}`);

        if (targetTab && targetContainer) {
            targetTab.classList.add('note-tab-active');
            targetContainer.classList.remove('hidden');
            fileTabs.currentTab = tabId;

            // 글자수 업데이트
            this.updateCharCountForTab(tabId);

            // 저장하기, 나누기 버튼 표시/숨김 처리
            this.updateButtonsVisibility(tabId);

            // 줄바꿈 버튼 상태 동기화
            this.syncForceEnterButton();
        }
    },

    updateCharCountForTab(tabId) {
        if (!charCountEl) return;

        let editor;
        if (tabId === 'main') {
            editor = noteEditor;
        } else {
            editor = document.getElementById(`note-editor-${tabId}`);
        }

        if (editor) {
            charCountEl.textContent = `글자수: ${editor.value.length}`;
        }
    },

    updateButtonsVisibility(tabId) {
        const saveBtn = document.querySelector('button[onclick="saveNotePadWithNoti()"]');
        const splitBtn = document.querySelector('button[onclick^="splitNoteIntoChunks"]');

        if (saveBtn && splitBtn) {
            if (tabId === 'main') {
                saveBtn.style.display = '';
                splitBtn.style.display = '';
            } else {
                saveBtn.style.display = 'none';
                splitBtn.style.display = 'none';
            }
        }
    },

    closeFileTab(index) {
        // 탭 닫기 확인
        const fileName = fileTabs.slots[index]?.fileName || `파일 ${index + 1}`;
        if (!confirm(`"${fileName}" 탭을 닫으시겠습니까?`)) {
            return;
        }

        // 슬롯 초기화
        fileTabs.slots[index] = null;

        // 탭 숨기기
        this.hideFileTab(index);

        // 에디터 내용 초기화
        const editor = document.getElementById(`note-editor-${index}`);
        const lineNumEl = document.getElementById(`line-numbers-${index}`);
        if (editor) editor.value = '';
        if (lineNumEl) lineNumEl.innerHTML = '1';

        // 현재 탭이 닫힌 탭이면 메인 탭으로 전환
        if (fileTabs.currentTab === index) {
            this.switchTab('main');
        }
    },

    setupTabClickHandlers() {
        document.querySelectorAll('.note-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                // 닫기 버튼 클릭은 무시
                if (e.target.classList.contains('note-tab-close')) {
                    return;
                }

                const tabId = tab.getAttribute('data-tab');
                this.switchTab(tabId);
            });
        });
    },

    forceEnterToNote() {
        const btn = document.querySelector('button[onclick="forceEnterToNote()"]');
        if (!btn) return;

        // 현재 활성화된 에디터 찾기
        let currentEditor = noteEditor;
        let currentLineNumbers = lineNumbers;
        if (fileTabs.currentTab !== 'main') {
            currentEditor = document.getElementById(`note-editor-${fileTabs.currentTab}`);
            currentLineNumbers = document.getElementById(`line-numbers-${fileTabs.currentTab}`);
        }
        if (!currentEditor || !currentLineNumbers) return;

        // 현재 탭의 상태 토글
        const currentState = fileTabs.wrapStates[fileTabs.currentTab];

        if (currentState) {
            // 줄 바꿈 해제 (가로 스크롤 활성화)
            currentEditor.style.whiteSpace = 'pre';
            currentEditor.style.overflowX = 'auto';
            fileTabs.wrapStates[fileTabs.currentTab] = false;
            btn.textContent = '⬇️';
            btn.title = '강제 줄 바꿈';
        } else {
            // 줄 바꿈 활성화 (가로 스크롤 비활성화)
            currentEditor.style.whiteSpace = 'pre-wrap';
            currentEditor.style.overflowX = 'hidden';
            fileTabs.wrapStates[fileTabs.currentTab] = true;
            btn.textContent = '⬆️';
            btn.title = '강제 줄 바꿈 해제';
        }

        // 줄 번호 동기화
        this.updateLineNumbersForEditor(currentEditor, currentLineNumbers);
    },

    syncForceEnterButton() {
        const btn = document.querySelector('button[onclick="forceEnterToNote()"]');
        if (!btn) return;

        const currentState = fileTabs.wrapStates[fileTabs.currentTab];
        if (currentState) {
            btn.textContent = '⬆️';
            btn.title = '강제 줄 바꿈 해제';
        } else {
            btn.textContent = '⬇️';
            btn.title = '강제 줄 바꿈';
        }
    },

    updateLineNumbersForEditor(editor, lineNumbersEl) {
        if (!editor || !lineNumbersEl) return;

        const lines = editor.value.split('\n');
        const lineCount = lines.length;
        let lineNumbersHTML = '';
        for (let i = 1; i <= lineCount; i++) {
            lineNumbersHTML += `<div>${i}</div>`;
        }
        lineNumbersEl.innerHTML = lineNumbersHTML;
        lineNumbersEl.scrollTop = editor.scrollTop;
    }
};

window.openNotePanel = () => Notepad.open();
window.closeNotePanel = () => Notepad.close();
window.saveNotePad = () => Notepad.save();
window.saveNotePadWithNoti = () => Notepad.saveWithNotification();
window.showNoteHelpPanel = () => Notepad.showHelpPanel();
window.splitNoteIntoChunks = (len) => Notepad.splitNoteIntoChunks(len);
window.LoadFileFromDisk = () => Notepad.loadFileFromDisk();
window.closeFileTab = (index) => Notepad.closeFileTab(index);
window.forceEnterToNote = () => Notepad.forceEnterToNote();