// Finding a piece of text in all stored memos at once, for the memo list.
import type { DocumentMeta, StoredDocument } from '../storage/storagePort.ts';

/** Longest snippet shown for a hit, in UTF-16 code units, not counting the marks for left-out text. */
export const SNIPPET_MAX_LENGTH = 80;

const ELLIPSIS = '…';
const LINE_BREAK = /[\r\n]/g;
// Every character that has a meaning in a pattern. In unicode mode nothing else may be escaped.
const PATTERN_SYNTAX = /[.*+?^${}()|[\]\\]/g;

export interface MemoSearchHit {
  meta: DocumentMeta;
  /** The line of the first match in the memo's text; undefined if only the title matches. */
  snippet: string | undefined;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * The line that holds the match, for showing where a memo was found. A line longer than
 * `maxLength` is cut to that length around the match, with a mark wherever text was left out.
 * O(length of the line) time.
 */
export function makeSnippet(text: string, matchStart: number, matchLength: number, maxLength: number): string {
  const lineStart = matchStart === 0 ? 0 : Math.max(text.lastIndexOf('\n', matchStart - 1), text.lastIndexOf('\r', matchStart - 1)) + 1;
  LINE_BREAK.lastIndex = matchStart;
  const lineEnd = LINE_BREAK.exec(text)?.index ?? text.length;
  if (lineEnd - lineStart <= maxLength) return text.slice(lineStart, lineEnd).trim();

  const matchEnd = Math.min(matchStart + matchLength, lineEnd);
  const room = Math.max(0, maxLength - (matchEnd - matchStart));
  let end = Math.min(lineEnd, Math.max(lineStart, matchStart - Math.floor(room / 2)) + maxLength);
  // Counted back from the end, so room that is not needed behind the match goes to the text in front.
  let start = Math.max(lineStart, end - maxLength);
  // A cut between the two halves of a character would leave broken text on either side.
  if (start > lineStart && isLowSurrogate(text.charCodeAt(start))) start += 1;
  if (end < lineEnd && isHighSurrogate(text.charCodeAt(end - 1))) end -= 1;
  return `${start > lineStart ? ELLIPSIS : ''}${text.slice(start, end)}${end < lineEnd ? ELLIPSIS : ''}`;
}

/** Most recently changed first, like the memo list; by title where the time is the same. */
function compareHits(left: MemoSearchHit, right: MemoSearchHit): number {
  if (left.meta.updatedAt !== right.meta.updatedAt) return left.meta.updatedAt < right.meta.updatedAt ? 1 : -1;
  if (left.meta.title !== right.meta.title) return left.meta.title < right.meta.title ? -1 : 1;
  return 0;
}

/**
 * The memos whose text or title contains `query`, ignoring case. A blank query finds nothing.
 * O(total length of the documents) time.
 */
export function findInMemos(documents: readonly StoredDocument[], query: string): MemoSearchHit[] {
  if (query.trim() === '') return [];
  // A pattern, not two lower-cased strings: lower-casing can change the length of a text, and the
  // place of the match is needed in the text as it is.
  const pattern = new RegExp(query.replace(PATTERN_SYNTAX, '\\$&'), 'iu');
  const hits: MemoSearchHit[] = [];
  for (const { meta, content } of documents) {
    const match = pattern.exec(content);
    if (match) hits.push({ meta, snippet: makeSnippet(content, match.index, match[0].length, SNIPPET_MAX_LENGTH) });
    else if (pattern.test(meta.title)) hits.push({ meta, snippet: undefined });
  }
  return hits.sort(compareHits);
}
