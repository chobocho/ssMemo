import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillTemplate, prepareInlineScript, prepareInlineStyle } from '../../scripts/htmlTemplate.ts';

// --- fillTemplate -----------------------------------------------------------

test('fillTemplate replaces every placeholder with its value', () => {
  const html = fillTemplate('<a>%%ONE%%</a><b>%%TWO%%</b>', { ONE: '1', TWO: '2' });
  assert.equal(html, '<a>1</a><b>2</b>');
});

test('fillTemplate inserts replacement patterns such as $& literally', () => {
  // Minified JS is full of "$&", "$1" and "$$"; a plain String.replace would expand them.
  const value = 'a$&b$1c$$d$`e';
  assert.equal(fillTemplate('[%%CODE%%]', { CODE: value }), `[${value}]`);
});

test('fillTemplate does not expand placeholders that appear inside inserted values', () => {
  assert.equal(fillTemplate('%%A%%|%%B%%', { A: '%%B%%', B: 'x' }), '%%B%%|x');
});

test('fillTemplate accepts an empty value', () => {
  assert.equal(fillTemplate('<p>%%EMPTY%%</p>', { EMPTY: '' }), '<p></p>');
});

test('fillTemplate returns a template without placeholders unchanged', () => {
  assert.equal(fillTemplate('plain text', {}), 'plain text');
});

test('fillTemplate rejects a placeholder that has no value', () => {
  assert.throws(() => fillTemplate('%%KNOWN%% %%MISSING%%', { KNOWN: 'k' }), /MISSING/);
});

test('fillTemplate ignores inherited properties when looking up a value', () => {
  const inherited = Object.create({ SCRIPT: 'from prototype' }) as Record<string, string>;
  assert.throws(() => fillTemplate('%%SCRIPT%%', inherited), /SCRIPT/);
});

test('fillTemplate rejects a value that the template never uses', () => {
  // An unused value means the template lost its placeholder and the output would silently miss a part.
  assert.throws(() => fillTemplate('%%USED%%', { USED: 'u', ORPHAN: 'o' }), /ORPHAN/);
});

test('fillTemplate rejects a placeholder that appears more than once', () => {
  assert.throws(() => fillTemplate('%%TWICE%% and %%TWICE%%', { TWICE: 't' }), /TWICE/);
});

// --- prepareInlineScript ----------------------------------------------------

test('prepareInlineScript hides "<!--" from the HTML parser without changing a string value', () => {
  const prepared = prepareInlineScript('return "a<!--b";');
  assert.equal(prepared.includes('<!--'), false);
  assert.equal(new Function(prepared)(), 'a<!--b');
});

test('prepareInlineScript keeps unicode-mode regular expressions valid', () => {
  // "<\!--" would be an invalid escape under the u flag; "\x3C" is valid everywhere.
  const prepared = prepareInlineScript('return /<!--/u.test("x<!--y");');
  assert.equal(prepared.includes('<!--'), false);
  assert.equal(new Function(prepared)(), true);
});

test('prepareInlineScript replaces every occurrence', () => {
  const prepared = prepareInlineScript('return "<!--" + "<!--" + `<!--`;');
  assert.equal(prepared.includes('<!--'), false);
  assert.equal(new Function(prepared)(), '<!--<!--<!--');
});

test('prepareInlineScript returns clean code unchanged', () => {
  const code = 'const a = 1 < 2; const b = !--a;';
  assert.equal(prepareInlineScript(code), code);
});

test('prepareInlineScript returns empty code unchanged', () => {
  assert.equal(prepareInlineScript(''), '');
});

test('prepareInlineScript rejects code that would close the script element early', () => {
  assert.throws(() => prepareInlineScript('var s = "</script>";'), /script/);
  assert.throws(() => prepareInlineScript('var s = "</SCRIPT >";'), /script/i);
});

// --- prepareInlineStyle -----------------------------------------------------

test('prepareInlineStyle returns clean css unchanged', () => {
  const css = 'body{margin:0}a>b{color:red}';
  assert.equal(prepareInlineStyle(css), css);
});

test('prepareInlineStyle rejects css that would close the style element early', () => {
  assert.throws(() => prepareInlineStyle('a::after{content:"</style>"}'), /style/);
  assert.throws(() => prepareInlineStyle('a::after{content:"</STYLE"}'), /style/i);
});
