import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SNIPPET_MAX_LENGTH, findInMemos, makeSnippet } from '../../src/app/memoSearch.ts';
import type { StoredDocument } from '../../src/storage/storagePort.ts';

const ELLIPSIS = String.fromCharCode(0x2026);
// U+1F600 as its two UTF-16 halves; cutting between them would leave broken text.
const EMOJI = String.fromCharCode(0xd83d, 0xde00);
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const HANGUL_WORD = String.fromCharCode(0xc7a5, 0xbcf4, 0xae30);

function memo(id: string, title: string, content: string, updatedAt = '2026-01-01T00:00:00.000Z'): StoredDocument {
  return { meta: { id, title, createdAt: '2026-01-01T00:00:00.000Z', updatedAt, length: content.length, rev: 1 }, content };
}

function ids(documents: StoredDocument[], query: string): string[] {
  return findInMemos(documents, query).map((hit) => hit.meta.id);
}

// --- makeSnippet ------------------------------------------------------------

test('a short line is shown whole, without its neighbours and without indentation', () => {
  const text = 'first line\n   buy milk and eggs  \nlast line';
  assert.equal(makeSnippet(text, text.indexOf('milk'), 4, 80), 'buy milk and eggs');
});

test('the snippet is the line of the match, also for the first and the last line', () => {
  const text = 'alpha\nbeta\ngamma';
  assert.equal(makeSnippet(text, 0, 5, 80), 'alpha');
  assert.equal(makeSnippet(text, text.indexOf('gamma'), 5, 80), 'gamma');
  assert.equal(makeSnippet('only', 0, 4, 80), 'only');
});

test('Windows line endings do not leak into the snippet', () => {
  const text = 'first\r\nbuy milk\r\nlast';
  assert.equal(makeSnippet(text, text.indexOf('milk'), 4, 80), 'buy milk');
});

test('a long line is cut around the match and marked where text was left out', () => {
  const line = `${'a'.repeat(200)} needle ${'b'.repeat(200)}`;
  const snippet = makeSnippet(line, line.indexOf('needle'), 6, 40);
  assert.equal(snippet.includes('needle'), true);
  assert.equal(snippet.startsWith(ELLIPSIS), true);
  assert.equal(snippet.endsWith(ELLIPSIS), true);
  assert.ok(snippet.length <= 40 + 2, `snippet is ${snippet.length} long`);
  // The match sits roughly in the middle, with text on both sides.
  assert.ok(snippet.indexOf('needle') > 10);
  assert.ok(snippet.indexOf('needle') < 25);
});

test('a match at the start of a long line needs no mark in front, one at the end none behind', () => {
  const start = `needle ${'b'.repeat(200)}`;
  const atStart = makeSnippet(start, 0, 6, 40);
  assert.equal(atStart.startsWith('needle'), true);
  assert.equal(atStart.endsWith(ELLIPSIS), true);
  const end = `${'a'.repeat(200)} needle`;
  const atEnd = makeSnippet(end, end.indexOf('needle'), 6, 40);
  assert.equal(atEnd.startsWith(ELLIPSIS), true);
  assert.equal(atEnd.endsWith('needle'), true);
  // Nothing is wasted: the room not needed behind the match goes to the text in front.
  assert.equal(atEnd.length, 40 + 1);
});

test('a line exactly as long as allowed is not cut', () => {
  const line = `${'a'.repeat(34)}needle`;
  assert.equal(makeSnippet(line, 34, 6, 40), line);
});

test('a match longer than the snippet may be starts the snippet', () => {
  const line = `${'a'.repeat(50)}${'n'.repeat(100)}${'b'.repeat(50)}`;
  const snippet = makeSnippet(line, 50, 100, 40);
  assert.equal(snippet, `${ELLIPSIS}${'n'.repeat(40)}${ELLIPSIS}`);
});

test('cutting never splits a character that takes two code units', () => {
  const line = `${EMOJI.repeat(100)}needle${EMOJI.repeat(100)}`;
  for (const maxLength of [20, 21, 22, 23]) {
    const snippet = makeSnippet(line, line.indexOf('needle'), 6, maxLength);
    assert.equal(LONE_SURROGATE.test(snippet), false, `broken character with ${maxLength}`);
    assert.equal(snippet.includes('needle'), true);
  }
});

// --- findInMemos ------------------------------------------------------------

test('a memo is found by its text or by its title, whatever the case', () => {
  const documents = [memo('a', 'Shopping', 'Buy MILK'), memo('b', 'Milk prices', 'went up'), memo('c', 'Ideas', 'write tests')];
  assert.deepEqual(ids(documents, 'milk').sort(), ['a', 'b']);
  assert.deepEqual(ids(documents, 'IDEAS'), ['c']);
  assert.deepEqual(ids(documents, 'nothing like this'), []);
});

test('a hit carries the line of the first match in the text', () => {
  const [hit] = findInMemos([memo('a', 'Shopping', 'bread\nbuy Milk today\nmore milk')], 'milk');
  assert.equal(hit?.snippet, 'buy Milk today');
  assert.equal(hit?.meta.title, 'Shopping');
});

test('a memo found only by its title has no snippet', () => {
  const [hit] = findInMemos([memo('b', 'Milk prices', 'went up')], 'milk');
  assert.equal(hit?.snippet, undefined);
});

test('an empty or blank query finds nothing', () => {
  const documents = [memo('a', 'Shopping', 'buy milk'), memo('b', '', '')];
  for (const query of ['', ' ', '\t ']) assert.deepEqual(findInMemos(documents, query), [], JSON.stringify(query));
});

test('spaces inside and around a query count', () => {
  const documents = [memo('a', 'x', 'buy milk'), memo('b', 'y', 'buymilk')];
  assert.deepEqual(ids(documents, 'buy milk'), ['a']);
  assert.deepEqual(ids(documents, ' milk'), ['a']);
});

test('characters that mean something in a pattern are searched for as they are', () => {
  const documents = [memo('a', 'x', 'cost: (3+4)*2 = 14?'), memo('b', 'y', 'a.b'), memo('c', 'z', 'axb'), memo('d', 'w', 'path\\to[0]^$|{}')];
  assert.deepEqual(ids(documents, '(3+4)*2'), ['a']);
  assert.deepEqual(ids(documents, 'a.b'), ['b']);
  assert.deepEqual(ids(documents, '14?'), ['a']);
  assert.deepEqual(ids(documents, '\\to[0]^$|{}'), ['d']);
  assert.deepEqual(ids(documents, '.*'), []);
});

test('Korean text and emoji are found', () => {
  const documents = [memo('a', 'x', `today: ${HANGUL_WORD} ${EMOJI}`), memo('b', 'y', 'nothing')];
  assert.deepEqual(ids(documents, HANGUL_WORD), ['a']);
  assert.deepEqual(ids(documents, EMOJI), ['a']);
});

test('hits come most recently changed first, and by title when changed at the same time', () => {
  const documents = [
    memo('old', 'B', 'milk', '2026-01-01T00:00:00.000Z'),
    memo('new', 'C', 'milk', '2026-03-01T00:00:00.000Z'),
    memo('same-time', 'A', 'milk', '2026-01-01T00:00:00.000Z'),
  ];
  assert.deepEqual(ids(documents, 'milk'), ['new', 'same-time', 'old']);
});

test('searching changes neither the documents nor their order', () => {
  const documents = [memo('a', 'A', 'milk', '2026-01-01T00:00:00.000Z'), memo('b', 'B', 'milk', '2026-02-01T00:00:00.000Z')];
  const before = JSON.stringify(documents);
  findInMemos(documents, 'milk');
  assert.equal(JSON.stringify(documents), before);
});

test('a long line gives a snippet of limited length', () => {
  const [hit] = findInMemos([memo('a', 'x', `${'a'.repeat(1000)} needle ${'b'.repeat(1000)}`)], 'needle');
  assert.ok((hit?.snippet?.length ?? 0) <= SNIPPET_MAX_LENGTH + 2);
  assert.equal(hit?.snippet?.includes('needle'), true);
});

test('a memo with empty text and an empty title is never a hit', () => {
  assert.deepEqual(findInMemos([memo('a', '', '')], 'x'), []);
});
