// Editor configuration: which CodeMirror features are on, how the editor is themed, and the
// facts about a document that the status bar shows.
import {
  Compartment,
  EditorState,
  EditorView,
  defaultKeymap,
  history,
  historyKeymap,
  keymap,
  lineNumbers,
  search,
  searchKeymap,
} from './cm6.ts';
import type { Extension, KeyBinding, StateEffect } from './cm6.ts';

export interface EditorStateOptions {
  /** Called by a mounted editor after its content changed. */
  onDocChange?: () => void;
  /** Called by a mounted editor after its content or its selection changed. */
  onViewUpdate?: () => void;
  /** Wrap long lines instead of scrolling sideways. Defaults to true: memos are prose. */
  lineWrapping?: boolean;
  /** Translations of the editor's own texts (the search panel), keyed by the English original. */
  phrases?: Readonly<Record<string, string>>;
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
  // The search panel is made for a mouse; these rules give its controls the size of a finger.
  // The text size stays at the page's base size: below 16 CSS px mobile browsers zoom in on focus.
  '.cm-search': { padding: 'var(--space-1) var(--page-gutter)', fontSize: 'var(--font-size-base)' },
  '.cm-search .cm-textfield': {
    minBlockSize: 'var(--touch-target)',
    maxInlineSize: '100%',
    fontSize: 'inherit',
  },
  '.cm-search .cm-button, .cm-search button[name="close"]': {
    minBlockSize: 'var(--touch-target)',
    minInlineSize: 'var(--touch-target)',
    fontSize: 'inherit',
  },
  '.cm-search label': {
    display: 'inline-flex',
    alignItems: 'center',
    minBlockSize: 'var(--touch-target)',
    fontSize: 'var(--font-size-small)',
  },
});

// Keys the app binds itself through its command table (app/commandTable.ts). The editor must not
// act on them as well, or one key press would do two things. A test compares both lists.
const KEYS_LEFT_TO_THE_APP: ReadonlySet<string> = new Set([
  // "Select parent syntax" in the editor; the app opens the search with it, as ssMemoWeb did.
  'Mod-i',
]);
// Of the search key bindings only this one is used: the keys that open the panel and step
// through the matches belong to the app, so they also work while the focus is outside the editor.
const SEARCH_PANEL_CLOSE_KEY = 'Escape';

function isLeftToTheApp(binding: KeyBinding): boolean {
  return [binding.key, binding.mac, binding.linux, binding.win].some((key) => key !== undefined && KEYS_LEFT_TO_THE_APP.has(key));
}

/** Everything the editor reacts to by itself. */
export const EDITOR_KEYMAP: readonly KeyBinding[] = [
  ...defaultKeymap,
  ...historyKeymap,
  ...searchKeymap.filter((binding) => binding.key === SEARCH_PANEL_CLOSE_KEY),
].filter((binding) => !isLeftToTheApp(binding));

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
  const { onDocChange, onViewUpdate, lineWrapping = true, phrases = {} } = options;
  return EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      history(),
      lineWrappingCompartment.of(lineWrappingExtension(lineWrapping)),
      // At the top: on a phone the bottom of the editor is where the keyboard is.
      search({ top: true }),
      EditorState.phrases.of(phrases),
      keymap.of(EDITOR_KEYMAP),
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
