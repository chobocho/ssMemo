// A small Markdown renderer without dependencies, ported from ssMemoWeb's markdown.js.
//
// Its output is inserted into the page as HTML, so safety comes first: every piece of input is
// HTML-escaped before anything else happens, and markup is only ever added by this file. Raw HTML
// in the source is therefore shown as text, with a short list of exceptions that are recognized
// in their exact, attribute-free form.
//
// Supported: headings (# to ######), bold, italic, inline code, fenced code blocks, flat ordered
// and unordered lists, links to http(s) and mailto addresses, horizontal rules, block quotes,
// tables with alignment, paragraphs, <details>/<summary>, and inline <b> <i> <u> <br>.
// Not supported on purpose: images, which would make the page load something from outside.
//
// Changed from the original: line endings other than LF are understood (headings and lists broke
// on Windows files), link targets are no longer mangled by underscores, relative links and
// anchors are not turned into links (a single-file app has nothing they could point to), and
// table cells are aligned by class instead of an inline style.

const LINE_BREAK_PATTERN = /\r\n?|\n/;

// Finished pieces of HTML are swapped for a placeholder while the rest of a line is processed,
// so that emphasis is not applied inside code or inside a link target. The placeholder is built
// from two private-use characters, which are removed from the input first.
const PLACEHOLDER_START = String.fromCharCode(0xe000);
const PLACEHOLDER_END = String.fromCharCode(0xe001);
const PLACEHOLDER_CHARACTERS = new RegExp(`[${PLACEHOLDER_START}${PLACEHOLDER_END}]`, 'g');
const PLACEHOLDER_PATTERN = new RegExp(`${PLACEHOLDER_START}(\\d+)${PLACEHOLDER_END}`, 'g');

// Only addresses that lead somewhere else. Anything that could run code (javascript:, data:)
// or that would resolve against this page (relative paths, anchors) stays plain text.
const LINK_TARGET_PATTERN = /^(https?:\/\/|mailto:)/i;
const LINK_ATTRIBUTES = 'target="_blank" rel="noopener noreferrer"';

type Alignment = 'left' | 'center' | 'right' | undefined;
const ALIGNMENT_CLASS_PREFIX = 'md-';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Inline markup of one piece of text. */
function renderInline(text: string): string {
  const finished: string[] = [];
  const protect = (html: string): string => `${PLACEHOLDER_START}${finished.push(html) - 1}${PLACEHOLDER_END}`;

  let html = escapeHtml(text).replace(PLACEHOLDER_CHARACTERS, '');
  html = html.replace(/`([^`]+)`/g, (_match, code: string) => protect(`<code>${code}</code>`));
  // Links come before emphasis: an address such as ".../a_b_c" must not get italics inside it.
  // The label stays in the text so that it can still be bold or italic.
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, target: string) =>
    LINK_TARGET_PATTERN.test(target) ? `${protect(`<a href="${target}" ${LINK_ATTRIBUTES}>`)}${label}${protect('</a>')}` : match,
  );
  // A marker counts only if it hugs the text it encloses: "2 * 3 * 4" is arithmetic, not italics.
  // An underscore must also not sit inside a word of Latin letters or digits, so "my_file_name"
  // stays as it is. Korean text may follow directly, because particles are written without a space.
  html = html.replace(/\*\*(?!\s)([^*]+?)(?<!\s)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<![A-Za-z0-9])__(?!\s)([^_]+?)(?<!\s)__(?![A-Za-z0-9])/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '$1<em>$2</em>');
  html = html.replace(/(?<![A-Za-z0-9_])_(?!\s)([^_\n]+?)(?<!\s)_(?![A-Za-z0-9_])/g, '<em>$1</em>');
  // Only the exact escaped forms are turned back into tags. A tag with attributes does not match
  // and stays escaped.
  html = html.replace(/&lt;(\/?)([biu])&gt;/gi, '<$1$2>');
  html = html.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
  return html.replace(PLACEHOLDER_PATTERN, (_match, index: string) => finished[Number(index)] ?? '');
}

/** The cells of a table row, with or without bars at the edges. */
function parseTableRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|')) row = row.slice(0, -1);
  return row.split('|').map((cell) => cell.trim());
}

/** The alignments given by a separator row such as "|---|:---:|---:|", or undefined if it is not one. */
function parseTableSeparator(line: string): Alignment[] | undefined {
  if (!line.includes('|')) return undefined;
  const alignments: Alignment[] = [];
  for (const cell of parseTableRow(line)) {
    if (!/^:?-{3,}:?$/.test(cell)) return undefined;
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    alignments.push(left && right ? 'center' : right ? 'right' : left ? 'left' : undefined);
  }
  return alignments;
}

function renderCell(tag: 'th' | 'td', content: string, alignment: Alignment): string {
  const classAttribute = alignment ? ` class="${ALIGNMENT_CLASS_PREFIX}${alignment}"` : '';
  return `<${tag}${classAttribute}>${renderInline(content)}</${tag}>`;
}

function renderTable(headerLine: string, alignments: readonly Alignment[], bodyLines: readonly string[]): string {
  const headers = parseTableRow(headerLine);
  const head = headers.map((cell, index) => renderCell('th', cell, alignments[index])).join('');
  const body = bodyLines
    .map((line) => {
      const cells = parseTableRow(line);
      // Every row gets exactly as many cells as the header has: missing ones are empty, extra ones are dropped.
      const row = headers.map((_header, index) => renderCell('td', cells[index] ?? '', alignments[index])).join('');
      return `<tr>${row}</tr>`;
    })
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** O(n) in the length of the text. */
export function renderMarkdown(text: string): string {
  const lines = text.split(LINE_BREAK_PATTERN);
  const out: string[] = [];
  let codeLines: string[] | undefined;
  let listTag: 'ul' | 'ol' | undefined;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) out.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
    paragraph = [];
  };
  const closeList = (): void => {
    if (listTag) out.push(`</${listTag}>`);
    listTag = undefined;
  };
  /** Ends whatever paragraph or list is open and emits a block of its own. */
  const block = (html: string): void => {
    flushParagraph();
    closeList();
    out.push(html);
  };
  const listItem = (tag: 'ul' | 'ol', content: string): void => {
    flushParagraph();
    if (listTag !== tag) {
      closeList();
      out.push(`<${tag}>`);
      listTag = tag;
    }
    out.push(`<li>${renderInline(content)}</li>`);
  };
  const codeBlock = (content: readonly string[]): string => `<pre><code>${content.map(escapeHtml).join('\n')}</code></pre>`;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();

    if (codeLines) {
      if (line.startsWith('```')) {
        out.push(codeBlock(codeLines));
        codeLines = undefined;
      } else {
        codeLines.push(line);
      }
      continue;
    }
    if (line.startsWith('```')) {
      flushParagraph();
      closeList();
      codeLines = [];
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = (heading[1] ?? '').length;
      block(`<h${level}>${renderInline(heading[2] ?? '')}</h${level}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      block('<hr>');
      continue;
    }
    if (/^>\s?/.test(line)) {
      block(`<blockquote>${renderInline(line.replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }

    // Collapsible sections. Only these exact forms are accepted; anything else stays text.
    if (/^<details(\s+open)?>$/i.test(trimmed)) {
      block(/\sopen>$/i.test(trimmed) ? '<details open>' : '<details>');
      continue;
    }
    if (/^<\/details>$/i.test(trimmed)) {
      block('</details>');
      continue;
    }
    const summary = /^<summary>(.*)<\/summary>$/i.exec(trimmed);
    if (summary) {
      block(`<summary>${renderInline(summary[1] ?? '')}</summary>`);
      continue;
    }
    if (/^<summary>$/i.test(trimmed)) {
      block('<summary>');
      continue;
    }
    if (/^<\/summary>$/i.test(trimmed)) {
      block('</summary>');
      continue;
    }

    // A table is a line with a bar that is followed by a separator row.
    const alignments = line.includes('|') ? parseTableSeparator(lines[index + 1] ?? '') : undefined;
    if (alignments) {
      let end = index + 2;
      while (end < lines.length && (lines[end] ?? '').includes('|')) end++;
      block(renderTable(line, alignments, lines.slice(index + 2, end)));
      index = end - 1;
      continue;
    }

    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (unordered) {
      listItem('ul', unordered[1] ?? '');
      continue;
    }
    const ordered = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (ordered) {
      listItem('ol', ordered[1] ?? '');
      continue;
    }

    if (trimmed === '') {
      flushParagraph();
      closeList();
      continue;
    }
    closeList();
    paragraph.push(line);
  }

  // A code block that was never closed ends with the document.
  if (codeLines) out.push(codeBlock(codeLines));
  flushParagraph();
  closeList();
  return out.join('\n');
}
