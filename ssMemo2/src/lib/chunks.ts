// Splitting a long memo into parts of a fixed length with a "cut line" between them, and joining
// the parts again. Useful where text has to be pasted somewhere that takes only so many
// characters at a time. Ported from ssMemoWeb's utils.js.

// "Cut line" in Korean. This is document data, not a text of the user interface: it is the same
// in every language, so a memo split in one language (or in ssMemoWeb) can be joined in another.
// Written as code points because Korean text may only appear literally in the Korean catalog.
export const CHUNK_LABEL = String.fromCharCode(0xc808, 0xcde8, 0xc120);
export const CHUNK_DELIMITER = `\n\n<----------[${CHUNK_LABEL}]---------->\n\n`;
/** Characters per part, as in ssMemoWeb. */
export const DEFAULT_CHUNK_LENGTH = 2000;

export interface TextRange {
  from: number;
  to: number;
}

export type ChunkAction = 'split' | 'join' | 'none';

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;
// A character outside the basic plane (most emoji) takes two code units.
const SURROGATE_PAIR_LENGTH = 2;

/**
 * The positions at which a delimiter has to go so that no part is longer than `length` code
 * units. A position never falls between the two halves of a surrogate pair: ssMemoWeb cut there,
 * and each half on its own is lost when the memo is written to a file. O(n / length).
 */
export function planSplit(text: string, length: number): number[] {
  const cuts: number[] = [];
  if (!Number.isInteger(length) || length < 1) return cuts;
  let position = 0;
  while (text.length - position > length) {
    let cut = position + length;
    if (isHighSurrogate(text.charCodeAt(cut - 1)) && isLowSurrogate(text.charCodeAt(cut))) {
      cut -= 1;
      // The part would be empty: one character alone is longer than a part may be. Keep it whole.
      if (cut === position) cut += SURROGATE_PAIR_LENGTH;
    }
    if (cut >= text.length) break;
    cuts.push(cut);
    position = cut;
  }
  return cuts;
}

/** Where the delimiters are, in order. O(n). */
export function planJoin(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  for (let from = text.indexOf(CHUNK_DELIMITER); from !== -1; from = text.indexOf(CHUNK_DELIMITER, from + CHUNK_DELIMITER.length)) {
    ranges.push({ from, to: from + CHUNK_DELIMITER.length });
  }
  return ranges;
}

/**
 * What the one toggle command should do. A memo that contains delimiters is joined whatever its
 * length, so a split memo can always be put back together; otherwise it is split if it is long.
 */
export function decideChunkAction(text: string, length: number): ChunkAction {
  if (text.includes(CHUNK_DELIMITER)) return 'join';
  return text.length > length ? 'split' : 'none';
}
