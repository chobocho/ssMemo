// Ported from ssMemoWeb's test-markdown.js, plus the cases that were broken or missing there.
// The renderer's output is put into the page as HTML, so most of these are about what must
// never come out of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, renderMarkdown } from '../../src/lib/markdown.ts';
import { createTestDom } from '../helpers/dom.ts';

function assertContains(html: string, part: string): void {
  assert.ok(html.includes(part), `expected ${JSON.stringify(html)} to contain ${JSON.stringify(part)}`);
}

function assertLacks(html: string, part: string): void {
  assert.ok(!html.includes(part), `expected ${JSON.stringify(html)} not to contain ${JSON.stringify(part)}`);
}

// --- blocks -----------------------------------------------------------------

test('headings of level one to six', () => {
  assertContains(renderMarkdown('# 제목'), '<h1>제목</h1>');
  assertContains(renderMarkdown('### 작은 제목'), '<h3>작은 제목</h3>');
  assertContains(renderMarkdown('###### six'), '<h6>six</h6>');
  // Seven marks are not a heading, and neither is a mark without a space after it.
  assertLacks(renderMarkdown('####### seven'), '<h');
  assertLacks(renderMarkdown('#hashtag'), '<h1>');
});

test('paragraphs, with single line breaks kept inside them', () => {
  assert.equal(renderMarkdown('일반 텍스트'), '<p>일반 텍스트</p>');
  assert.equal(renderMarkdown('first\nsecond\n\nthird'), '<p>first<br>second</p>\n<p>third</p>');
});

test('empty input renders nothing', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown('\n\n  \n'), '');
});

test('horizontal rules and block quotes', () => {
  for (const rule of ['---', '***', '___', '-----', '  ---  ']) assertContains(renderMarkdown(rule), '<hr>');
  assertContains(renderMarkdown('> 인용문'), '<blockquote>인용문</blockquote>');
});

test('code blocks keep their content literally', () => {
  const html = renderMarkdown('```\nconst x = 1;\n**not bold** <b>\n```');
  assertContains(html, '<pre><code>const x = 1;\n**not bold** &lt;b&gt;</code></pre>');
  assertLacks(html, '<strong>');
});

test('a code block that is never closed still ends with the document', () => {
  assert.equal(renderMarkdown('```\nleft open'), '<pre><code>left open</code></pre>');
});

test('unordered and ordered lists, and a switch between them', () => {
  assert.equal(renderMarkdown('- 사과\n- 배'), '<ul>\n<li>사과</li>\n<li>배</li>\n</ul>');
  assert.equal(renderMarkdown('1. 첫째\n2. 둘째'), '<ol>\n<li>첫째</li>\n<li>둘째</li>\n</ol>');
  assert.equal(renderMarkdown('- a\n1. b'), '<ul>\n<li>a</li>\n</ul>\n<ol>\n<li>b</li>\n</ol>');
  for (const marker of ['-', '*', '+']) assertContains(renderMarkdown(`${marker} item`), '<li>item</li>');
});

test('a list ends where a paragraph begins', () => {
  assert.equal(renderMarkdown('- a\ntext'), '<ul>\n<li>a</li>\n</ul>\n<p>text</p>');
});

test('tables with a header row, and cells aligned by class', () => {
  const html = renderMarkdown('| 이름 | 나이 |\n| --- | ---: |\n| Kim | 30 |\n| Lee | 25 |');
  assertContains(html, '<table><thead><tr><th>이름</th><th class="md-right">나이</th></tr></thead>');
  assertContains(html, '<tbody><tr><td>Kim</td><td class="md-right">30</td></tr>');
  assertContains(html, '<td>Lee</td>');
  assertContains(renderMarkdown('| A |\n| :---: |\n| 가 |'), 'class="md-center"');
  assertContains(renderMarkdown('| A |\n| :--- |\n| 가 |'), 'class="md-left"');
  // No style attribute: a page that forbids inline styles must still show the table.
  assertLacks(html, 'style=');
});

test('a row with too few or too many cells is fitted to the header', () => {
  const html = renderMarkdown('| a | b |\n| --- | --- |\n| 1 |\n| 1 | 2 | 3 |');
  assertContains(html, '<tr><td>1</td><td></td></tr>');
  assertContains(html, '<tr><td>1</td><td>2</td></tr>');
});

test('a line with bars but no separator row below is not a table', () => {
  assertLacks(renderMarkdown('| 단순 | 텍스트 |'), '<table>');
  assertLacks(renderMarkdown('| a |\n| -- |\n| b |'), '<table>');
});

test('details and summary are let through in exactly their plain forms', () => {
  const html = renderMarkdown('<details>\n<summary>접기</summary>\n\n본문\n</details>');
  assertContains(html, '<details>');
  assertContains(html, '<summary>접기</summary>');
  assertContains(html, '<p>본문</p>');
  assertContains(html, '</details>');
  const open = renderMarkdown('<details open>\n<summary>**굵은 제목**</summary>\n</details>');
  assertContains(open, '<details open>');
  assertContains(open, '<summary><strong>굵은 제목</strong></summary>');
});

// --- inline -----------------------------------------------------------------

test('bold, italic and inline code', () => {
  assertContains(renderMarkdown('**굵게**'), '<strong>굵게</strong>');
  assertContains(renderMarkdown('__굵게__'), '<strong>굵게</strong>');
  assertContains(renderMarkdown('*기울임*'), '<em>기울임</em>');
  assertContains(renderMarkdown('_기울임_'), '<em>기울임</em>');
  assertContains(renderMarkdown('`코드`'), '<code>코드</code>');
});

test('markup inside a code span is left alone, outside of it it works', () => {
  const bold = renderMarkdown('`**x**`');
  assertContains(bold, '<code>**x**</code>');
  assertLacks(bold, '<strong>');
  assertContains(renderMarkdown('`_var_name_`'), '<code>_var_name_</code>');
  const link = renderMarkdown('`[a](https://b.com)`');
  assertContains(link, '<code>[a](https://b.com)</code>');
  assertLacks(link, '<a href');
  const mixed = renderMarkdown('**굵게** `**코드**` *기울임*');
  assertContains(mixed, '<strong>굵게</strong>');
  assertContains(mixed, '<code>**코드**</code>');
  assertContains(mixed, '<em>기울임</em>');
});

test('links to web and mail addresses open in a new tab without handing over the opener', () => {
  assert.equal(
    renderMarkdown('[ssMemo](https://example.com/a?b=1&c=2)'),
    '<p><a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">ssMemo</a></p>',
  );
  assertContains(renderMarkdown('[mail](mailto:a@example.com)'), '<a href="mailto:a@example.com"');
  assertContains(renderMarkdown('[plain](http://example.com)'), '<a href="http://example.com"');
});

test('the few harmless inline tags are let through without attributes', () => {
  assertContains(renderMarkdown('이것은 <b>굵게</b>'), '<b>굵게</b>');
  assertContains(renderMarkdown('이것은 <i>기울임</i>'), '<i>기울임</i>');
  assertContains(renderMarkdown('이것은 <u>밑줄</u>'), '<u>밑줄</u>');
  for (const lineBreak of ['<br>', '<br/>', '<br />']) assertContains(renderMarkdown(`한 줄${lineBreak}다음 줄`), '한 줄<br>다음 줄');
});

// --- line endings (broken in ssMemoWeb) -------------------------------------

test('Windows and old Mac line endings give the same result as Unix ones', () => {
  const source = ['# 제목', '', '- 사과', '- 배', '', '| a | b |', '| --- | --- |', '| 1 | 2 |', '', '```', 'code', '```', 'text'];
  const expected = renderMarkdown(source.join('\n'));
  assertContains(expected, '<h1>제목</h1>');
  assertContains(expected, '<table>');
  assert.equal(renderMarkdown(source.join('\r\n')), expected);
  assert.equal(renderMarkdown(source.join('\r')), expected);
  assertLacks(renderMarkdown(source.join('\r\n')), '\r');
});

// --- what must never come out -----------------------------------------------

test('escapeHtml escapes every character that can start or end markup', () => {
  assert.equal(escapeHtml('<>&"\''), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(escapeHtml('plain 텍스트'), 'plain 텍스트');
});

test('raw HTML is shown as text, not turned into elements', () => {
  const script = renderMarkdown('<script>alert(1)</script>');
  assertLacks(script, '<script');
  assertContains(script, '&lt;script&gt;alert(1)&lt;/script&gt;');
  assertLacks(renderMarkdown('<img src=x onerror=alert(1)>'), '<img');
  assertLacks(renderMarkdown('<marquee>스크롤</marquee>'), '<marquee>');
  assertLacks(renderMarkdown('# <img src=x onerror=alert(1)>'), '<img');
  assertLacks(renderMarkdown('| <img src=x> |\n| --- |\n| <svg onload=alert(1)> |'), '<img');
  assertLacks(renderMarkdown('| a |\n| --- |\n| <svg onload=alert(1)> |'), '<svg');
});

test('allowed tags with attributes stay text', () => {
  for (const source of ['<b onclick="x">텍스트</b>', '<details onclick="x">', '<summary onclick="x">제목</summary>', '<br onload="x">', '<details open onclick=x>']) {
    const html = renderMarkdown(source);
    assertLacks(html, 'onclick="x"');
    assertLacks(html, '<b onclick');
    assertLacks(html, '<details onclick');
    assertLacks(html, '<details open onclick');
    assertLacks(html, '<summary onclick');
    assertLacks(html, '<br onload');
    assertContains(html, '&lt;');
  }
});

test('links with a scheme that can run code are left as text', () => {
  for (const url of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x']) {
    const html = renderMarkdown(`[클릭](${url})`);
    assertLacks(html, '<a ');
    assertLacks(html, 'href=');
  }
});

test('links that would only lead back into this page are left as text', () => {
  // The app is a single file: there is nothing a relative link or an anchor could point to.
  for (const url of ['/etc/passwd', './other.html', '../up', '#section', 'other.html']) {
    assertLacks(renderMarkdown(`[link](${url})`), '<a ');
  }
});

test('a quote inside a link target cannot break out of the attribute', () => {
  const html = renderMarkdown('[x](https://example.com/" onmouseover="alert(1))');
  assertLacks(html, '" onmouseover="');
  assertLacks(html, 'onmouseover="alert');
});

test('the private characters the renderer uses internally cannot be smuggled in', () => {
  const start = String.fromCharCode(0xe000);
  const end = String.fromCharCode(0xe001);
  // Would refer to a code span that does not exist.
  const html = renderMarkdown(`${start}0${end} and ${start}7${end}`);
  assertLacks(html, 'undefined');
  assertLacks(html, '<code>');
  assertLacks(html, start);
});

test('rendering a long document stays quick', () => {
  const source = '# title\n\ntext with **bold** and `code` and [a link](https://example.com)\n\n- item\n'.repeat(5000);
  const startedAt = performance.now();
  const html = renderMarkdown(source);
  assert.ok(performance.now() - startedAt < 3000);
  assert.ok(html.length > source.length);
});

test('underscores and asterisks in a link target do not turn into emphasis', () => {
  // ssMemoWeb applied italics first and broke such addresses.
  assert.equal(
    renderMarkdown('[doc](https://example.com/a_b_c/*x*)'),
    '<p><a href="https://example.com/a_b_c/*x*" target="_blank" rel="noopener noreferrer">doc</a></p>',
  );
  assertContains(renderMarkdown('[**bold** label](https://example.com)'), '<strong>bold</strong> label</a>');
});

// --- the result as the browser sees it --------------------------------------

const ALLOWED_ELEMENTS = new Set([
  'P', 'BR', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'STRONG', 'EM', 'CODE', 'PRE', 'UL', 'OL', 'LI', 'A',
  'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'DETAILS', 'SUMMARY', 'B', 'I', 'U',
]);
const ALLOWED_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  A: ['href', 'target', 'rel'],
  TH: ['class'],
  TD: ['class'],
  DETAILS: ['open'],
};

const HOSTILE_INPUTS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg/onload=alert(1)>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<a href="javascript:alert(1)">x</a>',
  '[x](javascript:alert(1))',
  '[x](JAVASCRIPT:alert(1))',
  '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  '[x](https://example.com/"onmouseover="alert(1))',
  '[<img src=x onerror=alert(1)>](https://example.com)',
  '`<script>alert(1)</script>`',
  '```\n<script>alert(1)</script>\n```',
  '# <script>alert(1)</script>',
  '> <img src=x onerror=alert(1)>',
  '- <img src=x onerror=alert(1)>',
  '| <img src=x onerror=alert(1)> |\n| --- |\n| <script>alert(1)</script> |',
  '<details ontoggle=alert(1)>',
  '<details open ontoggle="alert(1)">',
  '<summary><img src=x onerror=alert(1)></summary>',
  '<b onmouseover=alert(1)>x</b>',
  '<b\nonmouseover=alert(1)>x</b>',
  '<br onload=alert(1)>',
  '**<script>alert(1)</script>**',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '<style>*{display:none}</style>',
  '<form action="https://example.com"><input name=x></form>',
  '<meta http-equiv="refresh" content="0;url=https://example.com">',
  '<object data="x"></object><embed src="x">',
  '![image](https://example.com/tracker.png)',
];

test('whatever the input, the browser builds only harmless elements from the result', () => {
  const { document } = createTestDom();
  for (const input of HOSTILE_INPUTS) {
    const container = document.createElement('div');
    container.innerHTML = renderMarkdown(input);
    for (const element of container.querySelectorAll('*')) {
      assert.ok(ALLOWED_ELEMENTS.has(element.tagName), `${JSON.stringify(input)} produced <${element.tagName.toLowerCase()}>`);
      const allowed = ALLOWED_ATTRIBUTES[element.tagName] ?? [];
      for (const attribute of element.attributes) {
        assert.ok(allowed.includes(attribute.name), `${JSON.stringify(input)} produced ${element.tagName} ${attribute.name}="${attribute.value}"`);
      }
      const href = element.getAttribute('href');
      if (href !== null) assert.match(href, /^(https?:\/\/|mailto:)/i, input);
    }
  }
});

test('nothing in the result makes the page load something by itself', () => {
  // Links are fine: they are only followed when the user clicks them.
  const { document } = createTestDom();
  const container = document.createElement('div');
  container.innerHTML = HOSTILE_INPUTS.map((input) => renderMarkdown(input)).join('\n');
  assert.equal(container.querySelectorAll('[src], [srcset], [data], [action], [style], link, script, img').length, 0);
});
