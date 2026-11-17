import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCommandRegistry } from '../../src/app/commands.ts';
import type { Command } from '../../src/app/commands.ts';
import { formatShortcut, matchesShortcut, parseShortcut } from '../../src/app/shortcut.ts';
import type { ShortcutEvent } from '../../src/app/shortcut.ts';

/** A key press with every modifier off unless stated. */
function keyEvent(overrides: Partial<ShortcutEvent>): ShortcutEvent {
  return { key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, ...overrides };
}

function command(id: string, shortcuts: readonly string[] = []): Command {
  return { id, labelKey: 'memo.defaultTitle', icon: '➕', shortcuts, run: () => undefined };
}

// --- formatShortcut ---------------------------------------------------------

test('formatShortcut writes a shortcut the way keyboards label it', () => {
  assert.equal(formatShortcut('Alt-o', false), 'Alt+O');
  assert.equal(formatShortcut('Mod-Shift-s', false), 'Ctrl+Shift+S');
  assert.equal(formatShortcut('Alt-PageDown', false), 'Alt+PageDown');
  assert.equal(formatShortcut('F2', false), 'F2');
  assert.equal(formatShortcut('Mod-<', false), 'Ctrl+<');
  assert.equal(formatShortcut('Ctrl-6', false), 'Ctrl+6');
});

test('formatShortcut uses the Mac names for the modifier keys', () => {
  assert.equal(formatShortcut('Mod-o', true), 'Cmd+O');
  assert.equal(formatShortcut('Alt-n', true), 'Option+N');
  // Ctrl is a key of its own on a Mac and keeps its name.
  assert.equal(formatShortcut('Ctrl-Alt-n', true), 'Ctrl+Option+N');
});

test('formatShortcut rejects what parseShortcut rejects', () => {
  assert.throws(() => formatShortcut('Hyper-x', false), /unknown modifier/);
  assert.throws(() => formatShortcut('', false), /names no key/);
});

// --- parseShortcut ----------------------------------------------------------

test('parseShortcut reads modifiers and the key', () => {
  assert.deepEqual(parseShortcut('Alt-n'), { mod: false, ctrl: false, alt: true, shift: false, key: 'n' });
  assert.deepEqual(parseShortcut('Mod-Shift-K'), { mod: true, ctrl: false, alt: false, shift: true, key: 'k' });
  assert.deepEqual(parseShortcut('Ctrl-Alt-PageDown'), { mod: false, ctrl: true, alt: true, shift: false, key: 'pagedown' });
  assert.deepEqual(parseShortcut('F2'), { mod: false, ctrl: false, alt: false, shift: false, key: 'f2' });
});

test('parseShortcut rejects malformed shortcuts', () => {
  for (const text of ['', 'Alt-', '-n', 'Hyper-n', 'Alt-Alt-n', 'Alt']) {
    assert.throws(() => parseShortcut(text), /shortcut/i, `expected "${text}" to be rejected`);
  }
});

// --- matchesShortcut --------------------------------------------------------

test('a shortcut matches only its exact modifier combination', () => {
  const altN = parseShortcut('Alt-n');
  assert.equal(matchesShortcut(keyEvent({ key: 'n', code: 'KeyN', altKey: true }), altN, false), true);
  assert.equal(matchesShortcut(keyEvent({ key: 'n', code: 'KeyN' }), altN, false), false);
  assert.equal(matchesShortcut(keyEvent({ key: 'N', code: 'KeyN', altKey: true, shiftKey: true }), altN, false), false);
  assert.equal(matchesShortcut(keyEvent({ key: 'n', code: 'KeyN', altKey: true, ctrlKey: true }), altN, false), false);
  assert.equal(matchesShortcut(keyEvent({ key: 'm', code: 'KeyM', altKey: true }), altN, false), false);
});

test('Mod means Ctrl on Windows, Linux and Android, and Command on macOS', () => {
  const modS = parseShortcut('Mod-s');
  const withCtrl = keyEvent({ key: 's', code: 'KeyS', ctrlKey: true });
  const withCommand = keyEvent({ key: 's', code: 'KeyS', metaKey: true });
  assert.equal(matchesShortcut(withCtrl, modS, false), true);
  assert.equal(matchesShortcut(withCommand, modS, false), false);
  assert.equal(matchesShortcut(withCommand, modS, true), true);
  assert.equal(matchesShortcut(withCtrl, modS, true), false);
});

test('letter shortcuts work with Caps Lock and while a Korean input method is active', () => {
  // ssMemoWeb compared event.key only, so shortcuts died when the key arrived as Hangul or "Process".
  const altN = parseShortcut('Alt-n');
  assert.equal(matchesShortcut(keyEvent({ key: 'N', code: 'KeyN', altKey: true }), altN, false), true);
  assert.equal(matchesShortcut(keyEvent({ key: 'ㅜ', code: 'KeyN', altKey: true }), altN, false), true);
  assert.equal(matchesShortcut(keyEvent({ key: 'Process', code: 'KeyN', altKey: true }), altN, false), true);
});

test('no shortcut fires while text is being composed', () => {
  const altN = parseShortcut('Alt-n');
  assert.equal(matchesShortcut(keyEvent({ key: 'n', code: 'KeyN', altKey: true, isComposing: true }), altN, false), false);
});

test('digit and named-key shortcuts are matched', () => {
  assert.equal(matchesShortcut(keyEvent({ key: '6', code: 'Digit6', ctrlKey: true }), parseShortcut('Mod-6'), false), true);
  assert.equal(matchesShortcut(keyEvent({ key: 'PageDown', code: 'PageDown', altKey: true }), parseShortcut('Alt-PageDown'), false), true);
  assert.equal(matchesShortcut(keyEvent({ key: 'PageUp', code: 'PageUp', altKey: true }), parseShortcut('Alt-PageDown'), false), false);
});

test('a punctuation shortcut ignores Shift, because Shift is what produces the character', () => {
  // "<" is Shift+"," on most layouts; requiring or forbidding Shift would make it unreachable.
  const modLess = parseShortcut('Mod-<');
  assert.equal(matchesShortcut(keyEvent({ key: '<', code: 'Comma', ctrlKey: true, shiftKey: true }), modLess, false), true);
  assert.equal(matchesShortcut(keyEvent({ key: ',', code: 'Comma', ctrlKey: true }), modLess, false), false);
});

// --- createCommandRegistry --------------------------------------------------

test('the registry lists commands in the given order and finds them by id', () => {
  const registry = createCommandRegistry([command('memo.new', ['Alt-n']), command('tab.close', ['Alt-w'])]);
  assert.deepEqual(registry.list().map((entry) => entry.id), ['memo.new', 'tab.close']);
  assert.equal(registry.get('tab.close')?.id, 'tab.close');
  assert.equal(registry.get('missing'), undefined);
});

test('the registry finds the command for a key press', () => {
  const registry = createCommandRegistry([command('memo.new', ['Alt-n']), command('tab.close', ['Alt-w', 'Mod-F4'])]);
  assert.equal(registry.findByKeyEvent(keyEvent({ key: 'w', code: 'KeyW', altKey: true }), false)?.id, 'tab.close');
  assert.equal(registry.findByKeyEvent(keyEvent({ key: 'F4', code: 'F4', ctrlKey: true }), false)?.id, 'tab.close');
  assert.equal(registry.findByKeyEvent(keyEvent({ key: 'x', code: 'KeyX', altKey: true }), false), undefined);
});

test('the registry rejects duplicate command ids', () => {
  assert.throws(() => createCommandRegistry([command('memo.new'), command('memo.new')]), /memo\.new/);
});

test('the registry rejects two commands with the same shortcut, however it is spelled', () => {
  assert.throws(
    () => createCommandRegistry([command('a', ['Alt-Shift-n']), command('b', ['Shift-Alt-N'])]),
    /Shift-Alt-N|Alt-Shift-n/,
  );
});

test('the registry rejects a malformed shortcut when it is created, not when a key is pressed', () => {
  assert.throws(() => createCommandRegistry([command('a', ['Hyper-n'])]), /shortcut/i);
});

test('a registry without commands is valid and matches nothing', () => {
  const registry = createCommandRegistry([]);
  assert.deepEqual(registry.list(), []);
  assert.equal(registry.findByKeyEvent(keyEvent({ key: 'n', code: 'KeyN', altKey: true }), false), undefined);
});
