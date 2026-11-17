import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { createFileIo, pickFiles, toPickedFiles } from '../../src/ui/fileIo.ts';
import { createTestDom, nextTick } from '../helpers/dom.ts';
import type { TestDom } from '../helpers/dom.ts';

const INPUT_SELECTOR = 'input[type="file"]';

function textFile(dom: TestDom, name: string, content: string): File {
  return new dom.window.File([content], name, { type: 'text/plain' });
}

/** Simulates the user choosing files in the browser's dialog. */
function choose(dom: TestDom, input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new dom.window.Event('change'));
}

function currentInput(dom: TestDom): HTMLInputElement {
  const input = dom.document.querySelector<HTMLInputElement>(INPUT_SELECTOR);
  assert.ok(input, 'no file input on the page');
  return input;
}

test('toPickedFiles describes each file and reads its bytes', async () => {
  const dom = createTestDom();
  const picked = toPickedFiles([textFile(dom, 'a.txt', 'hello'), textFile(dom, 'empty.txt', '')]);
  assert.deepEqual(picked.map((file) => [file.name, file.size]), [['a.txt', 5], ['empty.txt', 0]]);
  const bytes = await picked[0]?.read();
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(bytes), 'hello');
  assert.equal((await picked[1]?.read())?.length, 0);
});

test('pickFiles opens the file dialog through a hidden input', () => {
  const dom = createTestDom();
  let clicks = 0;
  dom.document.addEventListener('click', (event) => {
    if ((event.target as Element).matches(INPUT_SELECTOR)) clicks += 1;
  });
  void pickFiles(dom.document, { multiple: true, accept: '.json' });
  const input = currentInput(dom);
  assert.equal(clicks, 1);
  assert.equal(input.hidden, true);
  assert.equal(input.multiple, true);
  assert.equal(input.accept, '.json');
});

test('pickFiles asks for a single file of any type unless told otherwise', () => {
  const dom = createTestDom();
  void pickFiles(dom.document, { multiple: false });
  const input = currentInput(dom);
  assert.equal(input.multiple, false);
  assert.equal(input.accept, '');
});

test('pickFiles resolves the chosen files and removes its input', async () => {
  const dom = createTestDom();
  const picking = pickFiles(dom.document, { multiple: true });
  choose(dom, currentInput(dom), [textFile(dom, 'a.txt', 'one'), textFile(dom, 'b.txt', 'two')]);
  const picked = await picking;
  assert.deepEqual(picked.map((file) => file.name), ['a.txt', 'b.txt']);
  assert.equal(new TextDecoder().decode(await picked[1]?.read()), 'two');
  assert.equal(dom.document.querySelector(INPUT_SELECTOR), null);
});

test('pickFiles resolves an empty list when the dialog is cancelled', async () => {
  const dom = createTestDom();
  const picking = pickFiles(dom.document, { multiple: true });
  currentInput(dom).dispatchEvent(new dom.window.Event('cancel'));
  assert.deepEqual(await picking, []);
  assert.equal(dom.document.querySelector(INPUT_SELECTOR), null);
});

test('an input left behind by a dialog that never answered is replaced by the next one', async () => {
  // Older browsers send no "cancel" event, so a dismissed dialog leaves its input waiting.
  const dom = createTestDom();
  void pickFiles(dom.document, { multiple: true });
  const picking = pickFiles(dom.document, { multiple: false });
  assert.equal(dom.document.querySelectorAll(INPUT_SELECTOR).length, 1);
  choose(dom, currentInput(dom), [textFile(dom, 'c.txt', 'three')]);
  await nextTick();
  assert.deepEqual((await picking).map((file) => file.name), ['c.txt']);
});

// --- createFileIo: the File System Access API where it exists ---------------

interface FakeHandle {
  name: string;
  content: number[];
  /** What happened to the handle's write streams, in order. */
  log: string[];
  failWrites: boolean;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
}

function fakeHandle(dom: TestDom, name: string, text: string): FakeHandle {
  const handle: FakeHandle = {
    name,
    content: [...new TextEncoder().encode(text)],
    log: [],
    failWrites: false,
    getFile: async () => new dom.window.File([new Uint8Array(handle.content)], name),
    createWritable: async () => {
      handle.log.push('open');
      let pending: number[] = [];
      return {
        async write(data) {
          if (handle.failWrites) throw new Error('disk full');
          pending = [...data];
          handle.log.push('write');
        },
        async close() {
          // As in the real API, the file changes only when the stream is closed.
          handle.content = pending;
          handle.log.push('close');
        },
        async abort() {
          handle.log.push('abort');
        },
      };
    },
  };
  return handle;
}

function abortError(dom: TestDom): Error {
  return new dom.window.DOMException('The user aborted a request.', 'AbortError');
}

function withPickers(dom: TestDom, pickers: { open?: (options: unknown) => Promise<unknown>; save?: (options: unknown) => Promise<unknown> }): Window {
  const win = dom.window as unknown as Window & Record<string, unknown>;
  if (pickers.open) win.showOpenFilePicker = pickers.open;
  if (pickers.save) win.showSaveFilePicker = pickers.save;
  return win;
}

test('with the file access API, picked files can be read and written back', async () => {
  const dom = createTestDom();
  const handle = fakeHandle(dom, 'notes.txt', 'old');
  const requests: unknown[] = [];
  const io = createFileIo(withPickers(dom, { open: async (options) => (requests.push(options), [handle]) }));

  const picked = await io.pickFiles({ multiple: true });
  assert.deepEqual(requests, [{ multiple: true }]);
  assert.deepEqual(picked.map((file) => [file.name, file.size]), [['notes.txt', 3]]);
  assert.equal(new TextDecoder().decode(await picked[0]?.read()), 'old');
  // No file input was needed.
  assert.equal(dom.document.querySelector(INPUT_SELECTOR), null);

  assert.equal(picked[0]?.writable?.name, 'notes.txt');
  await picked[0]?.writable?.write(new TextEncoder().encode('new text'));
  assert.equal(new TextDecoder().decode(new Uint8Array(handle.content)), 'new text');
  assert.deepEqual(handle.log, ['open', 'write', 'close']);
});

test('closing the file access dialog gives an empty list', async () => {
  const dom = createTestDom();
  const io = createFileIo(withPickers(dom, { open: async () => Promise.reject(abortError(dom)) }));
  assert.deepEqual(await io.pickFiles({ multiple: true }), []);
  assert.equal(dom.document.querySelector(INPUT_SELECTOR), null);
});

test('when the file access dialog is not allowed, the classic file input is used instead', async () => {
  const dom = createTestDom();
  const io = createFileIo(withPickers(dom, { open: async () => Promise.reject(new dom.window.DOMException('Not allowed', 'SecurityError')) }));
  const picking = io.pickFiles({ multiple: true });
  await nextTick();
  choose(dom, currentInput(dom), [textFile(dom, 'a.txt', 'one')]);
  const picked = await picking;
  assert.deepEqual(picked.map((file) => file.name), ['a.txt']);
  assert.equal(picked[0]?.writable, undefined);
});

test('a request limited to a file type uses the file input, which can filter', async () => {
  const dom = createTestDom();
  let pickerCalls = 0;
  const io = createFileIo(withPickers(dom, { open: async () => ((pickerCalls += 1), []) }));
  void io.pickFiles({ multiple: false, accept: '.json' });
  assert.equal(currentInput(dom).accept, '.json');
  assert.equal(pickerCalls, 0);
});

test('without the file access API, files are picked through the file input', async () => {
  const dom = createTestDom();
  const io = createFileIo(dom.window as unknown as Window);
  const picking = io.pickFiles({ multiple: true });
  choose(dom, currentInput(dom), [textFile(dom, 'a.txt', 'one')]);
  assert.deepEqual((await picking).map((file) => file.name), ['a.txt']);
});

test('saveAs writes to the file the user chose and returns it for later saves', async () => {
  const dom = createTestDom();
  const handle = fakeHandle(dom, 'chosen.txt', '');
  const requests: unknown[] = [];
  const io = createFileIo(withPickers(dom, { save: async (options) => (requests.push(options), handle) }));

  const target = await io.saveAs('suggested.txt', new TextEncoder().encode('content'));
  assert.deepEqual(requests, [{ suggestedName: 'suggested.txt' }]);
  assert.equal(target.kind, 'written');
  assert.equal(new TextDecoder().decode(new Uint8Array(handle.content)), 'content');

  assert.ok(target.kind === 'written');
  assert.equal(target.file.name, 'chosen.txt');
  await target.file.write(new TextEncoder().encode('again'));
  assert.equal(new TextDecoder().decode(new Uint8Array(handle.content)), 'again');
});

test('saveAs reports a closed dialog as cancelled and writes nothing', async () => {
  const dom = createTestDom();
  const io = createFileIo(withPickers(dom, { save: async () => Promise.reject(abortError(dom)) }));
  assert.deepEqual(await io.saveAs('a.txt', new Uint8Array([1])), { kind: 'cancelled' });
  assert.equal(dom.document.querySelector('a'), null);
});

test('saveAs rejects when writing fails, and abandons the half-written stream', async () => {
  const dom = createTestDom();
  const handle = fakeHandle(dom, 'chosen.txt', 'precious');
  handle.failWrites = true;
  const io = createFileIo(withPickers(dom, { save: async () => handle }));
  await assert.rejects(io.saveAs('a.txt', new Uint8Array([1])), /disk full/);
  assert.deepEqual(handle.log, ['open', 'abort']);
  assert.equal(new TextDecoder().decode(new Uint8Array(handle.content)), 'precious');
});

/** Records downloads: every link with a "download" attribute that gets clicked. */
function recordDownloads(dom: TestDom): { name: string; url: string }[] {
  const downloads: { name: string; url: string }[] = [];
  dom.document.addEventListener('click', (event) => {
    const link = event.target as HTMLAnchorElement;
    if (link.tagName === 'A' && link.hasAttribute('download')) {
      downloads.push({ name: link.download, url: link.href });
      // jsdom would try to navigate.
      event.preventDefault();
    }
  });
  return downloads;
}

async function downloadedBytes(url: string): Promise<number[]> {
  const blob = resolveObjectURL(url);
  assert.ok(blob, 'the download URL does not point to data');
  return [...new Uint8Array(await blob.arrayBuffer())];
}

test('without the file access API, saveAs hands the bytes to the browser as a download', async () => {
  const dom = createTestDom();
  const downloads = recordDownloads(dom);
  const io = createFileIo(dom.window as unknown as Window);
  const target = await io.saveAs('notes.txt', new Uint8Array([0xef, 0xbb, 0xbf, 0x61]));
  assert.deepEqual(target, { kind: 'downloaded' });
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0]?.name, 'notes.txt');
  // Exactly the bytes given: no conversion, no added or removed byte order mark.
  assert.deepEqual(await downloadedBytes(downloads[0]?.url ?? ''), [0xef, 0xbb, 0xbf, 0x61]);
  // The helper link does not stay on the page.
  assert.equal(dom.document.querySelector('a'), null);
});

test('when the save dialog is not allowed, saveAs falls back to a download', async () => {
  const dom = createTestDom();
  const downloads = recordDownloads(dom);
  const io = createFileIo(withPickers(dom, { save: async () => Promise.reject(new dom.window.DOMException('Not allowed', 'SecurityError')) }));
  assert.deepEqual(await io.saveAs('notes.txt', new Uint8Array([0x61])), { kind: 'downloaded' });
  assert.equal(downloads.length, 1);
});

test('an empty file can be downloaded', async () => {
  const dom = createTestDom();
  const downloads = recordDownloads(dom);
  await createFileIo(dom.window as unknown as Window).saveAs('empty.txt', new Uint8Array());
  assert.deepEqual(await downloadedBytes(downloads[0]?.url ?? ''), []);
});
