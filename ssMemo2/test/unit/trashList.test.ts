import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TrashedMemo } from '../../src/app/trash.ts';
import { createTrashList } from '../../src/ui/trashList.ts';
import { createTestDom, nextTick } from '../helpers/dom.ts';

function memo(entryId: string, title: string, length = 10): TrashedMemo {
  return { entryId, title, length, deletedAt: '2026-03-01T00:00:00.000Z' };
}

interface Harness {
  element: HTMLElement;
  /** What the callbacks were called with, in order, e.g. "restore:a". */
  calls: string[];
  listCalls(): number;
  titles(): (string | null | undefined)[];
  click(selector: string, index?: number): Promise<void>;
  text(): string;
  problem(): string | null | undefined;
}

interface Behaviour {
  listing?: () => Promise<TrashedMemo[]>;
  failRestore?: boolean;
  failRemove?: boolean;
}

async function createHarness(memos: TrashedMemo[], behaviour: Behaviour = {}): Promise<Harness> {
  const { document } = createTestDom();
  const calls: string[] = [];
  let listCalls = 0;
  const element = createTrashList(document, {
    labels: {
      hint: 'Deleted memos stay here for a while.',
      loading: 'Loading…',
      empty: 'The trash is empty.',
      failed: 'That did not work.',
      emptyAll: 'Empty the trash',
      restoreOf: (title) => `Restore ${title}`,
      removeOf: (title) => `Delete ${title} for good`,
      details: (item) => `${item.length} characters`,
    },
    listTrash: () => {
      listCalls += 1;
      return behaviour.listing ? behaviour.listing() : Promise.resolve(memos);
    },
    onRestore: async (item) => {
      calls.push(`restore:${item.entryId}`);
      if (behaviour.failRestore) throw new Error('gone');
    },
    onRemove: async (item) => {
      calls.push(`remove:${item.entryId}`);
      if (behaviour.failRemove) throw new Error('storage closed');
    },
    onEmpty: async () => {
      calls.push('empty');
    },
    close: () => calls.push('close'),
  });
  document.body.append(element);
  await nextTick();
  return {
    element,
    calls,
    listCalls: () => listCalls,
    titles: () => [...element.querySelectorAll('.memo-title')].map((node) => node.textContent),
    async click(selector, index = 0) {
      const target = element.querySelectorAll<HTMLElement>(selector)[index];
      assert.ok(target, `nothing matches ${selector} [${index}]`);
      target.click();
      await nextTick();
    },
    text: () => element.textContent ?? '',
    problem: () => element.querySelector('[role="alert"]')?.textContent,
  };
}

test('the trash lists the deleted memos in the order it is given, with their details', async () => {
  const harness = await createHarness([memo('a', 'Shopping', 4), memo('b', 'Ideas', 120)]);
  assert.deepEqual(harness.titles(), ['Shopping', 'Ideas']);
  assert.equal(harness.text().includes('4 characters'), true);
  assert.equal(harness.text().includes('120 characters'), true);
  assert.equal(harness.text().includes('Loading…'), false);
});

test('how long deleted memos are kept is always explained', async () => {
  assert.equal((await createHarness([])).text().includes('Deleted memos stay here for a while.'), true);
  assert.equal((await createHarness([memo('a', 'Shopping')])).text().includes('Deleted memos stay here for a while.'), true);
});

test('an empty trash says so and offers nothing to empty', async () => {
  const harness = await createHarness([]);
  assert.deepEqual(harness.titles(), []);
  assert.equal(harness.text().includes('The trash is empty.'), true);
  assert.equal(harness.element.querySelector<HTMLElement>('.trash-empty')?.hidden, true);
});

test('a trash with memos in it can be emptied', async () => {
  const harness = await createHarness([memo('a', 'Shopping')]);
  const button = harness.element.querySelector<HTMLElement>('.trash-empty');
  assert.equal(button?.hidden, false);
  assert.equal(button?.textContent?.includes('Empty the trash'), true);
  await harness.click('.trash-empty');
  assert.deepEqual(harness.calls, ['empty']);
  // Still open, showing what is left.
  assert.equal(harness.listCalls(), 2);
});

test('while the trash is being read a loading message is shown', async () => {
  const pending: { resolve?: (memos: TrashedMemo[]) => void } = {};
  const harness = await createHarness([], { listing: () => new Promise((resolve) => { pending.resolve = resolve; }) });
  assert.equal(harness.text().includes('Loading…'), true);
  pending.resolve?.([memo('a', 'Shopping')]);
  await nextTick();
  assert.deepEqual(harness.titles(), ['Shopping']);
  assert.equal(harness.text().includes('Loading…'), false);
});

test('restoring a memo closes the trash', async () => {
  const harness = await createHarness([memo('a', 'Shopping'), memo('b', 'Ideas')]);
  await harness.click('.memo-restore', 1);
  assert.deepEqual(harness.calls, ['restore:b', 'close']);
});

test('a memo that could not be restored is reported, and the trash stays open with a fresh list', async () => {
  const harness = await createHarness([memo('a', 'Shopping')], { failRestore: true });
  await harness.click('.memo-restore');
  assert.deepEqual(harness.calls, ['restore:a']);
  assert.equal(harness.problem(), 'That did not work.');
  assert.equal(harness.listCalls(), 2);
});

test('deleting for good keeps the trash open and reloads the list', async () => {
  const harness = await createHarness([memo('a', 'Shopping'), memo('b', 'Ideas')]);
  await harness.click('.memo-delete', 1);
  assert.deepEqual(harness.calls, ['remove:b']);
  assert.equal(harness.listCalls(), 2);
  assert.equal(harness.problem(), '');
});

test('a failed deletion is reported and the list is reloaded so it shows the truth', async () => {
  const harness = await createHarness([memo('a', 'Shopping')], { failRemove: true });
  await harness.click('.memo-delete');
  assert.equal(harness.problem(), 'That did not work.');
  assert.equal(harness.listCalls(), 2);
  assert.deepEqual(harness.titles(), ['Shopping']);
});

test('a trash that cannot be read is reported', async () => {
  const harness = await createHarness([], { listing: () => Promise.reject(new Error('storage closed')) });
  assert.equal(harness.problem(), 'That did not work.');
  assert.deepEqual(harness.titles(), []);
  assert.equal(harness.element.querySelector<HTMLElement>('.trash-empty')?.hidden, true);
});

test('icon-only buttons name the memo they act on', async () => {
  const harness = await createHarness([memo('a', 'Shopping')]);
  assert.equal(harness.element.querySelector('.memo-restore')?.getAttribute('aria-label'), 'Restore Shopping');
  assert.equal(harness.element.querySelector('.memo-delete')?.getAttribute('aria-label'), 'Delete Shopping for good');
});

test('an entry of the trash is not itself a button: a memo is restored only on purpose', async () => {
  const harness = await createHarness([memo('a', 'Shopping')]);
  const buttons = [...harness.element.querySelectorAll('.memo-item button')].map((button) => button.className);
  assert.equal(buttons.length, 2);
  assert.equal(harness.element.querySelector('.memo-title')?.closest('button'), null);
});

test('a memo title is shown as text, never interpreted as markup', async () => {
  const hostile = '<img src=x onerror="alert(1)">';
  const harness = await createHarness([memo('a', hostile)]);
  assert.deepEqual(harness.titles(), [hostile]);
  assert.equal(harness.element.querySelector('img'), null);
});
