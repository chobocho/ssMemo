import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOADING_INDICATOR_BYTES, MAX_FILE_BYTES, createLocalFiles } from '../../src/app/localFiles.ts';
import type { FileNotice, LocalFiles, PickedFile } from '../../src/app/localFiles.ts';
import type { OpenedFile } from '../../src/app/workspace.ts';

const UTF8_BOM = [0xef, 0xbb, 0xbf];
// "an-nyeong" in CP949; not valid UTF-8.
const CP949_WORD = [0xbe, 0xc8, 0xb3, 0xe7];
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d];

interface Harness {
  files: LocalFiles;
  opened: OpenedFile[];
  notices: FileNotice[];
  /** Everything that happened, in order: "show a.txt", "yield", "read a.txt", "open a.txt", "hide a.txt". */
  events: string[];
  /** A file whose declared size can differ from its content, as for a file changed after it was picked. */
  file(name: string, content: readonly number[] | string, declaredSize?: number): PickedFile;
  /** A file that cannot be read. */
  brokenFile(name: string, declaredSize?: number): PickedFile;
}

function createHarness(tabLimit = Number.POSITIVE_INFINITY): Harness {
  const opened: OpenedFile[] = [];
  const notices: FileNotice[] = [];
  const events: string[] = [];
  const files = createLocalFiles({
    openFile(file) {
      if (opened.length >= tabLimit) return false;
      events.push(`open ${file.source.fileName}`);
      opened.push(file);
      return true;
    },
    onNotice: (notice) => notices.push(notice),
    showLoading(fileName) {
      events.push(`show ${fileName}`);
      return () => events.push(`hide ${fileName}`);
    },
    async yieldToUi() {
      events.push('yield');
    },
  });
  return {
    files,
    opened,
    notices,
    events,
    file(name, content, declaredSize) {
      const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
      return {
        name,
        size: declaredSize ?? bytes.length,
        async read() {
          events.push(`read ${name}`);
          return bytes;
        },
      };
    },
    brokenFile(name, declaredSize = 1) {
      return {
        name,
        size: declaredSize,
        async read() {
          events.push(`read ${name}`);
          throw new Error('the file was removed');
        },
      };
    },
  };
}

test('opening no files does nothing', async () => {
  const harness = createHarness();
  await harness.files.openFiles([]);
  assert.deepEqual(harness.events, []);
  assert.deepEqual(harness.notices, []);
});

test('each file is decoded and opened, in the order given', async () => {
  const harness = createHarness();
  await harness.files.openFiles([
    harness.file('windows.txt', [...UTF8_BOM, 0x61, 0x0d, 0x0a, 0x62]),
    harness.file('legacy.txt', [...CP949_WORD, 0x0a]),
    harness.file('plain.md', '# title\n'),
  ]);
  assert.deepEqual(harness.opened, [
    { text: 'a\r\nb', source: { fileName: 'windows.txt', encoding: 'UTF-8', eol: 'crlf', hasBom: true } },
    { text: '\uC548\uB155\n', source: { fileName: 'legacy.txt', encoding: 'CP949', eol: 'lf', hasBom: false } },
    { text: '# title\n', source: { fileName: 'plain.md', encoding: 'UTF-8', eol: 'lf', hasBom: false } },
  ]);
  assert.deepEqual(harness.notices, []);
});

test('an empty file opens as an empty tab', async () => {
  const harness = createHarness();
  await harness.files.openFiles([harness.file('empty.txt', [])]);
  assert.deepEqual(harness.opened, [{ text: '', source: { fileName: 'empty.txt', encoding: 'UTF-8', eol: 'lf', hasBom: false } }]);
});

test('a file over the size limit is refused without being read', async () => {
  const harness = createHarness();
  await harness.files.openFiles([harness.file('huge.log', 'x', MAX_FILE_BYTES + 1), harness.file('ok.txt', 'fine')]);
  assert.deepEqual(harness.notices, [{ kind: 'file-too-large', fileName: 'huge.log', maxBytes: MAX_FILE_BYTES }]);
  assert.equal(harness.events.includes('read huge.log'), false);
  assert.deepEqual(harness.opened.map((file) => file.source.fileName), ['ok.txt']);
});

test('a file of exactly the size limit is accepted', async () => {
  const harness = createHarness();
  await harness.files.openFiles([harness.file('limit.txt', 'x', MAX_FILE_BYTES)]);
  assert.deepEqual(harness.notices, []);
  assert.equal(harness.opened.length, 1);
});

test('a file that turns out larger than it claimed is refused after reading', async () => {
  const harness = createHarness();
  const grown = { name: 'grown.txt', size: 10, read: async () => new Uint8Array(MAX_FILE_BYTES + 1).fill(0x61) };
  await harness.files.openFiles([grown]);
  assert.deepEqual(harness.notices, [{ kind: 'file-too-large', fileName: 'grown.txt', maxBytes: MAX_FILE_BYTES }]);
  assert.deepEqual(harness.opened, []);
});

test('a file that is not text is refused', async () => {
  const harness = createHarness();
  await harness.files.openFiles([harness.file('photo.png', PNG_HEADER), harness.file('ok.txt', 'fine')]);
  assert.deepEqual(harness.notices, [{ kind: 'file-not-text', fileName: 'photo.png' }]);
  assert.deepEqual(harness.opened.map((file) => file.source.fileName), ['ok.txt']);
});

test('a file that cannot be read is reported and the remaining files are still opened', async () => {
  const harness = createHarness();
  await harness.files.openFiles([harness.brokenFile('gone.txt'), harness.file('ok.txt', 'fine')]);
  assert.deepEqual(harness.notices, [{ kind: 'file-unreadable', fileName: 'gone.txt' }]);
  assert.deepEqual(harness.opened.map((file) => file.source.fileName), ['ok.txt']);
});

test('when no more tabs can be opened the remaining files are not even read', async () => {
  const harness = createHarness(1);
  await harness.files.openFiles([harness.file('1.txt', 'one'), harness.file('2.txt', 'two'), harness.file('3.txt', 'three')]);
  assert.deepEqual(harness.opened.map((file) => file.source.fileName), ['1.txt']);
  assert.equal(harness.events.includes('read 3.txt'), false);
  // The workspace itself tells the user about the tab limit.
  assert.deepEqual(harness.notices, []);
});

test('text that looks wrongly decoded is opened with a hint to try another encoding', async () => {
  const harness = createHarness();
  // Invalid as UTF-8 and nonsense as CP949 and Johab.
  await harness.files.openFiles([harness.file('odd.txt', [0xff, 0xff, 0xff, 0xff, 0x61])]);
  assert.equal(harness.opened.length, 1);
  assert.deepEqual(harness.notices, [{ kind: 'file-garbled', fileName: 'odd.txt', encoding: 'CP949' }]);
});

test('a small file opens without a loading indicator and without pauses', async () => {
  const harness = createHarness();
  await harness.files.openFiles([harness.file('small.txt', 'x', LOADING_INDICATOR_BYTES - 1)]);
  assert.deepEqual(harness.events, ['read small.txt', 'open small.txt']);
});

test('a large file shows a loading indicator from before it is read until after it is opened', async () => {
  const harness = createHarness();
  await harness.files.openFiles([harness.file('large.txt', 'x', LOADING_INDICATOR_BYTES)]);
  const { events } = harness;
  assert.equal(events[0], 'show large.txt');
  // The browser gets a chance to draw the indicator before the slow work starts.
  assert.equal(events[1], 'yield');
  assert.ok(events.indexOf('yield') < events.indexOf('read large.txt'));
  assert.ok(events.indexOf('read large.txt') < events.indexOf('open large.txt'));
  assert.equal(events.at(-1), 'hide large.txt');
  assert.equal(events.filter((event) => event === 'show large.txt').length, 1);
  // Between the steps as well, so a slow phone stays responsive.
  assert.ok(events.filter((event) => event === 'yield').length >= 3);
});

test('the loading indicator is removed when the file cannot be read or is refused', async () => {
  const harness = createHarness();
  await harness.files.openFiles([
    harness.brokenFile('gone.txt', LOADING_INDICATOR_BYTES),
    harness.file('photo.png', PNG_HEADER, LOADING_INDICATOR_BYTES),
  ]);
  const { events } = harness;
  assert.ok(events.indexOf('hide gone.txt') > events.indexOf('read gone.txt'));
  assert.ok(events.indexOf('hide photo.png') > events.indexOf('read photo.png'));
  assert.equal(events.filter((event) => event.startsWith('show')).length, 2);
  assert.equal(events.filter((event) => event.startsWith('hide')).length, 2);
});

test('the loading indicator is removed when no tab is left for the file', async () => {
  const harness = createHarness(0);
  await harness.files.openFiles([harness.file('large.txt', 'x', LOADING_INDICATOR_BYTES)]);
  assert.equal(harness.events.at(-1), 'hide large.txt');
});
