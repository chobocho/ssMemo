// ========================================
// Main Application Entry Point
// ========================================

import { NoteSearchUI } from './note-search.js';
import { Notepad } from './notepad.js';
import { AppAPI } from './app-api.js';
import { state } from './state.js';

async function initApp() {
    await AppAPI.init();
    NoteSearchUI.setup();
    Notepad.open();
}

// Save notepad when closing the window if there are changes
window.addEventListener('beforeunload', async (e) => {
    if (state.notepad.isDirty) {
        await Notepad.save();
    }
});

window.addEventListener('load', initApp);