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
