import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AutosaveState } from '../../src/app/autosave.ts';
import { MAX_TITLE_LENGTH } from '../../src/app/documentStore.ts';
import {
  SAVE_STATE_KEYS,
  describeFileNotice,
  describeNotice,
  describeStorage,
  describeTitleProblem,
  formatEditorStats,
  formatTimestamp,
  temporaryModeKey,
} from '../../src/app/noticeText.ts';
import { en } from '../../src/i18n/en.ts';
import { createTranslator } from '../../src/i18n/i18n.ts';

const t = createTranslator('en');

test('describeNotice explains a failed load', () => {
  assert.equal(describeNotice({ kind: 'load-failed' }, t), en['notice.loadFailed']);
});

test('describeNotice states how many damaged records were skipped', () => {
  assert.match(describeNotice({ kind: 'corrupt-records', count: 3 }, t), /\b3\b/);
});

test('describeNotice names the copy that was saved after a conflict', () => {
  const text = describeNotice({ kind: 'saved-as-copy', title: 'Notes (conflict copy)' }, t);
  assert.equal(text.includes('Notes (conflict copy)'), true);
});

test('describeNotice gives each reason for a failed save its own message', () => {
  const quota = describeNotice({ kind: 'save-failed', reason: 'quota' }, t);
  const lost = describeNotice({ kind: 'save-failed', reason: 'connection-lost' }, t);
  const other = describeNotice({ kind: 'save-failed', reason: 'other' }, t);
  assert.equal(quota, en['notice.saveFailedQuota']);
  assert.equal(lost, en['notice.connectionLost']);
  assert.equal(other, en['notice.saveFailed']);
  assert.equal(new Set([quota, lost, other]).size, 3);
});

test('every save state has its own label', () => {
  const states: AutosaveState[] = ['saved', 'pending', 'saving', 'failed'];
  const labels = states.map((state) => t(SAVE_STATE_KEYS[state]));
  assert.equal(new Set(labels).size, states.length);
});

test('temporaryModeKey explains why nothing is being kept', () => {
  assert.equal(temporaryModeKey('safe-mode'), 'notice.temporarySafeMode');
  assert.equal(temporaryModeKey('unavailable'), 'notice.temporaryUnavailable');
  // A missing reason is treated as the unexpected case rather than as something the user chose.
  assert.equal(temporaryModeKey(undefined), 'notice.temporaryUnavailable');
});

test('describeStorage names the mode and, when temporary, the reason', () => {
  assert.equal(describeStorage({ mode: 'persistent' }), 'persistent');
  assert.equal(describeStorage({ mode: 'temporary', reason: 'safe-mode' }), 'temporary (safe-mode)');
  assert.equal(describeStorage({ mode: 'temporary', reason: 'unavailable' }), 'temporary (unavailable)');
});

test('describeNotice states the tab limit', () => {
  assert.match(describeNotice({ kind: 'tab-limit' }, t), /\b20\b/);
});

test('describeNotice explains that a memo is gone', () => {
  assert.equal(describeNotice({ kind: 'memo-missing' }, t), en['notice.memoMissing']);
});

test('describeTitleProblem explains each reason a title is refused', () => {
  const empty = describeTitleProblem('empty', t);
  const tooLong = describeTitleProblem('too-long', t);
  const lineBreak = describeTitleProblem('line-break', t);
  assert.equal(new Set([empty, tooLong, lineBreak]).size, 3);
  assert.equal(tooLong.includes(String(MAX_TITLE_LENGTH)), true);
});

test('formatTimestamp renders a stored time for the given language and time zone', () => {
  const english = formatTimestamp('2026-03-04T05:06:00.000Z', 'en', 'UTC');
  const korean = formatTimestamp('2026-03-04T05:06:00.000Z', 'ko', 'UTC');
  assert.match(english, /2026/);
  assert.match(english, /5:06/);
  assert.match(korean, /2026/);
  assert.notEqual(english, korean);
});

test('formatTimestamp returns text it cannot parse unchanged', () => {
  assert.equal(formatTimestamp('not a date', 'en', 'UTC'), 'not a date');
  assert.equal(formatTimestamp('', 'en', 'UTC'), '');
});

test('formatEditorStats shows cursor position and document size', () => {
  const text = formatEditorStats({ characters: 1234, lines: 56, cursorLine: 12, cursorColumn: 5, selectedCharacters: 0 }, t);
  assert.equal(text, 'Ln 12, Col 5 · 1234 characters · 56 lines');
});

test('formatEditorStats adds the selection size only while something is selected', () => {
  const text = formatEditorStats({ characters: 10, lines: 1, cursorLine: 1, cursorColumn: 4, selectedCharacters: 3 }, t);
  assert.equal(text, 'Ln 1, Col 4 · 3 selected · 10 characters · 1 lines');
});

test('formatEditorStats shows nothing when there is no document', () => {
  assert.equal(formatEditorStats(undefined, t), '');
});

test('describeFileNotice names the file in every message', () => {
  const notices = [
    { kind: 'file-too-large', fileName: 'big.log', maxBytes: 10 * 1024 * 1024 },
    { kind: 'file-not-text', fileName: 'photo.png' },
    { kind: 'file-unreadable', fileName: 'gone.txt' },
    { kind: 'file-garbled', fileName: 'odd.txt', encoding: 'CP949' },
  ] as const;
  const texts = notices.map((notice) => describeFileNotice(notice, t));
  notices.forEach((notice, index) => assert.equal(texts[index]?.includes(notice.fileName), true, notice.kind));
  assert.equal(new Set(texts).size, notices.length);
});

test('describeFileNotice states the size limit in megabytes', () => {
  const text = describeFileNotice({ kind: 'file-too-large', fileName: 'big.log', maxBytes: 10 * 1024 * 1024 }, t);
  assert.match(text, /\b10 MB\b/);
});

test('describeFileNotice names the encoding a doubtful file was read with', () => {
  const text = describeFileNotice({ kind: 'file-garbled', fileName: 'odd.txt', encoding: 'CP949' }, t);
  assert.equal(text.includes('CP949'), true);
});
