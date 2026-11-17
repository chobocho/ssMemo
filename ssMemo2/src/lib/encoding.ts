// Turns the bytes of a text file into text, finding out which encoding they are in.
//
// Supported: UTF-8, UTF-16 (little and big endian), CP949 (the superset of EUC-KR that Korean
// Windows uses) and Johab (the older "combination" code of KS X 1001 annex 3).
// No library is involved: UTF-8, UTF-16 and CP949 use the browser's TextDecoder, and Johab
// syllables are computed from their bit pattern. Ported from ssMemoWeb's encoding.js, with
// byte order marks and UTF-16 added and the Johab tables corrected (the originals mapped most
// vowels and final consonants to the wrong letter).

export const TEXT_ENCODINGS = ['UTF-8', 'UTF-16LE', 'UTF-16BE', 'CP949', 'Johab'] as const;
export type TextEncoding = (typeof TEXT_ENCODINGS)[number];

export interface DecodedText {
  text: string;
  encoding: TextEncoding;
  /** The bytes began with this encoding's byte order mark. The mark is not part of `text`. */
  hasBom: boolean;
}

/** The byte order mark of each encoding that has one. */
const BYTE_ORDER_MARKS: Readonly<Partial<Record<TextEncoding, readonly number[]>>> = {
  'UTF-8': [0xef, 0xbb, 0xbf],
  'UTF-16LE': [0xff, 0xfe],
  'UTF-16BE': [0xfe, 0xff],
};

// The names TextDecoder knows these encodings by. Its "euc-kr" decoder is in fact CP949.
const DECODER_LABELS: Readonly<Record<Exclude<TextEncoding, 'Johab'>, string>> = {
  'UTF-8': 'utf-8',
  'UTF-16LE': 'utf-16le',
  'UTF-16BE': 'utf-16be',
  CP949: 'euc-kr',
};

const REPLACEMENT_CHARACTER = 0xfffd;

// looksGarbled: how much of the text is examined, and the share of replacement characters above
// which the text counts as wrongly decoded. Readable text has practically none.
const GARBLED_SAMPLE_LENGTH = 65536;
const GARBLED_RATIO = 0.01;

// A Johab syllable is 16 bits: 1 IIIII MMMMM FFFFF (initial, medial and final consonant/vowel).
const JOHAB_FIELD_MASK = 0x1f;
const JOHAB_INITIAL_SHIFT = 10;
const JOHAB_MEDIAL_SHIFT = 5;
const HANGUL_SYLLABLE_BASE = 0xac00;
const SYLLABLES_PER_INITIAL = 588;
const SYLLABLES_PER_MEDIAL = 28;

// String.fromCharCode takes its characters as arguments, and engines limit how many there can be.
const FROM_CHAR_CODE_CHUNK = 0x8000;

/**
 * A table from a 5-bit Johab field to the index Unicode uses, -1 where the code is unassigned.
 * `runs` lists [first code, first index, count] for each unbroken stretch of codes.
 */
function createJohabTable(runs: readonly (readonly [number, number, number])[]): Int8Array {
  const table = new Int8Array(JOHAB_FIELD_MASK + 1).fill(-1);
  for (const [firstCode, firstIndex, count] of runs) {
    for (let offset = 0; offset < count; offset++) table[firstCode + offset] = firstIndex + offset;
  }
  return table;
}

// Checked against an independent codec for all 11,172 syllables (see the reference data in the
// unit test). Code 0x01 of the final table means "no final consonant".
const JOHAB_INITIAL = createJohabTable([[0x02, 0, 19]]);
const JOHAB_MEDIAL = createJohabTable([
  [0x03, 0, 5],
  [0x0a, 5, 6],
  [0x12, 11, 6],
  [0x1a, 17, 4],
]);
const JOHAB_FINAL = createJohabTable([
  [0x01, 0, 17],
  [0x13, 17, 11],
]);

export function isTextEncoding(value: unknown): value is TextEncoding {
  return (TEXT_ENCODINGS as readonly unknown[]).includes(value);
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

function hasByteOrderMark(bytes: Uint8Array, encoding: TextEncoding): boolean {
  const mark = BYTE_ORDER_MARKS[encoding];
  return mark !== undefined && startsWith(bytes, mark);
}

function isJohabSyllablePair(lead: number, trail: number): boolean {
  if (lead < 0x84 || lead > 0xd3) return false;
  return (trail >= 0x41 && trail <= 0x7e) || (trail >= 0x81 && trail <= 0xfe);
}

/** The Unicode syllable for two Johab bytes, or -1 if they are not an assigned syllable. */
function johabSyllable(lead: number, trail: number): number {
  const value = (lead << 8) | trail;
  const initial = JOHAB_INITIAL[(value >> JOHAB_INITIAL_SHIFT) & JOHAB_FIELD_MASK] ?? -1;
  const medial = JOHAB_MEDIAL[(value >> JOHAB_MEDIAL_SHIFT) & JOHAB_FIELD_MASK] ?? -1;
  const final = JOHAB_FINAL[value & JOHAB_FIELD_MASK] ?? -1;
  if (initial < 0 || medial < 0 || final < 0) return -1;
  return HANGUL_SYLLABLE_BASE + initial * SYLLABLES_PER_INITIAL + medial * SYLLABLES_PER_MEDIAL + final;
}

// Second bytes of Johab's two-byte symbols and Hanja start at 0x31. Anything below (a space, a
// line break) is a character of its own and must survive a damaged byte before it.
function isJohabTrailByte(value: number): boolean {
  return value >= 0x31 && value !== 0x7f && value !== 0xff;
}

/**
 * O(n) time, O(n) extra space. Code units are collected in a typed array and turned into text
 * chunk by chunk: appending to a string per character took tens of seconds on a 6 MB file.
 */
function decodeJohab(bytes: Uint8Array): string {
  const length = bytes.length;
  // Upper bound: every byte becomes one character.
  const codes = new Uint16Array(length);
  let count = 0;
  for (let i = 0; i < length; i++) {
    const lead = bytes[i] ?? 0;
    if (lead < 0x80) {
      codes[count++] = lead;
      continue;
    }
    const trail = bytes[i + 1] ?? 0;
    const syllable = isJohabSyllablePair(lead, trail) ? johabSyllable(lead, trail) : -1;
    if (syllable >= 0) {
      codes[count++] = syllable;
      i++;
      continue;
    }
    // Symbols and Hanja have no simple rule and are shown as a replacement character.
    codes[count++] = REPLACEMENT_CHARACTER;
    if (isJohabTrailByte(trail)) i++;
  }

  let text = '';
  for (let start = 0; start < count; start += FROM_CHAR_CODE_CHUNK) {
    text += String.fromCharCode(...codes.subarray(start, Math.min(start + FROM_CHAR_CODE_CHUNK, count)));
  }
  return text;
}

/** O(n). */
function countReplacementCharacters(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === REPLACEMENT_CHARACTER) count++;
  }
  return count;
}

/**
 * Decodes bytes that are not UTF-8. They are CP949 if they make sense as CP949, which nearly all
 * such files are. Only when they do not is Johab tried, and it wins if it leaves fewer
 * undecodable bytes. (ssMemoWeb guessed from byte ranges, which missed short Johab texts.)
 */
function decodeLegacyKorean(bytes: Uint8Array): DecodedText {
  const cp949 = decodeTextAs(bytes, 'CP949');
  const cp949Damage = countReplacementCharacters(cp949.text);
  if (cp949Damage === 0) return cp949;
  const johab = decodeTextAs(bytes, 'Johab');
  return countReplacementCharacters(johab.text) < cp949Damage ? johab : cp949;
}

/** undefined if the bytes are not valid UTF-8. */
function decodeStrictUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder(DECODER_LABELS['UTF-8'], { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Decodes with the given encoding. Never throws: bytes that mean nothing in that encoding become
 * replacement characters, so a wrong choice shows garbled text that can be decoded again.
 */
export function decodeTextAs(bytes: Uint8Array, encoding: TextEncoding): DecodedText {
  const hasBom = hasByteOrderMark(bytes, encoding);
  const content = hasBom ? bytes.subarray(BYTE_ORDER_MARKS[encoding]?.length ?? 0) : bytes;
  const text =
    encoding === 'Johab'
      ? decodeJohab(content)
      : // ignoreBOM keeps the decoder from dropping a mark itself; that was handled above.
        new TextDecoder(DECODER_LABELS[encoding], { ignoreBOM: true }).decode(content);
  return { text, encoding, hasBom };
}

/**
 * Finds the encoding and decodes. A byte order mark decides; otherwise bytes that are valid UTF-8
 * are UTF-8, and the rest is CP949 or, failing that, Johab.
 */
export function decodeText(bytes: Uint8Array): DecodedText {
  for (const encoding of TEXT_ENCODINGS) {
    if (hasByteOrderMark(bytes, encoding)) return decodeTextAs(bytes, encoding);
  }
  const utf8 = decodeStrictUtf8(bytes);
  if (utf8 !== undefined) return { text: utf8, encoding: 'UTF-8', hasBom: false };
  return decodeLegacyKorean(bytes);
}

/**
 * Whether decoded text has so many replacement characters that the encoding was probably
 * guessed wrong. Only the beginning is examined, so the cost does not grow with the file.
 */
export function looksGarbled(text: string): boolean {
  const sample = text.slice(0, GARBLED_SAMPLE_LENGTH);
  return countReplacementCharacters(sample) > sample.length * GARBLED_RATIO;
}

/** The encodings encodeText can produce. Browsers have no encoder for the legacy Korean ones. */
const WRITABLE_ENCODINGS = ['UTF-8', 'UTF-16LE', 'UTF-16BE'] as const;
export type WritableEncoding = (typeof WRITABLE_ENCODINGS)[number];

const BYTES_PER_UTF16_UNIT = 2;

export function isWritableEncoding(encoding: TextEncoding): encoding is WritableEncoding {
  return (WRITABLE_ENCODINGS as readonly TextEncoding[]).includes(encoding);
}

/** O(n) time. `withBom` puts the encoding's byte order mark in front. */
export function encodeText(text: string, encoding: WritableEncoding, withBom: boolean): Uint8Array {
  const mark = withBom ? (BYTE_ORDER_MARKS[encoding] ?? []) : [];
  if (encoding === 'UTF-8') {
    const encoded = new TextEncoder().encode(text);
    if (mark.length === 0) return encoded;
    const result = new Uint8Array(mark.length + encoded.length);
    result.set(mark);
    result.set(encoded, mark.length);
    return result;
  }
  // A JavaScript string already is a sequence of UTF-16 code units; only the byte order differs.
  const result = new Uint8Array(mark.length + text.length * BYTES_PER_UTF16_UNIT);
  result.set(mark);
  const lowByteFirst = encoding === 'UTF-16LE';
  let offset = mark.length;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    result[offset++] = lowByteFirst ? unit & 0xff : unit >> 8;
    result[offset++] = lowByteFirst ? unit >> 8 : unit & 0xff;
  }
  return result;
}
