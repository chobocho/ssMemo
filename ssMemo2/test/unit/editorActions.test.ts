import { test } from 'node:test';
import assert from 'node:assert/strict';
import { undo } from '@codemirror/commands';
import type { EditorState, TransactionSpec } from '@codemirror/state';
import {
  DIVIDER_LENGTH,
  getCodeToRun,
  getSelectedUrl,
  getUrlToOpen,
  insertDivider,
  insertResultLines,
  insertText,
  joinChunks,
  splitIntoChunks,
  toggleChunks,
} from '../../src/editor/editorActions.ts';
import { CHUNK_DELIMITER } from '../../src/lib/chunks.ts';
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

// --- chunks -----------------------------------------------------------------

test('splitIntoChunks puts a delimiter after every full part', () => {
  const before = stateWith('abcdef', 0);
  const spec = splitIntoChunks(before, 2);
  assert.ok(spec);
  assert.equal(applied(before, spec).doc.toString(), `ab${CHUNK_DELIMITER}cd${CHUNK_DELIMITER}ef`);
});

test('splitIntoChunks leaves a text alone that fits into one part', () => {
  assert.equal(splitIntoChunks(stateWith('abc', 0), 3), undefined);
});

test('joinChunks removes the delimiters, and reports when there are none', () => {
  const before = stateWith(`ab${CHUNK_DELIMITER}cd${CHUNK_DELIMITER}ef`, 0);
  const spec = joinChunks(before);
  assert.ok(spec);
  assert.equal(applied(before, spec).doc.toString(), 'abcdef');
  assert.equal(joinChunks(stateWith('abcdef', 0)), undefined);
});

test('splitting and joining are each one step for undo', () => {
  const original = stateWith('abcdef', 0);
  const splitSpec = splitIntoChunks(original, 2);
  assert.ok(splitSpec);
  const wasSplit = applied(original, splitSpec);
  assert.equal(undone(wasSplit).doc.toString(), 'abcdef');

  const joinSpec = joinChunks(wasSplit);
  assert.ok(joinSpec);
  const wasJoined = applied(wasSplit, joinSpec);
  assert.equal(undone(wasJoined).doc.toString(), wasSplit.doc.toString());
});

test('the cursor stays with the text it was in when delimiters come and go', () => {
  // The cursor sits between "e" and "f"; two delimiters are inserted before it.
  const before = stateWith('abcdef', 5);
  const spec = splitIntoChunks(before, 2);
  assert.ok(spec);
  const after = applied(before, spec);
  const cursor = after.selection.main.head;
  assert.equal(after.doc.sliceString(cursor - 1, cursor + 1), 'ef');

  const joinSpec = joinChunks(after);
  assert.ok(joinSpec);
  assert.equal(applied(after, joinSpec).selection.main.head, 5);
});

test('a cursor exactly where a cut line goes stays in front of it', () => {
  const before = stateWith('abcdef', 4);
  const spec = splitIntoChunks(before, 2);
  assert.ok(spec);
  const after = applied(before, spec);
  const cursor = after.selection.main.head;
  assert.equal(after.doc.sliceString(cursor - 1, cursor), 'd');
  assert.equal(after.doc.sliceString(cursor, cursor + CHUNK_DELIMITER.length), CHUNK_DELIMITER);
});

test('toggleChunks splits a long text, joins a split one and leaves a short one alone', () => {
  const long = stateWith('abcdef', 0);
  const split = toggleChunks(long, 2);
  assert.equal(split.action, 'split');
  const wasSplit = applied(long, split.spec);
  assert.equal(wasSplit.doc.toString(), `ab${CHUNK_DELIMITER}cd${CHUNK_DELIMITER}ef`);

  const joined = toggleChunks(wasSplit, 2);
  assert.equal(joined.action, 'join');
  assert.equal(applied(wasSplit, joined.spec).doc.toString(), 'abcdef');

  const short = stateWith('ab', 0);
  const nothing = toggleChunks(short, 2);
  assert.equal(nothing.action, 'none');
  assert.equal(applied(short, nothing.spec).doc.toString(), 'ab');
});

// --- code to run and its result ---------------------------------------------

test('the selected text is what gets run, whichever way it was selected', () => {
  const text = 'note\n1 + 2\nmore';
  assert.deepEqual(getCodeToRun(stateWith(text, 5, 10)), { code: '1 + 2', end: 10 });
  assert.deepEqual(getCodeToRun(stateWith(text, 10, 5)), { code: '1 + 2', end: 10 });
  // Several lines at once.
  assert.deepEqual(getCodeToRun(stateWith('x = 1\nx + 1\nrest', 0, 11)), { code: 'x = 1\nx + 1', end: 11 });
});

test('without a selection the line with the cursor is run', () => {
  const text = 'note\n1 + 2\nmore';
  for (const cursor of [5, 7, 10]) assert.deepEqual(getCodeToRun(stateWith(text, cursor)), { code: '1 + 2', end: 10 }, String(cursor));
  assert.deepEqual(getCodeToRun(stateWith(text, 0)), { code: 'note', end: 4 });
  assert.deepEqual(getCodeToRun(stateWith('a\n\nb', 2)), { code: '', end: 2 });
  assert.deepEqual(getCodeToRun(stateWith('', 0)), { code: '', end: 0 });
});

test('result lines go on lines of their own right below the code', () => {
  const before = stateWith('note\n1 + 2\nmore', 7);
  const after = applied(before, insertResultLines(before, 10, ['# 3']));
  assert.equal(after.doc.toString(), 'note\n1 + 2\n# 3\nmore');
  // The cursor ends up behind the result.
  assert.equal(after.selection.main.head, 'note\n1 + 2\n# 3'.length);
});

test('several result lines stay together, and the end of the document needs no line break after them', () => {
  const before = stateWith('x = 1\nx + 1', 0);
  const after = applied(before, insertResultLines(before, 11, ['# x = 1', '# 2']));
  assert.equal(after.doc.toString(), 'x = 1\nx + 1\n# x = 1\n# 2');
});

test('a selection that ended with a line break does not glue the result to the next line', () => {
  // ssMemoWeb produced "# 3more" here.
  const before = stateWith('1 + 2\nmore', 0, 6);
  const after = applied(before, insertResultLines(before, 6, ['# 3']));
  assert.equal(after.doc.toString(), '1 + 2\n# 3\nmore');
});

test('a position beyond the document is treated as its end, and no lines change nothing', () => {
  const before = stateWith('1 + 2', 0);
  assert.equal(applied(before, insertResultLines(before, 999, ['# 3'])).doc.toString(), '1 + 2\n# 3');
  assert.equal(applied(before, insertResultLines(before, 5, [])).doc.toString(), '1 + 2');
});

test('an inserted result is one step for undo', () => {
  const before = stateWith('1 + 2', 0);
  assert.equal(undone(applied(before, insertResultLines(before, 5, ['# 3']))).doc.toString(), '1 + 2');
});

// --- web addresses ----------------------------------------------------------

test('a selected web address is the one to open', () => {
  const text = 'see www.example.com/a now';
  const selected = stateWith(text, 4, 21);
  assert.equal(getUrlToOpen(selected), 'https://www.example.com/a');
  assert.equal(getSelectedUrl(selected), 'https://www.example.com/a');
});

test('a selection that is not exactly one web address opens nothing', () => {
  const text = 'see www.example.com/a now';
  assert.equal(getUrlToOpen(stateWith(text, 0, 21)), undefined);
  assert.equal(getSelectedUrl(stateWith(text, 0, 3)), undefined);
});

test('without a selection the address under the cursor is taken, but only by the command', () => {
  const state = stateWith('see https://example.com/a now', 10);
  assert.equal(getUrlToOpen(state), 'https://example.com/a');
  // A right click needs a selection: the cursor alone must not turn it into "open".
  assert.equal(getSelectedUrl(state), undefined);
  assert.equal(getUrlToOpen(stateWith('see https://example.com/a now', 1)), undefined);
});

test('the cursor on the second line finds the address on that line', () => {
  const text = 'first line\nsee https://example.com/b';
  assert.equal(getUrlToOpen(stateWith(text, text.length - 3)), 'https://example.com/b');
});
