// Edits the app makes to a document on the user's behalf. Each function looks at an editor state
// and returns the change to apply, so it can be tested without a view, and because the change
// goes through the editor it is undoable and autosaved like typing. (In ssMemoWeb such edits
// replaced the whole text area and wiped the undo history.)
import { CHUNK_DELIMITER, decideChunkAction, planJoin, planSplit } from '../lib/chunks.ts';
import type { ChunkAction } from '../lib/chunks.ts';
import { findUrlAt, toWebUrl } from '../lib/url.ts';
import { isolateHistory } from './cm6.ts';
import type { EditorState, TransactionSpec } from './cm6.ts';

/** Number of dashes in a divider line, as in ssMemoWeb. */
export const DIVIDER_LENGTH = 50;
const DIVIDER = '─'.repeat(DIVIDER_LENGTH);
const LINE_BREAK = '\n';
// Marks the change as input, which is what lets undo group and report it like typed text.
const INPUT_EVENT = 'input';
// The history merges edits that follow each other quickly. A command that rewrites the whole
// document is undone on its own, however soon after something else it ran.
const OWN_UNDO_STEP = isolateHistory.of('full');

/** Replaces the selection with `text` and puts the cursor behind it. */
export function insertText(state: EditorState, text: string): TransactionSpec {
  return { ...state.replaceSelection(text), scrollIntoView: true, userEvent: INPUT_EVENT };
}

/**
 * Puts a divider at the cursor, on a line of its own: line breaks are added around it only where
 * there is text on the same line. A selection is replaced.
 */
export function insertDivider(state: EditorState): TransactionSpec {
  const { from, to } = state.selection.main;
  const textBefore = from > 0 && state.sliceDoc(from - 1, from) !== LINE_BREAK;
  const textAfter = to < state.doc.length && state.sliceDoc(to, to + 1) !== LINE_BREAK;
  const insert = `${textBefore ? LINE_BREAK : ''}${DIVIDER}${textAfter ? LINE_BREAK : ''}`;
  return {
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    scrollIntoView: true,
    userEvent: INPUT_EVENT,
  };
}

/**
 * Puts cut lines into the document so no part is longer than `length`; undefined if it is short
 * enough already. Only the delimiters are inserted, so the cursor stays with its text.
 */
export function splitIntoChunks(state: EditorState, length: number): TransactionSpec | undefined {
  const cuts = planSplit(state.doc.toString(), length);
  if (cuts.length === 0) return undefined;
  return { changes: cuts.map((from) => ({ from, insert: CHUNK_DELIMITER })), userEvent: INPUT_EVENT, annotations: OWN_UNDO_STEP };
}

/** Takes every cut line out again; undefined if the document has none. */
export function joinChunks(state: EditorState): TransactionSpec | undefined {
  const ranges = planJoin(state.doc.toString());
  if (ranges.length === 0) return undefined;
  return { changes: ranges, userEvent: 'delete', annotations: OWN_UNDO_STEP };
}

/** What the cut-line command does to this document, and the change that does it (empty for 'none'). */
export function toggleChunks(state: EditorState, length: number): { action: ChunkAction; spec: TransactionSpec } {
  const action = decideChunkAction(state.doc.toString(), length);
  const spec = action === 'split' ? splitIntoChunks(state, length) : action === 'join' ? joinChunks(state) : undefined;
  return { action, spec: spec ?? {} };
}

/** A piece of the document to run as a calculation, and where its result goes. */
export interface CodeToRun {
  code: string;
  /** Position in the document right behind the code. */
  end: number;
}

/** What "run" applies to: the selected text, or without a selection the line the cursor is on. */
export function getCodeToRun(state: EditorState): CodeToRun {
  const { from, to, empty, head } = state.selection.main;
  if (!empty) return { code: state.sliceDoc(from, to), end: to };
  const line = state.doc.lineAt(head);
  return { code: line.text, end: line.to };
}

/**
 * Puts `lines` right behind position `end`, on lines of their own: a line break is added before
 * them unless `end` is the start of a line, and after them unless a line ends there anyway.
 * (ssMemoWeb left the second one out and glued the result to the following line.)
 */
export function insertResultLines(state: EditorState, end: number, lines: readonly string[]): TransactionSpec {
  if (lines.length === 0) return {};
  const at = Math.min(Math.max(end, 0), state.doc.length);
  const textBefore = at > 0 && state.sliceDoc(at - 1, at) !== LINE_BREAK;
  const textAfter = at < state.doc.length && state.sliceDoc(at, at + 1) !== LINE_BREAK;
  const insert = `${textBefore ? LINE_BREAK : ''}${lines.join(LINE_BREAK)}${textAfter ? LINE_BREAK : ''}`;
  return {
    changes: { from: at, insert },
    // Behind the result itself, not behind the line break that separates it from what follows.
    selection: { anchor: at + insert.length - (textAfter ? LINE_BREAK.length : 0) },
    scrollIntoView: true,
    userEvent: INPUT_EVENT,
    annotations: OWN_UNDO_STEP,
  };
}

// No web address is longer than this; a larger selection is not even looked at.
const MAX_URL_LENGTH = 2048;

/** The web address that is selected, if the selection is exactly one. */
export function getSelectedUrl(state: EditorState): string | undefined {
  const { from, to } = state.selection.main;
  return from === to || to - from > MAX_URL_LENGTH ? undefined : toWebUrl(state.sliceDoc(from, to));
}

/** The web address to open: the selected one, or without a selection the one the cursor is in. */
export function getUrlToOpen(state: EditorState): string | undefined {
  const { empty, head } = state.selection.main;
  if (!empty) return getSelectedUrl(state);
  const line = state.doc.lineAt(head);
  return findUrlAt(line.text, head - line.from);
}
