// ========================================
// Data Management
// ========================================
import { state } from './state.js';
import { WailsRuntime } from './wails-runtime.js';
import { SearchPanel } from './search-panel.js';

export const DataManager = {
    async refreshAllNotes() {
        if (!WailsRuntime.isReady()) return;
        try {
            const result = await window.go.main.App.GetAllNotes();
            state.allNotesData = Array.isArray(result) ? result : [];
        } catch (e) {
            state.allNotesData = [];
        }
        SearchPanel.updateResults();
    }
};
