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
// Booting takes a few hundred milliseconds, and several times that while other test files
// compete for the processor, so the page is polled until it is ready instead of waiting a fixed time.
const BOOT_POLL_MS = 20;
const BOOT_TIMEOUT_MS = 15_000;
// What start-up still does after the first tab is on screen (event listeners, the status bar).
const BOOT_SETTLE_MS = 100;
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
  /** Every call the page made to window.open. */
  opened: unknown[][];
  /** Files the page offered as downloads, in order. */
  downloads(): Promise<{ name: string; bytes: number[] }[]>;
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
  const downloadNames: string[] = [];
  const opened: unknown[][] = [];
  let objectUrlBlobs: Blob[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(`jsdomError: ${error.message}`));
  virtualConsole.on('error', (...args) => errors.push(`console.error: ${args.join(' ')}`));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: options.url ?? PAGE_URL,
    virtualConsole,
    beforeParse(window) {
      objectUrlBlobs = installBrowserStandIns(window).objectUrlBlobs;
      // jsdom cannot open windows; the calls are recorded instead.
      window.open = (...args: unknown[]) => {
        opened.push(args);
        return null;
      };
      // A download is a click on a link with a "download" attribute. jsdom cannot follow it.
      window.document.addEventListener('click', (event) => {
        const link = event.target as HTMLAnchorElement;
        if (link.tagName === 'A' && link.hasAttribute('download')) {
          downloadNames.push(link.download);
          event.preventDefault();
        }
      });
      if (options.factory) {
        Object.defineProperty(window, 'indexedDB', { value: options.factory, configurable: true });
      }
    },
  });
  const { document } = dom.window;
  // The first tab appears when the stored memos were read and the editor shows one of them.
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (!document.querySelector('.tab-title') && Date.now() < deadline) await wait(BOOT_POLL_MS);
  await wait(BOOT_SETTLE_MS);
  const text = (element: Element | null | undefined): string => element?.textContent ?? '';
  return {
    window: dom.window,
    document,
    errors,
    tabTitles: () => [...document.querySelectorAll('.tab-title')].map(text),
    activeTabTitle: () => document.querySelector('.tab-active .tab-title')?.textContent ?? undefined,
    editorText: () => document.querySelector('.cm-content')?.textContent ?? undefined,
    noticeTexts: () => [...document.querySelectorAll('.notice-text')].map(text),
    opened,
    downloads: () =>
      Promise.all(downloadNames.map(async (name, index) => ({ name, bytes: [...new Uint8Array((await objectUrlBlobs[index]?.arrayBuffer()) ?? [])] }))),
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

function toolbarButton(page: Page, label: string): HTMLElement {
  const button = page.document.querySelector<HTMLElement>(`.toolbar [aria-label="${label}"]`);
  assert.ok(button, `no toolbar button labelled ${label}`);
  return button;
}

test('the status bar describes the visible memo and follows tab switches', async () => {
  const page = await openPage({ factory: await seededFactory() });
  const statusBar = (): string => page.document.querySelector('.status-bar')?.textContent ?? '';
  assert.match(statusBar(), /4 characters · 1 lines/);
  await page.click('.tab [role="tab"]', 1);
  assert.match(statusBar(), /16 characters · 1 lines/);
  page.close();
});

test('line wrapping and text size are settings that survive a reload', async () => {
  const factory = await seededFactory();
  const page = await openPage({ factory });
  const wrapsNow = (target: Page): boolean => target.document.querySelector('.cm-content')?.classList.contains('cm-lineWrapping') ?? false;
  const fontSize = (target: Page): string => target.document.documentElement.style.getPropertyValue('--editor-font-size');
  assert.equal(wrapsNow(page), true);
  const sizeBefore = fontSize(page);

  toolbarButton(page, 'Line wrapping').click();
  toolbarButton(page, 'Larger text').click();
  await wait(100);
  assert.equal(wrapsNow(page), false);
  assert.equal(toolbarButton(page, 'Line wrapping').getAttribute('aria-pressed'), 'false');
  assert.notEqual(fontSize(page), sizeBefore);
  const sizeAfter = fontSize(page);
  assert.deepEqual(page.errors, []);
  page.close();

  const reloaded = await openPage({ factory });
  assert.equal(wrapsNow(reloaded), false);
  assert.equal(fontSize(reloaded), sizeAfter);
  assert.equal(toolbarButton(reloaded, 'Line wrapping').getAttribute('aria-pressed'), 'false');
  reloaded.close();
});

test('a saved language choice overrides the browser language', async () => {
  const factory = await seededFactory();
  const storage = await openIndexedDbStorage(factory);
  await storage.setValue('settings', { language: 'ko', lineWrapping: true, editorFontSizeRem: 0.875 });
  storage.close();
  const page = await openPage({ factory });
  assert.equal(page.document.documentElement.lang, 'ko');
  assert.ok(page.document.querySelector('.toolbar [aria-label="메모 목록"]'));
  assert.deepEqual(page.errors, []);
  page.close();
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
  toolbarButton(page, 'Memo list').click();
  await wait(50);
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
  toolbarButton(page, 'Memo list').click();
  await wait(50);

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

test('the menu lists the commands and runs the one that is picked', async () => {
  const page = await openPage({ factory: await seededFactory() });
  toolbarButton(page, 'Menu').click();
  await wait(50);
  const labels = [...topDialog(page).querySelectorAll('.command-label')].map((node) => node.textContent);
  assert.ok(labels.includes('Open file'));
  assert.ok(labels.includes('Language'));
  // The menu does not offer to open itself.
  assert.equal(labels.includes('Menu'), false);

  const newMemo = [...topDialog(page).querySelectorAll<HTMLElement>('.command-item')].find((item) => item.textContent?.includes('New memo'));
  assert.ok(newMemo);
  newMemo.click();
  await wait(50);
  assert.equal(page.document.querySelector('dialog[open]'), null);
  assert.deepEqual(page.tabTitles(), ['Shopping', 'Ideas', 'New memo']);
  assert.deepEqual(page.errors, []);
  page.close();
});

/** Simulates choosing files in the dialog that the open-file button brought up. */
async function chooseFiles(page: Page, files: File[]): Promise<void> {
  const input = page.document.querySelector<HTMLInputElement>('input[type="file"]');
  assert.ok(input, 'the file dialog was not requested');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new page.window.Event('change'));
  await wait(200);
}

test('the open-file button opens every chosen file in a tab of its own', async () => {
  const page = await openPage({ factory: new FakeIndexedDbFactory() });
  toolbarButton(page, 'Open file').click();
  await chooseFiles(page, [
    new page.window.File(['plain text'], 'plain.txt'),
    // "an-nyeong" in CP949, with a Windows line ending.
    new page.window.File([new Uint8Array([0xbe, 0xc8, 0xb3, 0xe7, 0x0d, 0x0a])], 'legacy.txt'),
  ]);
  assert.deepEqual(page.errors, []);
  assert.deepEqual(page.noticeTexts(), []);
  assert.deepEqual(page.tabTitles(), ['New memo', 'plain.txt', 'legacy.txt']);
  assert.equal(page.activeTabTitle(), 'legacy.txt');
  assert.equal(page.editorText(), String.fromCharCode(0xc548, 0xb155));
  assert.equal(page.document.querySelector('input[type="file"]'), null);
  page.close();
});

test('a file dropped on the page opens too, and a file that is not text is refused', async () => {
  const page = await openPage({ factory: new FakeIndexedDbFactory() });
  const drop = new page.window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', {
    value: {
      types: ['Files'],
      files: [new page.window.File(['dropped text'], 'dropped.md'), new page.window.File([new Uint8Array([0x89, 0x50, 0x00, 0x00])], 'photo.png')],
    },
  });
  page.document.querySelector('.cm-content')?.dispatchEvent(drop);
  await wait(200);
  assert.deepEqual(page.errors, []);
  assert.deepEqual(page.tabTitles(), ['New memo', 'dropped.md']);
  assert.equal(page.editorText(), 'dropped text');
  assert.equal(page.noticeTexts().length, 1);
  assert.match(page.noticeTexts()[0] ?? '', /photo\.png/);
  page.close();
});

test('a file dropped while a dialog is open is neither opened nor allowed to replace the page', async () => {
  const page = await openPage({ factory: await seededFactory() });
  toolbarButton(page, 'Menu').click();
  await wait(50);
  const drop = new page.window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [new page.window.File(['dropped text'], 'dropped.md')] } });
  topDialog(page).dispatchEvent(drop);
  await wait(200);
  // Without this the browser would leave the app and show the file instead.
  assert.equal(drop.defaultPrevented, true);
  assert.deepEqual(page.tabTitles(), ['Shopping', 'Ideas']);
  assert.deepEqual(page.errors, []);
  page.close();
});

test('an opened file is stored once it is edited and comes back after a reload', async () => {
  const factory = new FakeIndexedDbFactory();
  const page = await openPage({ factory });
  toolbarButton(page, 'Open file').click();
  await chooseFiles(page, [new page.window.File(['first line\r\n'], 'notes.txt')]);

  const storageBefore = await openIndexedDbStorage(factory);
  assert.deepEqual((await storageBefore.listDocuments()).documents, []);
  storageBefore.close();

  const line = page.document.querySelector('.cm-line');
  assert.ok(line);
  line.textContent = 'first line, edited';
  await wait(AUTOSAVE_WAIT_MS);
  const storage = await openIndexedDbStorage(factory);
  const { documents } = await storage.listDocuments();
  storage.close();
  assert.equal(documents.length, 1);
  assert.equal(documents[0]?.title, 'notes.txt');
  assert.deepEqual(documents[0]?.source, { fileName: 'notes.txt', encoding: 'UTF-8', eol: 'crlf', hasBom: false });
  assert.deepEqual(page.errors, []);
  page.close();

  const reloaded = await openPage({ factory });
  assert.deepEqual(reloaded.tabTitles(), ['notes.txt']);
  assert.match(reloaded.editorText() ?? '', /^first line, edited/);
  reloaded.close();
});

/** Opens the menu and picks the command with the given label. */
async function pickFromMenu(page: Page, label: string): Promise<void> {
  toolbarButton(page, 'Menu').click();
  await wait(50);
  const item = [...topDialog(page).querySelectorAll<HTMLElement>('.command-item')].find(
    (candidate) => candidate.querySelector('.command-label')?.textContent === label,
  );
  assert.ok(item, `the menu has no command labelled ${label}`);
  item.click();
  await wait(50);
}

async function pickChoice(page: Page, label: string): Promise<void> {
  const choice = [...topDialog(page).querySelectorAll<HTMLElement>('.choice')].find((candidate) => candidate.textContent === label);
  assert.ok(choice, `no choice labelled ${label}`);
  choice.click();
  await wait(100);
}

test('a file read with the wrong encoding can be read again with another one', async () => {
  const page = await openPage({ factory: new FakeIndexedDbFactory() });
  const statusBar = (): string => page.document.querySelector('.status-bar')?.textContent ?? '';
  const korean = String.fromCharCode(0xc548, 0xb155);
  toolbarButton(page, 'Open file').click();
  await chooseFiles(page, [new page.window.File([new Uint8Array([0xbe, 0xc8, 0xb3, 0xe7, 0x0d, 0x0a, 0x61])], 'legacy.txt')]);
  assert.match(statusBar(), /CP949 · CRLF$/);

  await pickFromMenu(page, 'Encoding');
  assert.equal(topDialog(page).querySelector('.choice[aria-pressed="true"]')?.textContent, 'CP949');
  await pickChoice(page, 'UTF-8');
  assert.match(statusBar(), /UTF-8 · CRLF$/);
  assert.equal(page.editorText()?.includes(korean), false);
  assert.equal(page.noticeTexts().length, 1);
  assert.match(page.noticeTexts()[0] ?? '', /legacy\.txt.*UTF-8/);

  await pickFromMenu(page, 'Encoding');
  await pickChoice(page, 'CP949');
  assert.match(statusBar(), /CP949 · CRLF$/);
  assert.equal(page.editorText()?.startsWith(korean), true);
  assert.deepEqual(page.errors, []);
  page.close();
});

test('the encoding of a memo cannot be changed, and the user is told why', async () => {
  const page = await openPage({ factory: await seededFactory() });
  await pickFromMenu(page, 'Encoding');
  assert.equal(page.document.querySelector('dialog[open]'), null);
  assert.equal(page.noticeTexts().length, 1);
  assert.deepEqual(page.errors, []);
  page.close();
});

const asciiBytes = (value: string): number[] => [...value].map((character) => character.charCodeAt(0));

test('the save button offers the visible memo as a text file', async () => {
  const page = await openPage({ factory: await seededFactory() });
  toolbarButton(page, 'Save to file').click();
  await wait(100);
  assert.deepEqual(await page.downloads(), [{ name: 'Shopping.txt', bytes: asciiBytes('milk') }]);
  assert.deepEqual(page.errors, []);
  assert.deepEqual(page.noticeTexts(), []);
  page.close();
});

test('Ctrl+S saves to a file instead of letting the browser save the page', async () => {
  const page = await openPage({ factory: await seededFactory() });
  const press = new page.window.KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true });
  page.document.querySelector('.cm-content')?.dispatchEvent(press);
  await wait(100);
  assert.equal(press.defaultPrevented, true);
  assert.deepEqual((await page.downloads()).map((download) => download.name), ['Shopping.txt']);
  page.close();
});

test('a CP949 file is written as UTF-8 only after the user agreed, and keeps its line endings', async () => {
  const page = await openPage({ factory: new FakeIndexedDbFactory() });
  const statusBar = (): string => page.document.querySelector('.status-bar')?.textContent ?? '';
  toolbarButton(page, 'Open file').click();
  await chooseFiles(page, [new page.window.File([new Uint8Array([0xbe, 0xc8, 0xb3, 0xe7, 0x0d, 0x0a, 0x61])], 'legacy.txt')]);

  // Declined: nothing is written.
  toolbarButton(page, 'Save to file').click();
  await wait(50);
  assert.match(topDialog(page).textContent ?? '', /legacy\.txt.*CP949.*UTF-8/);
  topDialog(page).querySelector('button')?.click();
  await wait(50);
  assert.deepEqual(await page.downloads(), []);
  assert.match(statusBar(), /CP949 · CRLF$/);

  // Agreed: "an-nyeong" in UTF-8, CR LF, "a".
  toolbarButton(page, 'Save to file').click();
  await wait(50);
  [...topDialog(page).querySelectorAll('button')].at(-1)?.click();
  await wait(100);
  assert.deepEqual(await page.downloads(), [
    { name: 'legacy.txt', bytes: [0xec, 0x95, 0x88, 0xeb, 0x85, 0x95, 0x0d, 0x0a, 0x61] },
  ]);
  assert.match(statusBar(), /UTF-8 · CRLF$/);
  assert.deepEqual(page.errors, []);
  page.close();
});

interface ExportedBackup {
  app: string;
  documents: { id: string; title: string; content: string }[];
}

function backupFileFor(page: Page, documents: unknown[], settings?: unknown): File {
  return new page.window.File([JSON.stringify({ app: 'ssMemo2', formatVersion: 1, exportedAt: TIMESTAMP, settings, documents })], 'backup.json');
}

async function storedTitles(factory: IDBFactory): Promise<string[]> {
  const storage = await openIndexedDbStorage(factory);
  const { documents } = await storage.listDocuments();
  storage.close();
  return documents.map((meta) => meta.title).sort();
}

test('exporting a backup offers one JSON file with every memo, including unsaved typing', async () => {
  const page = await openPage({ factory: await seededFactory() });
  const line = page.document.querySelector('.cm-line');
  assert.ok(line);
  line.textContent = 'milk and bread';
  await wait(100);

  await pickFromMenu(page, 'Export backup');
  await wait(200);
  const [download] = await page.downloads();
  assert.ok(download);
  assert.match(download.name, /^ssMemo2-backup-\d{8}-\d{4}\.json$/);
  const backup = JSON.parse(new TextDecoder().decode(new Uint8Array(download.bytes))) as ExportedBackup;
  assert.equal(backup.app, 'ssMemo2');
  assert.deepEqual(backup.documents.map((document) => [document.title, document.content]).sort(), [
    ['Ideas', 'write more tests'],
    ['Shopping', 'milk and bread'],
  ]);
  assert.equal(page.noticeTexts().length, 1);
  assert.deepEqual(page.errors, []);
  page.close();
});

test('importing a backup can add its memos to the stored ones', async () => {
  const factory = await seededFactory();
  const page = await openPage({ factory });
  await pickFromMenu(page, 'Import backup');
  assert.equal(page.document.querySelector<HTMLInputElement>('input[type="file"]')?.accept, '.json,application/json');
  await chooseFiles(page, [backupFileFor(page, [{ id: 'c', title: 'From the backup', content: 'restored text' }, { id: 'a', title: 'Shopping', content: 'milk' }])]);

  assert.match(topDialog(page).textContent ?? '', /2 memo\(s\).*2 memo\(s\) are stored/);
  await pickChoice(page, 'Add: keep the stored memos and add those of the backup');
  await wait(100);
  assert.deepEqual(await storedTitles(factory), ['From the backup', 'Ideas', 'Shopping']);
  assert.equal(page.noticeTexts().length, 1);
  // The open tabs are untouched by an addition.
  assert.deepEqual(page.tabTitles(), ['Shopping', 'Ideas']);
  assert.deepEqual(page.errors, []);
  page.close();

  const reloaded = await openPage({ factory });
  toolbarButton(reloaded, 'Memo list').click();
  await wait(50);
  assert.ok([...topDialog(reloaded).querySelectorAll('.memo-title')].some((node) => node.textContent === 'From the backup'));
  reloaded.close();
});

test('importing a backup can replace everything, after a second confirmation', async () => {
  const factory = await seededFactory();
  const page = await openPage({ factory });
  const backup = (): File => backupFileFor(page, [{ id: 'c', title: 'Only this', content: 'from the backup' }], { language: 'ko', lineWrapping: false, editorFontSizeRem: 1 });

  // Declined at the confirmation: nothing changes.
  await pickFromMenu(page, 'Import backup');
  await chooseFiles(page, [backup()]);
  await pickChoice(page, 'Replace: delete the stored memos and keep only the backup');
  assert.match(topDialog(page).textContent ?? '', /All 2 stored memo/);
  topDialog(page).querySelector('button')?.click();
  await wait(100);
  assert.deepEqual(await storedTitles(factory), ['Ideas', 'Shopping']);

  await pickFromMenu(page, 'Import backup');
  await chooseFiles(page, [backup()]);
  await pickChoice(page, 'Replace: delete the stored memos and keep only the backup');
  [...topDialog(page).querySelectorAll('button')].at(-1)?.click();
  await wait(200);
  assert.deepEqual(await storedTitles(factory), ['Only this']);
  // The page reloads itself afterwards, which jsdom cannot do; nothing else may have gone wrong.
  assert.deepEqual(page.errors.filter((error) => !error.includes('Not implemented: navigation')), []);
  page.close();

  const reloaded = await openPage({ factory });
  assert.deepEqual(reloaded.tabTitles(), ['Only this']);
  assert.equal(reloaded.editorText(), 'from the backup');
  // The settings of the backup apply too.
  assert.equal(reloaded.document.documentElement.lang, 'ko');
  reloaded.close();
});

test('a file that is not a backup is refused and changes nothing', async () => {
  const factory = await seededFactory();
  const page = await openPage({ factory });
  await pickFromMenu(page, 'Import backup');
  await chooseFiles(page, [new page.window.File(['just some notes'], 'notes.json')]);
  assert.equal(page.document.querySelector('dialog[open]'), null);
  assert.equal(page.noticeTexts().length, 1);
  assert.deepEqual(await storedTitles(factory), ['Ideas', 'Shopping']);
  assert.deepEqual(page.errors, []);
  page.close();
});

test('in temporary mode a backup can be exported, and importing only offers to add', async () => {
  const page = await openPage({ factory: await seededFactory(), url: `${PAGE_URL}?safe` });
  await pickFromMenu(page, 'Export backup');
  await wait(200);
  assert.equal((await page.downloads()).length, 1);

  await pickFromMenu(page, 'Import backup');
  await chooseFiles(page, [backupFileFor(page, [{ id: 'c', title: 'From the backup', content: 'x' }])]);
  assert.deepEqual([...topDialog(page).querySelectorAll('.choice')].map((choice) => choice.textContent), [
    'Add: keep the stored memos and add those of the backup',
  ]);
  assert.deepEqual(page.errors, []);
  page.close();
});

async function pressKey(page: Page, init: KeyboardEventInit): Promise<KeyboardEvent> {
  const event = new page.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  page.document.querySelector('.cm-content')?.dispatchEvent(event);
  await wait(100);
  return event;
}

function searchField(page: Page): HTMLInputElement {
  const field = page.document.querySelector<HTMLInputElement>('.cm-search input[name="search"]');
  assert.ok(field, 'the search panel is not open');
  return field;
}

/** Types into the search field the way the panel expects: it reads the field on "keyup". */
async function searchFor(page: Page, query: string): Promise<void> {
  const field = searchField(page);
  field.value = query;
  field.dispatchEvent(new page.window.Event('keyup', { bubbles: true }));
  await wait(50);
}

test('Ctrl+F opens the search panel and stepping through matches selects them', async () => {
  const page = await openPage({ factory: await seededFactory() });
  const statusBar = (): string => page.document.querySelector('.status-bar')?.textContent ?? '';
  await page.click('.tab [role="tab"]', 1);

  const press = await pressKey(page, { key: 'f', code: 'KeyF', ctrlKey: true });
  assert.equal(press.defaultPrevented, true);
  assert.equal(searchField(page).placeholder, 'Find');

  await searchFor(page, 'more');
  page.document.querySelector<HTMLElement>('.cm-search button[name="next"]')?.click();
  await wait(100);
  assert.match(statusBar(), /4 selected/);
  assert.deepEqual(page.errors, []);
  page.close();
});

test('Ctrl+I opens the search as well, and the search follows to the next tab', async () => {
  const page = await openPage({ factory: await seededFactory() });
  await pressKey(page, { key: 'i', code: 'KeyI', ctrlKey: true });
  await searchFor(page, 'milk');

  await page.click('.tab [role="tab"]', 1);
  assert.equal(page.activeTabTitle(), 'Ideas');
  assert.equal(searchField(page).value, 'milk');

  // And a closed panel stays closed on the way back.
  page.document.querySelector<HTMLElement>('.cm-search button[name="close"]')?.click();
  await wait(50);
  await page.click('.tab [role="tab"]', 0);
  assert.equal(page.document.querySelector('.cm-search'), null);
  assert.deepEqual(page.errors, []);
  page.close();
});

test('the keys for the start and the end of the document move the cursor there', async () => {
  const page = await openPage({ factory: await seededFactory() });
  const statusBar = (): string => page.document.querySelector('.status-bar')?.textContent ?? '';
  assert.match(statusBar(), /^Ln 1, Col 1 /);
  // "milk" has four characters, so its end is column 5.
  const toEnd = await pressKey(page, { key: 'e', code: 'KeyE', ctrlKey: true });
  assert.equal(toEnd.defaultPrevented, true);
  assert.match(statusBar(), /^Ln 1, Col 5 /);
  await pressKey(page, { key: '6', code: 'Digit6', ctrlKey: true });
  assert.match(statusBar(), /^Ln 1, Col 1 /);
  await pressKey(page, { key: '4', code: 'Digit4', ctrlKey: true });
  assert.match(statusBar(), /^Ln 1, Col 5 /);
  await pressKey(page, { key: 'h', code: 'KeyH', ctrlKey: true });
  assert.match(statusBar(), /^Ln 1, Col 1 /);
  assert.deepEqual(page.errors, []);
  page.close();
});

test('symbol and divider keys insert at the cursor, and the insertion can be undone and is saved', async () => {
  const factory = await seededFactory();
  const page = await openPage({ factory });
  const lines = (): string[] => [...page.document.querySelectorAll('.cm-line')].map((line) => line.textContent ?? '');

  // Ctrl+Shift+C: a check mark at the cursor, which is at the start of "milk".
  const symbol = await pressKey(page, { key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true });
  assert.equal(symbol.defaultPrevented, true);
  assert.deepEqual(lines(), [`${String.fromCodePoint(0x2705)}milk`]);

  // Ctrl+Z takes it out again: the insertion went through the editor's history.
  await pressKey(page, { key: 'z', code: 'KeyZ', ctrlKey: true });
  assert.deepEqual(lines(), ['milk']);

  // Ctrl+Shift+Z is a symbol here, not redo.
  await pressKey(page, { key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true });
  assert.deepEqual(lines(), [`${String.fromCodePoint(0x1f7e9)}milk`]);
  await pressKey(page, { key: 'z', code: 'KeyZ', ctrlKey: true });

  // Ctrl+L at the end of the text: the divider goes on a line of its own.
  await pressKey(page, { key: 'e', code: 'KeyE', ctrlKey: true });
  await pressKey(page, { key: 'l', code: 'KeyL', ctrlKey: true });
  assert.deepEqual(lines(), ['milk', String.fromCharCode(0x2500).repeat(50)]);

  await wait(AUTOSAVE_WAIT_MS);
  assert.equal(await storedContent(factory, 'a'), `milk\n${String.fromCharCode(0x2500).repeat(50)}`);
  assert.deepEqual(page.errors, []);
  page.close();
});

test('a symbol picked from the menu is inserted too', async () => {
  const page = await openPage({ factory: await seededFactory() });
  await pickFromMenu(page, 'Arrow');
  assert.equal(page.editorText(), `${String.fromCharCode(0x2192)}milk`);
  assert.deepEqual(page.errors, []);
  page.close();
});

test('a long memo is split with cut lines and joined again, a short one is left alone', async () => {
  const factory = await seededFactory();
  const storage = await openIndexedDbStorage(factory);
  await storage.saveDocument({ id: 'long', title: 'Long', content: 'x'.repeat(4500), createdAt: TIMESTAMP, updatedAt: TIMESTAMP }, NEW_DOCUMENT_REV);
  await createSessionStore(storage).save({ tabs: [{ documentId: 'long', cursor: 0 }, { documentId: 'a', cursor: 0 }], activeDocumentId: 'long' });
  storage.close();
  const cutLine = String.fromCharCode(0xc808, 0xcde8, 0xc120);
  const countCutLines = (text: string): number => text.split(`[${cutLine}]`).length - 1;

  const page = await openPage({ factory });
  await pickFromMenu(page, 'Split with cut lines / join again');
  await wait(AUTOSAVE_WAIT_MS);
  const split = (await storedContent(factory, 'long')) ?? '';
  assert.equal(countCutLines(split), 2);
  assert.equal(split.replaceAll('x', '').length, split.length - 4500);
  // The search is set to the cut line, so "find next" walks from part to part.
  assert.equal(searchField(page).value, cutLine);

  await pickFromMenu(page, 'Split with cut lines / join again');
  await wait(AUTOSAVE_WAIT_MS);
  assert.equal(await storedContent(factory, 'long'), 'x'.repeat(4500));

  await page.click('.tab [role="tab"]', 1);
  await pickFromMenu(page, 'Split with cut lines / join again');
  assert.equal(page.noticeTexts().length, 1);
  assert.equal(page.editorText(), 'milk');
  assert.deepEqual(page.errors, []);
  page.close();
});

test('the preview shows the memo as rendered Markdown and follows typing and tab switches', async () => {
  const page = await openPage({ factory: await seededFactory() });
  const main = page.document.querySelector('.app-main');
  const pane = page.document.querySelector('.preview-pane');
  assert.ok(main && pane);
  assert.equal(main.classList.contains('is-previewing'), false);
  assert.equal(pane.innerHTML, '');

  toolbarButton(page, 'Markdown preview').click();
  await wait(50);
  assert.equal(main.classList.contains('is-previewing'), true);
  assert.equal(toolbarButton(page, 'Markdown preview').getAttribute('aria-pressed'), 'true');
  assert.equal(pane.innerHTML, '<p>milk</p>');

  const line = page.document.querySelector('.cm-line');
  assert.ok(line);
  line.textContent = '# Shopping **today**';
  await wait(600);
  assert.equal(pane.innerHTML, '<h1>Shopping <strong>today</strong></h1>');

  await page.click('.tab [role="tab"]', 1);
  await wait(600);
  assert.equal(pane.innerHTML, '<p>write more tests</p>');

  toolbarButton(page, 'Markdown preview').click();
  await wait(50);
  assert.equal(main.classList.contains('is-previewing'), false);
  assert.equal(pane.innerHTML, '');
  assert.deepEqual(page.errors, []);
  page.close();
});

test('markup typed into a memo is shown as text in the preview, never run', async () => {
  const page = await openPage({ factory: await seededFactory() });
  toolbarButton(page, 'Markdown preview').click();
  const line = page.document.querySelector('.cm-line');
  assert.ok(line);
  line.textContent = '<img src=x onerror="document.title=1"> [x](javascript:document.title=2)';
  await wait(600);
  const pane = page.document.querySelector('.preview-pane');
  assert.ok(pane);
  assert.equal(pane.querySelectorAll('img, a, script').length, 0);
  assert.match(pane.textContent ?? '', /<img src=x/);
  assert.equal(page.document.title, 'ssMemo2');
  assert.deepEqual(page.errors, []);
  page.close();
});

/** Replaces the text of the first line the way typing does. */
async function typeLine(page: Page, text: string): Promise<void> {
  const line = page.document.querySelector('.cm-line');
  assert.ok(line);
  line.textContent = text;
  await wait(100);
}

function dialogButton(page: Page, label: string): HTMLElement {
  const button = [...topDialog(page).querySelectorAll<HTMLElement>('button')].find((candidate) => candidate.textContent?.includes(label));
  assert.ok(button, `the dialog has no button labelled ${label}`);
  return button;
}

test('Ctrl+Enter calculates the current line and can put the result into the memo', async () => {
  const page = await openPage({ factory: await seededFactory() });
  await typeLine(page, '(1 + 2) * 7');
  const press = await pressKey(page, { key: 'Enter', code: 'Enter', ctrlKey: true });
  assert.equal(press.defaultPrevented, true);
  assert.equal(topDialog(page).querySelector('.calc-output')?.textContent, '21');
  // The line itself is unchanged: Ctrl+Enter did not also insert a blank line.
  assert.equal(page.editorText(), '(1 + 2) * 7');

  dialogButton(page, 'Insert into the memo').click();
  await wait(100);
  assert.equal(page.document.querySelector('dialog[open]'), null);
  assert.deepEqual([...page.document.querySelectorAll('.cm-line')].map((line) => line.textContent), ['(1 + 2) * 7', '# 21']);
  assert.deepEqual(page.errors, []);
  page.close();
});

test('kept variables are used by later calculations and are still there after a reload', async () => {
  const factory = await seededFactory();
  const page = await openPage({ factory });
  await typeLine(page, 'rate = 1250');
  await pickFromMenu(page, 'Calculate');
  assert.equal(topDialog(page).querySelector('.calc-output')?.textContent, 'rate = 1250');
  dialogButton(page, 'Keep the variables').click();
  await wait(100);

  await typeLine(page, 'rate * 3');
  await pressKey(page, { key: 'Enter', code: 'Enter', ctrlKey: true });
  assert.equal(topDialog(page).querySelector('.calc-output')?.textContent, '3750');
  assert.match(topDialog(page).querySelector('.calc-memory')?.textContent ?? '', /rate/);
  dialogButton(page, 'Close').click();
  await wait(AUTOSAVE_WAIT_MS);
  assert.deepEqual(page.errors, []);
  page.close();

  const reloaded = await openPage({ factory });
  assert.equal(reloaded.editorText(), 'rate * 3');
  await pressKey(reloaded, { key: 'Enter', code: 'Enter', ctrlKey: true });
  assert.equal(topDialog(reloaded).querySelector('.calc-output')?.textContent, '3750');
  reloaded.close();
});

test('a calculation that cannot be done is explained, and an empty line gives a hint', async () => {
  const page = await openPage({ factory: await seededFactory() });
  await typeLine(page, '10 / 0');
  await pressKey(page, { key: 'Enter', code: 'Enter', ctrlKey: true });
  assert.equal(topDialog(page).querySelector('.modal-message')?.textContent, 'Cannot divide by zero.');
  dialogButton(page, 'Close').click();
  await wait(50);
  assert.equal(page.document.querySelector('dialog[open]'), null);

  await typeLine(page, '');
  await pressKey(page, { key: 'Enter', code: 'Enter', ctrlKey: true });
  assert.equal(page.document.querySelector('dialog[open]'), null);
  assert.equal(page.noticeTexts().length, 1);
  assert.deepEqual(page.errors, []);
  page.close();
});

test('the address under the cursor is opened in a new tab that gets no handle on this page', async () => {
  const page = await openPage({ factory: await seededFactory() });
  await typeLine(page, 'https://example.com/docs?q=1 is where it is');
  await pickFromMenu(page, 'Open the web address');
  assert.deepEqual(page.opened, [['https://example.com/docs?q=1', '_blank', 'noopener,noreferrer']]);

  await typeLine(page, 'no address on this line');
  await pickFromMenu(page, 'Open the web address');
  assert.equal(page.opened.length, 1);
  assert.equal(page.noticeTexts().length, 1);
  assert.deepEqual(page.errors, []);
  page.close();
});

test('a right click on a selected address opens it, with a mouse but not by touch', async () => {
  const page = await openPage({ factory: await seededFactory() });
  await typeLine(page, 'see www.example.com/a for more');
  // Selecting through the search: "find next" selects the match.
  await pressKey(page, { key: 'f', code: 'KeyF', ctrlKey: true });
  await searchFor(page, 'www.example.com/a');
  page.document.querySelector<HTMLElement>('.cm-search button[name="next"]')?.click();
  await wait(100);

  const rightClick = (pointerType: string): Event => {
    const event = new page.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    page.document.querySelector('.cm-content')?.dispatchEvent(event);
    return event;
  };
  // A long press on a touch screen: the browser's own menu (copy, paste) must stay.
  assert.equal(rightClick('touch').defaultPrevented, false);
  assert.deepEqual(page.opened, []);

  assert.equal(rightClick('mouse').defaultPrevented, true);
  assert.deepEqual(page.opened, [['https://www.example.com/a', '_blank', 'noopener,noreferrer']]);
  assert.deepEqual(page.errors, []);
  page.close();
});

test('a right click on text that is not an address is left to the browser', async () => {
  const page = await openPage({ factory: await seededFactory() });
  await pressKey(page, { key: 'f', code: 'KeyF', ctrlKey: true });
  await searchFor(page, 'milk');
  page.document.querySelector<HTMLElement>('.cm-search button[name="next"]')?.click();
  await wait(100);
  const event = new page.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  page.document.querySelector('.cm-content')?.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(page.opened, []);
  page.close();
});

test('the search panel speaks the language of the app', async () => {
  const factory = await seededFactory();
  const storage = await openIndexedDbStorage(factory);
  await storage.setValue('settings', { language: 'ko', lineWrapping: true, editorFontSizeRem: 0.875 });
  storage.close();
  const page = await openPage({ factory });
  await pressKey(page, { key: 'f', code: 'KeyF', ctrlKey: true });
  assert.equal(searchField(page).placeholder, String.fromCharCode(0xcc3e, 0xae30));
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
