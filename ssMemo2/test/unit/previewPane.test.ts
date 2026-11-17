import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppShell } from '../../src/ui/appShell.ts';
import { createPreviewPane } from '../../src/ui/previewPane.ts';
import { createTestDom } from '../helpers/dom.ts';

test('the pane is a labelled region that shows the HTML it is given', () => {
  const { document } = createTestDom();
  const pane = createPreviewPane(document, 'Preview');
  assert.equal(pane.element.classList.contains('preview-pane'), true);
  assert.equal(pane.element.getAttribute('role'), 'region');
  assert.equal(pane.element.getAttribute('aria-label'), 'Preview');
  pane.setHtml('<h1>Title</h1><p>text</p>');
  assert.equal(pane.element.querySelector('h1')?.textContent, 'Title');
  pane.setHtml('');
  assert.equal(pane.element.childNodes.length, 0);
});

test('the pane can be scrolled with the keyboard', () => {
  const { document } = createTestDom();
  assert.equal(createPreviewPane(document, 'Preview').element.tabIndex, 0);
});

test('the main area has a place for the editor and one for the preview, in that order', () => {
  const { document } = createTestDom();
  const shell = createAppShell(document, 'ssMemo2');
  assert.equal(shell.main.tagName, 'MAIN');
  assert.deepEqual([...shell.main.children], [shell.editorHost, shell.previewHost]);
  assert.notEqual(shell.editorHost, shell.previewHost);
  assert.equal(shell.editorHost.classList.contains('editor-pane'), true);
});
