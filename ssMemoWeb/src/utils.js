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

// 절취선 토글 버튼이 클릭됐을 때 어떤 동작을 해야 하는지 결정.
// - delimiter가 이미 있으면 길이와 무관하게 'join' (짧아진 메모에서도 토글 가능)
// - delimiter가 없을 때는 text가 len보다 길어야 'split', 아니면 'noop'
// 분기 로직을 순수 함수로 두어 단위 테스트가 가능하도록 분리.
export function decideChunkAction(text, len, delimiter = CHUNK_DELIMITER) {
    if (typeof text !== 'string' || !len || len <= 0) return 'noop';
    if (text.includes(delimiter)) return 'join';
    return text.length > len ? 'split' : 'noop';
}

// 다음 애니메이션 프레임까지 메인 스레드를 양보. 큰 파일을 단계별로
// 처리할 때 각 단계 사이에 브라우저가 페인트/입력 처리할 시간을 주기 위해 사용.
// 페이지가 백그라운드/숨김 상태라 rAF가 throttle되면 setTimeout fallback으로
// 빠져나와 await가 영구 대기하는 것을 막는다 (스피너 잔류 방지).
export function nextFrame() {
    return new Promise(resolve => {
        let done = false;
        const finish = () => { if (done) return; done = true; resolve(); };
        requestAnimationFrame(finish);
        setTimeout(finish, 100);
    });
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

// [0, end) 구간의 줄바꿈(\n) 개수를 센다. countNewlines(text, idx)는 해당
// 인덱스의 0-기반 줄 번호와 같다. split 배열 할당 없이 동작해 5MB 파일에서도 저비용.
export function countNewlines(text, end = text.length) {
    if (!text) return 0;
    const limit = end < text.length ? end : text.length;
    let count = 0;
    for (let i = 0; i < limit; i++) {
        if (text.charCodeAt(i) === 10) count++;
    }
    return count;
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
