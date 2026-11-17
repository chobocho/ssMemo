import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AutosaveState } from '../../src/app/autosave.ts';
import { MAX_TITLE_LENGTH } from '../../src/app/documentStore.ts';
import {
  SAVE_STATE_KEYS,
  describeBackupNotice,
  describeCalcError,
  describeCalcNotice,
  describeBackupSummary,
  describeFileNotice,
  describeNotice,
  describeShareNotice,
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

test('formatEditorStats ends with the encoding and line ending of a file', () => {
  const stats = { characters: 10, lines: 1, cursorLine: 1, cursorColumn: 1, selectedCharacters: 0 };
  assert.equal(
    formatEditorStats(stats, t, { encoding: 'CP949', eol: 'crlf', hasBom: false }),
    'Ln 1, Col 1 · 10 characters · 1 lines · CP949 · CRLF',
  );
  assert.equal(
    formatEditorStats(stats, t, { encoding: 'UTF-8', eol: 'lf', hasBom: true }),
    'Ln 1, Col 1 · 10 characters · 1 lines · UTF-8 BOM · LF',
  );
  assert.match(formatEditorStats(stats, t, { encoding: 'UTF-16BE', eol: 'cr', hasBom: false }), /UTF-16BE · CR$/);
  assert.equal(formatEditorStats(undefined, t, { encoding: 'UTF-8', eol: 'lf', hasBom: false }), '');
});

test('describeFileNotice confirms a save and reports a failed one, naming the file', () => {
  const saved = describeFileNotice({ kind: 'file-saved', fileName: 'notes.txt' }, t);
  const failed = describeFileNotice({ kind: 'file-save-failed', fileName: 'notes.txt' }, t);
  assert.ok(saved.includes('notes.txt') && failed.includes('notes.txt'));
  assert.notEqual(saved, failed);
});

test('describeFileNotice explains why an encoding cannot be changed', () => {
  const notAFile = describeFileNotice({ kind: 'encoding-not-a-file' }, t);
  const locked = describeFileNotice({ kind: 'encoding-locked' }, t);
  assert.ok(notAFile.length > 0 && locked.length > 0);
  assert.notEqual(notAFile, locked);
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

test('describeBackupNotice gives every outcome its own message', () => {
  const notices = [
    { kind: 'backup-exported', documents: 3, unreadable: 0 },
    { kind: 'backup-export-failed' },
    { kind: 'backup-unreadable-file' },
    { kind: 'backup-invalid', problem: 'not-json' },
    { kind: 'backup-invalid', problem: 'not-a-backup' },
    { kind: 'backup-invalid', problem: 'newer-format' },
    { kind: 'backup-empty' },
    { kind: 'backup-imported', added: 1, copied: 0, unchanged: 0, skipped: 0 },
    { kind: 'backup-import-failed' },
  ] as const;
  const texts = notices.map((notice) => describeBackupNotice(notice, t));
  assert.equal(texts.every((text) => text.length > 0), true);
  assert.equal(new Set(texts).size, notices.length);
});

test('describeBackupNotice counts the exported memos and mentions damaged records only if there are any', () => {
  const complete = describeBackupNotice({ kind: 'backup-exported', documents: 12, unreadable: 0 }, t);
  const partial = describeBackupNotice({ kind: 'backup-exported', documents: 12, unreadable: 4 }, t);
  assert.match(complete, /\b12\b/);
  assert.match(partial, /\b12\b/);
  assert.match(partial, /\b4\b/);
  assert.notEqual(complete, partial);
});

test('describeBackupNotice breaks an import down into added, copied and unchanged memos', () => {
  const text = describeBackupNotice({ kind: 'backup-imported', added: 5, copied: 2, unchanged: 7, skipped: 0 }, t);
  for (const count of ['5', '2', '7']) assert.match(text, new RegExp(`\\b${count}\\b`));
  const withSkipped = describeBackupNotice({ kind: 'backup-imported', added: 5, copied: 2, unchanged: 7, skipped: 9 }, t);
  assert.match(withSkipped, /\b9\b/);
  assert.ok(withSkipped.startsWith(text));
});

test('describeBackupSummary says what the backup holds, when it was made and what is stored', () => {
  const text = describeBackupSummary({ documents: 8, skipped: 0, exportedAt: '2026-10-01T03:04:00.000Z', stored: 3 }, t, 'en', 'UTC');
  assert.match(text, /\b8\b/);
  assert.match(text, /\b3\b/);
  assert.match(text, /Oct 1, 2026/);
});

test('describeBackupSummary copes with a backup that does not say when it was made', () => {
  const text = describeBackupSummary({ documents: 8, skipped: 2, exportedAt: undefined, stored: 0 }, t, 'en', 'UTC');
  assert.match(text, /\b8\b/);
  assert.equal(text.includes('undefined'), false);
  // Entries that cannot be used are mentioned, so the count does not surprise afterwards.
  assert.match(text, /\b2\b/);
});

test('every calculator error has a message of its own that names what it is about', () => {
  const cases = [
    ['source-too-long', '100000'],
    ['too-complex', ''],
    ['unknown-character', '@'],
    ['unexpected-token', ')'],
    ['unexpected-token', ''],
    ['expected-token', ')'],
    ['undefined-variable', 'total'],
    ['unknown-function', 'sqrt'],
    ['wrong-argument-count', 'sin'],
    ['division-by-zero', ''],
    ['factorial-not-integer', ''],
    ['factorial-negative', ''],
    ['factorial-too-large', '1000'],
  ] as const;
  const texts = cases.map(([code, detail]) => describeCalcError(code, detail, t));
  assert.equal(new Set(texts).size, cases.length);
  cases.forEach(([code, detail], index) => {
    const text = texts[index] ?? '';
    assert.ok(text.length > 0, code);
    if (detail !== '') assert.ok(text.includes(detail), `${code}: ${text}`);
    assert.equal(text.includes('{'), false, `${code}: ${text}`);
  });
});

test('describeCalcNotice explains how to run something and what a failed store means', () => {
  const nothing = describeCalcNotice({ kind: 'calc-nothing-to-run' }, t);
  const notSaved = describeCalcNotice({ kind: 'calc-memory-not-saved' }, t);
  assert.ok(nothing.length > 0 && notSaved.length > 0);
  assert.notEqual(nothing, notSaved);
});

test('describeShareNotice has words of its own for every way sharing can end badly', () => {
  const kinds = ['share-unsupported', 'share-nothing', 'share-too-long', 'share-failed'] as const;
  const messages = kinds.map((kind) => describeShareNotice({ kind }, t));
  for (const message of messages) assert.ok(message.length > 0);
  assert.equal(new Set(messages).size, kinds.length);
  // Where sharing is impossible the user is pointed to what works instead.
  assert.match(describeShareNotice({ kind: 'share-unsupported' }, t), /file/i);
  assert.match(describeShareNotice({ kind: 'share-too-long' }, t), /file/i);
});
