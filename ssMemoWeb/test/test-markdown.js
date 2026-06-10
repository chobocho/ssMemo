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

// 표 (GFM)
const table = renderMarkdown('| 이름 | 나이 |\n| --- | ---: |\n| Kim | 30 |\n| Lee | 25 |');
assertContains(table, '<table>', '표 시작');
assertContains(table, '<thead>', 'thead 존재');
assertContains(table, '<th>이름</th>', '헤더 셀 1');
assertContains(table, '<th style="text-align:right">나이</th>', '헤더 셀 우측 정렬');
assertContains(table, '<tbody>', 'tbody 존재');
assertContains(table, '<td>Kim</td>', '본문 셀');
assertContains(table, '<td style="text-align:right">30</td>', '본문 셀 우측 정렬');
assertContains(table, '<td>Lee</td>', '두 번째 행');

// 표가 아닌 경우는 표로 처리되지 않음 (구분 행 없음)
const notTable = renderMarkdown('| 단순 | 텍스트 |');
assertNotContains(notTable, '<table>', '구분 행 없으면 표 아님');

// 가운데 정렬
const centered = renderMarkdown('| A |\n| :---: |\n| 가 |');
assertContains(centered, 'text-align:center', '가운데 정렬');

// details / summary 지원
const det1 = renderMarkdown('<details>\n<summary>접기</summary>\n\n본문\n</details>');
assertContains(det1, '<details>', 'details 시작 태그 통과');
assertContains(det1, '</details>', 'details 종료 태그 통과');
assertContains(det1, '<summary>접기</summary>', 'summary 인라인 형태 통과');
assertContains(det1, '<p>본문</p>', 'details 내부 마크다운 처리');

const det2 = renderMarkdown('<details open>\n<summary>**굵은 제목**</summary>\n</details>');
assertContains(det2, '<details open>', 'details open 속성 허용');
assertContains(det2, '<strong>굵은 제목</strong>', 'summary 내부 인라인 마크다운');

// 임의 속성/스크립트 차단 (보안)
const detEvil = renderMarkdown('<details onclick="x">\n</details>');
assertNotContains(detEvil, '<details onclick', 'details 임의 속성 차단');
assertContains(detEvil, '&lt;details onclick', '차단된 태그는 이스케이프됨');

const sumEvil = renderMarkdown('<summary onclick="x">제목</summary>');
assertNotContains(sumEvil, '<summary onclick', 'summary 임의 속성 차단');

// 인라인 HTML 태그 허용: <b>, <i>, <u>, <br>
assertContains(renderMarkdown('이것은 <b>굵게</b>'), '<b>굵게</b>', '<b> 태그 통과');
assertContains(renderMarkdown('이것은 <i>기울임</i>'), '<i>기울임</i>', '<i> 태그 통과');
assertContains(renderMarkdown('이것은 <u>밑줄</u>'), '<u>밑줄</u>', '<u> 태그 통과');
assertContains(renderMarkdown('한 줄<br>다음 줄'), '<br>', '<br> 태그 통과');
assertContains(renderMarkdown('한 줄<br/>다음 줄'), '<br>', '<br/> 자체닫힘 통과');
assertContains(renderMarkdown('한 줄<br />다음 줄'), '<br>', '<br /> 자체닫힘 통과');

// 임의 속성 차단 (XSS 방지)
const bEvil = renderMarkdown('<b onclick="x">텍스트</b>');
assertNotContains(bEvil, '<b onclick', '<b> 임의 속성 차단');
assertContains(bEvil, '&lt;b onclick', '차단된 태그는 이스케이프됨');

// 알 수 없는 태그는 여전히 이스케이프
const unknown = renderMarkdown('<marquee>스크롤</marquee>');
assertNotContains(unknown, '<marquee>', '알 수 없는 태그 차단');
assertContains(unknown, '&lt;marquee&gt;', '알 수 없는 태그 이스케이프됨');

section('markdown.js — 코드 스팬 리터럴 보존');

// 코드 스팬 내부에서는 강조/링크 문법이 적용되지 않아야 한다.
const codeBold = renderMarkdown('`**x**`');
assertContains(codeBold, '<code>**x**</code>', '코드 스팬 안의 ** 리터럴 보존');
assertNotContains(codeBold, '<strong>', '코드 스팬 안에서 bold 미적용');

const codeUnderscore = renderMarkdown('`_var_name_`');
assertContains(codeUnderscore, '<code>_var_name_</code>', '코드 스팬 안의 _ 리터럴 보존');
assertNotContains(codeUnderscore, '<em>', '코드 스팬 안에서 italic 미적용');

const codeLink = renderMarkdown('`[a](https://b.com)`');
assertContains(codeLink, '<code>[a](https://b.com)</code>', '코드 스팬 안의 링크 문법 보존');
assertNotContains(codeLink, '<a href', '코드 스팬 안에서 링크 미적용');

// 코드 스팬 밖의 문법은 그대로 동작해야 한다.
const mixed = renderMarkdown('**굵게** `**코드**` *기울임*');
assertContains(mixed, '<strong>굵게</strong>', '코드 스팬 밖 bold 정상');
assertContains(mixed, '<code>**코드**</code>', '같은 줄 코드 스팬 리터럴 보존');
assertContains(mixed, '<em>기울임</em>', '코드 스팬 밖 italic 정상');
