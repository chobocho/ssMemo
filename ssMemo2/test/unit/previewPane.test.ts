import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppShell } from '../../src/ui/appShell.ts';
import { createPreviewPane } from '../../src/ui/previewPane.ts';
import type { PreviewPane } from '../../src/ui/previewPane.ts';
import { createTestDom } from '../helpers/dom.ts';

function createHarness(): { pane: PreviewPane; content: HTMLElement; back: HTMLButtonElement; backCount(): number } {
  const { document } = createTestDom();
  let backs = 0;
  const pane = createPreviewPane(document, { label: 'Preview', backLabel: 'Back to editing', onBack: () => { backs += 1; } });
  document.body.append(pane.element);
  const content = pane.element.querySelector<HTMLElement>('.preview-content');
  const back = pane.element.querySelector<HTMLButtonElement>('button.preview-back');
  assert.ok(content && back);
  return { pane, content, back, backCount: () => backs };
}

test('the pane shows the HTML it is given in a labelled region', () => {
  const { pane, content } = createHarness();
  assert.equal(pane.element.classList.contains('preview-pane'), true);
  assert.equal(content.getAttribute('role'), 'region');
  assert.equal(content.getAttribute('aria-label'), 'Preview');
  pane.setHtml('<h1>Title</h1><p>text</p>');
  assert.equal(content.querySelector('h1')?.textContent, 'Title');
  pane.setHtml('');
  assert.equal(content.childNodes.length, 0);
});

test('the rendered text can be scrolled with the keyboard', () => {
  assert.equal(createHarness().content.tabIndex, 0);
});

test('the button back to editing is always there and is not part of what gets replaced', () => {
  const { pane, back, backCount } = createHarness();
  assert.equal(back.textContent?.includes('Back to editing'), true);
  pane.setHtml('<p>one</p>');
  pane.setHtml('<p>two</p>');
  assert.equal(pane.element.contains(back), true);
  back.click();
  assert.equal(backCount(), 1);
  // It comes before the text, so it is the first thing reached with the keyboard.
  assert.equal(pane.element.firstElementChild, back);
});

test('the main area has a place for the editor and one for the preview, in that order', () => {
  const { document } = createTestDom();
  const shell = createAppShell(document, 'ssMemo2');
  assert.equal(shell.main.tagName, 'MAIN');
  assert.deepEqual([...shell.main.children], [shell.editorHost, shell.previewHost]);
  assert.notEqual(shell.editorHost, shell.previewHost);
  assert.equal(shell.editorHost.classList.contains('editor-pane'), true);
});
