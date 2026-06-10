// ========================================
// Main Application Entry Point
// ========================================

import { NoteSearchUI } from './note-search.js';
import { Notepad } from './notepad.js';
import { AppAPI } from './app-api.js';

async function initApp() {
    await AppAPI.init();
    NoteSearchUI.setup();
    Notepad.open();
}

// beforeunload의 async 핸들러는 브라우저가 promise를 기다려주지 않아 저장이
// 시작되기 전에 페이지가 사라질 수 있다. 대신 pagehide/visibilitychange(hidden)
// 시점에 저장을 시작해 유실 가능성을 줄인다 (메인 + 열린 메모 탭 모두 저장).
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') Notepad.saveAll();
});
window.addEventListener('pagehide', () => Notepad.saveAll());

// 미저장 변경이 남아 있으면 이탈 경고를 띄워 저장이 완료될 시간을 확보한다.
window.addEventListener('beforeunload', (e) => {
    if (Notepad.hasUnsavedChanges()) {
        Notepad.saveAll();
        e.preventDefault();
        e.returnValue = '';
    }
});

window.addEventListener('load', initApp);