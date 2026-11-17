import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTabManager } from '../../src/app/tabManager.ts';
import type { TabManager } from '../../src/app/tabManager.ts';
import { createTabBar } from '../../src/ui/tabBar.ts';
import { createTestDom } from '../helpers/dom.ts';

interface Harness {
  tabs: TabManager;
  bar: HTMLElement;
  /** The area the tabs switch, i.e. where the editor is. */
  panel: HTMLElement;
  document: Document;
  /** Sends a key press to the tab that has the focus. */
  press(key: string): KeyboardEvent;
  /** What the callbacks were called with, in order, e.g. "activate:a". */
  calls: string[];
  entries(): HTMLElement[];
  titles(): (string | null | undefined)[];
}

function createHarness(): Harness {
  const { document, window } = createTestDom();
  const tabs = createTabManager();
  const calls: string[] = [];
  const panel = document.createElement('div');
  panel.id = 'editor-panel';
  const bar = createTabBar(document, {
    tabs,
    panel,
    labels: { newMemo: 'New memo', closeTab: (title) => `Close ${title}` },
    onActivate: (tabId) => calls.push(`activate:${tabId}`),
    onClose: (tabId) => calls.push(`close:${tabId}`),
    onNew: () => calls.push('new'),
  });
  document.body.append(bar, panel);
  const entries = (): HTMLElement[] => [...bar.querySelectorAll<HTMLElement>('.tab')];
  return {
    tabs,
    bar,
    panel,
    document,
    press(key) {
      const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      (document.activeElement ?? document.body).dispatchEvent(event);
      return event;
    },
    calls,
    entries,
    titles: () => entries().map((entry) => entry.querySelector('.tab-title')?.textContent),
  };
}

function selectButton(entry: HTMLElement | undefined): HTMLButtonElement {
  const button = entry?.querySelector<HTMLButtonElement>('[role="tab"]');
  assert.ok(button, 'expected a tab button');
  return button;
}

function closeButton(entry: HTMLElement | undefined): HTMLButtonElement {
  const button = entry?.querySelector<HTMLButtonElement>('.tab-close');
  assert.ok(button, 'expected a close button');
  return button;
}

test('the bar shows one entry per tab, in order', () => {
  const harness = createHarness();
  assert.deepEqual(harness.titles(), []);
  harness.tabs.open('a', 'first');
  harness.tabs.open('b', 'second');
  assert.deepEqual(harness.titles(), ['first', 'second']);
});

test('only the active tab is marked as selected', () => {
  const harness = createHarness();
  harness.tabs.open('a', 'first');
  harness.tabs.open('b', 'second');
  harness.tabs.activate('a');
  const selected = harness.entries().map((entry) => selectButton(entry).getAttribute('aria-selected'));
  assert.deepEqual(selected, ['true', 'false']);
  assert.deepEqual(harness.entries().map((entry) => entry.classList.contains('tab-active')), [true, false]);
});

test('a tab with unsaved changes shows a marker, a saved one does not', () => {
  const harness = createHarness();
  harness.tabs.open('a', 'first');
  harness.tabs.open('b', 'second');
  harness.tabs.setDirty('b', true);
  assert.deepEqual(harness.entries().map((entry) => entry.querySelector('.tab-marker') !== null), [false, true]);
  harness.tabs.setDirty('b', false);
  assert.deepEqual(harness.entries().map((entry) => entry.querySelector('.tab-marker') !== null), [false, false]);
});

test('the bar follows renames and closed tabs', () => {
  const harness = createHarness();
  harness.tabs.open('a', 'first');
  harness.tabs.open('b', 'second');
  harness.tabs.setTitle('a', 'renamed');
  harness.tabs.close('b');
  assert.deepEqual(harness.titles(), ['renamed']);
});

test('clicking a tab asks to activate it and nothing else', () => {
  const harness = createHarness();
  harness.tabs.open('a', 'first');
  harness.tabs.open('b', 'second');
  selectButton(harness.entries()[0]).click();
  assert.deepEqual(harness.calls, ['activate:a']);
});

test('clicking the close button asks to close that tab without activating it', () => {
  const harness = createHarness();
  harness.tabs.open('a', 'first');
  harness.tabs.open('b', 'second');
  closeButton(harness.entries()[0]).click();
  assert.deepEqual(harness.calls, ['close:a']);
});

test('the new-memo button asks for a new memo', () => {
  const harness = createHarness();
  const button = harness.bar.querySelector<HTMLButtonElement>('.tab-new');
  assert.ok(button);
  button.click();
  assert.deepEqual(harness.calls, ['new']);
});

test('icon-only buttons have names a screen reader can announce', () => {
  const harness = createHarness();
  harness.tabs.open('a', 'shopping list');
  assert.equal(closeButton(harness.entries()[0]).getAttribute('aria-label'), 'Close shopping list');
  assert.equal(harness.bar.querySelector('.tab-new')?.getAttribute('aria-label'), 'New memo');
});

test('the full title is available even when the tab is too narrow to show it', () => {
  const harness = createHarness();
  const longTitle = 'a very long memo title that will be cut off in the tab strip';
  harness.tabs.open('a', longTitle);
  assert.equal(selectButton(harness.entries()[0]).title, longTitle);
});

test('a title is shown as text, never interpreted as markup', () => {
  const harness = createHarness();
  const hostile = '<img src=x onerror="alert(1)"><b>bold</b>';
  harness.tabs.open('a', hostile);
  assert.deepEqual(harness.titles(), [hostile]);
  assert.equal(harness.bar.querySelector('img'), null);
  assert.equal(harness.bar.querySelector('b'), null);
});

// --- keyboard and screen reader ---------------------------------------------

/** Three tabs a, b, c with b active, as the user would have them after clicking b. */
function threeTabs(): Harness {
  const harness = createHarness();
  for (const id of ['a', 'b', 'c']) harness.tabs.open(id, `Tab ${id}`);
  harness.tabs.activate('b');
  return harness;
}

const tabButtons = (harness: Harness): HTMLButtonElement[] => [...harness.bar.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

test('the Tab key stops at the strip once: only the active tab is in the tab order', () => {
  const harness = threeTabs();
  assert.deepEqual(tabButtons(harness).map((button) => button.tabIndex), [-1, 0, -1]);
  // Close buttons are reached with Delete instead of taking a stop each.
  for (const button of harness.bar.querySelectorAll<HTMLButtonElement>('.tab-close')) assert.equal(button.tabIndex, -1);
  assert.equal(harness.bar.querySelector<HTMLButtonElement>('.tab-new')?.tabIndex, 0);
});

test('arrow keys move to the neighbouring tab and wrap around at the ends', () => {
  const harness = threeTabs();
  tabButtons(harness)[1]?.focus();
  assert.equal(harness.press('ArrowRight').defaultPrevented, true);
  harness.press('ArrowLeft');
  assert.deepEqual(harness.calls, ['activate:c', 'activate:a']);

  // From the last tab forward is the first, from the first backward the last.
  harness.calls.length = 0;
  harness.tabs.activate('c');
  harness.press('ArrowRight');
  harness.tabs.activate('a');
  harness.press('ArrowLeft');
  assert.deepEqual(harness.calls, ['activate:a', 'activate:c']);
});

test('Home and End jump to the first and the last tab', () => {
  const harness = threeTabs();
  tabButtons(harness)[1]?.focus();
  harness.press('End');
  harness.press('Home');
  assert.deepEqual(harness.calls, ['activate:c', 'activate:a']);
});

test('Delete closes the tab that has the focus', () => {
  const harness = threeTabs();
  tabButtons(harness)[1]?.focus();
  assert.equal(harness.press('Delete').defaultPrevented, true);
  assert.deepEqual(harness.calls, ['close:b']);
});

test('other keys are left alone', () => {
  const harness = threeTabs();
  tabButtons(harness)[1]?.focus();
  for (const key of ['ArrowDown', 'Enter', 'a', 'Tab']) assert.equal(harness.press(key).defaultPrevented, false, key);
  assert.deepEqual(harness.calls, []);
});

test('the focus stays on the strip when the active tab changes while it is in use', () => {
  // The strip is rebuilt on every change, which would otherwise drop the focus onto the page.
  const harness = threeTabs();
  tabButtons(harness)[1]?.focus();
  harness.tabs.activate('c');
  assert.equal(harness.document.activeElement, tabButtons(harness)[2]);
  harness.tabs.close('c');
  assert.equal(harness.document.activeElement?.getAttribute('aria-selected'), 'true');
});

test('the focus is not pulled into the strip when it is somewhere else', () => {
  const harness = threeTabs();
  const elsewhere = harness.document.createElement('button');
  harness.document.body.append(elsewhere);
  elsewhere.focus();
  harness.tabs.activate('c');
  assert.equal(harness.document.activeElement, elsewhere);
});

test('each tab says which area it controls, and that area is named after the active tab', () => {
  const harness = threeTabs();
  const [first, active] = tabButtons(harness);
  assert.ok(first && active);
  assert.equal(active.getAttribute('aria-controls'), 'editor-panel');
  assert.ok(active.id.length > 0);
  assert.notEqual(first.id, active.id);
  assert.equal(harness.panel.getAttribute('role'), 'tabpanel');
  assert.equal(harness.panel.getAttribute('aria-labelledby'), active.id);

  harness.tabs.activate('a');
  assert.equal(harness.panel.getAttribute('aria-labelledby'), tabButtons(harness)[0]?.id);
});

test('the wrappers around the tabs do not get in the way of the tab list', () => {
  const harness = threeTabs();
  assert.equal(harness.bar.querySelector('[role="tablist"]')?.getAttribute('aria-orientation'), 'horizontal');
  for (const entry of harness.entries()) assert.equal(entry.getAttribute('role'), 'presentation');
});
