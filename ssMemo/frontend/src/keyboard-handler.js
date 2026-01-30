// ========================================
// Keyboard Handler
// ========================================
import { state } from './state.js';
import { Notepad } from './notepad.js';

export const KeyboardHandler = {
    handleGlobal(e) {
        const isFindShortcut = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f';
        const isSaveShortcut = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's';

        if (isFindShortcut) {
            e.preventDefault();
            const notePanel = document.getElementById('note-panel');
            if (!notePanel || notePanel.classList.contains('hidden')) {
                Notepad.open().then(() => {
                    if (state.elements.noteSearchInput) {
                        state.elements.noteSearchInput.focus();
                        state.elements.noteSearchInput.select();
                    }
                });
                return;
            }

            if (state.elements.noteSearchInput) {
                state.elements.noteSearchInput.focus();
                state.elements.noteSearchInput.select();
            }
            return;
        }

        if (isSaveShortcut) {
            const notePanel = document.getElementById('note-panel');
            if (notePanel && !notePanel.classList.contains('hidden')) {
                e.preventDefault();
                Notepad.save();
                return;
            }
        }
    }
};
