import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEXT_ENCODINGS, decodeText, decodeTextAs, isTextEncoding, looksGarbled } from '../../src/lib/encoding.ts';

const REPLACEMENT = '\uFFFD';
// The same two syllables in each encoding. Escapes are used because Korean text may only appear
// literally in the Korean message catalog.
const ANNYEONG = '\uC548\uB155';
const ANNYEONG_UTF8 = [0xec, 0x95, 0x88, 0xeb, 0x85, 0x95];
const ANNYEONG_CP949 = [0xbe, 0xc8, 0xb3, 0xe7];
const HANGEUL = '\uD55C\uAE00';
const HANGEUL_JOHAB = [0xd0, 0x65, 0x8b, 0x69];

// Reference data produced by an independent Johab codec (Python's), not by the code under test.
// ssMemoWeb's own tests used byte values that no real Johab file contains, which hid wrong tables.
const JOHAB_REFERENCE = [
  {
    covers: 'every initial consonant',
    text: '\uAC00\uAE4C\uB098\uB2E4\uB530\uB77C\uB9C8\uBC14\uBE60\uC0AC\uC2F8\uC544\uC790\uC9DC\uCC28\uCE74\uD0C0\uD30C\uD558',
    hex: '88618c619061946198619c61a061a461a861ac61b061b461b861bc61c061c461c861cc61d061',
  },
  {
    covers: 'every vowel',
    text: '\uAC00\uAC1C\uAC38\uAC54\uAC70\uAC8C\uACA8\uACC4\uACE0\uACFC\uAD18\uAD34\uAD50\uAD6C\uAD88\uADA4\uADC0\uADDC\uADF8\uAE14\uAE30',
    hex: '8861888188a188c188e189418961898189a189c189e18a418a618a818aa18ac18ae18b418b618b818ba1',
  },
  {
    covers: 'every final consonant',
    text: '\uAC00\uAC01\uAC02\uAC03\uAC04\uAC05\uAC06\uAC07\uAC08\uAC09\uAC0A\uAC0B\uAC0C\uAC0D\uAC0E\uAC0F\uAC10\uAC11\uAC12\uAC13\uAC14\uAC15\uAC16\uAC17\uAC18\uAC19\uAC1A\uAC1B',
    hex: '886188628863886488658866886788688869886a886b886c886d886e886f887088718873887488758876887788788879887a887b887c887d',
  },
  {
    covers: 'a sentence with spaces and punctuation',
    text: '\uC548\uB155\uD558\uC138\uC694, \uC870\uD569\uD615 \uD14C\uC2A4\uD2B8\uC785\uB2C8\uB2E4.',
    hex: 'b4659177d061ad41b6612c20b9a1d073d17720c941af61cb61b7b393a194612e',
  },
] as const;
const GA = '\uAC00';

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const fromHex = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, 'hex'));

function repeat(values: readonly number[], times: number): Uint8Array {
  const result = new Uint8Array(values.length * times);
  for (let i = 0; i < times; i++) result.set(values, i * values.length);
  return result;
}

test('the list of encodings names every supported one', () => {
  assert.deepEqual([...TEXT_ENCODINGS], ['UTF-8', 'UTF-16LE', 'UTF-16BE', 'CP949', 'Johab']);
});

test('isTextEncoding accepts exactly the listed names', () => {
  for (const encoding of TEXT_ENCODINGS) assert.equal(isTextEncoding(encoding), true, encoding);
  for (const other of ['utf-8', 'EUC-KR', '', undefined, null, 8]) assert.equal(isTextEncoding(other), false, String(other));
});

test('valid UTF-8 is detected', () => {
  assert.deepEqual(decodeText(bytes(...ANNYEONG_UTF8)), { text: ANNYEONG, encoding: 'UTF-8', hasBom: false });
});

test('plain ASCII counts as UTF-8', () => {
  assert.deepEqual(decodeText(bytes(0x61, 0x0a, 0x62)), { text: 'a\nb', encoding: 'UTF-8', hasBom: false });
});

test('an empty file is empty UTF-8 text', () => {
  assert.deepEqual(decodeText(bytes()), { text: '', encoding: 'UTF-8', hasBom: false });
});

test('a UTF-8 byte order mark is reported and left out of the text', () => {
  assert.deepEqual(decodeText(bytes(0xef, 0xbb, 0xbf, ...ANNYEONG_UTF8)), { text: ANNYEONG, encoding: 'UTF-8', hasBom: true });
  assert.deepEqual(decodeText(bytes(0xef, 0xbb, 0xbf)), { text: '', encoding: 'UTF-8', hasBom: true });
});

test('only the first byte order mark is removed', () => {
  // A second U+FEFF is a character of the text (zero width no-break space).
  const decoded = decodeText(bytes(0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x61));
  assert.equal(decoded.text, '\uFEFFa');
  assert.equal(decoded.hasBom, true);
});

test('UTF-16 is detected by its byte order mark, in either byte order', () => {
  assert.deepEqual(decodeText(bytes(0xff, 0xfe, 0x61, 0x00, 0x00, 0xac)), { text: `a${GA}`, encoding: 'UTF-16LE', hasBom: true });
  assert.deepEqual(decodeText(bytes(0xfe, 0xff, 0x00, 0x61, 0xac, 0x00)), { text: `a${GA}`, encoding: 'UTF-16BE', hasBom: true });
});

test('UTF-16 surrogate pairs decode to one character', () => {
  // U+1F600 is D83D DE00 in UTF-16.
  assert.equal(decodeText(bytes(0xff, 0xfe, 0x3d, 0xd8, 0x00, 0xde)).text, '\u{1F600}');
  assert.equal(decodeText(bytes(0xfe, 0xff, 0xd8, 0x3d, 0xde, 0x00)).text, '\u{1F600}');
});

test('a UTF-16 file cut off in the middle of a character still decodes', () => {
  const decoded = decodeText(bytes(0xff, 0xfe, 0x61, 0x00, 0x62));
  assert.equal(decoded.encoding, 'UTF-16LE');
  assert.equal(decoded.text, `a${REPLACEMENT}`);
});

test('bytes that are not UTF-8 are read as CP949', () => {
  assert.deepEqual(decodeText(bytes(...ANNYEONG_CP949)), { text: ANNYEONG, encoding: 'CP949', hasBom: false });
});

test('CP949 text mixed with ASCII and line breaks keeps both', () => {
  const decoded = decodeText(bytes(0x61, ...ANNYEONG_CP949, 0x0d, 0x0a, 0x62));
  assert.equal(decoded.encoding, 'CP949');
  assert.equal(decoded.text, `a${ANNYEONG}\r\nb`);
});

test('Johab is detected when the bytes make no sense as CP949', () => {
  const decoded = decodeText(repeat(HANGEUL_JOHAB, 5));
  assert.equal(decoded.encoding, 'Johab');
  assert.equal(decoded.text, HANGEUL.repeat(5));
  assert.equal(decoded.hasBom, false);
});

test('a short Johab sentence is detected too', () => {
  const sentence = JOHAB_REFERENCE[3];
  assert.deepEqual(decodeText(fromHex(sentence.hex)), { text: sentence.text, encoding: 'Johab', hasBom: false });
});

test('ordinary CP949 text is not mistaken for Johab', () => {
  // These bytes happen to be valid Johab syllables as well; CP949 is far more common and wins.
  assert.equal(decodeText(repeat(ANNYEONG_CP949, 50)).encoding, 'CP949');
});

test('bytes that are damaged in every encoding are reported as CP949', () => {
  const decoded = decodeText(bytes(0xff, 0xff, 0xff, 0x61));
  assert.equal(decoded.encoding, 'CP949');
  assert.ok(decoded.text.endsWith('a'));
});

for (const reference of JOHAB_REFERENCE) {
  test(`Johab reference data decodes exactly: ${reference.covers}`, () => {
    assert.equal(decodeTextAs(fromHex(reference.hex), 'Johab').text, reference.text);
  });
}

test('Johab syllables decode by their bit pattern', () => {
  assert.equal(decodeTextAs(bytes(0x88, 0x61), 'Johab').text, GA);
  assert.equal(decodeTextAs(bytes(0xd0, 0x65), 'Johab').text, '\uD55C');
  assert.equal(decodeTextAs(bytes(0x8b, 0x69), 'Johab').text, '\uAE00');
  // The last syllable of the Unicode block.
  assert.equal(decodeTextAs(bytes(0xd3, 0xbd), 'Johab').text, '\uD7A3');
  assert.equal(decodeTextAs(bytes(0x61, 0x88, 0x61, 0x62), 'Johab').text, `a${GA}b`);
});

test('Johab bytes that are not a syllable become a replacement character', () => {
  // 0xD9 0x31 is in the symbol area, which is not mapped.
  assert.equal(decodeTextAs(bytes(0xd9, 0x31, 0x61), 'Johab').text, `${REPLACEMENT}a`);
  // A lead byte at the very end has no second byte.
  assert.equal(decodeTextAs(bytes(0x61, 0x88), 'Johab').text, `a${REPLACEMENT}`);
});

test('a stray Johab lead byte does not swallow the line break after it', () => {
  // ssMemoWeb dropped the byte after any unmapped lead byte, joining two lines into one.
  assert.equal(decodeTextAs(bytes(0xd9, 0x0a, 0x61), 'Johab').text, `${REPLACEMENT}\na`);
  assert.equal(decodeTextAs(bytes(0x88, 0x20, 0x61), 'Johab').text, `${REPLACEMENT} a`);
});

test('decoding a large Johab file takes well under a second per megabyte', () => {
  const big = repeat(HANGEUL_JOHAB, 64 * 1024);
  const startedAt = performance.now();
  const decoded = decodeTextAs(big, 'Johab');
  const elapsedMs = performance.now() - startedAt;
  assert.equal(decoded.text.length, 128 * 1024);
  assert.equal(decoded.text.slice(-2), HANGEUL);
  assert.ok(elapsedMs < 2000, `took ${elapsedMs.toFixed(0)} ms`);
});

test('the same bytes can be decoded again with another encoding', () => {
  const file = bytes(...ANNYEONG_CP949);
  // A wrong choice must give text, however garbled, instead of throwing.
  const wrong = decodeTextAs(file, 'UTF-8');
  assert.equal(wrong.encoding, 'UTF-8');
  assert.ok(wrong.text.includes(REPLACEMENT));
  assert.deepEqual(decodeTextAs(file, 'CP949'), { text: ANNYEONG, encoding: 'CP949', hasBom: false });
  // Decoding does not change the bytes it was given.
  assert.deepEqual([...file], ANNYEONG_CP949);
});

test('an explicitly chosen encoding strips only its own byte order mark', () => {
  assert.deepEqual(decodeTextAs(bytes(0xef, 0xbb, 0xbf, 0x61), 'UTF-8'), { text: 'a', encoding: 'UTF-8', hasBom: true });
  assert.deepEqual(decodeTextAs(bytes(0xff, 0xfe, 0x61, 0x00), 'UTF-16LE'), { text: 'a', encoding: 'UTF-16LE', hasBom: true });
  assert.deepEqual(decodeTextAs(bytes(0xfe, 0xff, 0x00, 0x61), 'UTF-16BE'), { text: 'a', encoding: 'UTF-16BE', hasBom: true });
  // UTF-16 without a mark cannot be detected, but it can be chosen by hand.
  assert.deepEqual(decodeTextAs(bytes(0x61, 0x00), 'UTF-16LE'), { text: 'a', encoding: 'UTF-16LE', hasBom: false });
  assert.deepEqual(decodeTextAs(bytes(0x00, 0x61), 'UTF-16BE'), { text: 'a', encoding: 'UTF-16BE', hasBom: false });
  // The mark of another encoding is just bytes.
  assert.equal(decodeTextAs(bytes(0xef, 0xbb, 0xbf, 0x61), 'CP949').hasBom, false);
  assert.equal(decodeTextAs(bytes(0xff, 0xfe, 0x61, 0x00), 'UTF-8').hasBom, false);
});

test('looksGarbled is false for readable text', () => {
  assert.equal(looksGarbled(''), false);
  assert.equal(looksGarbled(`${ANNYEONG} hello ${HANGEUL}`), false);
});

test('looksGarbled is true when replacement characters are frequent', () => {
  assert.equal(looksGarbled(`${REPLACEMENT.repeat(3)}${ANNYEONG}${REPLACEMENT.repeat(2)}`), true);
});

test('looksGarbled needs more than one replacement character in a hundred', () => {
  assert.equal(looksGarbled(REPLACEMENT + 'a'.repeat(99)), false);
  assert.equal(looksGarbled(REPLACEMENT.repeat(2) + 'a'.repeat(98)), true);
});

test('looksGarbled samples only the beginning of a long text', () => {
  // Constant cost for big files; a damaged tail alone does not trigger the hint.
  assert.equal(looksGarbled('a'.repeat(70_000) + REPLACEMENT.repeat(5000)), false);
});
