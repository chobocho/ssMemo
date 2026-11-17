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
    groups: [
      {
        label: 'Files',
        rows: [
          { icon: '📂', label: 'Open file', shortcuts: ['Ctrl+O'] },
          { icon: '🔤', label: 'Encoding', shortcuts: [] },
        ],
      },
      { label: 'Search', rows: [{ icon: '🔍', label: 'Find', shortcuts: ['Ctrl+F', 'Ctrl+I'] }] },
    ],
    notesTitle: 'Good to know',
    notes: ['Memos are saved automatically.', 'Redo is Ctrl+Y.'],
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
  assert.deepEqual([...(notes?.querySelectorAll('li') ?? [])].map((item) => item.textContent), ['Memos are saved automatically.', 'Redo is Ctrl+Y.']);
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
  const { content } = createHarness({ notes: ['<img src=x onerror=alert(1)>'], licensesText: '<script>alert(1)</script>' });
  assert.equal(content.querySelector('img'), null);
  assert.equal(content.querySelector('script'), null);
});
