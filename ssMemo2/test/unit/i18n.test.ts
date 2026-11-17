import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../../src/i18n/en.ts';
import { FALLBACK_LOCALE, createTranslator, formatMessage, resolveLocale } from '../../src/i18n/i18n.ts';
import { ko } from '../../src/i18n/ko.ts';
import { listFiles, rootDir } from '../helpers/projectFiles.ts';

const CATALOG_FILES: readonly string[] = ['src/i18n/en.ts', 'src/i18n/ko.ts'];

// --- resolveLocale ----------------------------------------------------------

test('resolveLocale picks the first browser language the app supports', () => {
  assert.equal(resolveLocale(['ko-KR', 'en-US', 'ko', 'en']), 'ko');
  assert.equal(resolveLocale(['en-US', 'ko-KR']), 'en');
  assert.equal(resolveLocale(['ja-JP', 'ko-KR']), 'ko');
});

test('resolveLocale falls back when no browser language is supported', () => {
  assert.equal(resolveLocale(['ja-JP', 'fr']), FALLBACK_LOCALE);
  assert.equal(resolveLocale([]), FALLBACK_LOCALE);
  assert.equal(resolveLocale(['']), FALLBACK_LOCALE);
});

test('resolveLocale ignores letter case and surrounding spaces', () => {
  assert.equal(resolveLocale(['KO-kr']), 'ko');
  assert.equal(resolveLocale(['  ko  ']), 'ko');
});

test('resolveLocale compares the whole primary subtag, not a prefix', () => {
  // "kok" is Konkani, not Korean.
  assert.equal(resolveLocale(['kok-IN']), FALLBACK_LOCALE);
});

test('resolveLocale lets a saved language choice override the browser', () => {
  assert.equal(resolveLocale(['en-US'], 'ko'), 'ko');
  assert.equal(resolveLocale(['ko-KR'], 'en'), 'en');
});

test('resolveLocale follows the browser when the choice is automatic or not a supported language', () => {
  assert.equal(resolveLocale(['ko-KR'], 'auto'), 'ko');
  assert.equal(resolveLocale(['ko-KR'], 'ja'), 'ko');
  assert.equal(resolveLocale(['ko-KR'], undefined), 'ko');
});

// --- catalogs ---------------------------------------------------------------

test('both catalogs define exactly the same keys', () => {
  assert.deepEqual(Object.keys(ko).sort(), Object.keys(en).sort());
});

test('no message is empty', () => {
  for (const [locale, catalog] of Object.entries({ en, ko })) {
    for (const [key, message] of Object.entries(catalog)) {
      assert.equal(message.trim().length > 0, true, `${locale}: ${key} is empty`);
    }
  }
});

test('every message key is used somewhere in the app', () => {
  // An unused message is dead code; TODO.md requires deleting it at once.
  // The build script counts too: it puts the message for a failed start into the page itself.
  const appSource = [...listFiles('src', ['.ts']), ...listFiles('scripts', ['.ts'])]
    .filter((file) => !CATALOG_FILES.includes(file))
    .map((file) => readFileSync(join(rootDir, file), 'utf8'))
    .join('\n');
  const unused = Object.keys(en).filter((key) => !appSource.includes(`'${key}'`));
  assert.deepEqual(unused, []);
});

// --- createTranslator -------------------------------------------------------

test('createTranslator returns the message of the chosen locale', () => {
  const key = 'diagnostics.copy';
  assert.equal(createTranslator('en')(key), en[key]);
  assert.equal(createTranslator('ko')(key), ko[key]);
  assert.notEqual(en[key], ko[key]);
});

test('createTranslator fills in message parameters', () => {
  assert.equal(createTranslator('en')('memo.conflictCopyTitle', { title: 'Notes' }), 'Notes (conflict copy)');
});

// --- formatMessage ----------------------------------------------------------

test('formatMessage replaces named placeholders, including repeated ones and numbers', () => {
  assert.equal(formatMessage('{count} of {total}, {count} left', { count: 2, total: 5 }), '2 of 5, 2 left');
});

test('formatMessage returns a message without placeholders unchanged', () => {
  assert.equal(formatMessage('Saved'), 'Saved');
  assert.equal(formatMessage('Saved', { unused: 'x' }), 'Saved');
});

test('formatMessage leaves an unknown placeholder visible instead of blanking it', () => {
  // A visible "{name}" in the UI is easier to notice and report than a silently missing word.
  assert.equal(formatMessage('Hello {name}', {}), 'Hello {name}');
  assert.equal(formatMessage('Hello {toString}', {}), 'Hello {toString}');
});

test('formatMessage inserts values literally', () => {
  assert.equal(formatMessage('<{title}>', { title: '{title} $& $1' }), '<{title} $& $1>');
});

test('both catalogs use the same placeholders in every message', () => {
  const placeholdersOf = (message: string): string[] => [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    assert.deepEqual(placeholdersOf(ko[key]), placeholdersOf(en[key]), key);
  }
});
