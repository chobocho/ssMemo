// One key press must do one thing. The app's shortcuts (the command table) and the editor's own
// key bindings are defined in different places, and the browser keeps some keys for itself, so
// this test compares all three. ssMemoWeb had such clashes and nobody noticed until a key did
// two things at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { KeyBinding } from '@codemirror/view';
import { COMMAND_DEFINITIONS } from '../../src/app/commandTable.ts';
import { EDITOR_KEYMAP } from '../../src/editor/editorSetup.ts';

type Platform = 'mac' | 'win' | 'linux';
const PLATFORMS: readonly Platform[] = ['mac', 'win', 'linux'];

interface KeyPress {
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  /** Lower-cased key name. */
  key: string;
}

const LETTER_OR_DIGIT = /^[a-z0-9]$/;

/** Reads "Mod-Shift-k" (the app's spelling) and "Shift-Mod-k" or "Cmd-ArrowUp" (the editor's). */
function parseKey(text: string, platform: Platform): KeyPress {
  const parts = text.split('-');
  const key = (parts.pop() ?? '').toLowerCase();
  const press: KeyPress = { ctrl: false, meta: false, alt: false, shift: false, key };
  for (const part of parts) {
    if (part === 'Mod') press[platform === 'mac' ? 'meta' : 'ctrl'] = true;
    else if (part === 'Ctrl') press.ctrl = true;
    else if (part === 'Cmd' || part === 'Meta') press.meta = true;
    else if (part === 'Alt') press.alt = true;
    else if (part === 'Shift') press.shift = true;
    else throw new Error(`Unknown modifier "${part}" in "${text}"`);
  }
  return press;
}

/**
 * Two key presses in one form. For punctuation Shift is left out: which of "," and "<" needs
 * Shift depends on the keyboard layout, so both spellings must count as the same key.
 */
function identity(press: KeyPress): string {
  const shift = LETTER_OR_DIGIT.test(press.key) || press.key.length > 1 ? press.shift : false;
  return `${press.ctrl ? 'ctrl+' : ''}${press.meta ? 'meta+' : ''}${press.alt ? 'alt+' : ''}${shift ? 'shift+' : ''}${press.key}`;
}

/** Every key press the binding reacts to on a platform. */
function editorKeys(binding: KeyBinding, platform: Platform): string[] {
  const text = binding[platform] ?? binding.key;
  if (text === undefined) return [];
  const press = parseKey(text, platform);
  // A binding with a "shift" handler also answers the same key with Shift held.
  return binding.shift ? [identity(press), identity({ ...press, shift: true })] : [identity(press)];
}

function appKeys(platform: Platform): { id: string; shortcut: string; identity: string }[] {
  return COMMAND_DEFINITIONS.flatMap((definition) =>
    definition.shortcuts.map((shortcut) => ({ id: definition.id, shortcut, identity: identity(parseKey(shortcut, platform)) })),
  );
}

test('the helper reads both spellings of a key and tells platforms apart', () => {
  assert.equal(identity(parseKey('Mod-Shift-k', 'win')), 'ctrl+shift+k');
  assert.equal(identity(parseKey('Shift-Mod-k', 'mac')), 'meta+shift+k');
  assert.equal(identity(parseKey('Cmd-ArrowUp', 'mac')), 'meta+arrowup');
  assert.equal(identity(parseKey('Alt-PageDown', 'linux')), 'alt+pagedown');
  // "<" is Shift+"," on many layouts; both must be the same key here.
  assert.equal(identity(parseKey('Mod-Shift-,', 'win')), identity(parseKey('Mod-,', 'win')));
  assert.deepEqual(editorKeys({ key: 'F3', shift: () => true }, 'win'), ['f3', 'shift+f3']);
  assert.deepEqual(editorKeys({ key: 'Mod-y', mac: 'Mod-Shift-z' }, 'mac'), ['meta+shift+z']);
  assert.deepEqual(editorKeys({ linux: 'Ctrl-Shift-z' }, 'win'), []);
});

test('no app shortcut is also a key binding of the editor, on any platform', () => {
  const clashes: string[] = [];
  for (const platform of PLATFORMS) {
    const boundByEditor = new Set(EDITOR_KEYMAP.flatMap((binding) => editorKeys(binding, platform)));
    for (const app of appKeys(platform)) {
      if (boundByEditor.has(app.identity)) clashes.push(`${platform}: ${app.shortcut} (${app.id})`);
    }
  }
  assert.deepEqual(clashes, []);
});

// Keys Chrome and Edge never hand to a page: opening and closing tabs and windows, and moving
// between tabs. A shortcut on one of them would simply never work.
const KEPT_BY_THE_BROWSER = ['ctrl+n', 'ctrl+t', 'ctrl+w', 'ctrl+shift+n', 'ctrl+shift+t', 'ctrl+shift+w', 'ctrl+tab', 'ctrl+shift+tab', 'ctrl+pagedown', 'ctrl+pageup', 'alt+f4'];

test('no app shortcut is a key the browser keeps for itself', () => {
  const lost = appKeys('win').filter((app) => KEPT_BY_THE_BROWSER.includes(app.identity));
  assert.deepEqual(lost.map((app) => `${app.shortcut} (${app.id})`), []);
});

test('the shortcuts ssMemoWeb users know are all there', () => {
  const byShortcut = new Map<string, string>(
    COMMAND_DEFINITIONS.flatMap((definition) => definition.shortcuts.map((shortcut): [string, string] => [shortcut, definition.id])),
  );
  const expected: Record<string, string> = {
    'Mod-f': 'search.open',
    'Mod-i': 'search.open',
    'Mod-<': 'search.previous',
    'Mod-,': 'search.previous',
    'Mod->': 'search.next',
    'Mod-.': 'search.next',
    'Mod-6': 'move.start',
    'Mod-h': 'move.start',
    'Mod-4': 'move.end',
    'Mod-e': 'move.end',
    'Alt-b': 'move.pageUp',
    'Alt-f': 'move.pageDown',
    'Mod-l': 'insert.divider',
    'Mod-Shift-a': 'insert.arrow',
    'Mod-Shift-c': 'insert.check',
    'Mod-Shift-o': 'insert.box',
    'Mod-Shift-r': 'insert.note',
    'Mod-Shift-x': 'insert.cross',
    'Mod-Shift-z': 'insert.green',
  };
  for (const [shortcut, id] of Object.entries(expected)) assert.equal(byShortcut.get(shortcut), id, shortcut);
});
