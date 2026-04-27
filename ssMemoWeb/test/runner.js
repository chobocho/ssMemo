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

export function assertEqual(actual, expected, label) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    appendResult(ok, ok ? label : `${label}  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
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
