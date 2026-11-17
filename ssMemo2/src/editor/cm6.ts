// The only module that imports CodeMirror packages (a test enforces it).
// Everything the app uses from CodeMirror is re-exported here, so this file shows exactly what
// the bundle takes from it and the rest of the code does not depend on how the packages are split.
export { Compartment, EditorState } from '@codemirror/state';
export type { Extension, StateEffect, TransactionSpec } from '@codemirror/state';
export { EditorView, keymap, lineNumbers } from '@codemirror/view';
export type { KeyBinding } from '@codemirror/view';
export {
  cursorDocEnd,
  cursorDocStart,
  cursorPageDown,
  cursorPageUp,
  defaultKeymap,
  history,
  historyKeymap,
} from '@codemirror/commands';
export {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  search,
  searchKeymap,
  searchPanelOpen,
  setSearchQuery,
} from '@codemirror/search';
