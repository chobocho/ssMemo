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
        currentMemoTitle: '', // 현재 편집 중인 메모 제목
    },
};
