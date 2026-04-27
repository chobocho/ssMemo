// ========================================
// 외부 의존성 없는 경량 Markdown 렌더러
// XSS 방지를 위해 모든 입력을 HTML 이스케이프 후 처리합니다.
// 지원: 헤더(#~######), bold(**), italic(*/_), inline code(`),
//       코드 블록(```), 순서/비순서 리스트, 링크[text](url),
//       수평선(---), 인용(>), GFM 표(|---|), 단락,
//       <details>/<summary> 접기 (속성은 open만 허용),
//       인라인 HTML <b>/<i>/<u>/<br> (속성 없는 형태만)
// ========================================

export function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderInline(text) {
    let s = escapeHtml(text);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
        // 안전한 스킴만 허용 (javascript: 등 차단)
        if (!/^(https?:\/\/|mailto:|#|\/|\.\/|\.\.\/)/i.test(url)) return match;
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    // 안전한 인라인 HTML 태그 화이트리스트 (속성 없는 형태만).
    // escapeHtml 이후의 리터럴 패턴만 복원하므로, 속성이 붙은 변형은
    // 매치되지 않아 이스케이프된 상태로 유지되어 XSS를 차단합니다.
    s = s.replace(/&lt;(\/?)([biu])&gt;/gi, '<$1$2>');
    s = s.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
    return s;
}

// 표 한 행의 셀들을 추출. `|` 경계를 가진 행과 그렇지 않은 행 모두 처리.
function parseTableRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map(c => c.trim());
}

// 표 구분 행 여부: `|---|:---:|---:|` 형태. 셀 정렬 배열을 반환하거나 null.
function parseTableSeparator(line) {
    if (!/\|/.test(line)) return null;
    const cells = parseTableRow(line);
    if (cells.length === 0) return null;
    const aligns = [];
    for (const cell of cells) {
        if (!/^:?-{3,}:?$/.test(cell)) return null;
        const left = cell.startsWith(':');
        const right = cell.endsWith(':');
        aligns.push(left && right ? 'center' : right ? 'right' : left ? 'left' : null);
    }
    return aligns;
}

function renderTable(headerLine, aligns, bodyLines) {
    const headers = parseTableRow(headerLine);
    const colCount = headers.length;
    const headHtml = headers
        .map((h, i) => {
            const a = aligns[i];
            const styleAttr = a ? ` style="text-align:${a}"` : '';
            return `<th${styleAttr}>${renderInline(h)}</th>`;
        })
        .join('');
    const bodyHtml = bodyLines.map(line => {
        const cells = parseTableRow(line);
        // 부족한 셀은 빈 문자열로 채우고, 초과는 잘라냅니다.
        const padded = cells.slice(0, colCount);
        while (padded.length < colCount) padded.push('');
        const tds = padded
            .map((c, i) => {
                const a = aligns[i];
                const styleAttr = a ? ` style="text-align:${a}"` : '';
                return `<td${styleAttr}>${renderInline(c)}</td>`;
            })
            .join('');
        return `<tr>${tds}</tr>`;
    }).join('');
    return `<table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
}

export function renderMarkdown(text) {
    if (!text) return '';
    const lines = text.split('\n');
    const out = [];
    let inCode = false;
    let codeBuffer = [];
    let listType = null;
    let paragraphBuffer = [];

    const flushParagraph = () => {
        if (paragraphBuffer.length) {
            out.push('<p>' + paragraphBuffer.map(renderInline).join('<br>') + '</p>');
            paragraphBuffer = [];
        }
    };
    const closeList = () => {
        if (listType) {
            out.push(`</${listType}>`);
            listType = null;
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (inCode) {
            if (/^```/.test(line)) {
                out.push(`<pre><code>${codeBuffer.map(escapeHtml).join('\n')}</code></pre>`);
                codeBuffer = [];
                inCode = false;
            } else {
                codeBuffer.push(line);
            }
            continue;
        }
        if (/^```/.test(line)) {
            flushParagraph();
            closeList();
            inCode = true;
            continue;
        }

        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
            flushParagraph();
            closeList();
            const level = heading[1].length;
            out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
            continue;
        }

        if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
            flushParagraph();
            closeList();
            out.push('<hr>');
            continue;
        }

        if (/^>\s?/.test(line)) {
            flushParagraph();
            closeList();
            out.push(`<blockquote>${renderInline(line.replace(/^>\s?/, ''))}</blockquote>`);
            continue;
        }

        // <details>/<summary> 접기 블록. 보안을 위해 정확한 패턴만 허용.
        const trimmed = line.trim();
        if (/^<details(\s+open)?>$/i.test(trimmed)) {
            flushParagraph();
            closeList();
            out.push(/\sopen>$/i.test(trimmed) ? '<details open>' : '<details>');
            continue;
        }
        if (/^<\/details>$/i.test(trimmed)) {
            flushParagraph();
            closeList();
            out.push('</details>');
            continue;
        }
        const inlineSummary = trimmed.match(/^<summary>([\s\S]*)<\/summary>$/i);
        if (inlineSummary) {
            flushParagraph();
            closeList();
            out.push(`<summary>${renderInline(inlineSummary[1])}</summary>`);
            continue;
        }
        if (/^<summary>$/i.test(trimmed)) {
            flushParagraph();
            closeList();
            out.push('<summary>');
            continue;
        }
        if (/^<\/summary>$/i.test(trimmed)) {
            flushParagraph();
            closeList();
            out.push('</summary>');
            continue;
        }

        // 표: 현재 줄에 `|`가 있고 다음 줄이 구분 행이면 표로 처리
        if (/\|/.test(line) && i + 1 < lines.length) {
            const aligns = parseTableSeparator(lines[i + 1]);
            if (aligns) {
                flushParagraph();
                closeList();
                const bodyLines = [];
                let j = i + 2;
                while (j < lines.length && /\|/.test(lines[j]) && lines[j].trim() !== '') {
                    bodyLines.push(lines[j]);
                    j++;
                }
                out.push(renderTable(line, aligns, bodyLines));
                i = j - 1;
                continue;
            }
        }

        const ul = line.match(/^\s*[-*+]\s+(.+)$/);
        if (ul) {
            flushParagraph();
            if (listType !== 'ul') {
                closeList();
                out.push('<ul>');
                listType = 'ul';
            }
            out.push(`<li>${renderInline(ul[1])}</li>`);
            continue;
        }

        const ol = line.match(/^\s*\d+\.\s+(.+)$/);
        if (ol) {
            flushParagraph();
            if (listType !== 'ol') {
                closeList();
                out.push('<ol>');
                listType = 'ol';
            }
            out.push(`<li>${renderInline(ol[1])}</li>`);
            continue;
        }

        if (line.trim() === '') {
            flushParagraph();
            closeList();
            continue;
        }

        closeList();
        paragraphBuffer.push(line);
    }

    if (inCode) {
        out.push(`<pre><code>${codeBuffer.map(escapeHtml).join('\n')}</code></pre>`);
    }
    flushParagraph();
    closeList();
    return out.join('\n');
}
