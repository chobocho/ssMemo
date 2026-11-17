// CodeMirror's EditorState works without a DOM, so the editor configuration is tested here.
// Mounting the view needs a real browser and is covered by the manual checklist instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redo, undo } from '@codemirror/commands';
import type { EditorState, StateCommand } from '@codemirror/state';
import { SearchQuery, getSearchQuery, searchPanelOpen, setSearchQuery } from '@codemirror/search';
import { EditorView, keymap } from '@codemirror/view';
import { createEditorState, getEditorStats, lineWrappingEffect } from '../../src/editor/editorSetup.ts';

/** Runs a command against a state and returns the resulting state. */
function run(command: StateCommand, state: EditorState): { handled: boolean; state: EditorState } {
  let next = state;
  const handled = command({
    state,
    dispatch: (transaction) => {
      next = transaction.state;
    },
  });
  return { handled, state: next };
}

function typeAtStart(state: EditorState, text: string): EditorState {
  return state.update({ changes: { from: 0, insert: text }, userEvent: 'input.type' }).state;
}

test('createEditorState holds the given text', () => {
  const state = createEditorState('first\nsecond');
  assert.equal(state.doc.toString(), 'first\nsecond');
  assert.equal(state.doc.lines, 2);
});

test('an empty document is one empty line', () => {
  const state = createEditorState('');
  assert.equal(state.doc.length, 0);
  assert.equal(state.doc.lines, 1);
});

test('CRLF and lone CR input is counted as line breaks', () => {
  // ssMemoWeb miscounted lines for CRLF files; CodeMirror splits on every line-break style.
  const state = createEditorState('a\r\nb\rc\nd');
  assert.equal(state.doc.lines, 4);
  assert.equal(state.doc.toString(), 'a\nb\nc\nd');
});

test('the document is editable', () => {
  const state = createEditorState('text');
  assert.equal(state.readOnly, false);
  assert.equal(state.facet(EditorView.editable), true);
});

test('typing can be undone and redone', () => {
  const original = createEditorState('memo');
  const typed = typeAtStart(original, 'new ');
  assert.equal(typed.doc.toString(), 'new memo');

  const undone = run(undo, typed);
  assert.equal(undone.handled, true);
  assert.equal(undone.state.doc.toString(), 'memo');

  const redone = run(redo, undone.state);
  assert.equal(redone.handled, true);
  assert.equal(redone.state.doc.toString(), 'new memo');
});

test('undo on an untouched document does nothing', () => {
  const result = run(undo, createEditorState('memo'));
  assert.equal(result.handled, false);
  assert.equal(result.state.doc.toString(), 'memo');
});

test('long lines wrap instead of scrolling sideways', () => {
  const attributes = createEditorState('').facet(EditorView.contentAttributes);
  const wraps = attributes.some((entry) => typeof entry === 'object' && entry.class === 'cm-lineWrapping');
  assert.equal(wraps, true);
});

test('standard editing and history keys are bound', () => {
  const boundKeys = new Set(
    createEditorState('')
      .facet(keymap)
      .flat()
      .map((binding) => binding.key),
  );
  for (const key of ['Enter', 'Backspace', 'Mod-a', 'Mod-z', 'Mod-y']) {
    assert.equal(boundKeys.has(key), true, `${key} is not bound`);
  }
});

function wraps(state: EditorState): boolean {
  return state.facet(EditorView.contentAttributes).some((entry) => typeof entry === 'object' && entry.class === 'cm-lineWrapping');
}

test('line wrapping can be switched off when the state is created', () => {
  assert.equal(wraps(createEditorState('text', { lineWrapping: false })), false);
  assert.equal(wraps(createEditorState('text', { lineWrapping: true })), true);
});

test('line wrapping can be switched on an existing state without losing text or history', () => {
  const typed = typeAtStart(createEditorState('memo'), 'new ');
  const unwrapped = typed.update({ effects: lineWrappingEffect(false) }).state;
  assert.equal(wraps(unwrapped), false);
  assert.equal(unwrapped.doc.toString(), 'new memo');
  assert.equal(run(undo, unwrapped).state.doc.toString(), 'memo');
  assert.equal(wraps(unwrapped.update({ effects: lineWrappingEffect(true) }).state), true);
});

test('getEditorStats counts characters and lines and locates the cursor', () => {
  const state = createEditorState('first\nsecond line\nthird').update({ selection: { anchor: 9 } }).state;
  assert.deepEqual(getEditorStats(state), { characters: 23, lines: 3, cursorLine: 2, cursorColumn: 4, selectedCharacters: 0 });
});

test('getEditorStats describes an empty document', () => {
  assert.deepEqual(getEditorStats(createEditorState('')), { characters: 0, lines: 1, cursorLine: 1, cursorColumn: 1, selectedCharacters: 0 });
});

test('getEditorStats reports the size of the selection, whichever way it was dragged', () => {
  const forward = createEditorState('abcdef').update({ selection: { anchor: 1, head: 4 } }).state;
  const backward = createEditorState('abcdef').update({ selection: { anchor: 4, head: 1 } }).state;
  assert.equal(getEditorStats(forward).selectedCharacters, 3);
  assert.equal(getEditorStats(backward).selectedCharacters, 3);
  // The cursor is where the selection ends, not where it started.
  assert.equal(getEditorStats(backward).cursorColumn, 2);
});

// --- search -----------------------------------------------------------------

function boundKeys(state: EditorState): Set<string | undefined> {
  return new Set(state.facet(keymap).flat().flatMap((binding) => [binding.key, binding.mac, binding.linux, binding.win]));
}

test('a document can be searched: the query is part of its state and the panel starts closed', () => {
  const state = createEditorState('one two one');
  assert.equal(searchPanelOpen(state), false);
  const searching = state.update({ effects: setSearchQuery.of(new SearchQuery({ search: 'one' })) }).state;
  assert.equal(getSearchQuery(searching).search, 'one');
  // Setting a query is not an edit.
  assert.equal(searching.doc.toString(), 'one two one');
});

test('Escape closes the search panel, while the keys that open and step through it are left to the app', () => {
  const keys = boundKeys(createEditorState(''));
  assert.equal(keys.has('Escape'), true);
  // The app binds these itself (see commandTable.ts) so they also work outside the editor.
  for (const key of ['Mod-f', 'Mod-i', 'F3', 'Mod-g']) assert.equal(keys.has(key), false, key);
});

test('editing keys are still bound after the search keys were taken out', () => {
  const keys = boundKeys(createEditorState(''));
  for (const key of ['Enter', 'Backspace', 'Mod-a', 'Mod-z', 'Mod-y', 'Mod-[']) assert.equal(keys.has(key), true, key);
});

test('the texts of the editor itself are translated with the given phrases', () => {
  const translated = createEditorState('', { phrases: { Find: 'Suchen', next: 'weiter' } });
  assert.equal(translated.phrase('Find'), 'Suchen');
  assert.equal(translated.phrase('next'), 'weiter');
  // Without phrases the editor falls back to its English originals.
  assert.equal(createEditorState('').phrase('Find'), 'Find');
});
