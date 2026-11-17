// Edits the app makes to a document on the user's behalf. Each function looks at an editor state
// and returns the change to apply, so it can be tested without a view, and because the change
// goes through the editor it is undoable and autosaved like typing. (In ssMemoWeb such edits
// replaced the whole text area and wiped the undo history.)
import type { EditorState, TransactionSpec } from './cm6.ts';

/** Number of dashes in a divider line, as in ssMemoWeb. */
export const DIVIDER_LENGTH = 50;
const DIVIDER = '─'.repeat(DIVIDER_LENGTH);
const LINE_BREAK = '\n';
// Marks the change as input, which is what lets undo group and report it like typed text.
const INPUT_EVENT = 'input';

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
