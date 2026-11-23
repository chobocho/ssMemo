import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHelpContent } from '../../src/ui/helpDialog.ts';
import type { HelpOptions } from '../../src/ui/helpDialog.ts';
import { createTestDom } from '../helpers/dom.ts';

function createHarness(overrides: Partial<HelpOptions> = {}): { content: HTMLElement; diagnostics: HTMLElement } {
  const { document } = createTestDom();
  const diagnostics = document.createElement('details');
  diagnostics.className = 'diagnostics';
  const content = createHelpContent(document, {
    filterLabel: 'Find a command or a key',
    noMatches: 'Nothing matches.',
    groups: [
      {
        label: 'Files',
        rows: [
          { icon: '📂', label: 'Open file', shortcuts: ['Ctrl+O'], hint: 'Several at once' },
          { icon: '🔤', label: 'Encoding', shortcuts: [] },
        ],
      },
      { label: 'Search', rows: [{ icon: '🔍', label: 'Find', shortcuts: ['Ctrl+F', 'Ctrl+I'] }] },
    ],
    tipsTitle: 'Good to know',
    tips: [
      { icon: '💾', title: 'Saved by itself', text: 'Memos are saved automatically.' },
      { icon: '↩️', title: 'Undo', text: 'Redo is Ctrl+Y.' },
    ],
    aboutTitle: 'About',
    aboutText: 'ssMemo2, build 0.1.0+abc',
    licensesTitle: 'Open-source licenses',
    licensesIntro: 'This app contains open-source software.',
    licensesText: 'MIT License\n\nCopyright (C) someone',
    diagnostics,
    ...overrides,
  });
  document.body.append(content);
  return { content, diagnostics };
}

test('each group is a section with its heading and one row per command', () => {
  const { content } = createHarness();
  const sections = [...content.querySelectorAll('.help-group')];
  assert.deepEqual(sections.map((section) => section.querySelector('h3')?.textContent), ['Files', 'Search']);
  assert.deepEqual(sections.map((section) => section.querySelectorAll('.help-row').length), [2, 1]);
});

test('a row shows icon, name and every shortcut as a key', () => {
  const { content } = createHarness();
  const rows = [...content.querySelectorAll('.help-row')];
  assert.equal(rows[0]?.querySelector('.help-icon')?.textContent, '📂');
  assert.equal(rows[0]?.querySelector('.help-label')?.textContent, 'Open file');
  assert.deepEqual([...(rows[0]?.querySelectorAll('kbd') ?? [])].map((key) => key.textContent), ['Ctrl+O']);
  assert.deepEqual([...(rows[2]?.querySelectorAll('kbd') ?? [])].map((key) => key.textContent), ['Ctrl+F', 'Ctrl+I']);
  assert.equal(rows[1]?.querySelectorAll('kbd').length, 0);
});

test('the notes come as a list under their heading', () => {
  const { content } = createHarness();
  const notes = content.querySelector('.help-notes');
  assert.equal(notes?.querySelector('h3')?.textContent, 'Good to know');
  const items = [...(notes?.querySelectorAll('li') ?? [])];
  assert.deepEqual(items.map((item) => item.querySelector('.help-note-title')?.textContent), ['Saved by itself', 'Undo']);
  assert.deepEqual(items.map((item) => item.querySelector('.help-note-text')?.textContent), ['Memos are saved automatically.', 'Redo is Ctrl+Y.']);
});

test('the build is named, and the licenses are there in full but folded away', () => {
  const { content } = createHarness();
  assert.match(content.querySelector('.help-about')?.textContent ?? '', /ssMemo2, build 0\.1\.0\+abc/);
  const licenses = content.querySelector<HTMLDetailsElement>('details.help-licenses');
  assert.ok(licenses);
  assert.equal(licenses.open, false);
  assert.equal(licenses.querySelector('summary')?.textContent, 'Open-source licenses');
  assert.equal(licenses.querySelector('pre')?.textContent, 'MIT License\n\nCopyright (C) someone');
  assert.match(licenses.textContent ?? '', /This app contains open-source software\./);
});

test('the diagnostics panel it is given is part of the help', () => {
  const { content, diagnostics } = createHarness();
  assert.equal(content.contains(diagnostics), true);
});

test('texts are shown as text, whatever they contain', () => {
  const { content } = createHarness({ tips: [{ icon: '<b>', title: '<i>x</i>', text: '<img src=x onerror=alert(1)>' }], licensesText: '<script>alert(1)</script>' });
  assert.equal(content.querySelector('img'), null);
  assert.equal(content.querySelector('script'), null);
  assert.equal(content.querySelector('.help-notes i, .help-notes b'), null);
});

test('a command that has an explanation shows it under its name, the others show none', () => {
  const { content } = createHarness();
  const rows = [...content.querySelectorAll('.help-row')];
  assert.equal(rows[0]?.querySelector('.help-hint')?.textContent, 'Several at once');
  assert.equal(rows[1]?.querySelector('.help-hint'), null);
});

// --- the filter -------------------------------------------------------------

function typeIntoFilter(content: HTMLElement, text: string): void {
  const filter = content.querySelector<HTMLInputElement>('.help-filter');
  assert.ok(filter, 'expected the filter field');
  filter.value = text;
  filter.dispatchEvent(new (content.ownerDocument.defaultView as Window & typeof globalThis).Event('input', { bubbles: true }));
}

/** Texts of the matching elements that are neither hidden themselves nor inside something hidden. */
const shownTexts = (content: HTMLElement, selector: string): string[] =>
  [...content.querySelectorAll<HTMLElement>(selector)].filter((element) => !element.closest('[hidden]')).map((element) => element.textContent ?? '');

test('the filter field is named, and comes before everything it filters', () => {
  const { content } = createHarness();
  const filter = content.querySelector('.help-filter');
  assert.equal(filter?.getAttribute('aria-label'), 'Find a command or a key');
  assert.equal(content.firstElementChild, filter);
});

test('typing leaves only the entries that contain every word, whatever the case', () => {
  const { content } = createHarness();
  typeIntoFilter(content, 'CTRL find');
  assert.deepEqual(shownTexts(content, '.help-row .help-label'), ['Find']);
  // A group without a match goes away with its heading; so do the notes.
  assert.deepEqual(shownTexts(content, '.help-group').length, 1);
  assert.equal(content.querySelector<HTMLElement>('.help-notes')?.hidden, true);
});

test('the filter looks at names, explanations, keys and notes alike', () => {
  const { content } = createHarness();
  typeIntoFilter(content, 'several');
  assert.deepEqual(shownTexts(content, '.help-row .help-label'), ['Open file']);
  typeIntoFilter(content, 'ctrl+i');
  assert.deepEqual(shownTexts(content, '.help-row .help-label'), ['Find']);
  typeIntoFilter(content, 'redo');
  assert.deepEqual(shownTexts(content, '.help-row .help-label'), []);
  assert.deepEqual(shownTexts(content, '.help-note .help-note-title'), ['Undo']);
});

test('when nothing matches the help says so, and an emptied field brings everything back', () => {
  const { content } = createHarness();
  const empty = content.querySelector<HTMLElement>('.help-empty');
  assert.equal(empty?.hidden, true);
  typeIntoFilter(content, 'zzz');
  assert.equal(empty?.hidden, false);
  assert.equal(empty?.textContent, 'Nothing matches.');
  typeIntoFilter(content, '  ');
  assert.equal(empty?.hidden, true);
  assert.equal(shownTexts(content, '.help-row').length, 3);
  assert.equal(shownTexts(content, '.help-note').length, 2);
});
