// The only module that imports CodeMirror packages (a test enforces it).
// Everything the app uses from CodeMirror is re-exported here, so this file shows exactly what
// the bundle takes from it and the rest of the code does not depend on how the packages are split.
export { EditorState } from '@codemirror/state';
export type { Extension } from '@codemirror/state';
export { EditorView, keymap, lineNumbers } from '@codemirror/view';
export { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
