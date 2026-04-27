// ========================================
// Pure utility helpers (DOM-free, testable)
// ========================================

export const CHUNK_DELIMITER = "\n\n<----------[절취선]---------->\n\n";

// 입력 문자열을 len 글자 단위로 잘라 delimiter로 이어 붙입니다.
export function splitTextIntoChunks(text, len, delimiter = CHUNK_DELIMITER) {
    if (!text || !len || len <= 0 || text.length <= len) return text;
    let result = '';
    for (let i = 0; i < text.length; i += len) {
        if (i > 0) result += delimiter;
        result += text.substring(i, i + len);
    }
    return result;
}

// splitTextIntoChunks가 삽입한 delimiter를 모두 제거합니다.
export function joinTextChunks(text, delimiter = CHUNK_DELIMITER) {
    if (!text || !text.includes(delimiter)) return text;
    return text.split(delimiter).join('');
}

// content 안에서 query를 정방향 검색. 없으면 -1.
// startIndex 이후에서 못 찾고 startIndex>0이면 처음부터 다시 시도(랩어라운드).
export function findNextIndex(content, query, startIndex = 0) {
    if (!content || !query) return -1;
    const safeStart = Math.max(0, startIndex);
    let idx = content.indexOf(query, safeStart);
    if (idx === -1 && safeStart > 0) {
        idx = content.indexOf(query, 0);
    }
    return idx;
}

// content 안에서 query를 역방향 검색. 없으면 -1.
// 못 찾으면 끝에서부터 다시 시도(랩어라운드).
export function findPrevIndex(content, query, startIndex) {
    if (!content || !query) return -1;
    if (startIndex < 0) return -1;
    let idx = content.lastIndexOf(query, startIndex);
    if (idx === -1) {
        idx = content.lastIndexOf(query, content.length);
    }
    return idx;
}
