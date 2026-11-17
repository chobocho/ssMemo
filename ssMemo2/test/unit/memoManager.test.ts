import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MemoSearchHit } from '../../src/app/memoSearch.ts';
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
  /** Types into the search field. */
  search(query: string): Promise<void>;
  searchCalls: string[];
}

interface Behaviour {
  listing?: () => Promise<DocumentListing>;
  failRename?: boolean;
  searching?: (query: string) => Promise<MemoSearchHit[]>;
}

async function createHarness(memos: DocumentMeta[], behaviour: Behaviour = {}): Promise<Harness> {
  const { document } = createTestDom();
  const calls: string[] = [];
  const searchCalls: string[] = [];
  let listCalls = 0;
  const element = createMemoManager(document, {
    labels: {
      newMemo: 'New memo',
      trash: 'Trash',
      search: 'Search all memos',
      noMatches: 'No memo contains that.',
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
    searchMemos: (query) => {
      searchCalls.push(query);
      return behaviour.searching ? behaviour.searching(query) : Promise.resolve([]);
    },
    onOpen: async (item, foundText) => {
      calls.push(foundText === undefined ? `open:${item.id}` : `open:${item.id}:${foundText}`);
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
    async search(query) {
      const field = element.querySelector<HTMLInputElement>('.memo-search');
      assert.ok(field, 'the manager has no search field');
      field.value = query;
      field.dispatchEvent(new field.ownerDocument.defaultView!.Event('input', { bubbles: true }));
      await nextTick();
    },
    searchCalls,
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

// --- searching all memos ----------------------------------------------------

const MILK_HITS: MemoSearchHit[] = [
  { meta: meta('a', 'Shopping'), snippet: 'buy milk today' },
  { meta: meta('b', 'Milk prices'), snippet: undefined },
];

test('typing into the search field lists the memos that were found, with the line that matches', async () => {
  const harness = await createHarness([meta('a', 'Shopping'), meta('b', 'Milk prices'), meta('c', 'Ideas')], { searching: async () => MILK_HITS });
  await harness.search('milk');
  assert.deepEqual(harness.searchCalls, ['milk']);
  assert.deepEqual(harness.titles(), ['Shopping', 'Milk prices']);
  const snippets = [...harness.element.querySelectorAll('.memo-snippet')].map((node) => node.textContent);
  assert.deepEqual(snippets, ['buy milk today']);
  assert.equal(harness.text().includes('Loading…'), false);
});

test('the search field says what it is for', async () => {
  const harness = await createHarness([]);
  const field = harness.element.querySelector<HTMLInputElement>('.memo-search');
  assert.equal(field?.getAttribute('aria-label'), 'Search all memos');
  assert.equal(field?.placeholder, 'Search all memos');
  assert.equal(field?.type, 'search');
});

test('clearing the search field brings the whole list back', async () => {
  const harness = await createHarness([meta('a', 'Shopping'), meta('c', 'Ideas')], { searching: async () => MILK_HITS });
  await harness.search('milk');
  await harness.search('');
  assert.deepEqual(harness.titles(), ['Shopping', 'Ideas']);
  assert.equal(harness.element.querySelector('.memo-snippet'), null);
  // Blanks alone are no search either.
  await harness.search('  ');
  assert.deepEqual(harness.searchCalls, ['milk']);
  assert.deepEqual(harness.titles(), ['Shopping', 'Ideas']);
});

test('a search that finds nothing says so', async () => {
  const harness = await createHarness([meta('a', 'Shopping')], { searching: async () => [] });
  await harness.search('unicorn');
  assert.deepEqual(harness.titles(), []);
  assert.equal(harness.text().includes('No memo contains that.'), true);
  assert.equal(harness.text().includes('No saved memos yet.'), false);
});

test('opening a memo found by its text hands on what was searched for', async () => {
  const harness = await createHarness([], { searching: async () => MILK_HITS });
  await harness.search('milk');
  await harness.click('.memo-open', 0);
  assert.deepEqual(harness.calls, ['open:a:milk', 'close']);
});

test('opening a memo found only by its title hands on nothing to look for', async () => {
  const harness = await createHarness([], { searching: async () => MILK_HITS });
  await harness.search('milk');
  await harness.click('.memo-open', 1);
  assert.deepEqual(harness.calls, ['open:b', 'close']);
});

test('an answer that arrives late does not replace a newer one', async () => {
  const pending = new Map<string, (hits: MemoSearchHit[]) => void>();
  const harness = await createHarness([], { searching: (query) => new Promise((resolve) => pending.set(query, resolve)) });
  await harness.search('m');
  await harness.search('mi');
  pending.get('mi')?.([{ meta: meta('b', 'Milk prices'), snippet: undefined }]);
  await nextTick();
  pending.get('m')?.([{ meta: meta('a', 'Shopping'), snippet: 'me too' }, { meta: meta('b', 'Milk prices'), snippet: undefined }]);
  await nextTick();
  assert.deepEqual(harness.titles(), ['Milk prices']);
});

test('a search that fails is reported, and the next one clears the report', async () => {
  let fail = true;
  const harness = await createHarness([meta('a', 'Shopping')], {
    searching: async () => {
      if (fail) throw new Error('storage closed');
      return MILK_HITS;
    },
  });
  await harness.search('milk');
  assert.equal(harness.element.querySelector('[role="alert"]')?.textContent, 'That did not work.');
  assert.deepEqual(harness.titles(), []);
  fail = false;
  await harness.search('milk ');
  assert.equal(harness.element.querySelector('[role="alert"]')?.textContent, '');
  assert.deepEqual(harness.titles(), ['Shopping', 'Milk prices']);
});

test('after deleting a found memo the search is repeated instead of showing every memo', async () => {
  const harness = await createHarness([meta('a', 'Shopping'), meta('c', 'Ideas')], { searching: async () => MILK_HITS });
  await harness.search('milk');
  await harness.click('.memo-delete', 0);
  assert.deepEqual(harness.calls, ['delete:a']);
  assert.deepEqual(harness.searchCalls, ['milk', 'milk']);
  assert.deepEqual(harness.titles(), ['Shopping', 'Milk prices']);
});

test('the line that matches is shown as text, never interpreted as markup', async () => {
  const hostile = '<img src=x onerror="alert(1)">';
  const harness = await createHarness([], { searching: async () => [{ meta: meta('a', 'Shopping'), snippet: hostile }] });
  await harness.search('img');
  assert.equal(harness.element.querySelector('.memo-snippet')?.textContent, hostile);
  assert.equal(harness.element.querySelector('img'), null);
});
