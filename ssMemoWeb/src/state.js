// ========================================
// State Management
// ========================================
export const state = {
    // UI Elements
    elements: {
        noteSearchInput: null,
        noteSearchBtn: null,
        noteSearchPrevBtn: null,
        noteSearchNextBtn: null,
    },

    // Notepad state
    notepad: {
        lastSavedContent: '',
        isDirty: false,
        autoSaveTimer: null,
    },
};
