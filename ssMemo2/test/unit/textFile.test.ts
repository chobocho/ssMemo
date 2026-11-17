import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEXT_ENCODINGS } from '../../src/lib/encoding.ts';
import { EOLS, detectEol, getSaveFormat, isEol, looksBinary, readTextFile, writeTextFile } from '../../src/lib/textFile.ts';
import type { Eol, TextFormat } from '../../src/lib/textFile.ts';

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const EOL_TEXT: Readonly<Record<Eol, string>> = { lf: '\n', crlf: '\r\n', cr: '\r' };
// "an-nyeong" in CP949.
const CP949_WORD = [0xbe, 0xc8, 0xb3, 0xe7];

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const ascii = (text: string): number[] => [...text].map((character) => character.charCodeAt(0));

test('the list of line endings names every supported one', () => {
  assert.deepEqual([...EOLS], ['lf', 'crlf', 'cr']);
  for (const eol of EOLS) assert.equal(isEol(eol), true, eol);
  for (const other of ['LF', '\n', '', undefined, 1]) assert.equal(isEol(other), false, String(other));
});

test('detectEol recognizes each line ending', () => {
  assert.equal(detectEol('a\nb\n'), 'lf');
  assert.equal(detectEol('a\r\nb\r\n'), 'crlf');
  assert.equal(detectEol('a\rb\r'), 'cr');
});

test('text without a line break counts as LF', () => {
  assert.equal(detectEol(''), 'lf');
  assert.equal(detectEol('one line'), 'lf');
});

test('detectEol picks the most frequent line ending of a mixed file', () => {
  assert.equal(detectEol('a\r\nb\r\nc\n'), 'crlf');
  assert.equal(detectEol('a\nb\nc\r\n'), 'lf');
  assert.equal(detectEol('a\rb\rc\n'), 'cr');
});

test('detectEol counts CRLF as one line ending, not as CR plus LF', () => {
  assert.equal(detectEol('a\r\n'), 'crlf');
  // One CRLF and one lone LF: a tie goes to the simpler ending.
  assert.equal(detectEol('a\r\nb\n'), 'lf');
  // A lone CR directly before a CRLF.
  assert.equal(detectEol('a\r\r\nb\r\n'), 'crlf');
});

test('readTextFile reports encoding, byte order mark and line ending, and leaves the text as it is', () => {
  const content = readTextFile(bytes(...UTF8_BOM, ...ascii('a\r\nb\r\n')));
  assert.deepEqual(content.format, { encoding: 'UTF-8', eol: 'crlf', hasBom: true });
  assert.equal(content.text, 'a\r\nb\r\n');
});

test('readTextFile of an empty file gives empty UTF-8 text with LF', () => {
  assert.deepEqual(readTextFile(bytes()), { text: '', format: { encoding: 'UTF-8', eol: 'lf', hasBom: false } });
});

test('readTextFile detects legacy Korean encodings', () => {
  const content = readTextFile(bytes(...CP949_WORD, 0x0d, 0x0a));
  assert.deepEqual(content.format, { encoding: 'CP949', eol: 'crlf', hasBom: false });
  assert.equal(content.text, '\uC548\uB155\r\n');
});

test('readTextFile can be told which encoding to use', () => {
  const content = readTextFile(bytes(0x61, 0x00, 0x0d, 0x00, 0x62, 0x00), 'UTF-16LE');
  assert.deepEqual(content, { text: 'a\rb', format: { encoding: 'UTF-16LE', eol: 'cr', hasBom: false } });
});

test('writeTextFile applies the line ending to text that uses LF', () => {
  assert.deepEqual([...writeTextFile('a\nb\n', { encoding: 'UTF-8', eol: 'crlf', hasBom: false })], ascii('a\r\nb\r\n'));
  assert.deepEqual([...writeTextFile('a\nb\n', { encoding: 'UTF-8', eol: 'cr', hasBom: false })], ascii('a\rb\r'));
  assert.deepEqual([...writeTextFile('a\nb\n', { encoding: 'UTF-8', eol: 'lf', hasBom: false })], ascii('a\nb\n'));
});

test('writeTextFile does not double line endings that are already there', () => {
  assert.deepEqual([...writeTextFile('a\r\nb\rc\n', { encoding: 'UTF-8', eol: 'crlf', hasBom: false })], ascii('a\r\nb\r\nc\r\n'));
  assert.deepEqual([...writeTextFile('a\r\nb\rc\n', { encoding: 'UTF-8', eol: 'lf', hasBom: false })], ascii('a\nb\nc\n'));
});

test('writeTextFile adds the byte order mark only when asked', () => {
  assert.deepEqual([...writeTextFile('a', { encoding: 'UTF-8', eol: 'lf', hasBom: true })], [...UTF8_BOM, 0x61]);
  assert.deepEqual([...writeTextFile('a', { encoding: 'UTF-8', eol: 'lf', hasBom: false })], [0x61]);
  assert.deepEqual([...writeTextFile('a', { encoding: 'UTF-16LE', eol: 'lf', hasBom: true })], [0xff, 0xfe, 0x61, 0x00]);
  assert.deepEqual([...writeTextFile('a', { encoding: 'UTF-16BE', eol: 'lf', hasBom: true })], [0xfe, 0xff, 0x00, 0x61]);
  assert.deepEqual([...writeTextFile('a', { encoding: 'UTF-16BE', eol: 'lf', hasBom: false })], [0x00, 0x61]);
});

test('writeTextFile of empty text is empty, or just the byte order mark', () => {
  assert.deepEqual([...writeTextFile('', { encoding: 'UTF-8', eol: 'crlf', hasBom: false })], []);
  assert.deepEqual([...writeTextFile('', { encoding: 'UTF-16LE', eol: 'crlf', hasBom: true })], [0xff, 0xfe]);
});

test('a file that is read and written back without changes is byte for byte the same', () => {
  // Korean, an emoji outside the basic plane, and several lines.
  const lines = ['\uC548\uB155 hello', '\u{1F600}', '', 'end'];
  for (const encoding of ['UTF-8', 'UTF-16LE', 'UTF-16BE'] as const) {
    for (const eol of EOLS) {
      for (const hasBom of [true, false]) {
        const format: TextFormat = { encoding, eol, hasBom };
        const original = writeTextFile(lines.join('\n'), format);
        // UTF-16 without a mark cannot be detected, so it is read with the encoding given.
        const content = readTextFile(original, hasBom || encoding === 'UTF-8' ? undefined : encoding);
        assert.deepEqual(content.format, format);
        assert.equal(content.text, lines.join(EOL_TEXT[eol]));
        // The editor hands the text back with LF line breaks.
        const edited = content.text.replace(/\r\n?/g, '\n');
        assert.deepEqual([...writeTextFile(edited, content.format)], [...original], JSON.stringify(format));
      }
    }
  }
});

test('getSaveFormat keeps formats that can be written', () => {
  for (const encoding of ['UTF-8', 'UTF-16LE', 'UTF-16BE'] as const) {
    const format: TextFormat = { encoding, eol: 'crlf', hasBom: true };
    assert.deepEqual(getSaveFormat(format), format);
  }
});

test('getSaveFormat returns the format alone, without other fields of what it was given', () => {
  const source = { fileName: 'old-name.txt', encoding: 'UTF-8', eol: 'lf', hasBom: false } as const;
  assert.deepEqual(getSaveFormat(source), { encoding: 'UTF-8', eol: 'lf', hasBom: false });
});

test('getSaveFormat turns legacy Korean encodings into UTF-8 without a mark, keeping the line ending', () => {
  for (const encoding of ['CP949', 'Johab'] as const) {
    assert.deepEqual(getSaveFormat({ encoding, eol: 'crlf', hasBom: false }), { encoding: 'UTF-8', eol: 'crlf', hasBom: false });
  }
});

test('every encoding has a save format that writeTextFile accepts', () => {
  for (const encoding of TEXT_ENCODINGS) {
    const format = getSaveFormat({ encoding, eol: 'lf', hasBom: false });
    assert.ok(writeTextFile('a', format).length > 0, encoding);
  }
});

test('writeTextFile refuses an encoding it cannot produce instead of writing something else', () => {
  assert.throws(() => writeTextFile('a', { encoding: 'CP949', eol: 'lf', hasBom: false }), /CP949/);
  assert.throws(() => writeTextFile('a', { encoding: 'Johab', eol: 'lf', hasBom: false }), /Johab/);
});

test('looksBinary is false for text in any supported encoding', () => {
  assert.equal(looksBinary(bytes()), false);
  assert.equal(looksBinary(bytes(...ascii('plain text\r\n\twith a tab'))), false);
  assert.equal(looksBinary(bytes(...CP949_WORD)), false);
  // UTF-16 text is full of zero bytes; the mark tells it apart from binary data.
  assert.equal(looksBinary(bytes(0xff, 0xfe, 0x61, 0x00)), false);
  assert.equal(looksBinary(bytes(0xfe, 0xff, 0x00, 0x61)), false);
});

test('looksBinary is true for data with zero bytes', () => {
  // The first bytes of a PNG file.
  assert.equal(looksBinary(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d)), true);
  assert.equal(looksBinary(bytes(0x61, 0x00, 0x62)), true);
});

test('looksBinary examines only the beginning of the file', () => {
  const big = new Uint8Array(20_000).fill(0x61);
  big[19_999] = 0;
  assert.equal(looksBinary(big), false);
  big[100] = 0;
  assert.equal(looksBinary(big), true);
});
