// ========================================
// Constants
// ========================================
export const CONSTANTS = {
    AUTO_SAVE_INTERVAL: 180000, // 3 minutes
    WAILS_CHECK_INTERVAL: 100,
    SEARCH_MISS_DURATION: 450,
    DIVIDER_LENGTH: 50,
    NOTEPAD_KEY: 'NOTEPAD',
    CALC_MEMORY_KEY: '__CALC_MEMORY__', // 코드 블럭 세션 메모리 영속 저장 키
    LOADING_SPINNER_THRESHOLD: 200 * 1024, // 200KB 이상 파일 로드 시 스피너 표시
    MAX_FILE_SIZE: 10 * 1024 * 1024,       // 10MB 업로드 상한
    MAX_FILE_TABS: 7,                       // 동시 열 수 있는 보조 파일 탭 수
};

// 텍스트로 허용되는 확장자 (소문자, 점 포함)
export const ALLOWED_TEXT_EXTENSIONS = [
    '.txt', '.md', '.py', '.java', '.go',
    '.c', '.cpp', '.js', '.json', '.html',
];

// Ctrl+Shift+키 → 삽입할 기호 매핑 (대문자 키만 정의, handler에서 toUpperCase로 비교)
export const SYMBOL_SHORTCUTS = {
    A: '→',
    C: '✅',
    O: '□',
    R: '※',
    Z: '🟩',
    X: '❎',
};
