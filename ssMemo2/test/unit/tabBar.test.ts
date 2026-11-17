import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTabManager } from '../../src/app/tabManager.ts';
import type { TabManager } from '../../src/app/tabManager.ts';
import { createTabBar } from '../../src/ui/tabBar.ts';
import { createTestDom } from '../helpers/dom.ts';

interface Harness {
  tabs: TabManager;
  bar: HTMLElement;
  /** What the callbacks were called with, in order, e.g. "activate:a". */
  calls: string[];
  entries(): HTMLElement[];
  titles(): (string | null | undefined)[];
}

function createHarness(): Harness {
  const { document } = createTestDom();
  const tabs = createTabManager();
  const calls: string[] = [];
  const bar = createTabBar(document, {
    tabs,
    labels: { newMemo: 'New memo', closeTab: (title) => `Close ${title}` },
    onActivate: (tabId) => calls.push(`activate:${tabId}`),
    onClose: (tabId) => calls.push(`close:${tabId}`),
    onNew: () => calls.push('new'),
  });
  document.body.append(bar);
  const entries = (): HTMLElement[] => [...bar.querySelectorAll<HTMLElement>('.tab')];
  return {
    tabs,
    bar,
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
