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
  '.cm-search': {
    // A flex row on narrow screens, the editor's own flowing layout elsewhere (see tokens.css).
    display: 'var(--search-layout)',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 'var(--space-1)',
    padding: 'var(--space-1) var(--page-gutter)',
    // The editor puts the close button into the top corner; nothing else may end up under it.
    paddingInlineEnd: 'calc(var(--touch-target) + var(--space-1))',
    fontSize: 'var(--font-size-base)',
  },
  '.cm-search .cm-textfield': {
    minBlockSize: 'var(--touch-target)',
    maxInlineSize: '100%',
    fontSize: 'inherit',
  },
  // In the flex row the search field takes whatever the buttons leave.
  '.cm-search [name="search"]': { flex: '1 1 6rem', minInlineSize: '0' },
  // What a narrow screen does without: selecting all matches, the options, and replacing.
  '.cm-search label, .cm-search br, .cm-search [name="select"], .cm-search [name="replace"], .cm-search [name="replaceAll"]': {
    display: 'var(--search-extra-display)',
  },
  '.cm-search .cm-button, .cm-search button[name="close"]': {
    minBlockSize: 'var(--touch-target)',
    minInlineSize: 'var(--touch-target)',
    fontSize: 'inherit',
  },
  // One line of text as tall as a touch target, so the check box and its label are easy to hit.
  '.cm-search label': { lineHeight: 'var(--touch-target)', fontSize: 'var(--font-size-small)' },
});

// Keys the app binds itself through its command table (app/commandTable.ts). The editor must not
// act on them as well, or one key press would do two things. A test compares both lists.
const KEYS_LEFT_TO_THE_APP: ReadonlySet<string> = new Set([
  // "Select parent syntax" in the editor; the app opens the search with it, as ssMemoWeb did.
  'Mod-i',
  // "Insert blank line" in the editor; the app runs the calculator with it, as ssMemoWeb did.
  'Mod-Enter',
  // Redo on Mac and Linux; the app inserts a symbol with it, as ssMemoWeb did. Redo keeps Mod-y.
  'Mod-Shift-z',
  'Ctrl-Shift-z',
]);
// Of the search key bindings only this one is used: the keys that open the panel and step
// through the matches belong to the app, so they also work while the focus is outside the editor.
const SEARCH_PANEL_CLOSE_KEY = 'Escape';

const BINDING_KEY_FIELDS = ['key', 'mac', 'linux', 'win'] as const;

/**
 * The binding without the keys that belong to the app, or undefined if no key is left. Only the
 * offending spelling goes: "Mod-y, on Mac Mod-Shift-z" keeps Mod-y and then applies on Mac too.
 */
function withoutAppKeys(binding: KeyBinding): KeyBinding | undefined {
  const kept: KeyBinding = { ...binding };
  for (const field of BINDING_KEY_FIELDS) {
    const key = kept[field];
    if (key !== undefined && KEYS_LEFT_TO_THE_APP.has(key)) delete kept[field];
  }
  return BINDING_KEY_FIELDS.some((field) => kept[field] !== undefined) ? kept : undefined;
}

/** Everything the editor reacts to by itself. */
export const EDITOR_KEYMAP: readonly KeyBinding[] = [
  ...defaultKeymap,
  ...historyKeymap,
  ...searchKeymap.filter((binding) => binding.key === SEARCH_PANEL_CLOSE_KEY),
].flatMap((binding) => withoutAppKeys(binding) ?? []);

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
