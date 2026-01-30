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

window.addEventListener('load', initApp);