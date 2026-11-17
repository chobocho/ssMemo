import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOADING_INDICATOR_BYTES, MAX_FILE_BYTES, createLocalFiles, toFileName } from '../../src/app/localFiles.ts';
import type { FileNotice, LocalFiles, PickedFile, SaveTarget, WritableFile } from '../../src/app/localFiles.ts';
import type { ActiveDocument, OpenedFile, SavedToFile } from '../../src/app/workspace.ts';
import type { TextEncoding } from '../../src/lib/encoding.ts';
import type { DocumentSource } from '../../src/storage/storagePort.ts';

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
  /** What the workspace reports as the visible tab; a test sets it. */
  active: { document: ActiveDocument | undefined };
  /** The encoding the user picks in the dialog; undefined backs out. */
  answer: { encoding: TextEncoding | undefined };
  /** Encodings the dialog was opened with as the current one. */
  asked: TextEncoding[];
  redecoded: { tabId: string; text: string; source: DocumentSource }[];
  /** Whether the workspace accepts a new decoding. */
  redecodeAllowed: { value: boolean };
  /** Text of the visible tab. */
  text: { value: string | undefined };
  /** Requests to choose a place to save: the suggested name and the bytes. */
  saveRequests: { name: string; bytes: number[] }[];
  /** What the next such request leads to; an Error makes it fail. */
  saveOutcome: { value: SaveTarget | Error };
  /** Questions about rewriting a file in another encoding, and the answer given. */
  conversionQuestions: string[];
  allowConversion: { value: boolean };
  marked: { tabId: string; saved: SavedToFile }[];
  /** A file that records what is written to it; with `broken` every write fails. */
  writable(name: string, broken?: boolean): WritableFile & { written: number[][] };
  /** A file whose declared size can differ from its content, as for a file changed after it was picked. */
  file(name: string, content: readonly number[] | string, declaredSize?: number): PickedFile;
  /** A file that cannot be read. */
  brokenFile(name: string, declaredSize?: number): PickedFile;
}

function createHarness(tabLimit = Number.POSITIVE_INFINITY): Harness {
  const opened: OpenedFile[] = [];
  const notices: FileNotice[] = [];
  const events: string[] = [];
  const active: Harness['active'] = { document: undefined };
  const answer: Harness['answer'] = { encoding: undefined };
  const asked: TextEncoding[] = [];
  const redecoded: Harness['redecoded'] = [];
  const redecodeAllowed = { value: true };
  const text: Harness['text'] = { value: 'memo text' };
  const saveRequests: Harness['saveRequests'] = [];
  const saveOutcome: Harness['saveOutcome'] = { value: { kind: 'downloaded' } };
  const conversionQuestions: string[] = [];
  const allowConversion = { value: true };
  const marked: Harness['marked'] = [];
  const files = createLocalFiles({
    getText: () => text.value,
    async saveAs(name, bytes) {
      saveRequests.push({ name, bytes: [...bytes] });
      if (saveOutcome.value instanceof Error) throw saveOutcome.value;
      return saveOutcome.value;
    },
    async confirmConversion(fileName, from, to) {
      conversionQuestions.push(`${fileName}: ${from} -> ${to}`);
      return allowConversion.value;
    },
    async markSaved(tabId, saved) {
      marked.push({ tabId, saved });
    },
    getActiveDocument: () => active.document,
    redecode(tabId, text, source) {
      if (!redecodeAllowed.value) return false;
      redecoded.push({ tabId, text, source });
      return true;
    },
    async chooseEncoding(current) {
      asked.push(current);
      return answer.encoding;
    },
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
    active,
    answer,
    asked,
    redecoded,
    redecodeAllowed,
    text,
    saveRequests,
    saveOutcome,
    conversionQuestions,
    allowConversion,
    marked,
    writable(name, broken = false) {
      const written: number[][] = [];
      return {
        name,
        written,
        async write(bytes) {
          if (broken) throw new Error('permission denied');
          written.push([...bytes]);
        },
      };
    },
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
  assert.deepEqual(harness.opened.map(({ text, source }) => ({ text, source })), [
    { text: 'a\r\nb', source: { fileName: 'windows.txt', encoding: 'UTF-8', eol: 'crlf', hasBom: true } },
    { text: '\uC548\uB155\n', source: { fileName: 'legacy.txt', encoding: 'CP949', eol: 'lf', hasBom: false } },
    { text: '# title\n', source: { fileName: 'plain.md', encoding: 'UTF-8', eol: 'lf', hasBom: false } },
  ]);
  assert.deepEqual(harness.notices, []);
});

test('an empty file opens as an empty tab', async () => {
  const harness = createHarness();
  await harness.files.openFiles([harness.file('empty.txt', [])]);
  assert.deepEqual(harness.opened.map((file) => file.source), [{ fileName: 'empty.txt', encoding: 'UTF-8', eol: 'lf', hasBom: false }]);
  assert.equal(harness.opened[0]?.text, '');
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

test('an opened file comes with its bytes, so it can be decoded again', async () => {
  const harness = createHarness();
  await harness.files.openFiles([harness.file('legacy.txt', CP949_WORD)]);
  assert.deepEqual([...(harness.opened[0]?.bytes ?? [])], CP949_WORD);
});

// --- changing the encoding --------------------------------------------------

const CP949_SOURCE: DocumentSource = { fileName: 'legacy.txt', encoding: 'CP949', eol: 'lf', hasBom: false };

function fileTab(bytes: readonly number[] | undefined, source: DocumentSource = CP949_SOURCE, localFile?: WritableFile): ActiveDocument {
  return { tabId: 'tab-1', title: source.fileName, source, originalBytes: bytes ? new Uint8Array(bytes) : undefined, localFile };
}

function memoTab(title: string, localFile?: WritableFile): ActiveDocument {
  return { tabId: 'tab-1', title, source: undefined, originalBytes: undefined, localFile };
}

test('changeEncoding reads the same bytes again with the chosen encoding', async () => {
  const harness = createHarness();
  // UTF-16LE text without a byte order mark: "a", CR, LF, "b".
  harness.active.document = fileTab([0x61, 0x00, 0x0d, 0x00, 0x0a, 0x00, 0x62, 0x00]);
  harness.answer.encoding = 'UTF-16LE';
  await harness.files.changeEncoding();
  assert.deepEqual(harness.asked, ['CP949']);
  assert.deepEqual(harness.redecoded, [
    { tabId: 'tab-1', text: 'a\r\nb', source: { fileName: 'legacy.txt', encoding: 'UTF-16LE', eol: 'crlf', hasBom: false } },
  ]);
  assert.deepEqual(harness.notices, []);
});

test('changeEncoding does nothing when the user backs out or picks the encoding already in use', async () => {
  const harness = createHarness();
  harness.active.document = fileTab(CP949_WORD);
  await harness.files.changeEncoding();
  harness.answer.encoding = 'CP949';
  await harness.files.changeEncoding();
  assert.deepEqual(harness.redecoded, []);
  assert.deepEqual(harness.notices, []);
});

test('changeEncoding explains that a memo has no encoding to change', async () => {
  const harness = createHarness();
  harness.active.document = memoTab('memo');
  await harness.files.changeEncoding();
  assert.deepEqual(harness.notices, [{ kind: 'encoding-not-a-file' }]);
  assert.deepEqual(harness.asked, []);

  harness.notices.length = 0;
  harness.active.document = undefined;
  await harness.files.changeEncoding();
  assert.deepEqual(harness.notices, [{ kind: 'encoding-not-a-file' }]);
});

test('changeEncoding explains that an edited or restored file cannot be read again', async () => {
  const harness = createHarness();
  harness.active.document = fileTab(undefined);
  harness.answer.encoding = 'UTF-8';
  await harness.files.changeEncoding();
  assert.deepEqual(harness.notices, [{ kind: 'encoding-locked' }]);
  // Asking for an encoding first and refusing afterwards would be a wasted question.
  assert.deepEqual(harness.asked, []);
});

test('changeEncoding reports it when the workspace refuses the new text', async () => {
  // The tab was edited while the dialog was open.
  const harness = createHarness();
  harness.active.document = fileTab(CP949_WORD);
  harness.answer.encoding = 'UTF-8';
  harness.redecodeAllowed.value = false;
  await harness.files.changeEncoding();
  assert.deepEqual(harness.notices, [{ kind: 'encoding-locked' }]);
});

test('changeEncoding hints at trying again when the result looks garbled', async () => {
  const harness = createHarness();
  harness.active.document = fileTab(CP949_WORD);
  harness.answer.encoding = 'UTF-8';
  await harness.files.changeEncoding();
  assert.equal(harness.redecoded.length, 1);
  assert.deepEqual(harness.notices, [{ kind: 'file-garbled', fileName: 'legacy.txt', encoding: 'UTF-8' }]);
});

test('changeEncoding shows the loading indicator for a large file and removes it afterwards', async () => {
  const harness = createHarness();
  harness.active.document = fileTab([...new Uint8Array(LOADING_INDICATOR_BYTES).fill(0x61)]);
  harness.answer.encoding = 'UTF-8';
  await harness.files.changeEncoding();
  assert.equal(harness.events[0], 'show legacy.txt');
  assert.equal(harness.events[1], 'yield');
  assert.equal(harness.events.at(-1), 'hide legacy.txt');
  assert.equal(harness.redecoded.length, 1);
});

test('changeEncoding of a small file shows no indicator', async () => {
  const harness = createHarness();
  harness.active.document = fileTab(CP949_WORD);
  harness.answer.encoding = 'Johab';
  await harness.files.changeEncoding();
  assert.deepEqual(harness.events, []);
});

test('a file opened with write access keeps it', async () => {
  const harness = createHarness();
  const writable = harness.writable('notes.txt');
  await harness.files.openFiles([{ ...harness.file('notes.txt', 'text'), writable }]);
  assert.equal(harness.opened[0]?.writable, writable);
});

// --- saving to a local file -------------------------------------------------

const ascii = (text: string): number[] => [...text].map((character) => character.charCodeAt(0));
const CRLF_SOURCE: DocumentSource = { fileName: 'windows.txt', encoding: 'UTF-8', eol: 'crlf', hasBom: true };

test('toFileName turns a memo title into a name every system accepts', () => {
  assert.equal(toFileName('Shopping list'), 'Shopping list.txt');
  assert.equal(toFileName('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j.txt');
  assert.equal(toFileName('tab\there'), 'tab_here.txt');
  // Windows refuses names that end in a dot or a space.
  assert.equal(toFileName(' report. '), 'report.txt');
  assert.equal(toFileName('...'), 'memo.txt');
  assert.equal(toFileName(''), 'memo.txt');
});

test('saving a memo asks where to put it and writes plain UTF-8', async () => {
  const harness = createHarness();
  harness.active.document = memoTab('Shopping: list');
  harness.text.value = 'milk\neggs';
  await harness.files.saveToFile(false);
  assert.deepEqual(harness.saveRequests, [{ name: 'Shopping_ list.txt', bytes: ascii('milk\neggs') }]);
  // A memo stays a memo: no source is recorded for it.
  assert.deepEqual(harness.marked, [{ tabId: 'tab-1', saved: {} }]);
  assert.deepEqual(harness.conversionQuestions, []);
});

test('saving a file keeps its name, line ending and byte order mark', async () => {
  const harness = createHarness();
  harness.active.document = fileTab(undefined, CRLF_SOURCE);
  harness.text.value = 'a\nb';
  await harness.files.saveToFile(false);
  assert.deepEqual(harness.saveRequests, [{ name: 'windows.txt', bytes: [0xef, 0xbb, 0xbf, ...ascii('a\r\nb')] }]);
  assert.deepEqual(harness.marked, [{ tabId: 'tab-1', saved: { source: CRLF_SOURCE } }]);
});

test('a file with a known location is written in place without asking', async () => {
  const harness = createHarness();
  const writable = harness.writable('windows.txt');
  harness.active.document = fileTab(undefined, CRLF_SOURCE, writable);
  harness.text.value = 'a';
  await harness.files.saveToFile(false);
  assert.deepEqual(writable.written, [[0xef, 0xbb, 0xbf, 0x61]]);
  assert.deepEqual(harness.saveRequests, []);
  assert.deepEqual(harness.marked, [{ tabId: 'tab-1', saved: { source: CRLF_SOURCE, localFile: writable } }]);
  assert.deepEqual(harness.notices, [{ kind: 'file-saved', fileName: 'windows.txt' }]);
});

test('"save as" asks for a place even when one is known, and follows the new file', async () => {
  const harness = createHarness();
  const old = harness.writable('windows.txt');
  const chosen = harness.writable('copy.txt');
  harness.active.document = fileTab(undefined, CRLF_SOURCE, old);
  harness.text.value = 'a';
  harness.saveOutcome.value = { kind: 'written', file: chosen };
  await harness.files.saveToFile(true);
  assert.deepEqual(old.written, []);
  assert.equal(harness.saveRequests[0]?.name, 'windows.txt');
  assert.deepEqual(harness.marked, [{ tabId: 'tab-1', saved: { source: { ...CRLF_SOURCE, fileName: 'copy.txt' }, localFile: chosen } }]);
  assert.deepEqual(harness.notices, [{ kind: 'file-saved', fileName: 'copy.txt' }]);
});

test('a download is recorded without a location, and the browser reports it itself', async () => {
  const harness = createHarness();
  harness.active.document = fileTab(undefined, CRLF_SOURCE);
  harness.saveOutcome.value = { kind: 'downloaded' };
  await harness.files.saveToFile(false);
  assert.deepEqual(harness.marked, [{ tabId: 'tab-1', saved: { source: CRLF_SOURCE } }]);
  assert.deepEqual(harness.notices, []);
});

test('closing the save dialog changes nothing', async () => {
  const harness = createHarness();
  harness.active.document = fileTab(undefined, CRLF_SOURCE);
  harness.saveOutcome.value = { kind: 'cancelled' };
  await harness.files.saveToFile(false);
  assert.deepEqual(harness.marked, []);
  assert.deepEqual(harness.notices, []);
});

test('a CP949 file is saved as UTF-8 only after the user agreed', async () => {
  const harness = createHarness();
  const writable = harness.writable('legacy.txt');
  harness.active.document = fileTab(undefined, { ...CP949_SOURCE, eol: 'crlf' }, writable);
  harness.text.value = 'a\nb';

  harness.allowConversion.value = false;
  await harness.files.saveToFile(false);
  assert.deepEqual(harness.conversionQuestions, ['legacy.txt: CP949 -> UTF-8']);
  assert.deepEqual(writable.written, []);
  assert.deepEqual(harness.marked, []);

  harness.allowConversion.value = true;
  await harness.files.saveToFile(false);
  assert.deepEqual(writable.written, [ascii('a\r\nb')]);
  assert.deepEqual(harness.marked, [
    { tabId: 'tab-1', saved: { source: { fileName: 'legacy.txt', encoding: 'UTF-8', eol: 'crlf', hasBom: false }, localFile: writable } },
  ]);
});

test('a UTF-16 file is written back as UTF-16 without any question', async () => {
  const harness = createHarness();
  const source: DocumentSource = { fileName: 'wide.txt', encoding: 'UTF-16LE', eol: 'lf', hasBom: true };
  harness.active.document = fileTab(undefined, source);
  harness.text.value = 'a';
  await harness.files.saveToFile(false);
  assert.deepEqual(harness.saveRequests[0]?.bytes, [0xff, 0xfe, 0x61, 0x00]);
  assert.deepEqual(harness.conversionQuestions, []);
});

test('a failed write is reported and nothing is recorded as saved', async () => {
  const harness = createHarness();
  harness.active.document = fileTab(undefined, CRLF_SOURCE, harness.writable('windows.txt', true));
  await harness.files.saveToFile(false);
  assert.deepEqual(harness.notices, [{ kind: 'file-save-failed', fileName: 'windows.txt' }]);
  assert.deepEqual(harness.marked, []);

  harness.notices.length = 0;
  harness.active.document = memoTab('memo');
  harness.saveOutcome.value = new Error('disk full');
  await harness.files.saveToFile(false);
  assert.deepEqual(harness.notices, [{ kind: 'file-save-failed', fileName: 'memo.txt' }]);
  assert.deepEqual(harness.marked, []);
});

test('saving does nothing when there is no tab or no text to save', async () => {
  const harness = createHarness();
  await harness.files.saveToFile(false);
  harness.active.document = memoTab('memo');
  harness.text.value = undefined;
  await harness.files.saveToFile(false);
  assert.deepEqual(harness.saveRequests, []);
  assert.deepEqual(harness.notices, []);
});

test('an empty memo can be saved as an empty file', async () => {
  const harness = createHarness();
  harness.active.document = memoTab('memo');
  harness.text.value = '';
  await harness.files.saveToFile(false);
  assert.deepEqual(harness.saveRequests, [{ name: 'memo.txt', bytes: [] }]);
});
