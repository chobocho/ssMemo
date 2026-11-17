import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Command } from '../../src/app/commands.ts';
import { createToolbar } from '../../src/ui/toolbar.ts';
import { createTestDom } from '../helpers/dom.ts';

function createHarness(): { toolbar: HTMLElement; ran: string[] } {
  const { document } = createTestDom();
  const ran: string[] = [];
  const command = (id: string, icon: string, shortcuts: string[]): Command => ({
    id,
    labelKey: 'command.newMemo',
    icon,
    shortcuts,
    run: () => ran.push(id),
  });
  const toolbar = createToolbar(document, [command('memo.manage', '📋', ['Alt-o']), command('view.wrap', '↩️', [])], (key) => `label of ${key}`);
  document.body.append(toolbar);
  return { toolbar, ran };
}

test('the toolbar shows one button per command, in order, with its icon', () => {
  const { toolbar } = createHarness();
  const icons = [...toolbar.querySelectorAll('button')].map((button) => button.textContent);
  assert.deepEqual(icons, ['📋', '↩️']);
});

test('clicking a button runs its command', () => {
  const { toolbar, ran } = createHarness();
  toolbar.querySelectorAll('button')[1]?.click();
  assert.deepEqual(ran, ['view.wrap']);
});

test('each button has an accessible name, and its tooltip mentions the shortcut', () => {
  const { toolbar } = createHarness();
  const [withShortcut, withoutShortcut] = [...toolbar.querySelectorAll('button')];
  assert.equal(withShortcut?.getAttribute('aria-label'), 'label of command.newMemo');
  assert.equal(withShortcut?.title, 'label of command.newMemo (Alt-o)');
  assert.equal(withoutShortcut?.title, 'label of command.newMemo');
});

test('an empty command list gives an empty toolbar', () => {
  const { document } = createTestDom();
  assert.equal(createToolbar(document, [], (key) => key).querySelectorAll('button').length, 0);
});
