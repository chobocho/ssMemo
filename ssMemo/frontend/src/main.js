// ========================================
// Main Application Entry Point
// ========================================

import { WailsRuntime } from './wails-runtime.js';
import { NoteSearchUI } from './note-search.js';
import { Notepad } from './notepad.js';
import { KeyboardHandler } from './keyboard-handler.js';

function initApp() {
    NoteSearchUI.setup();
    Notepad.open();
    window.addEventListener('keydown', (e) => KeyboardHandler.handleGlobal(e));
}

window.onload = () => {
    WailsRuntime.waitForReady(initApp);
};
