import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TABS, createTabManager } from '../../src/app/tabManager.ts';
import type { TabManager } from '../../src/app/tabManager.ts';

/** A manager with tabs a, b, c open (c active) and a counter of change notifications. */
function createHarness(maxTabs?: number): { tabs: TabManager; notifications: () => number } {
  const tabs = createTabManager(maxTabs);
  let count = 0;
  tabs.subscribe(() => {
    count += 1;
  });
  return { tabs, notifications: () => count };
}

function openAbc(tabs: TabManager): void {
  for (const id of ['a', 'b', 'c']) tabs.open(id, `title ${id}`);
}

function ids(tabs: TabManager): string[] {
  return tabs.getTabs().map((tab) => tab.id);
}

test('a new manager has no tabs and no active tab', () => {
  const { tabs } = createHarness();
  assert.deepEqual(tabs.getTabs(), []);
  assert.equal(tabs.getActiveId(), undefined);
});

test('open appends a clean tab and makes it active', () => {
  const { tabs } = createHarness();
  assert.equal(tabs.open('a', 'first'), 'opened');
  assert.equal(tabs.open('b', 'second'), 'opened');
  assert.deepEqual(tabs.getTabs(), [
    { id: 'a', title: 'first', dirty: false },
    { id: 'b', title: 'second', dirty: false },
  ]);
  assert.equal(tabs.getActiveId(), 'b');
});

test('opening a tab that is already open only activates it', () => {
  const { tabs } = createHarness();
  openAbc(tabs);
  assert.equal(tabs.open('a', 'another title'), 'activated');
  assert.deepEqual(ids(tabs), ['a', 'b', 'c']);
  assert.equal(tabs.getActiveId(), 'a');
  assert.equal(tabs.getTabs()[0]?.title, 'title a');
});

test('open refuses to go past the limit and changes nothing', () => {
  const { tabs, notifications } = createHarness(2);
  tabs.open('a', 'a');
  tabs.open('b', 'b');
  const before = notifications();
  assert.equal(tabs.open('c', 'c'), 'limit');
  assert.deepEqual(ids(tabs), ['a', 'b']);
  assert.equal(tabs.getActiveId(), 'b');
  assert.equal(notifications(), before);
  // A tab that is already open can still be activated at the limit.
  assert.equal(tabs.open('a', 'a'), 'activated');
});

test('the default limit is MAX_TABS', () => {
  const { tabs } = createHarness();
  for (let index = 0; index < MAX_TABS; index++) assert.equal(tabs.open(`tab-${index}`, 't'), 'opened');
  assert.equal(tabs.open('one-too-many', 't'), 'limit');
});

test('activate switches to an open tab and ignores unknown ids', () => {
  const { tabs } = createHarness();
  openAbc(tabs);
  assert.equal(tabs.activate('a'), true);
  assert.equal(tabs.getActiveId(), 'a');
  assert.equal(tabs.activate('missing'), false);
  assert.equal(tabs.getActiveId(), 'a');
});

test('closing the active tab activates its right neighbour', () => {
  const { tabs } = createHarness();
  openAbc(tabs);
  tabs.activate('b');
  assert.equal(tabs.close('b'), true);
  assert.deepEqual(ids(tabs), ['a', 'c']);
  assert.equal(tabs.getActiveId(), 'c');
});

test('closing the active last tab activates its left neighbour', () => {
  const { tabs } = createHarness();
  openAbc(tabs);
  assert.equal(tabs.close('c'), true);
  assert.equal(tabs.getActiveId(), 'b');
});

test('closing the only tab leaves no active tab', () => {
  const { tabs } = createHarness();
  tabs.open('a', 'a');
  assert.equal(tabs.close('a'), true);
  assert.deepEqual(tabs.getTabs(), []);
  assert.equal(tabs.getActiveId(), undefined);
});

test('closing an inactive tab keeps the active one', () => {
  const { tabs } = createHarness();
  openAbc(tabs);
  assert.equal(tabs.close('a'), true);
  assert.equal(tabs.getActiveId(), 'c');
});

test('closing an unknown tab does nothing', () => {
  const { tabs, notifications } = createHarness();
  openAbc(tabs);
  const before = notifications();
  assert.equal(tabs.close('missing'), false);
  assert.equal(notifications(), before);
});

test('title and dirty flag can be changed per tab', () => {
  const { tabs } = createHarness();
  openAbc(tabs);
  tabs.setTitle('b', 'renamed');
  tabs.setDirty('b', true);
  assert.deepEqual(tabs.getTabs()[1], { id: 'b', title: 'renamed', dirty: true });
  // Unknown ids are ignored rather than creating tabs.
  tabs.setTitle('missing', 'x');
  tabs.setDirty('missing', true);
  assert.deepEqual(ids(tabs), ['a', 'b', 'c']);
});

test('listeners are told exactly once per change and not at all when nothing changed', () => {
  const { tabs, notifications } = createHarness();
  tabs.open('a', 'a');
  assert.equal(notifications(), 1);
  tabs.open('b', 'b');
  assert.equal(notifications(), 2);

  tabs.activate('b'); // already active
  tabs.setDirty('b', false); // already clean
  tabs.setTitle('b', 'b'); // same title
  assert.equal(notifications(), 2);

  tabs.setDirty('b', true);
  tabs.setTitle('b', 'new');
  tabs.activate('a');
  tabs.close('a');
  assert.equal(notifications(), 6);
});

test('unsubscribing stops notifications', () => {
  const tabs = createTabManager();
  let count = 0;
  const unsubscribe = tabs.subscribe(() => {
    count += 1;
  });
  tabs.open('a', 'a');
  unsubscribe();
  tabs.open('b', 'b');
  assert.equal(count, 1);
});

test('getTabs returns copies that cannot change the manager', () => {
  const { tabs } = createHarness();
  openAbc(tabs);
  const snapshot = tabs.getTabs() as { id: string; title: string; dirty: boolean }[];
  snapshot[0]!.title = 'changed by the caller';
  snapshot.pop();
  assert.deepEqual(ids(tabs), ['a', 'b', 'c']);
  assert.equal(tabs.getTabs()[0]?.title, 'title a');
});
