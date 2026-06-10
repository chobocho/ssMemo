// ========================================
// Notepad Management
// ========================================
import { state } from './state.js';
import { CONSTANTS, SYMBOL_SHORTCUTS } from './constants.js';
import { NoteSearchUI } from './note-search.js';
import { AppAPI } from './app-api.js';
import { splitTextIntoChunks, joinTextChunks, buildLineNumbersText, debounce, nextFrame, decideChunkAction, CHUNK_DELIMITER } from './utils.js';
import { renderMarkdown } from './markdown.js';
import { isAllowedTextFile, isOversized } from './file-utils.js';
import { decodeKoreanText, decodeWithEncoding, looksGarbled } from './encoding.js';
import { runCode, serializeEnv, deserializeEnv } from './calc.js';
import {
    listMemos, loadMemo, saveMemo, deleteMemo, renameMemo,
    ensureAtLeastOneMemo, validateTitle,
} from './memo-store.js';

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

// 코드 블럭 실행기의 메모리 — "메모리에 저장" 옵션을 선택했을 때만 갱신됨.
// IndexedDB(또는 폴백 메모리)에 영속 저장되며, Notepad.open()에서 자동 로드.
const calcMemory = {};

// 메모리를 영속 저장에 기록. IndexedDB 실패 시 AppAPI가 메모리 폴백으로 처리.
async function persistCalcMemory() {
    try {
        await AppAPI.saveOrUpdateNoteByDate(CONSTANTS.CALC_MEMORY_KEY, serializeEnv(calcMemory));
    } catch (e) {
        console.warn('[ssMemo] 코드 메모리 저장 실패:', e);
    }
}

// 영속 저장에서 메모리를 읽어 calcMemory에 채움. 손상 시 빈 상태로 동작.
async function loadCalcMemory() {
    try {
        const rec = await AppAPI.getNoteByDate(CONSTANTS.CALC_MEMORY_KEY);
        const restored = deserializeEnv(rec?.content || '');
        for (const k of Object.keys(calcMemory)) delete calcMemory[k];
        Object.assign(calcMemory, restored);
    } catch (e) {
        console.warn('[ssMemo] 코드 메모리 로드 실패:', e);
    }
}

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
            // 레거시 NOTEPAD → memo:기본 메모 마이그레이션 (이미 메모가 있으면 스킵).
            const firstTitle = await ensureAtLeastOneMemo();
            const memo = await loadMemo(firstTitle);
            noteEditor.value = memo.content || '';
            state.notepad.currentMemoTitle = firstTitle;
        } catch (e) {
            console.error('Failed to load notepad content:', e);
            noteEditor.value = '';
            state.notepad.currentMemoTitle = CONSTANTS.DEFAULT_MEMO_TITLE;
        }

        state.notepad.lastSavedContent = noteEditor.value;
        state.notepad.isDirty = false;
        this.refreshTitleDisplay();

        // 저장된 코드 블럭 메모리를 읽어 calcMemory에 채운다.
        // 이후 runCodeBlock에서 즉시 사용 가능하도록 await로 동기화.
        await loadCalcMemory();

        this.updateLineNumbers();
        this.updateCharCount();
        // 로드된 메모에 이미 절취선이 있을 수 있으므로 버튼 상태 동기화.
        this.syncSplitButtonState();

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
            await this.saveAll();
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

        const title = state.notepad.currentMemoTitle;
        if (!title) return "현재 메모를 알 수 없어 저장하지 못했습니다.";

        let retMsg = "저장에 성공했습니다.";
        try {
            await saveMemo(title, content);
            state.notepad.lastSavedContent = content;
            state.notepad.isDirty = false;
            console.log(`Notepad auto-saved: ${title}`);
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
        state.notepad.autoSaveTimer = setInterval(() => this.saveAll(), CONSTANTS.AUTO_SAVE_INTERVAL);
    },

    stopAutoSave() {
        if (state.notepad.autoSaveTimer) {
            clearInterval(state.notepad.autoSaveTimer);
            state.notepad.autoSaveTimer = null;
        }
    },

    // 현재 활성 탭의 에디터/줄번호/메모 슬롯 컨텍스트. 메인 탭이면 slot=null.
    activeEditorContext() {
        const tabId = fileTabs.currentTab;
        if (tabId === 'main') {
            return { tabId, editor: noteEditor, lineNumbersEl: lineNumbers, slot: null };
        }
        return {
            tabId,
            editor: document.getElementById(`note-editor-${tabId}`),
            lineNumbersEl: document.getElementById(`line-numbers-${tabId}`),
            slot: fileTabs.slots[tabId] || null,
        };
    },

    // 프로그램적 편집(구분선/기호 삽입 등) 후 줄번호/글자수/미저장 상태를 활성 탭 기준으로 갱신.
    afterProgrammaticEdit(ctx) {
        refreshLineNumbers(ctx.editor, ctx.lineNumbersEl);
        if (charCountEl) charCountEl.textContent = `글자수: ${ctx.editor.value.length}`;
        if (ctx.tabId === 'main') {
            state.notepad.isDirty = ctx.editor.value !== state.notepad.lastSavedContent;
        } else if (ctx.slot && ctx.slot.kind === 'memo') {
            ctx.slot.content = ctx.editor.value;
            ctx.slot.isDirty = ctx.editor.value !== ctx.slot.lastSavedContent;
            this.setMemoTabDirty(ctx.tabId, ctx.slot.isDirty);
        }
    },

    insertDivider() {
        const ctx = this.activeEditorContext();
        const editor = ctx.editor;
        if (!editor || editor.readOnly) return;

        const divider = '─'.repeat(CONSTANTS.DIVIDER_LENGTH);
        const cursorPos = editor.selectionStart;
        const textBefore = editor.value.substring(0, cursorPos);
        const textAfter = editor.value.substring(editor.selectionEnd);

        const prefix = (textBefore.length > 0 && !textBefore.endsWith('\n')) ? '\n' : '';
        const suffix = (textAfter.length > 0 && !textAfter.startsWith('\n')) ? '\n' : '';

        const newText = textBefore + prefix + divider + suffix + textAfter;
        editor.value = newText;

        const newCursorPos = cursorPos + prefix.length + divider.length + suffix.length;
        editor.setSelectionRange(newCursorPos, newCursorPos);

        this.afterProgrammaticEdit(ctx);
    },

    insertSymbol(symbol) {
        const ctx = this.activeEditorContext();
        const editor = ctx.editor;
        if (!editor || editor.readOnly) return;

        const cursorPos = editor.selectionStart;
        const textBefore = editor.value.substring(0, cursorPos);
        const textAfter = editor.value.substring(editor.selectionEnd);

        const newText = textBefore + symbol + textAfter;
        editor.value = newText;

        const newCursorPos = cursorPos + symbol.length;
        editor.setSelectionRange(newCursorPos, newCursorPos);

        this.afterProgrammaticEdit(ctx);
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
        if (e.ctrlKey && (e.key === 'f' || e.key === 'F' || e.key === 'I' || e.key === 'i')) {
            e.preventDefault();
            state.elements.noteSearchInput?.focus();
            return;
        }

        // 스크롤/이동 단축키는 현재 활성 탭의 에디터를 대상으로 한다.
        const { editor: currentEditor } = this.activeEditorContext();

        if (e.key === 'PageUp' || (e.altKey && (e.key === 'B' || e.key === 'b'))) {
            e.preventDefault();
            if (currentEditor) currentEditor.scrollTop -= currentEditor.clientHeight;
            return;
        }

        if (e.key === 'PageDown' || (e.altKey && (e.key === 'F' || e.key === 'f'))) {
            e.preventDefault();
            if (currentEditor) currentEditor.scrollTop += currentEditor.clientHeight;
            return;
        }

        if (e.ctrlKey && (e.key === '6' || e.key === 'h' || e.key === 'H')) {
            e.preventDefault();
            if (currentEditor) {
                currentEditor.setSelectionRange(0, 0);
                currentEditor.scrollTop = 0;
            }
            return;
        }

        if (e.ctrlKey && (e.key === '4' || e.key === 'e' || e.key === 'E')) {
            e.preventDefault();
            if (currentEditor) {
                const endPos = currentEditor.value.length;
                currentEditor.setSelectionRange(endPos, endPos);
                currentEditor.scrollTop = currentEditor.scrollHeight;
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

    // 절취선 토글 버튼의 텍스트/툴팁을 현재 메모 내용에 맞춘다.
    // 메모 로드/리셋/분할 토글 직후 호출해 시각과 콘텐츠 상태를 일치시킨다.
    syncSplitButtonState(len = 2000) {
        const btn = document.querySelector('button[onclick^="splitNoteIntoChunks"]');
        if (!btn || !noteEditor) return;
        const hasDelimiter = noteEditor.value.includes(CHUNK_DELIMITER);
        if (hasDelimiter) {
            btn.textContent = '➕';
            btn.title = '절취선 문구 삭제';
        } else {
            btn.textContent = '➗';
            btn.title = `${len}자 크기로 나누기`;
        }
    },

    splitNoteIntoChunks(len) {
        if (!noteEditor) return;
        const content = noteEditor.value;
        const action = decideChunkAction(content, len);
        if (action === 'noop') return;

        if (action === 'join') {
            noteEditor.value = joinTextChunks(content);
            if (state.elements.noteSearchInput &&
                state.elements.noteSearchInput.value === '절취선') {
                state.elements.noteSearchInput.value = '';
            }
        } else {
            noteEditor.value = splitTextIntoChunks(content, len);
            if (state.elements.noteSearchInput) {
                state.elements.noteSearchInput.value = '절취선';
            }
        }

        this.syncSplitButtonState(len);
        this.updateLineNumbers();
        this.updateCharCount();
        state.notepad.isDirty = noteEditor.value !== state.notepad.lastSavedContent;
    },

    showHelpPanel() {
        // 한 줄: 키(또는 아이콘) + 설명. < > 는 HTML 태그로 해석되지 않도록 미리 이스케이프해 전달.
        const row = (key, desc) =>
            `<li><span class="help-key">${key}</span><span class="help-desc">${desc}</span></li>`;

        const sections = [
            ['🗂️ 메모 & 탭', [
                row('📁 파일 메뉴', '메모 관리 · 파일 불러오기 · 저장 · 다운로드 · 메모 비우기'),
                row('📋 메모 관리', '새 메모 만들기 · 전환 · 이름 변경 · 삭제'),
                row('🗂️ 탭', '메모를 추가 탭으로 열어 동시 편집 (메인 + 최대 7개)'),
                row('• 표시', '저장하지 않은 변경이 있는 메모 탭에 표시'),
                row('자동 저장', '3분마다 메인 메모와 열려 있는 모든 메모 탭을 저장'),
                row('파일 열기', '드래그 앤 드롭 또는 파일 불러오기 (읽기 전용 탭)'),
            ]],
            ['🧰 툴바 아이콘', [
                row('➗ / ➕', '2000자 단위로 나누기(절취선) / 절취선 제거'),
                row('⬇️ / ⬆️', '강제 줄바꿈 켜기 / 끄기'),
                row('📖', '마크다운 미리보기 (.md 파일 탭)'),
                row('🔤', '인코딩 변경 — UTF-8 / CP949 / Johab (파일 탭)'),
                row('🧮', '선택한 코드 실행'),
                row('🔍', '텍스트 검색'),
            ]],
            ['⌨️ 단축키', [
                row('Ctrl + F / Ctrl + I', '검색창 포커스'),
                row('Ctrl + &lt; / Ctrl + ,', '이전 검색 결과'),
                row('Ctrl + &gt; / Ctrl + . / Ctrl + N', '다음 검색 결과'),
                row('Ctrl + L', '구분선 삽입'),
                row('Ctrl + Enter', '선택한 코드 실행 🧮'),
                row('Ctrl + 6 / Ctrl + H', '문서 맨 위로'),
                row('Ctrl + 4 / Ctrl + E', '문서 맨 아래로'),
                row('Alt + B / PageUp', '페이지 위로'),
                row('Alt + F / PageDown', '페이지 아래로'),
            ]],
            ['✨ 기호 삽입 (Ctrl + Shift)', [
                row('Ctrl + Shift + A', '→'),
                row('Ctrl + Shift + C', '✅ 체크마크'),
                row('Ctrl + Shift + O', '□ 박스'),
                row('Ctrl + Shift + R', '※'),
                row('Ctrl + Shift + X', '❎'),
                row('Ctrl + Shift + Z', '🟩'),
            ]],
            ['🧮 코드 실행', [
                row('실행', '코드를 드래그 후 🧮 또는 Ctrl + Enter (선택 없으면 현재 줄)'),
                row('지원 문법', '+ − * / // · 괄호 · 변수 · sin/cos/tan · factorial(n≤1000) · # 주석'),
                row('정수 정밀도', 'BigInt 기반 — 5000자리 이상도 정확'),
                row('📥 메모에 삽입', '코드 다음 줄에 # 주석으로 결과 삽입'),
                row('💾 메모리에 저장', '변수를 IndexedDB에 영속 저장 (다음 실행에서 자동 사용)'),
                row('🗑️ 메모리 초기화', '저장된 변수 모두 삭제'),
            ]],
            ['🔗 기타', [
                row('URL 열기', 'URL을 드래그한 뒤 우클릭하면 새 창으로 이동'),
            ]],
        ];

        const bodyHtml = sections.map(([title, rows]) =>
            `<div class="help-section">
                <h4>${title}</h4>
                <ul class="help-list">${rows.join('')}</ul>
            </div>`).join('');

        const overlay = document.createElement('div');
        overlay.className = 'custom-modal-overlay';
        const modal = document.createElement('div');
        modal.className = 'custom-modal help-modal';
        modal.innerHTML = `
            <div class="custom-modal-header">📝 ssMemo 도움말</div>
            <div class="custom-modal-body help-body">${bodyHtml}</div>
            <div class="custom-modal-footer">
                <button class="custom-modal-btn">확인</button>
            </div>
        `;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        modal.querySelector('.custom-modal-btn').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
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

    // 탭 라벨 텍스트/툴팁 설정. 이름이 12글자를 초과하면 8글자 + '...'로 축약하고
    // 전체 이름은 툴팁으로 보존. tooltip이 주어지면 라벨 title로 사용.
    setTabLabel(index, fullName, tooltip) {
        const tab = document.querySelector(`.note-tab[data-tab="${index}"]`);
        if (!tab) return;
        tab.classList.remove('note-tab-hidden');
        const labelEl = tab.querySelector('.note-tab-label');
        if (labelEl) {
            const displayName = fullName.length > 12
                ? fullName.substring(0, 8) + '...'
                : fullName;
            labelEl.textContent = displayName;
            labelEl.title = tooltip || fullName;
        }
    },

    showFileTab(index) {
        const fileInfo = fileTabs.slots[index];
        if (!fileInfo) return;
        this.setTabLabel(index, fileInfo.fileName);
    },

    // 메모 탭의 라벨을 제목으로 설정 (툴팁은 "메모: 제목").
    showMemoTab(index) {
        const slot = fileTabs.slots[index];
        if (!slot || slot.kind !== 'memo') return;
        this.setTabLabel(index, slot.title, `메모: ${slot.title}`);
        this.setMemoTabDirty(index, slot.isDirty);
    },

    // 메모 탭의 미저장 표시(•) 토글.
    setMemoTabDirty(index, dirty) {
        const tab = document.querySelector(`.note-tab[data-tab="${index}"]`);
        if (tab) tab.classList.toggle('note-tab-dirty', !!dirty);
    },

    // 이미 열려 있는 메모인지 확인. 메인 탭 또는 슬롯 탭이면 위치를 반환.
    findOpenMemo(title) {
        if (title === state.notepad.currentMemoTitle) return 'main';
        const idx = fileTabs.slots.findIndex(
            (s) => s && s.kind === 'memo' && s.title === title);
        return idx === -1 ? null : idx;
    },

    // IndexedDB 메모를 빈 슬롯 탭에 편집 가능한 상태로 추가로 연다.
    // 이미 열린 메모면 해당 탭으로 전환만 한다. 빈 슬롯이 없으면 안내.
    async openMemoInTab(title) {
        const open = this.findOpenMemo(title);
        if (open !== null) {
            this.switchTab(open);
            return;
        }

        const emptySlot = fileTabs.slots.findIndex((s) => s === null);
        if (emptySlot === -1) {
            await AppAPI.showMessage(
                '메모 열기 실패',
                `탭이 가득 찼습니다. 최대 ${CONSTANTS.MAX_FILE_TABS}개까지 추가로 열 수 있습니다.`);
            return;
        }

        let content = '';
        try {
            const memo = await loadMemo(title);
            content = memo.content || '';
        } catch (e) {
            console.error('Failed to load memo into tab:', e);
            await AppAPI.showMessage('메모 열기 실패', '메모를 불러오지 못했습니다.');
            return;
        }

        fileTabs.slots[emptySlot] = {
            kind: 'memo', title, content,
            lastSavedContent: content, isDirty: false,
        };
        this.showMemoTab(emptySlot);
        this.loadMemoToEditor(emptySlot);
        this.switchTab(emptySlot);
    },

    // 메모 슬롯의 콘텐츠를 에디터에 싣고 편집 가능 상태로 만든다.
    // 파일 탭과 달리 readonly를 해제하고 입력 시 슬롯 상태/미저장 표시를 갱신한다.
    loadMemoToEditor(index) {
        const slot = fileTabs.slots[index];
        if (!slot || slot.kind !== 'memo') return;

        const editor = document.getElementById(`note-editor-${index}`);
        const lineNumEl = document.getElementById(`line-numbers-${index}`);
        const container = document.getElementById(`note-container-${index}`);
        if (!editor || !lineNumEl) return;

        editor.value = slot.content;
        editor.readOnly = false;
        if (container) container.classList.remove('note-editor-readonly');
        refreshLineNumbers(editor, lineNumEl);

        editor.onscroll = () => { lineNumEl.scrollTop = editor.scrollTop; };
        editor.onkeydown = (e) => this.handleKeyDown(e);
        editor.oninput = () => {
            refreshLineNumbers(editor, lineNumEl);
            slot.content = editor.value;
            slot.isDirty = editor.value !== slot.lastSavedContent;
            this.setMemoTabDirty(index, slot.isDirty);
            if (fileTabs.currentTab === index) this.updateCharCountForTab(index);
            lineNumEl.scrollTop = editor.scrollTop;
        };
    },

    // 메모 탭 슬롯을 IndexedDB에 저장. 변경 없으면 저장 생략.
    async saveMemoSlot(index) {
        const slot = fileTabs.slots[index];
        if (!slot || slot.kind !== 'memo') return '저장할 메모가 아닙니다.';

        const editor = document.getElementById(`note-editor-${index}`);
        const content = editor ? editor.value : slot.content;
        if (!slot.isDirty && content === slot.lastSavedContent) {
            return '변경된 내용이 없습니다.';
        }
        try {
            await saveMemo(slot.title, content);
            slot.content = content;
            slot.lastSavedContent = content;
            slot.isDirty = false;
            this.setMemoTabDirty(index, false);
            console.log(`Memo tab auto-saved: ${slot.title}`);
            return '저장에 성공했습니다.';
        } catch (e) {
            console.error('Failed to save memo tab:', e);
            return '저장에 실패했습니다.';
        }
    },

    async saveMemoSlotWithNotification(index) {
        const msg = await this.saveMemoSlot(index);
        await AppAPI.showMessage('메모 저장', msg);
    },

    // 메인 메모 또는 열려 있는 메모 탭에 미저장 변경이 있는지. 이탈 경고 판단용.
    hasUnsavedChanges() {
        if (state.notepad.isDirty) return true;
        return fileTabs.slots.some((s) => s && s.kind === 'memo' && s.isDirty);
    },

    // 메인 메모 + 열려 있는 모든 더티 메모 탭을 함께 저장. 자동 저장/닫기에서 사용.
    async saveAll() {
        await this.save();
        for (let i = 0; i < fileTabs.slots.length; i++) {
            const s = fileTabs.slots[i];
            if (s && s.kind === 'memo' && s.isDirty) {
                await this.saveMemoSlot(i);
            }
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
        const container = document.getElementById(`note-container-${index}`);

        if (!editor || !lineNumEl) return;

        // 슬롯이 이전에 편집 가능한 메모로 쓰였을 수 있으므로 읽기 전용 상태로 복원.
        editor.value = fileInfo.content;
        editor.readOnly = true;
        editor.oninput = null;
        if (container) container.classList.add('note-editor-readonly');
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
        // 슬롯 탭 id를 숫자로 정규화. data-tab 속성은 문자열("0")이고 findIndex는 숫자(0)를
        // 돌려주므로, currentTab 타입을 통일해 이후 === 비교(예: 메모 입력 핸들러)를 일치시킨다.
        if (tabId !== 'main') tabId = Number(tabId);

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
        // 메인 메모장 전용 편집 아이콘은 파일 탭에서 숨김.
        // 저장/다운로드/초기화는 📁 파일 메뉴 안에서 탭별로 동적 표시되므로 여기서 다루지 않음.
        const splitBtn = document.querySelector('button[onclick^="splitNoteIntoChunks"]');
        if (splitBtn) {
            splitBtn.style.display = (tabId === 'main') ? '' : 'none';
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

    async closeFileTab(index) {
        const slot = fileTabs.slots[index];
        // 탭 닫기 확인 — 메모 탭은 제목, 파일 탭은 파일명으로 안내.
        const label = slot?.kind === 'memo'
            ? slot.title
            : (slot?.fileName || `파일 ${index + 1}`);
        const ok = await AppAPI.confirm('탭 닫기', `"${label}" 탭을 닫으시겠습니까?`);
        if (!ok) return;

        // 편집 가능한 메모 탭은 닫기 전에 변경분을 저장해 데이터 유실을 막는다.
        if (slot?.kind === 'memo' && slot.isDirty) {
            await this.saveMemoSlot(index);
        }

        this.discardTab(index);
    },

    // 슬롯 탭을 확인/저장 없이 비우고 UI를 초기화한다. 닫기/삭제 동기화에서 사용.
    discardTab(index) {
        // 슬롯 초기화
        fileTabs.slots[index] = null;
        fileTabs.previewStates[index] = false;
        fileTabs.wrapStates[index] = false;

        // 탭 숨기기 및 미저장 표시 제거
        this.hideFileTab(index);
        this.setMemoTabDirty(index, false);

        // 에디터 내용 초기화 및 미리보기 정리 — 메모 편집 후 남은 readonly 해제 상태도 복원.
        const editor = document.getElementById(`note-editor-${index}`);
        const lineNumEl = document.getElementById(`line-numbers-${index}`);
        const previewEl = document.getElementById(`note-md-preview-${index}`);
        const container = document.getElementById(`note-container-${index}`);
        if (editor) {
            editor.value = '';
            editor.readOnly = true;
            editor.oninput = null;
            editor.classList.remove('hidden');
        }
        if (container) container.classList.add('note-editor-readonly');
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
        let resultMsg = '메모장이 초기화되었습니다.';
        try {
            // 현재 메모를 비운다 — 메모 자체는 유지되고 본문만 빈 상태로.
            // 메모를 삭제하려면 메모 관리 📋의 [삭제] 버튼을 사용.
            const title = state.notepad.currentMemoTitle;
            if (title) {
                await saveMemo(title, '');
            }
            state.notepad.lastSavedContent = '';
            state.notepad.isDirty = false;
        } catch (e) {
            console.error('Failed to reset notepad:', e);
            // 저장 실패 시 화면만 비우면 DB와 어긋난다(새로고침 시 내용 부활).
            // 마지막 저장 내용으로 복원하고 실패를 그대로 알린다.
            noteEditor.value = state.notepad.lastSavedContent;
            state.notepad.isDirty = false;
            resultMsg = '저장소에 반영하지 못해 초기화를 취소했습니다. 잠시 후 다시 시도해주세요.';
        }
        this.updateLineNumbers();
        this.updateCharCount();
        this.syncSplitButtonState();
        await AppAPI.showMessage('메모장 초기화', resultMsg);
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
                fileName = slot.kind === 'memo' ? `${slot.title}.txt` : slot.fileName;
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
    // 모달 옵션:
    //   - 📥 메모에 삽입 (메인 탭 + 출력 있을 때)
    //   - 💾 메모리에 저장 (항상)
    //   - 🗑️ 메모리 초기화 (메모리에 변수가 있을 때)
    // 메모리는 매 실행 시 initialEnv로 자동 주입(읽기)되지만, 쓰기는 명시적 저장만.
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

        let outputs, env;
        try {
            const r = runCode(code, calcMemory);
            outputs = r.outputs;
            env = r.env;
        } catch (err) {
            await AppAPI.showMessage('🧮 실행 오류', err.message || String(err));
            return;
        }

        const memKeys = Object.keys(calcMemory);
        const memHeader = memKeys.length > 0
            ? `[메모리: ${memKeys.join(', ')}]\n\n`
            : '';
        const body = memHeader + (outputs.length > 0 ? outputs.join('\n') : '(출력 없음)');

        // 메인 탭과 편집 가능한 메모 탭 모두 결과 삽입 가능 (읽기 전용 파일 탭 제외).
        const isEditable = isMainTab || fileTabs.slots[currentTab]?.kind === 'memo';
        const options = [];
        if (isEditable && outputs.length > 0) {
            options.push({ value: 'insert', label: '📥 메모에 삽입' });
        }
        options.push({ value: 'save', label: '💾 메모리에 저장' });
        if (memKeys.length > 0) {
            options.push({ value: 'clear', label: '🗑️ 메모리 초기화' });
        }

        const action = await AppAPI.choose('🧮 실행 결과', body, options);
        if (action === 'insert') {
            this.insertCodeResult(editor, codeEnd, outputs);
        } else if (action === 'save') {
            // 실행 후의 env(initialEnv + 신규 대입) 전체를 메모리에 병합 후 영속화.
            Object.assign(calcMemory, env);
            persistCalcMemory();
        } else if (action === 'clear') {
            for (const k of Object.keys(calcMemory)) delete calcMemory[k];
            persistCalcMemory();
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

        // 활성 탭(메인/메모) 기준으로 줄번호·글자수·미저장 상태 갱신.
        this.afterProgrammaticEdit(this.activeEditorContext());
    },

    // 파일 메뉴 모달 — 메모/파일 관련 액션을 한 곳에 모음.
    // 현재 탭에 따라 옵션 동적 구성 (파일 탭에서는 메인 전용 액션 숨김).
    async openFileMenu() {
        const currentTab = fileTabs.currentTab;
        const isMainTab = currentTab === 'main';
        const isMemoTab = !isMainTab && fileTabs.slots[currentTab]?.kind === 'memo';
        const options = [
            { value: 'memos', label: '📋 메모 관리 (목록/이름변경/삭제)' },
            { value: 'load',  label: '🗂️ 파일 불러오기' },
        ];
        // 메인 메모와 편집 가능한 메모 탭 모두 저장 가능.
        if (isMainTab || isMemoTab) {
            options.push({ value: 'save', label: '💾 저장' });
        }
        options.push({ value: 'download', label: '📥 다운로드' });
        if (isMainTab) {
            options.push({ value: 'reset', label: '🗑️ 메모 비우기' });
        }

        const action = await AppAPI.choose('📁 파일', '원하는 작업을 선택하세요.', options);
        switch (action) {
            case 'memos':    return this.openMemoManager();
            case 'load':     return this.loadFileFromDisk();
            case 'save':     return isMainTab
                ? this.saveWithNotification()
                : this.saveMemoSlotWithNotification(currentTab);
            case 'download': return this.downloadNotePad();
            case 'reset':    return this.resetNotePad();
        }
    },

    // 현재 메모 제목을 헤더에 표시.
    refreshTitleDisplay() {
        const el = document.getElementById('current-memo-title');
        if (!el) return;
        const title = state.notepad.currentMemoTitle || '메모장';
        el.textContent = title;
        el.title = `현재 메모: ${title}`;
    },

    // 메인 탭의 콘텐츠를 currentMemoTitle 메모로 저장하고, target 메모로 전환.
    // 더티 상태면 먼저 저장. 전환 후 화면/상태/메모리 모두 갱신.
    async switchToMemo(title) {
        if (!noteEditor) return;
        if (title === state.notepad.currentMemoTitle) return;
        if (state.notepad.isDirty) await this.save();
        // 같은 메모가 별도 탭으로 열려 있으면 메인과 중복되므로, 저장 후 그 탭을 닫는다.
        const dupIdx = fileTabs.slots.findIndex(
            (s) => s && s.kind === 'memo' && s.title === title);
        if (dupIdx !== -1) {
            if (fileTabs.slots[dupIdx].isDirty) await this.saveMemoSlot(dupIdx);
            this.discardTab(dupIdx);
        }
        try {
            const memo = await loadMemo(title);
            noteEditor.value = memo.content || '';
        } catch (e) {
            console.error('Failed to load memo:', e);
            await AppAPI.showMessage('메모 열기 실패', '메모를 불러오지 못했습니다.');
            return;
        }
        state.notepad.currentMemoTitle = title;
        state.notepad.lastSavedContent = noteEditor.value;
        state.notepad.isDirty = false;
        this.refreshTitleDisplay();
        this.updateLineNumbers();
        this.updateCharCount();
        this.syncSplitButtonState();
        // 메인 탭으로 강제 전환 (다른 파일 탭이 열려 있을 수 있음).
        this.switchToMainTabIfNeeded();
    },

    // 현재 활성 탭이 메인이 아니면 메인으로 전환.
    switchToMainTabIfNeeded() {
        if (fileTabs.currentTab !== 'main' && typeof this.switchTab === 'function') {
            this.switchTab('main');
        }
    },

    // 메모 관리 모달. 사용자가 메모 목록과 액션(열기/이름변경/삭제/새 메모)을 다룰 수 있음.
    async openMemoManager() {
        // 진입 직전 더티 상태면 먼저 저장해 목록의 updatedAt이 최신을 반영하도록.
        // 메인 + 열린 메모 탭을 모두 저장.
        await this.saveAll();

        let memos;
        try {
            memos = await listMemos();
        } catch (e) {
            await AppAPI.showMessage('메모 목록 오류', '메모 목록을 불러오지 못했습니다.');
            return;
        }

        const action = await this.showMemoManagerModal(memos);
        if (!action) return;

        if (action.type === 'open') {
            await this.switchToMemo(action.title);
        } else if (action.type === 'open-tab') {
            await this.openMemoInTab(action.title);
        } else if (action.type === 'new') {
            await this.createNewMemo();
        } else if (action.type === 'rename') {
            await this.promptRename(action.title);
        } else if (action.type === 'delete') {
            await this.promptDelete(action.title);
        }
    },

    // 메모 관리 모달 렌더링. 사용자 선택을 액션 객체로 반환.
    async showMemoManagerModal(memos) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'custom-modal-overlay';
            const modal = document.createElement('div');
            modal.className = 'custom-modal memo-manager-modal';
            modal.innerHTML = `
                <div class="custom-modal-header">📋 메모 관리</div>
                <div class="custom-modal-body memo-manager-body"></div>
                <div class="custom-modal-footer">
                    <button class="custom-modal-btn custom-modal-btn-cancel">닫기</button>
                </div>
            `;
            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            const body = modal.querySelector('.memo-manager-body');
            const cleanup = (val) => { overlay.remove(); resolve(val); };

            // "새 메모" 버튼 (목록 위)
            const newBtn = document.createElement('button');
            newBtn.className = 'custom-modal-btn memo-manager-new-btn';
            newBtn.textContent = '➕ 새 메모';
            newBtn.addEventListener('click', () => cleanup({ type: 'new' }));
            body.appendChild(newBtn);

            // 목록
            const list = document.createElement('div');
            list.className = 'memo-manager-list';
            const currentTitle = state.notepad.currentMemoTitle;
            memos.forEach((m) => {
                const row = document.createElement('div');
                row.className = 'memo-manager-row' + (m.title === currentTitle ? ' is-current' : '');

                const titleSpan = document.createElement('span');
                titleSpan.className = 'memo-manager-title';
                titleSpan.textContent = (m.title === currentTitle ? '✓ ' : '') + m.title;
                row.appendChild(titleSpan);

                const actions = document.createElement('span');
                actions.className = 'memo-manager-actions';

                const openBtn = document.createElement('button');
                openBtn.className = 'memo-manager-action';
                openBtn.textContent = '열기';
                openBtn.disabled = (m.title === currentTitle);
                openBtn.addEventListener('click', () => cleanup({ type: 'open', title: m.title }));
                actions.appendChild(openBtn);

                // 추가 탭으로 열기 — 이미 열려 있으면(메인/슬롯) 비활성화.
                const openTabBtn = document.createElement('button');
                openTabBtn.className = 'memo-manager-action';
                openTabBtn.textContent = '🗂️ 탭';
                const alreadyOpen = this.findOpenMemo(m.title) !== null;
                openTabBtn.disabled = alreadyOpen;
                if (alreadyOpen) openTabBtn.title = '이미 열려 있는 메모입니다.';
                openTabBtn.addEventListener('click', () => cleanup({ type: 'open-tab', title: m.title }));
                actions.appendChild(openTabBtn);

                const renameBtn = document.createElement('button');
                renameBtn.className = 'memo-manager-action';
                renameBtn.textContent = '이름변경';
                renameBtn.addEventListener('click', () => cleanup({ type: 'rename', title: m.title }));
                actions.appendChild(renameBtn);

                const delBtn = document.createElement('button');
                delBtn.className = 'memo-manager-action memo-manager-action-danger';
                delBtn.textContent = '삭제';
                delBtn.addEventListener('click', () => cleanup({ type: 'delete', title: m.title }));
                actions.appendChild(delBtn);

                row.appendChild(actions);
                list.appendChild(row);
            });
            if (memos.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'memo-manager-empty';
                empty.textContent = '저장된 메모가 없습니다.';
                list.appendChild(empty);
            }
            body.appendChild(list);

            modal.querySelector('.custom-modal-btn-cancel')
                .addEventListener('click', () => cleanup(null));
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) cleanup(null);
            });
        });
    },

    // 텍스트 입력 모달. 취소/잘못된 입력 시 null 반환, 성공 시 trim된 문자열 반환.
    // validator는 (string) => string|null 형태: null이면 통과, 문자열이면 에러 메시지.
    async promptText(title, message, defaultValue, validator) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'custom-modal-overlay';
            const modal = document.createElement('div');
            modal.className = 'custom-modal';
            modal.innerHTML = `
                <div class="custom-modal-header"></div>
                <div class="custom-modal-body">
                    <div class="prompt-message"></div>
                    <input type="text" class="prompt-input" />
                    <div class="prompt-error"></div>
                </div>
                <div class="custom-modal-footer">
                    <button class="custom-modal-btn custom-modal-btn-cancel">취소</button>
                    <button class="custom-modal-btn">확인</button>
                </div>
            `;
            overlay.appendChild(modal);
            modal.querySelector('.custom-modal-header').textContent = title;
            modal.querySelector('.prompt-message').textContent = message;
            const input = modal.querySelector('.prompt-input');
            input.value = defaultValue || '';
            const errEl = modal.querySelector('.prompt-error');
            document.body.appendChild(overlay);
            setTimeout(() => { input.focus(); input.select(); }, 10);

            const cleanup = (val) => { overlay.remove(); resolve(val); };
            const tryConfirm = () => {
                const v = input.value.trim();
                const err = validator ? validator(v) : null;
                if (err) { errEl.textContent = err; return; }
                cleanup(v);
            };

            modal.querySelectorAll('.custom-modal-btn')[1]
                .addEventListener('click', tryConfirm);
            modal.querySelector('.custom-modal-btn-cancel')
                .addEventListener('click', () => cleanup(null));
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) cleanup(null);
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); tryConfirm(); }
                if (e.key === 'Escape') { e.preventDefault(); cleanup(null); }
            });
        });
    },

    // 새 메모 생성. 제목 입력 → 빈 콘텐츠로 저장 → 해당 메모로 전환.
    async createNewMemo() {
        const existing = (await listMemos()).map((m) => m.title);
        const newTitle = await this.promptText(
            '➕ 새 메모', '새 메모 제목을 입력하세요.', '',
            (t) => {
                const v = validateTitle(t);
                if (v) return v;
                if (existing.includes(t)) return '같은 제목의 메모가 이미 존재합니다.';
                return null;
            }
        );
        if (!newTitle) return;
        try {
            await saveMemo(newTitle, '');
            await this.switchToMemo(newTitle);
        } catch (e) {
            console.error('Failed to create memo:', e);
            await AppAPI.showMessage('새 메모 생성 실패', '메모를 생성하지 못했습니다.');
        }
    },

    // 메모 이름 변경. 현재 메모를 변경할 경우 currentMemoTitle도 갱신.
    async promptRename(oldTitle) {
        const existing = (await listMemos()).map((m) => m.title).filter((t) => t !== oldTitle);
        const newTitle = await this.promptText(
            '✏️ 이름 변경', `"${oldTitle}" → 새 제목`, oldTitle,
            (t) => {
                const v = validateTitle(t);
                if (v) return v;
                if (t === oldTitle) return '기존 제목과 같습니다.';
                if (existing.includes(t)) return '같은 제목의 메모가 이미 존재합니다.';
                return null;
            }
        );
        if (!newTitle) return;
        try {
            // 이름 변경 직전, 더티 콘텐츠가 있으면 옛 키로 먼저 저장 (메인/메모 탭 모두).
            if (oldTitle === state.notepad.currentMemoTitle && state.notepad.isDirty) {
                await this.save();
            }
            const slotIdx = fileTabs.slots.findIndex(
                (s) => s && s.kind === 'memo' && s.title === oldTitle);
            if (slotIdx !== -1 && fileTabs.slots[slotIdx].isDirty) {
                await this.saveMemoSlot(slotIdx);
            }
            await renameMemo(oldTitle, newTitle);
            if (oldTitle === state.notepad.currentMemoTitle) {
                state.notepad.currentMemoTitle = newTitle;
                this.refreshTitleDisplay();
            }
            // 열려 있는 메모 탭이면 슬롯 제목과 라벨도 갱신.
            if (slotIdx !== -1) {
                fileTabs.slots[slotIdx].title = newTitle;
                this.showMemoTab(slotIdx);
            }
        } catch (e) {
            console.error('Failed to rename memo:', e);
            await AppAPI.showMessage('이름 변경 실패', e.message || '메모 이름을 변경하지 못했습니다.');
        }
    },

    // 메모 삭제. 현재 메모를 삭제하면 남은 첫 메모로 전환, 없으면 기본 메모 생성.
    async promptDelete(title) {
        const ok = await AppAPI.confirm(
            '🗑️ 메모 삭제',
            `"${title}" 메모를 영구 삭제합니다.\n이 작업은 되돌릴 수 없습니다.`
        );
        if (!ok) return;
        try {
            await deleteMemo(title);
        } catch (e) {
            console.error('Failed to delete memo:', e);
            await AppAPI.showMessage('삭제 실패', '메모를 삭제하지 못했습니다.');
            return;
        }
        // 삭제한 메모가 별도 탭으로 열려 있으면 저장 없이 탭을 닫는다.
        const slotIdx = fileTabs.slots.findIndex(
            (s) => s && s.kind === 'memo' && s.title === title);
        if (slotIdx !== -1) this.discardTab(slotIdx);
        // 현재 메모를 삭제한 경우 다음 메모로 전환 (없으면 기본 메모 새로 생성).
        if (title === state.notepad.currentMemoTitle) {
            const memos = await listMemos();
            if (memos.length > 0) {
                state.notepad.isDirty = false; // 삭제됐으므로 저장 시도 막기
                state.notepad.currentMemoTitle = '';
                await this.switchToMemo(memos[0].title);
            } else {
                const newTitle = CONSTANTS.DEFAULT_MEMO_TITLE;
                await saveMemo(newTitle, '');
                state.notepad.isDirty = false;
                state.notepad.currentMemoTitle = '';
                await this.switchToMemo(newTitle);
            }
        }
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
window.openMemoManager = () => Notepad.openMemoManager();
window.openFileMenu = () => Notepad.openFileMenu();