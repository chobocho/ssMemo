// A text file as a whole: its text plus the three things that must survive an edit unchanged so
// the file is not silently rewritten in another form - encoding, byte order mark and line ending.
// (ssMemoWeb always saved UTF-8 with LF, whatever it had opened.)
import { decodeText, decodeTextAs, encodeText, isWritableEncoding } from './encoding.ts';
import type { TextEncoding } from './encoding.ts';

export const EOLS = ['lf', 'crlf', 'cr'] as const;
/** Line ending: Unix, Windows, or classic Mac OS. */
export type Eol = (typeof EOLS)[number];

export interface TextFormat {
  encoding: TextEncoding;
  eol: Eol;
  hasBom: boolean;
}

export interface TextFileContent {
  /** As decoded, with the file's own line endings. */
  text: string;
  format: TextFormat;
}

const EOL_TEXT: Readonly<Record<Eol, string>> = { lf: '\n', crlf: '\r\n', cr: '\r' };
const ANY_LINE_BREAK = /\r\n?|\n/g;
const CARRIAGE_RETURN = 0x0d;
const LINE_FEED = 0x0a;

// looksBinary: how much of the file is examined. Binary formats have zero bytes within their
// first few kilobytes; text does not have any.
const BINARY_SAMPLE_LENGTH = 8000;
const UTF16_MARKS: readonly (readonly [number, number])[] = [
  [0xff, 0xfe],
  [0xfe, 0xff],
];

export function isEol(value: unknown): value is Eol {
  return (EOLS as readonly unknown[]).includes(value);
}

/**
 * The line ending a text uses; the most frequent one if it mixes several, LF if it has none.
 * A tie goes to the ending listed first in EOLS. O(n) time, no allocation.
 */
export function detectEol(text: string): Eol {
  const counts: Record<Eol, number> = { lf: 0, crlf: 0, cr: 0 };
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === LINE_FEED) {
      counts.lf++;
    } else if (code === CARRIAGE_RETURN) {
      if (text.charCodeAt(i + 1) === LINE_FEED) {
        counts.crlf++;
        i++;
      } else {
        counts.cr++;
      }
    }
  }
  let dominant: Eol = 'lf';
  for (const eol of EOLS) {
    if (counts[eol] > counts[dominant]) dominant = eol;
  }
  return dominant;
}

/**
 * Decodes a file and notes its format. Without `encoding` the encoding is detected; with it,
 * the bytes are read that way even if they look like something else.
 */
export function readTextFile(bytes: Uint8Array, encoding?: TextEncoding): TextFileContent {
  const decoded = encoding === undefined ? decodeText(bytes) : decodeTextAs(bytes, encoding);
  return {
    text: decoded.text,
    format: { encoding: decoded.encoding, eol: detectEol(decoded.text), hasBom: decoded.hasBom },
  };
}

/**
 * The format a file is written in. Formats the browser can produce are kept as they are. CP949
 * and Johab cannot be written without a conversion table of their own, so those files become
 * UTF-8; the caller is expected to tell the user before overwriting such a file.
 */
export function getSaveFormat(format: TextFormat): TextFormat {
  // Always a new object with just these fields: callers pass richer objects (a document source
  // with its file name) and spread the result into new ones.
  if (isWritableEncoding(format.encoding)) {
    return { encoding: format.encoding, eol: format.eol, hasBom: format.hasBom };
  }
  return { encoding: 'UTF-8', eol: format.eol, hasBom: false };
}

/**
 * The bytes of a file holding `text` in the given format. Line breaks of any kind in `text` are
 * written as the format's line ending, so text from the editor (always LF) and text that was
 * never normalized both come out right. Throws if the encoding cannot be written; pass the
 * format through getSaveFormat first.
 */
export function writeTextFile(text: string, format: TextFormat): Uint8Array {
  if (!isWritableEncoding(format.encoding)) {
    throw new Error(`Text cannot be written as ${format.encoding}`);
  }
  // Skips a full copy of the text in the most common case: LF text saved with LF.
  const alreadyRight = format.eol === 'lf' && !text.includes('\r');
  const body = alreadyRight ? text : text.replace(ANY_LINE_BREAK, EOL_TEXT[format.eol]);
  return encodeText(body, format.encoding, format.hasBom);
}

/**
 * Whether the bytes are something other than text (an image, an archive, ...), judged by zero
 * bytes near the start. UTF-16 text has those too and is recognized by its byte order mark.
 */
export function looksBinary(bytes: Uint8Array): boolean {
  if (UTF16_MARKS.some(([first, second]) => bytes[0] === first && bytes[1] === second)) return false;
  return bytes.subarray(0, BINARY_SAMPLE_LENGTH).includes(0);
}
