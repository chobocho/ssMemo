import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEMO_SORTS, isMemoSort, orderMemos } from '../../src/app/memoOrder.ts';
import type { MemoSort } from '../../src/app/memoOrder.ts';
import type { DocumentMeta } from '../../src/storage/storagePort.ts';

const compareTitles = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare;
const JANUARY = '2026-01-01T00:00:00.000Z';
const FEBRUARY = '2026-02-01T00:00:00.000Z';
const MARCH = '2026-03-01T00:00:00.000Z';

function meta(id: string, title: string, updatedAt = JANUARY, createdAt = JANUARY): DocumentMeta {
  return { id, title, createdAt, updatedAt, length: 1, rev: 1 };
}

function ordered(metas: DocumentMeta[], sort: MemoSort, compare = compareTitles): string[] {
  return orderMemos(metas, (item) => item, { sort, compareTitles: compare }).map((item) => item.id);
}

test('the offered orders are the three the list can be put in', () => {
  assert.deepEqual([...MEMO_SORTS], ['updated', 'created', 'title']);
  for (const sort of MEMO_SORTS) assert.equal(isMemoSort(sort), true);
  for (const value of ['size', '', 'UPDATED', 1, null, undefined, {}]) assert.equal(isMemoSort(value), false, String(value));
});

test('"updated" puts the memo changed last first', () => {
  const metas = [meta('old', 'A', JANUARY), meta('new', 'B', MARCH), meta('middle', 'C', FEBRUARY)];
  assert.deepEqual(ordered(metas, 'updated'), ['new', 'middle', 'old']);
});

test('"created" puts the memo made last first, whenever it was changed', () => {
  const metas = [meta('first', 'A', MARCH, JANUARY), meta('last', 'B', JANUARY, MARCH), meta('second', 'C', FEBRUARY, FEBRUARY)];
  assert.deepEqual(ordered(metas, 'created'), ['last', 'second', 'first']);
});

test('"title" goes by the alphabet, ignoring case and counting numbers as numbers', () => {
  const metas = [meta('b', 'banana'), meta('m10', 'Memo 10'), meta('a', 'Apple'), meta('m2', 'memo 2')];
  assert.deepEqual(ordered(metas, 'title'), ['a', 'b', 'm2', 'm10']);
});

test('titles are compared the way the language of the app does', () => {
  // GA, NA, DA: the first three syllables of the Korean alphabet, given out of order.
  const ga = String.fromCharCode(0xac00);
  const na = String.fromCharCode(0xb098);
  const da = String.fromCharCode(0xb2e4);
  const korean = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' }).compare;
  assert.deepEqual(ordered([meta('da', da), meta('ga', ga), meta('na', na)], 'title', korean), ['ga', 'na', 'da']);
});

test('memos equal in what they are ordered by fall back to the other properties, so the order never wavers', () => {
  // Same time: by title. Same title: the one changed last first. The same in everything: by id.
  assert.deepEqual(ordered([meta('b', 'B'), meta('a', 'A')], 'updated'), ['a', 'b']);
  assert.deepEqual(ordered([meta('b', 'B'), meta('a', 'A')], 'created'), ['a', 'b']);
  assert.deepEqual(ordered([meta('old', 'Same', JANUARY), meta('new', 'Same', MARCH)], 'title'), ['new', 'old']);
  for (const sort of MEMO_SORTS) {
    assert.deepEqual(ordered([meta('2', 'Same'), meta('1', 'Same')], sort), ['1', '2'], sort);
    assert.deepEqual(ordered([meta('1', 'Same'), meta('2', 'Same')], sort), ['1', '2'], sort);
  }
});

test('times are compared as moments, not as text', () => {
  // The same moment written with an offset, as a backup edited by hand may contain.
  const metas = [meta('earlier', 'A', '2026-03-01T08:00:00+09:00'), meta('later', 'B', '2026-03-01T00:30:00.000Z')];
  assert.deepEqual(ordered(metas, 'updated'), ['later', 'earlier']);
});

test('a time that cannot be read counts as the oldest instead of upsetting the order', () => {
  const metas = [meta('broken', 'A', 'not a date'), meta('new', 'B', MARCH), meta('old', 'C', JANUARY)];
  assert.deepEqual(ordered(metas, 'updated'), ['new', 'old', 'broken']);
});

test('ordering leaves the given list as it was', () => {
  const metas = [meta('old', 'A', JANUARY), meta('new', 'B', MARCH)];
  orderMemos(metas, (item) => item, { sort: 'updated', compareTitles });
  assert.deepEqual(metas.map((item) => item.id), ['old', 'new']);
});

test('anything that belongs to a memo can be ordered, such as search results', () => {
  const hits = [
    { meta: meta('old', 'A', JANUARY), snippet: 'x' },
    { meta: meta('new', 'B', MARCH), snippet: undefined },
  ];
  const result = orderMemos(hits, (hit) => hit.meta, { sort: 'updated', compareTitles });
  assert.deepEqual(result.map((hit) => hit.meta.id), ['new', 'old']);
  assert.equal(result[1], hits[0]);
});

test('an empty list stays empty', () => {
  for (const sort of MEMO_SORTS) assert.deepEqual(ordered([], sort), []);
});

// --- pinned memos -----------------------------------------------------------

function orderedWithPins(metas: DocumentMeta[], sort: MemoSort, pinned: string[]): string[] {
  return orderMemos(metas, (item) => item, { sort, compareTitles, pinnedIds: new Set(pinned) }).map((item) => item.id);
}

test('pinned memos come first, whatever the order', () => {
  const metas = [meta('new', 'B', MARCH, JANUARY), meta('old', 'C', JANUARY, FEBRUARY), meta('middle', 'A', FEBRUARY, MARCH)];
  assert.deepEqual(orderedWithPins(metas, 'updated', ['old']), ['old', 'new', 'middle']);
  assert.deepEqual(orderedWithPins(metas, 'created', ['new']), ['new', 'middle', 'old']);
  assert.deepEqual(orderedWithPins(metas, 'title', ['old']), ['old', 'middle', 'new']);
});

test('among themselves pinned memos keep the chosen order, and so do the others', () => {
  const metas = [meta('a', 'A', JANUARY), meta('b', 'B', FEBRUARY), meta('c', 'C', MARCH), meta('d', 'D', '2026-04-01T00:00:00.000Z')];
  assert.deepEqual(orderedWithPins(metas, 'updated', ['a', 'c']), ['c', 'a', 'd', 'b']);
  assert.deepEqual(orderedWithPins(metas, 'title', ['d', 'b']), ['b', 'd', 'a', 'c']);
});

test('a pin for a memo that is not in the list changes nothing, and neither does having no pins', () => {
  const metas = [meta('old', 'A', JANUARY), meta('new', 'B', MARCH)];
  assert.deepEqual(orderedWithPins(metas, 'updated', ['gone']), ['new', 'old']);
  assert.deepEqual(orderedWithPins(metas, 'updated', []), ['new', 'old']);
});

test('with every memo pinned the list is in the chosen order again', () => {
  const metas = [meta('old', 'A', JANUARY), meta('new', 'B', MARCH)];
  assert.deepEqual(orderedWithPins(metas, 'updated', ['old', 'new']), ['new', 'old']);
});
