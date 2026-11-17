// Which tabs are open, in what order, and which one is showing. Pure state: it knows nothing about
// documents, the editor or the DOM, so the tab bar and the workspace can both rely on it and it
// can be tested on its own. Every tab is equal; ssMemoWeb's special "main" tab is gone.

/** Upper bound on open tabs, to keep memory use and the tab strip manageable. */
export const MAX_TABS = 20;

export interface Tab {
  id: string;
  title: string;
  /** True while the tab holds changes that are not stored yet. */
  dirty: boolean;
}

export type OpenResult =
  /** A new tab was added and is now active. */
  | 'opened'
  /** The tab was already open and is now active. */
  | 'activated'
  /** Nothing happened: the tab limit is reached. */
  | 'limit';

export interface TabManager {
  /** Copies, in display order. */
  getTabs(): readonly Tab[];
  getActiveId(): string | undefined;
  open(id: string, title: string): OpenResult;
  /** Returns false if no such tab is open. */
  activate(id: string): boolean;
  /**
   * Closes a tab. If it was the active one, its right neighbour becomes active, or the left one
   * if there is none. Returns false if no such tab is open.
   */
  close(id: string): boolean;
  setTitle(id: string, title: string): void;
  setDirty(id: string, dirty: boolean): void;
  /** `listener` is called once after every change. Returns a function that removes it. */
  subscribe(listener: () => void): () => void;
}

export function createTabManager(maxTabs: number = MAX_TABS): TabManager {
  const tabs: Tab[] = [];
  const listeners = new Set<() => void>();
  let activeId: string | undefined;

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const find = (id: string): Tab | undefined => tabs.find((tab) => tab.id === id);

  return {
    getTabs: () => tabs.map((tab) => ({ ...tab })),
    getActiveId: () => activeId,

    open(id, title) {
      if (find(id)) {
        if (activeId !== id) {
          activeId = id;
          notify();
        }
        return 'activated';
      }
      if (tabs.length >= maxTabs) return 'limit';
      tabs.push({ id, title, dirty: false });
      activeId = id;
      notify();
      return 'opened';
    },

    activate(id) {
      if (!find(id)) return false;
      if (activeId !== id) {
        activeId = id;
        notify();
      }
      return true;
    },

    close(id) {
      const index = tabs.findIndex((tab) => tab.id === id);
      if (index < 0) return false;
      tabs.splice(index, 1);
      if (activeId === id) {
        // After the splice, the former right neighbour sits at the same index.
        activeId = (tabs[index] ?? tabs[index - 1])?.id;
      }
      notify();
      return true;
    },

    setTitle(id, title) {
      const tab = find(id);
      if (!tab || tab.title === title) return;
      tab.title = title;
      notify();
    },

    setDirty(id, dirty) {
      const tab = find(id);
      if (!tab || tab.dirty === dirty) return;
      tab.dirty = dirty;
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * The tab after (1) or before (-1) the active one, wrapping around at the ends; undefined when
 * there is no other tab to go to.
 */
export function adjacentTabId(tabs: TabManager, step: 1 | -1): string | undefined {
  const ids = tabs.getTabs().map((tab) => tab.id);
  const activeId = tabs.getActiveId();
  const activeIndex = activeId === undefined ? -1 : ids.indexOf(activeId);
  if (activeIndex < 0 || ids.length < 2) return undefined;
  return ids[(activeIndex + step + ids.length) % ids.length];
}
