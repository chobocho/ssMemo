// CodeMirror's EditorState works without a DOM, so the editor configuration is tested here.
// Mounting the view needs a real browser and is covered by the manual checklist instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redo, undo } from '@codemirror/commands';
import type { EditorState, StateCommand } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { createEditorState } from '../../src/editor/editorSetup.ts';

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
