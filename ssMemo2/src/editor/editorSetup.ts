// Editor configuration: which CodeMirror features are on, how the editor is themed, and the
// facts about a document that the status bar shows.
import { Compartment, EditorState, EditorView, defaultKeymap, history, historyKeymap, keymap, lineNumbers } from './cm6.ts';
import type { Extension, StateEffect } from './cm6.ts';

export interface EditorStateOptions {
  /** Called by a mounted editor after its content changed. */
  onDocChange?: () => void;
  /** Called by a mounted editor after its content or its selection changed. */
  onViewUpdate?: () => void;
  /** Wrap long lines instead of scrolling sideways. Defaults to true: memos are prose. */
  lineWrapping?: boolean;
}

export interface EditorStats {
  /** Length in UTF-16 code units, counting each line break as one. */
  characters: number;
  lines: number;
  /** 1-based position of the cursor (the moving end of the selection). */
  cursorLine: number;
  cursorColumn: number;
  selectedCharacters: number;
}

// The theme only references CSS variables, so every size stays in tokens.css and the font-size
// setting can change a variable without reconfiguring the editor.
const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--editor-font-size)' },
  // The caret already shows focus; an outline around the whole editing area is only noise.
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--editor-font-family)', lineHeight: 'var(--editor-line-height)' },
});

// One compartment for all states, so the same effect switches wrapping in any of them without
// touching their text or undo history.
const lineWrappingCompartment = new Compartment();

function lineWrappingExtension(enabled: boolean): Extension {
  return enabled ? EditorView.lineWrapping : [];
}

/** An effect that turns line wrapping on or off in a state created by createEditorState. */
export function lineWrappingEffect(enabled: boolean): StateEffect<unknown> {
  return lineWrappingCompartment.reconfigure(lineWrappingExtension(enabled));
}

/** Editor state for `doc`. Needs no DOM, so the configuration can be tested headlessly. */
export function createEditorState(doc: string, options: EditorStateOptions = {}): EditorState {
  const { onDocChange, onViewUpdate, lineWrapping = true } = options;
  return EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      history(),
      lineWrappingCompartment.of(lineWrappingExtension(lineWrapping)),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      editorTheme,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onDocChange?.();
        if (update.docChanged || update.selectionSet) onViewUpdate?.();
      }),
    ],
  });
}

/** O(log n) in the document size for the cursor position; the rest is constant. */
export function getEditorStats(state: EditorState): EditorStats {
  const cursor = state.selection.main.head;
  const line = state.doc.lineAt(cursor);
  return {
    characters: state.doc.length,
    lines: state.doc.lines,
    cursorLine: line.number,
    cursorColumn: cursor - line.from + 1,
    selectedCharacters: state.selection.ranges.reduce((total, range) => total + (range.to - range.from), 0),
  };
}
