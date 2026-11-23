import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Command } from '../../src/app/commands.ts';
import { createCommandMenu } from '../../src/ui/commandMenu.ts';
import { createTestDom } from '../helpers/dom.ts';

interface Harness {
  menu: HTMLElement;
  picked: string[];
  ran: string[];
  items(): HTMLButtonElement[];
}

function createHarness(wrapOn = true): Harness {
  const { document } = createTestDom();
  const picked: string[] = [];
  const ran: string[] = [];
  const command = (id: string, icon: string, shortcuts: string[], group = 'file'): Command => ({
    id,
    group,
    labelKey: 'command.newMemo',
    icon,
    shortcuts,
    run: () => ran.push(id),
  });
  const menu = createCommandMenu(document, {
    commands: [
      command('file.open', '📂', ['Mod-o', 'Alt-x']),
      command('view.larger', 'A+', [], 'view'),
      { ...command('view.wrap', '↩️', ['Alt-z'], 'view'), isOn: () => wrapOn },
    ],
    t: (key) => `label of ${key}`,
    groupLabel: (group) => `group ${group}`,
    formatShortcut: (shortcut) => `<${shortcut}>`,
    onPick: (picked_) => picked.push(picked_.id),
  });
  document.body.append(menu);
  return { menu, picked, ran, items: () => [...menu.querySelectorAll('button')] };
}

test('the menu lists every command in order, with icon and label', () => {
  const { items } = createHarness();
  assert.equal(items().length, 3);
  assert.deepEqual(items().map((item) => item.querySelector('.command-icon')?.textContent), ['📂', 'A+', '↩️']);
  for (const item of items()) {
    assert.equal(item.querySelector('.command-label')?.textContent, 'label of command.newMemo');
  }
});

test('the icon is hidden from screen readers, which read the label instead', () => {
  const { items } = createHarness();
  assert.equal(items()[0]?.querySelector('.command-icon')?.getAttribute('aria-hidden'), 'true');
});

test('a command shows its first shortcut, formatted; one without a shortcut shows none', () => {
  const { items } = createHarness();
  assert.equal(items()[0]?.querySelector('.command-shortcut')?.textContent, '<Mod-o>');
  assert.equal(items()[1]?.querySelector('.command-shortcut'), null);
});

test('picking an item reports the command and leaves running it to the caller', () => {
  // The caller closes the dialog first; a command that opens another dialog needs that order.
  const harness = createHarness();
  harness.items()[1]?.click();
  assert.deepEqual(harness.picked, ['view.larger']);
  assert.deepEqual(harness.ran, []);
});

test('a toggle command shows whether it is on', () => {
  assert.equal(createHarness(true).items()[2]?.getAttribute('aria-pressed'), 'true');
  assert.equal(createHarness(false).items()[2]?.getAttribute('aria-pressed'), 'false');
  assert.equal(createHarness().items()[0]?.hasAttribute('aria-pressed'), false);
});

test('an empty command list gives an empty menu', () => {
  const { document } = createTestDom();
  const menu = createCommandMenu(document, {
    commands: [],
    t: (key) => key,
    groupLabel: (group) => group,
    formatShortcut: (shortcut) => shortcut,
    onPick: () => undefined,
  });
  assert.equal(menu.querySelectorAll('.command-group').length, 0);
  assert.equal(menu.querySelectorAll('button').length, 0);
});

test('commands are listed under a heading for their group, in the order the groups first appear', () => {
  const { menu } = createHarness();
  const headings = [...menu.querySelectorAll('.command-group-title')].map((heading) => heading.textContent);
  assert.deepEqual(headings, ['group file', 'group view']);
  const groups = [...menu.querySelectorAll('.command-group')];
  assert.deepEqual(groups.map((group) => group.querySelectorAll('button').length), [1, 2]);
  // Each list is named by its heading for screen readers.
  for (const group of groups) {
    const headingId = group.querySelector('.command-group-title')?.id;
    assert.ok(headingId);
    assert.equal(group.getAttribute('aria-labelledby'), headingId);
  }
});

test('the first command asks for the focus, so the keyboard starts in the list', () => {
  const { document } = createTestDom();
  const menu = createCommandMenu(document, {
    commands: [
      { id: 'a', group: 'memo', labelKey: 'command.newMemo', icon: 'A', shortcuts: [], run: () => undefined },
      { id: 'b', group: 'file', labelKey: 'command.openFile', icon: 'B', shortcuts: [], run: () => undefined },
    ],
    t: (key) => key,
    groupLabel: (group) => group,
    formatShortcut: (shortcut) => shortcut,
    onPick: () => undefined,
  });
  assert.deepEqual([...menu.querySelectorAll('button')].map((button) => button.autofocus), [true, false]);
});
