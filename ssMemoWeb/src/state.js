// ========================================
// State Management
// ========================================
export const state = {
    // Calendar state
    currentDate: new Date(),
    get currentYear() { return this._year || this.currentDate.getFullYear(); },
    set currentYear(val) { this._year = val; },
    get currentMonth() { return this._month ?? this.currentDate.getMonth(); },
    set currentMonth(val) { this._month = val; },

    // Data state
    notesData: [],
    allNotesData: [],
    selectedDateStr: "",

    // Canvas state
    canvas: null,
    ctx: null,
    cellWidth: 0,
    cellHeight: 0,
    noteHoverTargets: [],

    // UI Elements
    elements: {
        noteTooltip: null,
        searchPanel: null,
        searchInput: null,
        searchResults: null,
        searchEmpty: null,
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

    // Theme state
    isDarkTheme: false,
};
