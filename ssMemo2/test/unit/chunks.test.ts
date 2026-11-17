import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK_DELIMITER, CHUNK_LABEL, DEFAULT_CHUNK_LENGTH, decideChunkAction, planJoin, planSplit } from '../../src/lib/chunks.ts';

// "cut line" in Korean, the word ssMemoWeb put between the parts.
const LABEL = String.fromCharCode(0xc808, 0xcde8, 0xc120);
const SMILE = String.fromCodePoint(0x1f600);

/** What the document looks like after the delimiters went in at the planned places. */
function split(text: string, length: number): string {
  let result = '';
  let last = 0;
  for (const cut of planSplit(text, length)) {
    result += text.slice(last, cut) + CHUNK_DELIMITER;
    last = cut;
  }
  return result + text.slice(last);
}

function join(text: string): string {
  let result = '';
  let last = 0;
  for (const range of planJoin(text)) {
    result += text.slice(last, range.from);
    last = range.to;
  }
  return result + text.slice(last);
}

test('the delimiter is the one ssMemoWeb used, so memos split there can be joined here', () => {
  assert.equal(CHUNK_LABEL, LABEL);
  assert.equal(CHUNK_DELIMITER, `\n\n<----------[${LABEL}]---------->\n\n`);
  assert.equal(DEFAULT_CHUNK_LENGTH, 2000);
});

test('a text is cut into parts of the given length', () => {
  assert.deepEqual(planSplit('abcdef', 2), [2, 4]);
  assert.deepEqual(planSplit('abcde', 2), [2, 4]);
  assert.equal(split('abcdef', 2), `ab${CHUNK_DELIMITER}cd${CHUNK_DELIMITER}ef`);
});

test('a text that already fits is not cut', () => {
  assert.deepEqual(planSplit('abc', 10), []);
  assert.deepEqual(planSplit('abc', 3), []);
  assert.deepEqual(planSplit('', 5), []);
});

test('a length that makes no sense cuts nothing', () => {
  for (const length of [0, -1, Number.NaN, 1.5]) assert.deepEqual(planSplit('abcdef', length), [], String(length));
});

test('a cut never lands inside a character that takes two code units', () => {
  // ssMemoWeb cut by code units, which tore emoji apart; saved as a file, each half was lost.
  const text = `a${SMILE}b${SMILE}c`;
  for (let length = 1; length <= text.length; length++) {
    for (const cut of planSplit(text, length)) {
      const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;
      assert.equal(isLowSurrogate(text.charCodeAt(cut)), false, `length ${length}: cut at ${cut}`);
    }
    assert.equal(join(split(text, length)), text, `length ${length}`);
  }
  // With room for exactly one unit before an emoji, the part ends early instead of in its middle.
  assert.deepEqual(planSplit(`ab${SMILE}cd`, 3), [2, 5]);
});

test('every part is at most as long as asked, except where one character alone is longer', () => {
  const text = 'x'.repeat(4500);
  const cuts = planSplit(text, 2000);
  assert.deepEqual(cuts, [2000, 4000]);
  // A single emoji cannot be shortened to one code unit.
  assert.deepEqual(planSplit(SMILE + SMILE, 1), [2]);
});

test('joining removes every delimiter and nothing else', () => {
  const text = `AAA${CHUNK_DELIMITER}BBB${CHUNK_DELIMITER}${CHUNK_DELIMITER}CCC`;
  assert.equal(planJoin(text).length, 3);
  assert.equal(join(text), 'AAABBBCCC');
  assert.deepEqual(planJoin('no delimiter here'), []);
  assert.deepEqual(planJoin(''), []);
  // Something that merely looks similar stays.
  assert.deepEqual(planJoin(`<----------[${LABEL}]---------->`), []);
});

test('splitting and joining gives back the original text', () => {
  const samples = ['1234567890', 'line one\nline two\n\nline four', `${LABEL} `.repeat(700), SMILE.repeat(1500), 'x'];
  for (const sample of samples) {
    for (const length of [1, 3, 7, 2000]) assert.equal(join(split(sample, length)), sample);
  }
});

test('what the toggle does depends on the text: join if it is split, split if it is long, else nothing', () => {
  assert.equal(decideChunkAction('x'.repeat(2001), 2000), 'split');
  assert.equal(decideChunkAction('x'.repeat(2000), 2000), 'none');
  assert.equal(decideChunkAction('', 2000), 'none');
  // A split memo can be joined even after it was shortened below the length.
  assert.equal(decideChunkAction(`a${CHUNK_DELIMITER}b`, 2000), 'join');
  assert.equal(decideChunkAction(`${'x'.repeat(5000)}${CHUNK_DELIMITER}`, 2000), 'join');
});
