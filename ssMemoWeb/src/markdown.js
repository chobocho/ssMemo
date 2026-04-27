// ========================================
// 외부 의존성 없는 경량 Markdown 렌더러
// XSS 방지를 위해 모든 입력을 HTML 이스케이프 후 처리합니다.
// 지원: 헤더(#~######), bold(**), italic(*/_), inline code(`),
//       코드 블록(```), 순서/비순서 리스트, 링크[text](url),
//       수평선(---), 인용(>), 단락
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
    return s;
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

    for (const line of lines) {
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
