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

// 호출이 ms 동안 멈출 때까지 fn 실행을 미루는 trailing-edge debounce.
// 큰 파일 입력 중 keystroke마다 발생하는 O(n) 줄수 스캔을 묶기 위해 사용.
export function debounce(fn, ms) {
    let timer = null;
    return function debounced(...args) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn.apply(this, args);
        }, ms);
    };
}

// 줄 번호 표시용 단일 텍스트("1\n2\n...\nN")를 만든다.
// `<div>` N개를 만들지 않고 한 번의 textContent 할당으로 끝내기 위한 헬퍼.
// count<1이면 빈 문자열 반환.
export function buildLineNumbersText(count) {
    if (!count || count < 1) return '';
    let buf = '1';
    for (let i = 2; i <= count; i++) {
        buf += '\n' + i;
    }
    return buf;
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
