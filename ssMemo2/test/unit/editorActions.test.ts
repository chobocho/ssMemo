import { test } from 'node:test';
import assert from 'node:assert/strict';
import { undo } from '@codemirror/commands';
import type { EditorState, TransactionSpec } from '@codemirror/state';
import { DIVIDER_LENGTH, insertDivider, insertText } from '../../src/editor/editorActions.ts';
import { createEditorState } from '../../src/editor/editorSetup.ts';

const DIVIDER = String.fromCharCode(0x2500).repeat(DIVIDER_LENGTH);

/** A state with the cursor at `anchor`, or a selection from `anchor` to `head`. */
function stateWith(text: string, anchor: number, head = anchor): EditorState {
  return createEditorState(text).update({ selection: { anchor, head } }).state;
}

function applied(state: EditorState, spec: TransactionSpec): EditorState {
  return state.update(spec).state;
}

function undone(state: EditorState): EditorState {
  let result = state;
  undo({ state, dispatch: (transaction) => { result = transaction.state; } });
  return result;
}

// --- insertText -------------------------------------------------------------

test('insertText puts the text at the cursor and the cursor behind it', () => {
  const state = applied(stateWith('ab', 1), insertText(stateWith('ab', 1), 'X'));
  assert.equal(state.doc.toString(), 'aXb');
  assert.equal(state.selection.main.head, 2);
  assert.equal(state.selection.main.empty, true);
});

test('insertText replaces what is selected, whichever way it was selected', () => {
  for (const [anchor, head] of [[1, 3], [3, 1]] as const) {
    const before = stateWith('abcd', anchor, head);
    const state = applied(before, insertText(before, 'X'));
    assert.equal(state.doc.toString(), 'aXd');
    assert.equal(state.selection.main.head, 2);
  }
});

test('insertText works in an empty document and at both ends', () => {
  const empty = stateWith('', 0);
  assert.equal(applied(empty, insertText(empty, 'X')).doc.toString(), 'X');
  const atStart = stateWith('ab', 0);
  assert.equal(applied(atStart, insertText(atStart, 'X')).doc.toString(), 'Xab');
  const atEnd = stateWith('ab', 2);
  assert.equal(applied(atEnd, insertText(atEnd, 'X')).doc.toString(), 'abX');
});

test('insertText counts a character outside the basic plane as the two units it is', () => {
  const before = stateWith('ab', 1);
  const state = applied(before, insertText(before, '\u{1F7E9}'));
  assert.equal(state.doc.toString(), 'a\u{1F7E9}b');
  assert.equal(state.selection.main.head, 3);
});

test('an insertion is one step for undo, which ssMemoWeb lost entirely', () => {
  const before = stateWith('abcd', 1, 3);
  const after = applied(before, insertText(before, 'X'));
  const back = undone(after);
  assert.equal(back.doc.toString(), 'abcd');
});

// --- insertDivider ----------------------------------------------------------

function withDivider(text: string, anchor: number, head = anchor): { text: string; cursor: number } {
  const before = stateWith(text, anchor, head);
  const after = applied(before, insertDivider(before));
  return { text: after.doc.toString(), cursor: after.selection.main.head };
}

test('the divider is a line of fifty box-drawing dashes', () => {
  assert.equal(DIVIDER.length, 50);
  assert.deepEqual(withDivider('', 0), { text: DIVIDER, cursor: 50 });
});

test('in the middle of a line the divider gets a line of its own', () => {
  assert.deepEqual(withDivider('ab', 1), { text: `a\n${DIVIDER}\nb`, cursor: 1 + 1 + 50 + 1 });
});

test('no blank lines are added where line breaks already are', () => {
  // The cursor is at the start of the second line: a line break before it, text after it.
  assert.equal(withDivider('a\nb', 2).text, `a\n${DIVIDER}\nb`);
  // On an empty line between two lines.
  assert.equal(withDivider('a\n\nb', 2).text, `a\n${DIVIDER}\nb`);
});

test('at the very start and the very end no line break is added on the outer side', () => {
  assert.equal(withDivider('ab', 0).text, `${DIVIDER}\nab`);
  assert.equal(withDivider('ab', 2).text, `ab\n${DIVIDER}`);
  assert.equal(withDivider('ab\n', 3).text, `ab\n${DIVIDER}`);
});

test('the divider replaces the selection', () => {
  assert.deepEqual(withDivider('abcd', 1, 3), { text: `a\n${DIVIDER}\nd`, cursor: 1 + 1 + 50 + 1 });
});

test('inserting a divider is one step for undo', () => {
  const before = stateWith('ab', 1);
  assert.equal(undone(applied(before, insertDivider(before))).doc.toString(), 'ab');
});
