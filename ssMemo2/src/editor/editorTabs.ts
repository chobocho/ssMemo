// One editor view shared by all tabs. Each tab has its own EditorState, which carries its text,
// selection and undo history, so switching tabs loses none of them. States are created when a
// tab is first shown, not when it is opened, so many restored tabs cost nothing until visited.
import { EditorView } from './cm6.ts';
import type { EditorState, StateEffect, TransactionSpec } from './cm6.ts';
import { createEditorState, getEditorStats, lineWrappingEffect } from './editorSetup.ts';
import type { EditorStats } from './editorSetup.ts';

/** The members of CodeMirror's EditorView this module uses; a test can supply a stand-in. */
export interface EditorViewPort {
  readonly state: EditorState;
  /** Replaces the whole state. Fires no update listeners. */
  setState(state: EditorState): void;
  dispatch(spec: TransactionSpec): void;
  /** An effect that restores the current scroll position when dispatched for the same document. */
  scrollSnapshot(): StateEffect<unknown>;
  /** Asks the view to measure its content again, e.g. after the font size changed. */
  requestMeasure(): void;
}

export interface EditorTabsOptions {
  createState(text: string, lineWrapping: boolean): EditorState;
  lineWrappingEffect(enabled: boolean): StateEffect<unknown>;
  /** Initial line-wrapping setting. */
  lineWrapping: boolean;
  /** Called after another tab became the visible one. */
  onShow?: () => void;
}

export interface EditorTabs {
  /**
   * Makes `tabId` the visible document. The first time a tab is shown it starts from
   * `initialText` with the cursor at `initialCursor` (moved into the text if it lies outside);
   * afterwards the tab is shown as it was left and both arguments are ignored.
   */
  show(tabId: string, initialText: string, initialCursor?: number): void;
  /** Current text of a tab, whether visible or not; undefined if the tab is unknown. */
  getText(tabId: string): string | undefined;
  /** Forgets a tab. If it is the visible one, another tab has to be shown next. */
  remove(tabId: string): void;
  getActiveTabId(): string | undefined;
  /** Cursor offset of a tab, visible or not; undefined if the tab is unknown. */
  getCursor(tabId: string): number | undefined;
  /** Applies to every tab: the visible one, those in the background and those opened later. */
  setLineWrapping(enabled: boolean): void;
  /** Facts about the visible tab; undefined while no tab is shown. */
  getStats(): EditorStats | undefined;
  /** Call after something outside the editor changed its text metrics (the font size). */
  remeasure(): void;
}

export function createEditorTabs(view: EditorViewPort, options: EditorTabsOptions): EditorTabs {
  const states = new Map<string, EditorState>();
  const scrollPositions = new Map<string, StateEffect<unknown>>();
  let activeTabId: string | undefined;
  let lineWrapping = options.lineWrapping;

  // The view owns the live state of the visible tab; it is copied back when the tab is left.
  const storeActiveTab = (): void => {
    if (activeTabId === undefined) return;
    states.set(activeTabId, view.state);
    scrollPositions.set(activeTabId, view.scrollSnapshot());
  };

  return {
    show(tabId, initialText, initialCursor = 0) {
      if (tabId === activeTabId) return;
      storeActiveTab();
      const knownState = states.get(tabId);
      const state = knownState ?? options.createState(initialText, lineWrapping);
      states.set(tabId, state);
      activeTabId = tabId;
      view.setState(state);

      const scrollPosition = scrollPositions.get(tabId);
      if (scrollPosition) {
        view.dispatch({ effects: scrollPosition });
      } else if (!knownState) {
        // A tab restored from the last visit: put the cursor back and bring it into view.
        const cursor = Math.min(Math.max(initialCursor, 0), state.doc.length);
        view.dispatch({ selection: { anchor: cursor }, scrollIntoView: true });
      }
      options.onShow?.();
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

    getCursor(tabId) {
      const state = tabId === activeTabId ? view.state : states.get(tabId);
      return state?.selection.main.head;
    },

    setLineWrapping(enabled) {
      if (enabled === lineWrapping) return;
      lineWrapping = enabled;
      const effect = options.lineWrappingEffect(enabled);
      // Background tabs have no view; their stored states are reconfigured directly.
      for (const [tabId, state] of states) {
        if (tabId !== activeTabId) states.set(tabId, state.update({ effects: effect }).state);
      }
      if (activeTabId !== undefined) view.dispatch({ effects: effect });
    },

    getStats: () => (activeTabId === undefined ? undefined : getEditorStats(view.state)),

    remeasure: () => view.requestMeasure(),
  };
}

export interface EditorCallbacks {
  /** The user changed the content of this tab. */
  onDocChange(tabId: string): void;
  /** The visible document, its content or its selection changed: what the status bar shows is stale. */
  onViewUpdate(): void;
}

/** Creates the editor inside `parent`. */
export function mountEditorTabs(parent: HTMLElement, callbacks: EditorCallbacks, lineWrapping: boolean): EditorTabs {
  const tabsRef: { current?: EditorTabs } = {};
  const createState = (text: string, wrap: boolean): EditorState =>
    createEditorState(text, {
      lineWrapping: wrap,
      onDocChange: () => {
        const tabId = tabsRef.current?.getActiveTabId();
        if (tabId !== undefined) callbacks.onDocChange(tabId);
      },
      onViewUpdate: callbacks.onViewUpdate,
    });
  // Until the first tab is shown the view holds an empty placeholder state.
  const view = new EditorView({ state: createState('', lineWrapping), parent });
  tabsRef.current = createEditorTabs(view, {
    createState,
    lineWrappingEffect,
    lineWrapping,
    onShow: callbacks.onViewUpdate,
  });
  return tabsRef.current;
}
