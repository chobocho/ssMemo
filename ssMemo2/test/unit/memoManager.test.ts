import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DocumentListing, DocumentMeta } from '../../src/storage/storagePort.ts';
import { createMemoManager } from '../../src/ui/memoManager.ts';
import { createTestDom, nextTick } from '../helpers/dom.ts';

function meta(id: string, title: string, length = 10): DocumentMeta {
  return { id, title, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T03:04:00.000Z', length, rev: 1 };
}

interface Harness {
  element: HTMLElement;
  /** What the callbacks were called with, in order, e.g. "open:a". */
  calls: string[];
  listCalls(): number;
  titles(): (string | null | undefined)[];
  click(selector: string, index?: number): Promise<void>;
  text(): string;
}

interface Behaviour {
  listing?: () => Promise<DocumentListing>;
  failRename?: boolean;
}

async function createHarness(memos: DocumentMeta[], behaviour: Behaviour = {}): Promise<Harness> {
  const { document } = createTestDom();
  const calls: string[] = [];
  let listCalls = 0;
  const element = createMemoManager(document, {
    labels: {
      newMemo: 'New memo',
      trash: 'Trash',
      loading: 'Loading…',
      empty: 'No saved memos yet.',
      failed: 'That did not work.',
      renameOf: (title) => `Rename ${title}`,
      deleteOf: (title) => `Delete ${title}`,
      details: (item) => `${item.length} characters`,
      corrupt: (count) => `Skipped ${count} damaged record(s).`,
    },
    listMemos: () => {
      listCalls += 1;
      return behaviour.listing ? behaviour.listing() : Promise.resolve({ documents: memos, corruptCount: 0 });
    },
    onOpen: async (item) => {
      calls.push(`open:${item.id}`);
    },
    onRename: async (item) => {
      calls.push(`rename:${item.id}`);
      if (behaviour.failRename) throw new Error('conflict');
    },
    onDelete: async (item) => {
      calls.push(`delete:${item.id}`);
    },
    onNew: () => calls.push('new'),
    onTrash: () => calls.push('trash'),
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
  };
}

test('the manager lists the memos in the order it is given, with their details', async () => {
  const harness = await createHarness([meta('a', 'Shopping', 4), meta('b', 'Ideas', 120)]);
  assert.deepEqual(harness.titles(), ['Shopping', 'Ideas']);
  assert.equal(harness.text().includes('4 characters'), true);
  assert.equal(harness.text().includes('120 characters'), true);
  assert.equal(harness.text().includes('Loading…'), false);
});

test('an empty storage is explained instead of showing a blank list', async () => {
  const harness = await createHarness([]);
  assert.deepEqual(harness.titles(), []);
  assert.equal(harness.text().includes('No saved memos yet.'), true);
});

test('while the list is being read a loading message is shown', async () => {
  const pending: { resolve?: (listing: DocumentListing) => void } = {};
  const harness = await createHarness([], { listing: () => new Promise((resolve) => { pending.resolve = resolve; }) });
  assert.equal(harness.text().includes('Loading…'), true);
  pending.resolve?.({ documents: [meta('a', 'Shopping')], corruptCount: 0 });
  await nextTick();
  assert.deepEqual(harness.titles(), ['Shopping']);
  assert.equal(harness.text().includes('Loading…'), false);
});

test('damaged records are mentioned when the storage skipped some', async () => {
  const harness = await createHarness([], { listing: async () => ({ documents: [meta('a', 'Shopping')], corruptCount: 2 }) });
  assert.equal(harness.text().includes('Skipped 2 damaged record(s).'), true);
});

test('choosing a memo opens it and closes the manager', async () => {
  const harness = await createHarness([meta('a', 'Shopping'), meta('b', 'Ideas')]);
  await harness.click('.memo-open', 1);
  assert.deepEqual(harness.calls, ['open:b', 'close']);
});

test('the new-memo button starts a memo and closes the manager', async () => {
  const harness = await createHarness([meta('a', 'Shopping')]);
  await harness.click('.memo-new');
  assert.deepEqual(harness.calls, ['new', 'close']);
});

test('the trash button closes the manager and then opens the trash', async () => {
  // Closed first, so the trash does not open on top of a list that would be out of date.
  const harness = await createHarness([meta('a', 'Shopping')]);
  assert.equal(harness.element.querySelector('.memo-trash')?.textContent?.includes('Trash'), true);
  await harness.click('.memo-trash');
  assert.deepEqual(harness.calls, ['close', 'trash']);
});

test('the trash can be reached even when no memo is stored', async () => {
  const harness = await createHarness([]);
  await harness.click('.memo-trash');
  assert.deepEqual(harness.calls, ['close', 'trash']);
});

test('renaming keeps the manager open and reloads the list', async () => {
  const harness = await createHarness([meta('a', 'Shopping')]);
  assert.equal(harness.listCalls(), 1);
  await harness.click('.memo-rename');
  assert.deepEqual(harness.calls, ['rename:a']);
  assert.equal(harness.listCalls(), 2);
});

test('deleting keeps the manager open and reloads the list', async () => {
  const harness = await createHarness([meta('a', 'Shopping'), meta('b', 'Ideas')]);
  await harness.click('.memo-delete', 1);
  assert.deepEqual(harness.calls, ['delete:b']);
  assert.equal(harness.listCalls(), 2);
});

test('a failed action is reported and the list is reloaded so it shows the truth', async () => {
  const harness = await createHarness([meta('a', 'Shopping')], { failRename: true });
  await harness.click('.memo-rename');
  assert.equal(harness.element.querySelector('[role="alert"]')?.textContent, 'That did not work.');
  assert.equal(harness.listCalls(), 2);
  assert.deepEqual(harness.titles(), ['Shopping']);
});

test('a list that cannot be read is reported', async () => {
  const harness = await createHarness([], { listing: () => Promise.reject(new Error('storage closed')) });
  assert.equal(harness.element.querySelector('[role="alert"]')?.textContent, 'That did not work.');
  assert.deepEqual(harness.titles(), []);
});

test('icon-only buttons name the memo they act on', async () => {
  const harness = await createHarness([meta('a', 'Shopping')]);
  assert.equal(harness.element.querySelector('.memo-rename')?.getAttribute('aria-label'), 'Rename Shopping');
  assert.equal(harness.element.querySelector('.memo-delete')?.getAttribute('aria-label'), 'Delete Shopping');
});

test('a memo title is shown as text, never interpreted as markup', async () => {
  const hostile = '<img src=x onerror="alert(1)">';
  const harness = await createHarness([meta('a', hostile)]);
  assert.deepEqual(harness.titles(), [hostile]);
  assert.equal(harness.element.querySelector('img'), null);
});
