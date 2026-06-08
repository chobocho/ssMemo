// ========================================
// Notepad Management
// ========================================
import { state } from './state.js';
import { CONSTANTS, SYMBOL_SHORTCUTS } from './constants.js';
import { NoteSearchUI } from './note-search.js';
import { AppAPI } from './app-api.js';
import { splitTextIntoChunks, joinTextChunks, buildLineNumbersText, debounce, nextFrame, CHUNK_DELIMITER } from './utils.js';
import { renderMarkdown } from './markdown.js';
import { isAllowedTextFile, isOversized } from './file-utils.js';
import { decodeKoreanText, decodeWithEncoding, looksGarbled } from './encoding.js';
import { runCode } from './calc.js';

// Cache DOM elements
let notePanel = null;
let noteEditor = null;
let lineNumbers = null;
let charCountEl = null;

// 빈 문자열도 textarea에서 1줄로 보이므로 최소 1로 보정.
// split보다 빠르게 줄 수만 세는 헬퍼 — 5MB 파일에서 split 배열 할당 비용을 피한다.
function countLines(text) {
    if (!text) return 1;
    let count = 1;
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 10) count++;
    }
    return count;
}

// 줄 번호 영역 갱신 + 줄 수 캐시. 줄 수가 그대로면 textContent를
// 다시 쓰지 않아 큰 파일 입력 중 리플로우/리페인트 비용을 절감한다.
function refreshLineNumbers(editor, lineNumbersEl) {
    if (!editor || !lineNumbersEl) return;
    const count = countLines(editor.value);
    if (lineNumbersEl.__ssLineCount !== count) {
        lineNumbersEl.textContent = buildLineNumbersText(count);
        lineNumbersEl.__ssLineCount = count;
    }
    lineNumbersEl.scrollTop = editor.scrollTop;
}

// 파일 탭 관리 상태
const fileTabs = {
    slots: Array(7).fill(null), // 각 슬롯의 파일 정보 {fileName, content}
    currentTab: 'main', // 현재 활성 탭
    wrapStates: { main: false, 0: false, 1: false, 2: false, 3: false, 4: false, 5: false, 6: false }, // 각 탭의 줄바꿈 상태
    previewStates: { 0: false, 1: false, 2: false, 3: false, 4: false, 5: false, 6: false } // .md 미리보기 상태
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

        // 큰 파일에서 keystroke마다 전체 스캔(countLines)을 돌면 입력이 끊긴다.
        // 줄번호 갱신은 50ms로 묶고, char count/scroll/isDirty는 즉시 반영.
        const debouncedLineNumbers = debounce(() => this.updateLineNumbers(), 50);

        noteEditor.oninput = () => {
            debouncedLineNumbers();
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

        // Drag & Drop 핸들러 설정
        this.setupDragAndDrop();

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
        refreshLineNumbers(noteEditor, lineNumbers);
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
        if (e.ctrlKey && (e.key === 'F' || e.key === 'I' || e.key === 'i')) {
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

        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            this.runCodeBlock();
            return;
        }

        if (e.ctrlKey && e.shiftKey && e.key) {
            const upperKey = e.key.toUpperCase();
            const symbol = SYMBOL_SHORTCUTS[upperKey];
            if (symbol) {
                e.preventDefault();
                this.insertSymbol(symbol);
                return;
            }
        }
    },

    splitNoteIntoChunks(len) {
        if (!noteEditor) return;

        const content = noteEditor.value;
        if (!len || len <= 0 || content.length <= len) return;

        const btn = document.querySelector('button[onclick^="splitNoteIntoChunks"]');
        const hasDelimiter = content.includes(CHUNK_DELIMITER);

        if (hasDelimiter) {
            noteEditor.value = joinTextChunks(content);
            if (btn) {
                btn.textContent = '➗';
                btn.title = `${len}자 크기로 나누기`;
            }
            if (state.elements.noteSearchInput.value === '절취선') {
                state.elements.noteSearchInput.value = '';
            }
        } else {
            noteEditor.value = splitTextIntoChunks(content, len);
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
Ctrl + Enter - 선택한 코드 실행 🧮
  (드래그로 선택 후 실행. 선택 없으면 현재 줄 실행)
  결과 모달에서 📥 버튼으로 코드 다음 줄에 # 주석으로 삽입 가능
  지원: 변수, +,-,*,/,//, 괄호, sin/cos/tan,
        factorial(n≤1000), # 주석
  정수는 5000자리 이상도 정확.

  예시:
    1 + 2 * 3            # 7
    (10 + 5) / 3         # 5
    7 / 2                # 3.5
    7 // 2               # 3 (몫)
    x = 10
    y = x * x + 1        # y = 101
    factorial(20)        # 2432902008176640000
    sin(0) + cos(0)      # 1
    9999 * 9999          # 99980001

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
            await this.handleIncomingFile(file);
        };

        input.click();
    },

    async handleIncomingFile(file) {
        if (isOversized(file)) {
            await AppAPI.showMessage('파일 불러오기 실패', '파일 크기가 너무 큽니다. (10MB 이하)');
            return;
        }
        if (!isAllowedTextFile(file)) {
            await AppAPI.showMessage('파일 불러오기 실패', '지원하지 않는 파일 형식입니다. (텍스트 파일만 가능)');
            return;
        }

        const showSpinner = file.size >= CONSTANTS.LOADING_SPINNER_THRESHOLD;
        if (showSpinner) {
            const sizeKb = Math.round(file.size / 1024);
            AppAPI.showLoading(`파일을 불러오는 중... (${sizeKb} KB)`);
            // 스피너가 실제로 그려지도록 한 프레임 양보
            await nextFrame();
        }

        // 큰 파일에서 decode/normalize/value 적용/줄번호/탭 전환이 한 동기 블록으로
        // 묶이면 메인 스레드가 수 초간 잠겨 터치/스크롤이 멈춘다. 단계 사이에
        // rAF로 양보해 브라우저가 페인트/입력을 처리할 틈을 만든다.
        const yieldIfBig = showSpinner ? nextFrame : null;

        // 어떤 단계에서 던지더라도 스피너가 영구 잔류하지 않도록 finally로 hideLoading 보장.
        let resultTitle = '파일 불러오기';
        let resultMsg = '파일을 읽을 수 없습니다.';
        try {
            // ArrayBuffer로 읽어 한글 인코딩(UTF-8/CP949/Johab)을 자동 감지한다.
            const buffer = await file.arrayBuffer();
            if (yieldIfBig) await yieldIfBig();

            const { text, encoding } = decodeKoreanText(buffer);
            if (yieldIfBig) await yieldIfBig();

            // CRLF/CR 파일을 LF로 정규화: split('\n')이 세는 줄 수와
            // textarea가 그리는 시각적 줄 수를 일치시킨다.
            const content = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            if (yieldIfBig) await yieldIfBig();

            const emptySlotIndex = fileTabs.slots.findIndex(slot => slot === null);
            if (emptySlotIndex === -1) {
                resultTitle = '파일 불러오기 실패';
                resultMsg = `최대 ${CONSTANTS.MAX_FILE_TABS}개의 파일만 열 수 있습니다.`;
            } else {
                // buffer는 사용자가 인코딩을 잘못 자동 감지했을 때 재디코딩에 쓰인다.
                fileTabs.slots[emptySlotIndex] = { fileName: file.name, content, encoding, buffer };
                this.showFileTab(emptySlotIndex);
                await this.loadFileToEditor(emptySlotIndex, yieldIfBig);
                if (yieldIfBig) await yieldIfBig();
                this.switchTab(emptySlotIndex);
                const garbledHint = looksGarbled(content)
                    ? '\n\n⚠️ 디코딩이 부정확할 수 있습니다. 툴바의 🔤 버튼으로 인코딩을 바꿔보세요.'
                    : '';
                resultMsg = `파일 "${file.name}"을 ${encoding} 인코딩으로 불러왔습니다.${garbledHint}`;
            }
        } catch (error) {
            console.error('Failed to read file:', error);
            resultTitle = '파일 불러오기 실패';
            resultMsg = '파일을 읽을 수 없습니다.';
        } finally {
            if (showSpinner) AppAPI.hideLoading();
        }

        await AppAPI.showMessage(resultTitle, resultMsg);
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
            // 파일명이 10글자를 초과하면 10글자까지만 표시
            const displayName = fileInfo.fileName.length > 12
                ? fileInfo.fileName.substring(0, 8) + '...'
                : fileInfo.fileName;
            labelEl.textContent = displayName;
            labelEl.title = fileInfo.fileName; // 전체 파일명은 툴팁으로 표시
        }
    },

    hideFileTab(index) {
        const tab = document.querySelector(`.note-tab[data-tab="${index}"]`);
        if (!tab) return;

        tab.classList.add('note-tab-hidden');
        tab.classList.remove('note-tab-active');
    },

    // yieldFn이 주어지면 editor.value 적용 후 한 프레임 양보해 textarea가
    // 페인트되고 터치 이벤트가 처리될 시간을 준 뒤 줄번호를 그린다.
    // 큰 파일에서 메인 스레드가 한 번에 묶이는 것을 막기 위함.
    async loadFileToEditor(index, yieldFn) {
        const fileInfo = fileTabs.slots[index];
        if (!fileInfo) return;

        const editor = document.getElementById(`note-editor-${index}`);
        const lineNumEl = document.getElementById(`line-numbers-${index}`);

        if (!editor || !lineNumEl) return;

        editor.value = fileInfo.content;
        if (yieldFn) await yieldFn();

        // 줄 번호 업데이트 (캐시로 중복 갱신 차단)
        refreshLineNumbers(editor, lineNumEl);

        // 스크롤 동기화
        editor.onscroll = () => {
            lineNumEl.scrollTop = editor.scrollTop;
        };

        // 키보드 이벤트 핸들러 연결 (검색 단축키 지원)
        editor.onkeydown = (e) => this.handleKeyDown(e);
    },

    // textarea의 scrollHeight와 line-numbers 패널의 scrollHeight를 일치시킨다.
    // 일부 브라우저는 textarea 바닥에 1행 분량의 추가 공간을 두어 두 요소가 어긋난다.
    // 탭이 표시된(보이는) 상태에서만 호출해야 측정이 유효하다.
    syncLineNumbersHeight(editor, lineNumEl) {
        if (!editor || !lineNumEl) return;
        if (editor.offsetParent === null) return; // 숨겨진 상태면 측정 불가
        const diff = editor.scrollHeight - lineNumEl.scrollHeight;
        const basePadding = 10;
        lineNumEl.style.paddingBottom = `${Math.max(basePadding, basePadding + diff)}px`;
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

            // 탭이 화면에 그려진 다음 프레임에 line-numbers 높이 보정
            if (tabId !== 'main') {
                const editor = document.getElementById(`note-editor-${tabId}`);
                const lineNumEl = document.getElementById(`line-numbers-${tabId}`);
                requestAnimationFrame(() => this.syncLineNumbersHeight(editor, lineNumEl));
            }
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
        const downloadBtn = document.querySelector('button[onclick^="downloadNotePad"]');

        if (saveBtn && splitBtn) {
            if (tabId === 'main') {
                saveBtn.style.display = '';
                splitBtn.style.display = '';
                downloadBtn.style.display = '';
            } else {
                saveBtn.style.display = 'none';
                splitBtn.style.display = 'none';
                downloadBtn.style.display = 'none';
            }
        }

        this.updateMarkdownButtonVisibility(tabId);
        this.updateEncodingButtonVisibility(tabId);
    },

    updateEncodingButtonVisibility(tabId) {
        const btn = document.getElementById('encoding-btn');
        if (!btn) return;
        const slot = tabId !== 'main' ? fileTabs.slots[tabId] : null;
        if (slot && slot.buffer) {
            btn.classList.remove('hidden');
            btn.title = `현재 인코딩: ${slot.encoding} (변경)`;
        } else {
            btn.classList.add('hidden');
        }
    },

    async changeEncoding() {
        const tabId = fileTabs.currentTab;
        if (tabId === 'main') return;
        const slot = fileTabs.slots[tabId];
        if (!slot || !slot.buffer) {
            await AppAPI.showMessage('인코딩 변경', '재디코딩할 원본 데이터가 없습니다.');
            return;
        }

        const ENCODINGS = ['UTF-8', 'CP949', 'Johab'];
        const options = ENCODINGS.map(enc => ({
            value: enc,
            label: enc + (enc === slot.encoding ? '  ✓ (현재)' : ''),
            isCurrent: enc === slot.encoding,
        }));
        const chosen = await AppAPI.choose(
            '인코딩 변경',
            `현재: ${slot.encoding}\n다른 인코딩으로 다시 읽어옵니다.`,
            options
        );
        if (!chosen || chosen === slot.encoding) return;

        const showSpinner = slot.buffer.byteLength >= CONSTANTS.LOADING_SPINNER_THRESHOLD;
        if (showSpinner) {
            AppAPI.showLoading(`${chosen} 인코딩으로 다시 읽는 중...`);
            await nextFrame();
        }
        // handleIncomingFile과 동일하게 큰 파일에서는 단계 사이마다 양보.
        const yieldIfBig = showSpinner ? nextFrame : null;

        let resultMsg = '다시 디코딩하지 못했습니다.';
        try {
            const text = decodeWithEncoding(slot.buffer, chosen);
            if (yieldIfBig) await yieldIfBig();

            const content = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            if (yieldIfBig) await yieldIfBig();

            slot.content = content;
            slot.encoding = chosen;

            const editor = document.getElementById(`note-editor-${tabId}`);
            const lineNumEl = document.getElementById(`line-numbers-${tabId}`);
            if (editor && lineNumEl) {
                editor.value = content;
                if (yieldIfBig) await yieldIfBig();
                refreshLineNumbers(editor, lineNumEl);
            }

            // 마크다운 미리보기 활성 상태면 새 텍스트로 다시 렌더.
            const previewEl = document.getElementById(`note-md-preview-${tabId}`);
            if (previewEl && fileTabs.previewStates[tabId]) {
                previewEl.innerHTML = renderMarkdown(content);
            }

            this.updateEncodingButtonVisibility(tabId);
            const garbledHint = looksGarbled(content)
                ? '\n\n⚠️ 결과가 여전히 깨져 보이면 다른 인코딩을 시도해보세요.'
                : '';
            resultMsg = `${chosen} 인코딩으로 다시 읽었습니다.${garbledHint}`;
        } catch (e) {
            console.error('Failed to re-decode:', e);
            resultMsg = '다시 디코딩하지 못했습니다.';
        } finally {
            if (showSpinner) AppAPI.hideLoading();
        }

        await AppAPI.showMessage('인코딩 변경', resultMsg);
    },

    updateMarkdownButtonVisibility(tabId) {
        const btn = document.getElementById('md-preview-btn');
        if (!btn) return;
        const isMd = tabId !== 'main' &&
            fileTabs.slots[tabId]?.fileName?.toLowerCase().endsWith('.md');
        if (isMd) {
            btn.classList.remove('hidden');
            const previewing = fileTabs.previewStates[tabId];
            btn.textContent = previewing ? '✏️' : '📖';
            btn.title = previewing ? '마크다운 원문 보기' : '마크다운 미리보기';
        } else {
            btn.classList.add('hidden');
        }
    },

    toggleMarkdownPreview() {
        const tabId = fileTabs.currentTab;
        if (tabId === 'main') return;
        const slot = fileTabs.slots[tabId];
        if (!slot || !slot.fileName.toLowerCase().endsWith('.md')) return;

        const editor = document.getElementById(`note-editor-${tabId}`);
        const lineNumEl = document.getElementById(`line-numbers-${tabId}`);
        const previewEl = document.getElementById(`note-md-preview-${tabId}`);
        if (!editor || !previewEl) return;

        const turningOn = !fileTabs.previewStates[tabId];
        if (turningOn) {
            previewEl.innerHTML = renderMarkdown(slot.content);
            previewEl.classList.remove('hidden');
            editor.classList.add('hidden');
            if (lineNumEl) lineNumEl.classList.add('hidden');
        } else {
            previewEl.classList.add('hidden');
            editor.classList.remove('hidden');
            if (lineNumEl) lineNumEl.classList.remove('hidden');
        }
        fileTabs.previewStates[tabId] = turningOn;
        this.updateMarkdownButtonVisibility(tabId);
    },

    closeFileTab(index) {
        // 탭 닫기 확인
        const fileName = fileTabs.slots[index]?.fileName || `파일 ${index + 1}`;
        if (!confirm(`"${fileName}" 탭을 닫으시겠습니까?`)) {
            return;
        }

        // 슬롯 초기화
        fileTabs.slots[index] = null;
        fileTabs.previewStates[index] = false;

        // 탭 숨기기
        this.hideFileTab(index);

        // 에디터 내용 초기화 및 미리보기 정리
        const editor = document.getElementById(`note-editor-${index}`);
        const lineNumEl = document.getElementById(`line-numbers-${index}`);
        const previewEl = document.getElementById(`note-md-preview-${index}`);
        if (editor) {
            editor.value = '';
            editor.classList.remove('hidden');
        }
        if (lineNumEl) {
            lineNumEl.textContent = '1';
            lineNumEl.__ssLineCount = 1;
            lineNumEl.classList.remove('hidden');
        }
        if (previewEl) {
            previewEl.innerHTML = '';
            previewEl.classList.add('hidden');
        }

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
        if (fileTabs.currentTab !== 'main') {
            requestAnimationFrame(() => this.syncLineNumbersHeight(currentEditor, currentLineNumbers));
        }
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

    async resetNotePad() {
        if (fileTabs.currentTab !== 'main') {
            await AppAPI.showMessage('메모장 초기화', '메인 메모장 탭에서만 초기화할 수 있습니다.');
            return;
        }
        if (!noteEditor) return;

        const ok = await AppAPI.confirm(
            '메모장 초기화',
            '메모장의 모든 내용을 지우시겠습니까?\n이 작업은 되돌릴 수 없습니다.'
        );
        if (!ok) return;

        noteEditor.value = '';
        state.notepad.isDirty = true;
        try {
            await AppAPI.saveOrUpdateNoteByDate(CONSTANTS.NOTEPAD_KEY, '');
            state.notepad.lastSavedContent = '';
            state.notepad.isDirty = false;
        } catch (e) {
            console.error('Failed to reset notepad:', e);
        }
        this.updateLineNumbers();
        this.updateCharCount();
        await AppAPI.showMessage('메모장 초기화', '메모장이 초기화되었습니다.');
    },

    downloadNotePad() {
        let content = '';
        let fileName = 'ssMemo.txt';

        if (fileTabs.currentTab === 'main') {
            content = noteEditor.value;
        } else {
            const index = fileTabs.currentTab;
            const slot = fileTabs.slots[index];
            if (slot) {
                content = slot.content;
                fileName = slot.fileName;
            } else {
                // Fallback for unexpected state
                const editor = document.getElementById(`note-editor-${index}`);
                if (editor) {
                    content = editor.value;
                }
            }
        }

        if (!content) {
            AppAPI.showMessage('다운로드', '다운로드할 내용이 없습니다.');
            return;
        }

        try {
            const blob = new Blob([content], { type: 'text/plain' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Failed to download file:', error);
            AppAPI.showMessage('다운로드 실패', '파일을 다운로드하는 중 오류가 발생했습니다.');
        }
    },

    updateLineNumbersForEditor(editor, lineNumbersEl) {
        refreshLineNumbers(editor, lineNumbersEl);
    },

    setupDragAndDrop() {
        if (!notePanel) return;

        // 드래그 오버 시 시각적 효과
        notePanel.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            notePanel.classList.add('drag-over');
        });

        notePanel.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // notePanel 자체를 벗어났을 때만 클래스 제거
            if (e.target === notePanel) {
                notePanel.classList.remove('drag-over');
            }
        });

        notePanel.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            notePanel.classList.remove('drag-over');

            const files = e.dataTransfer.files;
            if (files.length === 0) return;
            await this.handleIncomingFile(files[0]);
        });
    },

    // 선택된 텍스트(또는 커서가 위치한 줄)를 코드로 실행해 결과를 모달로 표시.
    // 메인 메모장에서 실행한 경우, 모달에서 "메모에 삽입"을 선택하면 코드 다음
    // 줄에 `# ...` 주석 형태로 결과를 끼워 넣는다 (재실행 시 주석으로 무시됨).
    async runCodeBlock() {
        const currentTab = fileTabs.currentTab;
        const isMainTab = currentTab === 'main';
        const editor = isMainTab
            ? noteEditor
            : document.getElementById(`note-editor-${currentTab}`);
        if (!editor) return;

        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        let code;
        let codeEnd; // 코드 영역의 끝 위치 (삽입 기준점)
        if (start !== end) {
            code = editor.value.substring(start, end);
            codeEnd = end;
        } else {
            // 선택이 없으면 커서가 있는 줄을 사용
            const text = editor.value;
            let ls = start;
            while (ls > 0 && text[ls - 1] !== '\n') ls--;
            let le = start;
            while (le < text.length && text[le] !== '\n') le++;
            code = text.substring(ls, le);
            codeEnd = le;
        }

        if (!code.trim()) {
            await AppAPI.showMessage('🧮 코드 실행', '실행할 코드를 드래그로 선택하거나 코드 라인에 커서를 두세요.');
            return;
        }

        let outputs;
        try {
            outputs = runCode(code).outputs;
        } catch (err) {
            await AppAPI.showMessage('🧮 실행 오류', err.message || String(err));
            return;
        }

        const body = outputs.length > 0 ? outputs.join('\n') : '(출력 없음)';
        // 메인 탭에서 출력이 있을 때만 "메모에 삽입" 옵션 제공.
        // 읽기 전용 파일 탭에서는 삽입 불가 → 단순 결과 모달만 표시.
        const canInsert = isMainTab && outputs.length > 0;
        if (!canInsert) {
            await AppAPI.showMessage('🧮 실행 결과', body);
            return;
        }
        const action = await AppAPI.choose('🧮 실행 결과', body, [
            { value: 'insert', label: '📥 메모에 삽입' },
        ]);
        if (action === 'insert') {
            this.insertCodeResult(editor, codeEnd, outputs);
        }
    },

    // 코드 영역 끝(codeEnd) 다음에 결과를 `# ...` 주석 라인들로 삽입.
    // 직전 문자가 개행이 아니면 자동으로 개행 추가, 커서는 삽입된 끝으로.
    insertCodeResult(editor, codeEnd, outputs) {
        const text = editor.value;
        const needsNL = codeEnd > 0 && text[codeEnd - 1] !== '\n';
        const insertText = (needsNL ? '\n' : '')
            + outputs.map((o) => '# ' + o).join('\n');

        editor.value = text.substring(0, codeEnd) + insertText + text.substring(codeEnd);
        const newCursor = codeEnd + insertText.length;
        editor.setSelectionRange(newCursor, newCursor);

        this.updateLineNumbers();
        this.updateCharCount();
        state.notepad.isDirty = editor.value !== state.notepad.lastSavedContent;
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
window.downloadNotePad = () => Notepad.downloadNotePad();
window.toggleMarkdownPreview = () => Notepad.toggleMarkdownPreview();
window.changeEncoding = () => Notepad.changeEncoding();
window.resetNotePad = () => Notepad.resetNotePad();
window.runCodeBlock = () => Notepad.runCodeBlock();