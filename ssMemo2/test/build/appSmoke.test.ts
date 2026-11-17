// Boots the real, built page in jsdom with an in-memory IndexedDB and uses it the way a visitor
// would. This is the closest thing to a browser test this project has: it proves the modules are
// wired together and nothing throws. jsdom has no layout engine, so appearance, touch behaviour
// and the browser's own dialog handling still need the manual checklist.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory as FakeIndexedDbFactory } from 'fake-indexeddb';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildHtml } from '../../scripts/buildHtml.ts';
import { createSessionStore } from '../../src/app/session.ts';
import { openIndexedDbStorage } from '../../src/storage/indexedDbStorage.ts';
import { NEW_DOCUMENT_REV } from '../../src/storage/storagePort.ts';
import { installBrowserStandIns } from '../helpers/dom.ts';

const PAGE_URL = 'http://localhost:8001/';
const BOOT_WAIT_MS = 300;
// Longer than the app's autosave idle delay (1.5 s).
const AUTOSAVE_WAIT_MS = 2000;
const TIMESTAMP = '2026-01-01T00:00:00.000Z';

interface Page {
  window: JSDOM['window'];
  document: Document;
  /** Errors the page logged or threw. */
  errors: string[];
  tabTitles(): string[];
  activeTabTitle(): string | undefined;
  editorText(): string | undefined;
  noticeTexts(): string[];
  click(selector: string, index?: number): Promise<void>;
  close(): void;
}

let html = '';

before(async () => {
  html = (await buildHtml()).html;
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openPage(options: { factory?: IDBFactory; url?: string } = {}): Promise<Page> {
  const errors: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(`jsdomError: ${error.message}`));
  virtualConsole.on('error', (...args) => errors.push(`console.error: ${args.join(' ')}`));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: options.url ?? PAGE_URL,
    virtualConsole,
    beforeParse(window) {
      installBrowserStandIns(window);
      if (options.factory) {
        Object.defineProperty(window, 'indexedDB', { value: options.factory, configurable: true });
      }
    },
  });
  await wait(BOOT_WAIT_MS);
  const { document } = dom.window;
  const text = (element: Element | null | undefined): string => element?.textContent ?? '';
  return {
    window: dom.window,
    document,
    errors,
    tabTitles: () => [...document.querySelectorAll('.tab-title')].map(text),
    activeTabTitle: () => document.querySelector('.tab-active .tab-title')?.textContent ?? undefined,
    editorText: () => document.querySelector('.cm-content')?.textContent ?? undefined,
    noticeTexts: () => [...document.querySelectorAll('.notice-text')].map(text),
    async click(selector, index = 0) {
      const target = document.querySelectorAll<HTMLElement>(selector)[index];
      assert.ok(target, `nothing matches ${selector} [${index}]`);
      target.click();
      await wait(50);
    },
    close: () => dom.window.close(),
  };
}

/** A database as an earlier visit left it: two memos, both open in tabs, the first one active. */
async function seededFactory(): Promise<IDBFactory> {
  const factory = new FakeIndexedDbFactory();
  const storage = await openIndexedDbStorage(factory);
  await storage.saveDocument({ id: 'a', title: 'Shopping', content: 'milk', createdAt: TIMESTAMP, updatedAt: TIMESTAMP }, NEW_DOCUMENT_REV);
  await storage.saveDocument({ id: 'b', title: 'Ideas', content: 'write more tests', createdAt: TIMESTAMP, updatedAt: TIMESTAMP }, NEW_DOCUMENT_REV);
  await createSessionStore(storage).save({
    tabs: [
      { documentId: 'a', cursor: 0 },
      { documentId: 'b', cursor: 0 },
    ],
    activeDocumentId: 'a',
  });
  storage.close();
  return factory;
}

async function storedContent(factory: IDBFactory, id: string): Promise<string | undefined> {
  const storage = await openIndexedDbStorage(factory);
  const document = await storage.getDocument(id);
  storage.close();
  return document?.content;
}

test('a first visit shows one blank memo tab and an empty editor', async () => {
  const page = await openPage({ factory: new FakeIndexedDbFactory() });
  assert.deepEqual(page.errors, []);
  assert.deepEqual(page.tabTitles(), ['New memo']);
  assert.equal(page.editorText(), '');
  assert.deepEqual(page.noticeTexts(), []);
  page.close();
});

test('a return visit restores the tabs and the active memo', async () => {
  const page = await openPage({ factory: await seededFactory() });
  assert.deepEqual(page.errors, []);
  assert.deepEqual(page.tabTitles(), ['Shopping', 'Ideas']);
  assert.equal(page.activeTabTitle(), 'Shopping');
  assert.equal(page.editorText(), 'milk');
  page.close();
});

test('clicking a tab shows that memo, and clicking back shows the first one again', async () => {
  const page = await openPage({ factory: await seededFactory() });
  await page.click('.tab [role="tab"]', 1);
  assert.equal(page.activeTabTitle(), 'Ideas');
  assert.equal(page.editorText(), 'write more tests');
  await page.click('.tab [role="tab"]', 0);
  assert.equal(page.editorText(), 'milk');
  assert.deepEqual(page.errors, []);
  page.close();
});

test('the new-memo button adds a blank tab and the close button removes a tab', async () => {
  const page = await openPage({ factory: await seededFactory() });
  await page.click('.tab-new');
  assert.deepEqual(page.tabTitles(), ['Shopping', 'Ideas', 'New memo']);
  assert.equal(page.activeTabTitle(), 'New memo');
  assert.equal(page.editorText(), '');

  await page.click('.tab-close', 2);
  assert.deepEqual(page.tabTitles(), ['Shopping', 'Ideas']);
  assert.deepEqual(page.errors, []);
  page.close();
});

test('typing is saved automatically and survives a reload', async () => {
  const factory = await seededFactory();
  const page = await openPage({ factory });
  // Change the text the way browser input does; CodeMirror picks up DOM mutations.
  const line = page.document.querySelector('.cm-line');
  assert.ok(line);
  line.textContent = 'milk and eggs';
  await wait(AUTOSAVE_WAIT_MS);
  assert.equal(await storedContent(factory, 'a'), 'milk and eggs');
  assert.deepEqual(page.errors, []);
  page.close();

  const reloaded = await openPage({ factory });
  assert.equal(reloaded.editorText(), 'milk and eggs');
  reloaded.close();
});

/** The dialog on top, as far as the page is concerned. */
function topDialog(page: Page): HTMLDialogElement {
  const dialog = [...page.document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1);
  assert.ok(dialog, 'expected an open dialog');
  return dialog;
}

test('the memo list opens a memo that is not in a tab yet', async () => {
  const factory = await seededFactory();
  const storage = await openIndexedDbStorage(factory);
  await storage.saveDocument({ id: 'c', title: 'Archive', content: 'old notes', createdAt: TIMESTAMP, updatedAt: TIMESTAMP }, NEW_DOCUMENT_REV);
  storage.close();

  const page = await openPage({ factory });
  await page.click('.toolbar button');
  const listed = [...topDialog(page).querySelectorAll('.memo-title')].map((node) => node.textContent).sort();
  assert.deepEqual(listed, ['Archive', 'Ideas', 'Shopping']);

  const archive = [...topDialog(page).querySelectorAll<HTMLElement>('.memo-open')].find((node) => node.textContent?.includes('Archive'));
  assert.ok(archive);
  archive.click();
  await wait(100);
  assert.equal(page.document.querySelector('dialog[open]'), null);
  assert.deepEqual(page.tabTitles(), ['Shopping', 'Ideas', 'Archive']);
  assert.equal(page.editorText(), 'old notes');
  assert.deepEqual(page.errors, []);
  page.close();
});

test('a memo can be renamed and deleted from the memo list', async () => {
  const factory = await seededFactory();
  const page = await openPage({ factory });
  await page.click('.toolbar button');

  // Rename "Shopping": the prompt opens on top of the list.
  const shoppingIndex = [...topDialog(page).querySelectorAll('.memo-title')].findIndex((node) => node.textContent === 'Shopping');
  topDialog(page).querySelectorAll<HTMLElement>('.memo-rename')[shoppingIndex]?.click();
  await wait(50);
  const input = topDialog(page).querySelector('input');
  assert.ok(input);
  input.value = 'Groceries';
  topDialog(page).querySelector('form')?.dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(100);
  assert.equal(page.tabTitles().includes('Groceries'), true);

  // Delete "Ideas": the confirmation opens on top of the list.
  const ideasIndex = [...topDialog(page).querySelectorAll('.memo-title')].findIndex((node) => node.textContent === 'Ideas');
  topDialog(page).querySelectorAll<HTMLElement>('.memo-delete')[ideasIndex]?.click();
  await wait(50);
  [...topDialog(page).querySelectorAll('button')].at(-1)?.click();
  await wait(100);
  assert.deepEqual(page.tabTitles(), ['Groceries']);
  assert.equal(await storedContent(factory, 'b'), undefined);
  assert.deepEqual(page.errors, []);
  page.close();
});

test('?safe starts in temporary mode without loading the stored memos', async () => {
  const page = await openPage({ factory: await seededFactory(), url: `${PAGE_URL}?safe` });
  assert.deepEqual(page.errors, []);
  assert.deepEqual(page.tabTitles(), ['New memo']);
  assert.equal(page.document.querySelector<HTMLElement>('.app-badge')?.hidden, false);
  assert.equal(page.noticeTexts().length, 1);
  page.close();
});

test('a browser without IndexedDB still gets a working editor, in temporary mode', async () => {
  const page = await openPage();
  assert.deepEqual(page.errors, []);
  assert.deepEqual(page.tabTitles(), ['New memo']);
  assert.equal(page.document.querySelector<HTMLElement>('.app-badge')?.hidden, false);
  assert.equal(page.document.querySelector('.cm-content')?.getAttribute('contenteditable'), 'true');
  page.close();
});
