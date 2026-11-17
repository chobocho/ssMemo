// The strip of tabs above the editor. It only displays the tab manager's state and reports what
// the user asked for; opening, closing and switching are decided by the workspace.
//
// For the keyboard it follows the usual pattern for tabs: the Tab key stops at the strip once (on
// the active tab), the arrow keys, Home and End move between tabs, and Delete closes one.
import type { Tab, TabManager } from '../app/tabManager.ts';

export interface TabBarLabels {
  newMemo: string;
  /** Accessible name of a tab's close button, e.g. "Close Shopping". */
  closeTab: (title: string) => string;
}

export interface TabBarOptions {
  tabs: TabManager;
  labels: TabBarLabels;
  /**
   * The area whose content the tabs switch (where the editor is). It needs an id; screen readers
   * are told that the tabs control it and it is named after the active tab.
   */
  panel?: HTMLElement;
  onActivate(tabId: string): void;
  onClose(tabId: string): void;
  onNew(): void;
}

const UNSAVED_MARKER = '●';
const CLOSE_SYMBOL = '✕';
const NEW_SYMBOL = '➕';
const TAB_ELEMENT_ID_PREFIX = 'tab-';
const TAB_SELECTOR = '[role="tab"]';
const IN_TAB_ORDER = 0;
const OUT_OF_TAB_ORDER = -1;

export function createTabBar(doc: Document, options: TabBarOptions): HTMLElement {
  const { tabs, labels, panel } = options;
  panel?.setAttribute('role', 'tabpanel');

  const element = doc.createElement('nav');
  element.className = 'tab-bar';

  const list = doc.createElement('div');
  list.className = 'tab-list';
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-orientation', 'horizontal');

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
    // Only there for layout; screen readers should see the tabs as direct parts of the list.
    entry.setAttribute('role', 'presentation');

    const select = doc.createElement('button');
    select.type = 'button';
    select.className = 'tab-select';
    select.id = `${TAB_ELEMENT_ID_PREFIX}${tab.id}`;
    select.setAttribute('role', 'tab');
    select.setAttribute('aria-selected', String(active));
    if (panel?.id) select.setAttribute('aria-controls', panel.id);
    select.tabIndex = active ? IN_TAB_ORDER : OUT_OF_TAB_ORDER;
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
    // With the keyboard a tab is closed with Delete; a stop per close button would only be in the way.
    close.tabIndex = OUT_OF_TAB_ORDER;
    close.addEventListener('click', () => options.onClose(tab.id));

    entry.append(select, close);
    return entry;
  }

  /** The id of the tab a key press went to, if it went to a tab. */
  const focusedTabId = (target: EventTarget | null): string | undefined => {
    // Key presses inside the strip come from its buttons, which are elements.
    const button = (target as Element | null)?.closest(TAB_SELECTOR);
    return button?.id.startsWith(TAB_ELEMENT_ID_PREFIX) ? button.id.slice(TAB_ELEMENT_ID_PREFIX.length) : undefined;
  };

  list.addEventListener('keydown', (event) => {
    const fromId = focusedTabId(event.target);
    if (fromId === undefined) return;
    const ids = tabs.getTabs().map((tab) => tab.id);
    const index = ids.indexOf(fromId);
    const targets: Record<string, string | undefined> = {
      // Past either end the strip wraps around.
      ArrowRight: ids[(index + 1) % ids.length],
      ArrowLeft: ids[(index - 1 + ids.length) % ids.length],
      Home: ids[0],
      End: ids.at(-1),
    };
    if (event.key === 'Delete') {
      event.preventDefault();
      options.onClose(fromId);
    } else if (Object.hasOwn(targets, event.key)) {
      event.preventDefault();
      const targetId = targets[event.key];
      if (targetId !== undefined) options.onActivate(targetId);
    }
  });

  // Rebuilding the whole strip on every change keeps this simple; there are at most a few dozen tabs.
  function render(): void {
    const activeId = tabs.getActiveId();
    // The rebuild removes the element that has the focus. If the user was working in the strip,
    // the focus is put back on the active tab instead of falling onto the page.
    const hadFocus = list.contains(doc.activeElement);
    const entries = tabs.getTabs().map((tab) => createEntry(tab, tab.id === activeId));
    list.replaceChildren(...entries);
    const activeTab = list.querySelector<HTMLElement>(`${TAB_SELECTOR}[aria-selected="true"]`);
    if (hadFocus) activeTab?.focus();
    if (activeTab) panel?.setAttribute('aria-labelledby', activeTab.id);
    else panel?.removeAttribute('aria-labelledby');
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
