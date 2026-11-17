import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../../src/i18n/en.ts';
import { FALLBACK_LOCALE, createTranslator, resolveLocale } from '../../src/i18n/i18n.ts';
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
  const appSource = listFiles('src', ['.ts'])
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
