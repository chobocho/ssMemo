import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SEARCH_PHRASE_KEYS, createSearchPhrases } from '../../src/editor/searchPhrases.ts';
import { en } from '../../src/i18n/en.ts';
import { createTranslator } from '../../src/i18n/i18n.ts';
import { ko } from '../../src/i18n/ko.ts';

// The texts the search package asks the editor to translate, read from the installed package
// itself: if an update of the package adds one, this test says so. The whole file is scanned,
// because replacing announces its result from outside the panel's own code.
function phrasesUsedBySearchPanel(): string[] {
  const source = readFileSync(fileURLToPath(import.meta.resolve('@codemirror/search')), 'utf8');
  const used = [...source.matchAll(/phrase\((?:view, |this\.view, )?"([^"]+)"/g)].map((match) => match[1] ?? '');
  return [...new Set(used)].sort();
}

// Not part of the panel: "go to line" is a separate feature the app does not offer.
const NOT_OFFERED = ['Go to line', 'go'];

test('every text of the search panel has a translation', () => {
  const used = phrasesUsedBySearchPanel().filter((phrase) => !NOT_OFFERED.includes(phrase));
  assert.ok(used.includes('Find') && used.includes('replace all'), `unexpected phrase list: ${used.join(', ')}`);
  assert.deepEqual(Object.keys(SEARCH_PHRASE_KEYS).sort(), used);
});

test('the English phrases are the editor\'s own, so English looks as the library intends', () => {
  const phrases = createSearchPhrases(createTranslator('en'));
  for (const original of Object.keys(SEARCH_PHRASE_KEYS)) assert.equal(phrases[original], original);
});

test('the Korean phrases differ from the originals', () => {
  const phrases = createSearchPhrases(createTranslator('ko'));
  for (const original of Object.keys(SEARCH_PHRASE_KEYS)) {
    assert.ok(phrases[original], original);
    assert.notEqual(phrases[original], original, original);
  }
});

test('a phrase with a number in it keeps the place for that number in every language', () => {
  // The editor puts the number where the "$" is.
  for (const [original, key] of Object.entries(SEARCH_PHRASE_KEYS)) {
    const expected = original.includes('$');
    assert.equal(en[key].includes('$'), expected, `en: ${original}`);
    assert.equal(ko[key].includes('$'), expected, `ko: ${original}`);
  }
});
