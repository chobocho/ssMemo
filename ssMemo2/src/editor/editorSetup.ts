// Editor configuration: which CodeMirror features are on and how the editor is themed.
import { EditorState, EditorView, defaultKeymap, history, historyKeymap, keymap, lineNumbers } from './cm6.ts';
import type { Extension } from './cm6.ts';

/** What the rest of the app may do with the mounted editor. */
export interface EditorHandle {
  getText(): string;
  /** Shows other text. Not reported as an edit, and undo does not lead back to the old text. */
  setText(text: string): void;
}

// The theme only references CSS variables, so every size stays in tokens.css and a later
// font-size setting can change the variables without reconfiguring the editor.
const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--editor-font-size)' },
  // The caret already shows focus; an outline around the whole editing area is only noise.
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--editor-font-family)', lineHeight: 'var(--editor-line-height)' },
});

function createEditorExtensions(onDocChange: () => void): Extension[] {
  return [
    lineNumbers(),
    history(),
    // Memos are prose: wrap long lines instead of scrolling sideways.
    EditorView.lineWrapping,
    keymap.of([...defaultKeymap, ...historyKeymap]),
    editorTheme,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onDocChange();
    }),
  ];
}

/**
 * Editor state for `doc`. Needs no DOM, so the configuration can be tested headlessly.
 * `onDocChange` is called by a mounted editor whenever its content changes.
 */
export function createEditorState(doc: string, onDocChange: () => void = () => undefined): EditorState {
  return EditorState.create({ doc, extensions: createEditorExtensions(onDocChange) });
}

/** Creates an empty editor inside `parent`. `onDocChange` is called after every content change. */
export function mountEditor(parent: HTMLElement, onDocChange: () => void): EditorHandle {
  const view = new EditorView({ state: createEditorState('', onDocChange), parent });
  return {
    getText: () => view.state.doc.toString(),
    // A fresh state instead of a change transaction: replacing the state fires no update
    // listener, so loading a memo is not mistaken for an edit, and it starts a new undo history.
    setText: (text) => view.setState(createEditorState(text, onDocChange)),
  };
}
