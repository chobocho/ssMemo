// The strip of tabs above the editor. It only displays the tab manager's state and reports what
// the user asked for; opening, closing and switching are decided by the workspace.
import type { Tab, TabManager } from '../app/tabManager.ts';

export interface TabBarLabels {
  newMemo: string;
  /** Accessible name of a tab's close button, e.g. "Close Shopping". */
  closeTab: (title: string) => string;
}

export interface TabBarOptions {
  tabs: TabManager;
  labels: TabBarLabels;
  onActivate(tabId: string): void;
  onClose(tabId: string): void;
  onNew(): void;
}

const UNSAVED_MARKER = '●';
const CLOSE_SYMBOL = '✕';
const NEW_SYMBOL = '➕';

export function createTabBar(doc: Document, options: TabBarOptions): HTMLElement {
  const { tabs, labels } = options;

  const element = doc.createElement('nav');
  element.className = 'tab-bar';

  const list = doc.createElement('div');
  list.className = 'tab-list';
  list.setAttribute('role', 'tablist');

  const newButton = doc.createElement('button');
  newButton.type = 'button';
  newButton.className = 'tab-new';
  newButton.textContent = NEW_SYMBOL;
  newButton.setAttribute('aria-label', labels.newMemo);
  newButton.title = labels.newMemo;
  newButton.addEventListener('click', () => options.onNew());

  element.append(list, newButton);

  function createEntry(tab: Tab, active: boolean): HTMLElement {
    const entry = doc.createElement('div');
    entry.className = active ? 'tab tab-active' : 'tab';

    const select = doc.createElement('button');
    select.type = 'button';
    select.className = 'tab-select';
    select.setAttribute('role', 'tab');
    select.setAttribute('aria-selected', String(active));
    // The tab may be too narrow for the whole title; the tooltip always has it.
    select.title = tab.title;
    select.addEventListener('click', () => options.onActivate(tab.id));

    if (tab.dirty) {
      const marker = doc.createElement('span');
      marker.className = 'tab-marker';
      marker.textContent = UNSAVED_MARKER;
      // Decorative here: the save state is announced by the status indicator in the header.
      marker.setAttribute('aria-hidden', 'true');
      select.append(marker);
    }

    const title = doc.createElement('span');
    title.className = 'tab-title';
    // textContent, never innerHTML: a memo title is arbitrary user text.
    title.textContent = tab.title;
    select.append(title);

    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.textContent = CLOSE_SYMBOL;
    close.setAttribute('aria-label', labels.closeTab(tab.title));
    close.addEventListener('click', () => options.onClose(tab.id));

    entry.append(select, close);
    return entry;
  }

  // Rebuilding the whole strip on every change keeps this simple; there are at most a few dozen tabs.
  function render(): void {
    const activeId = tabs.getActiveId();
    const entries = tabs.getTabs().map((tab) => createEntry(tab, tab.id === activeId));
    list.replaceChildren(...entries);
    const activeEntry = list.querySelector<HTMLElement>('.tab-active');
    // Keeps the active tab visible when the strip is scrolled; absent in non-browser environments.
    if (typeof activeEntry?.scrollIntoView === 'function') {
      activeEntry.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  tabs.subscribe(render);
  render();
  return element;
}
