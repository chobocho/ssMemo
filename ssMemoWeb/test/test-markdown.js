// ========================================
// Markdown 렌더러 단위 테스트
// ========================================
import { renderMarkdown, escapeHtml } from '../src/markdown.js';
import { assertContains, assertNotContains, assertEqual, section } from './runner.js';

section('markdown.js');

assertContains(renderMarkdown('# 제목'), '<h1>제목</h1>', 'H1 헤더');
assertContains(renderMarkdown('### 작은 제목'), '<h3>작은 제목</h3>', 'H3 헤더');

assertContains(renderMarkdown('**굵게**'), '<strong>굵게</strong>', 'Bold');
assertContains(renderMarkdown('*기울임*'), '<em>기울임</em>', 'Italic *');

assertContains(renderMarkdown('`코드`'), '<code>코드</code>', 'Inline code');

const cb = renderMarkdown('```\nconst x = 1;\n```');
assertContains(cb, '<pre><code>', 'Code block 시작');
assertContains(cb, 'const x = 1;', 'Code block 본문');

const ul = renderMarkdown('- 사과\n- 배');
assertContains(ul, '<ul>', '비순서 리스트 시작');
assertContains(ul, '<li>사과</li>', '비순서 리스트 항목');

const ol = renderMarkdown('1. 첫째\n2. 둘째');
assertContains(ol, '<ol>', '순서 리스트 시작');
assertContains(ol, '<li>첫째</li>', '순서 리스트 항목');

assertContains(renderMarkdown('[ssMemo](https://example.com)'),
    '<a href="https://example.com"', '안전한 링크');

const xss = renderMarkdown('[클릭](javascript:alert(1))');
assertNotContains(xss, 'href="javascript:', 'javascript: 스킴 차단');

const escaped = renderMarkdown('<script>alert(1)</script>');
assertNotContains(escaped, '<script>', '스크립트 태그 이스케이프');
assertContains(escaped, '&lt;script&gt;', '스크립트 태그가 엔티티화됨');

assertContains(renderMarkdown('---'), '<hr>', '수평선');
assertContains(renderMarkdown('> 인용문'), '<blockquote>인용문</blockquote>', '블록 인용');
assertContains(renderMarkdown('일반 텍스트'), '<p>일반 텍스트</p>', '단락');

assertEqual(escapeHtml('<>&"\''), '&lt;&gt;&amp;&quot;&#39;', 'escapeHtml 모든 문자');
