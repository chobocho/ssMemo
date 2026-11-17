import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Command } from '../../src/app/commands.ts';
import { createToolbar } from '../../src/ui/toolbar.ts';
import { createTestDom } from '../helpers/dom.ts';

function createHarness(): { toolbar: HTMLElement; ran: string[]; refresh: () => void; setWrap: (on: boolean) => void } {
  const { document } = createTestDom();
  const ran: string[] = [];
  let wrapOn = true;
  const command = (id: string, icon: string, shortcuts: string[]): Command => ({
    id,
    labelKey: 'command.newMemo',
    icon,
    shortcuts,
    run: () => ran.push(id),
  });
  const toolbar = createToolbar(
    document,
    [command('memo.manage', '📋', ['Alt-o']), { ...command('view.wrap', '↩️', []), isOn: () => wrapOn }],
    (key) => `label of ${key}`,
  );
  document.body.append(toolbar.element);
  return {
    toolbar: toolbar.element,
    ran,
    refresh: toolbar.refresh,
    setWrap: (on) => {
      wrapOn = on;
    },
  };
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
  assert.equal(createToolbar(document, [], (key) => key).element.querySelectorAll('button').length, 0);
});

test('a toggle command shows whether it is on, and follows the setting after refresh', () => {
  const { toolbar, refresh, setWrap } = createHarness();
  const [plain, toggle] = [...toolbar.querySelectorAll('button')];
  // A plain command is not a toggle and must not claim a pressed state.
  assert.equal(plain?.hasAttribute('aria-pressed'), false);
  assert.equal(toggle?.getAttribute('aria-pressed'), 'true');
  setWrap(false);
  refresh();
  assert.equal(toggle?.getAttribute('aria-pressed'), 'false');
});
