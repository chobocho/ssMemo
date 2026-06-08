// 테스트 러너 공용 헬퍼: 각 테스트 파일이 import해서 사용
const results = document.getElementById('results');
const summary = document.getElementById('summary');

if (!window.__ssTestStats) {
    window.__ssTestStats = { passed: 0, failed: 0 };
}

function appendResult(ok, message) {
    const li = document.createElement('li');
    li.className = ok ? 'pass' : 'fail';
    li.textContent = `${ok ? '✅' : '❌'} ${message}`;
    results.appendChild(li);
    if (ok) window.__ssTestStats.passed++;
    else    window.__ssTestStats.failed++;
    refreshSummary();
}

function refreshSummary() {
    const { passed, failed } = window.__ssTestStats;
    summary.textContent = `결과: ${passed} 통과 / ${failed} 실패`;
    summary.className = 'summary ' + (failed === 0 ? 'pass' : 'fail');
    document.title = failed === 0
        ? `✅ ${passed} 통과 - ssMemo 테스트`
        : `❌ ${failed} 실패 - ssMemo 테스트`;
}

// BigInt는 JSON.stringify로 직렬화할 수 없으므로 replacer로 문자열화한다.
// 그래야 calc.js의 BigInt 결과를 assertEqual로 비교할 수 있다.
const _replacer = (_k, v) => (typeof v === 'bigint' ? `__bigint__${v.toString()}` : v);
function _stringify(v) {
    try { return JSON.stringify(v, _replacer); }
    catch (e) { return `__unstringifiable__:${String(v)}`; }
}

export function assertEqual(actual, expected, label) {
    const a = _stringify(actual);
    const b = _stringify(expected);
    const ok = a === b;
    appendResult(ok, ok ? label : `${label}  (expected ${b}, got ${a})`);
}

// fn 실행 시 에러가 발생하고 그 메시지에 needle이 포함되어야 통과.
export function assertThrows(fn, needle, label) {
    let threw = false;
    let msg = '';
    try { fn(); }
    catch (e) { threw = true; msg = e?.message || String(e); }
    if (!threw) {
        appendResult(false, `${label}  (에러 발생 안 함)`);
        return;
    }
    const ok = msg.includes(needle);
    appendResult(ok, ok ? label : `${label}  (메시지에 "${needle}" 없음 — 실제: "${msg}")`);
}

export function assertContains(actual, needle, label) {
    const ok = String(actual).includes(needle);
    appendResult(ok, ok ? label : `${label}  (expected to contain "${needle}")`);
}

export function assertNotContains(actual, needle, label) {
    const ok = !String(actual).includes(needle);
    appendResult(ok, ok ? label : `${label}  (unexpected substring "${needle}" present)`);
}

export function section(name) {
    const li = document.createElement('li');
    li.style.fontWeight = 'bold';
    li.style.marginTop = '8px';
    li.textContent = `── ${name} ──`;
    results.appendChild(li);
}
