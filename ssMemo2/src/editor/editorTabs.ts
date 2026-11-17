// One editor view shared by all tabs. Each tab has its own EditorState, which carries its text,
// selection and undo history, so switching tabs loses none of them. States are created when a
// tab is first shown, not when it is opened, so many restored tabs cost nothing until visited.
import { EditorView } from './cm6.ts';
import type { EditorState, StateEffect, TransactionSpec } from './cm6.ts';
import { createEditorState } from './editorSetup.ts';

/** The members of CodeMirror's EditorView this module uses; a test can supply a stand-in. */
export interface EditorViewPort {
  readonly state: EditorState;
  /** Replaces the whole state. Fires no update listeners. */
  setState(state: EditorState): void;
  dispatch(spec: TransactionSpec): void;
  /** An effect that restores the current scroll position when dispatched for the same document. */
  scrollSnapshot(): StateEffect<unknown>;
}

export interface EditorTabs {
  /**
   * Makes `tabId` the visible document. The first time a tab is shown it starts from
   * `initialText`; afterwards the text it had when it was left is kept and `initialText` is ignored.
   */
  show(tabId: string, initialText: string): void;
  /** Current text of a tab, whether visible or not; undefined if the tab is unknown. */
  getText(tabId: string): string | undefined;
  /** Forgets a tab. If it is the visible one, another tab has to be shown next. */
  remove(tabId: string): void;
  getActiveTabId(): string | undefined;
}

export function createEditorTabs(view: EditorViewPort, createState: (text: string) => EditorState): EditorTabs {
  const states = new Map<string, EditorState>();
  const scrollPositions = new Map<string, StateEffect<unknown>>();
  let activeTabId: string | undefined;

  // The view owns the live state of the visible tab; it is copied back when the tab is left.
  const storeActiveTab = (): void => {
    if (activeTabId === undefined) return;
    states.set(activeTabId, view.state);
    scrollPositions.set(activeTabId, view.scrollSnapshot());
  };

  return {
    show(tabId, initialText) {
      if (tabId === activeTabId) return;
      storeActiveTab();
      const state = states.get(tabId) ?? createState(initialText);
      states.set(tabId, state);
      activeTabId = tabId;
      view.setState(state);
      const scrollPosition = scrollPositions.get(tabId);
      if (scrollPosition) view.dispatch({ effects: scrollPosition });
    },

    getText(tabId) {
      const state = tabId === activeTabId ? view.state : states.get(tabId);
      return state?.doc.toString();
    },

    remove(tabId) {
      states.delete(tabId);
      scrollPositions.delete(tabId);
      if (activeTabId === tabId) activeTabId = undefined;
    },

    getActiveTabId: () => activeTabId,
  };
}

/**
 * Creates the editor inside `parent`. `onDocChange` is called with the id of the visible tab
 * after every change the user makes to it.
 */
export function mountEditorTabs(parent: HTMLElement, onDocChange: (tabId: string) => void): EditorTabs {
  const tabsRef: { current?: EditorTabs } = {};
  const createState = (text: string): EditorState =>
    createEditorState(text, () => {
      const tabId = tabsRef.current?.getActiveTabId();
      if (tabId !== undefined) onDocChange(tabId);
    });
  // Until the first tab is shown the view holds an empty placeholder state.
  const view = new EditorView({ state: createState(''), parent });
  tabsRef.current = createEditorTabs(view, createState);
  return tabsRef.current;
}
