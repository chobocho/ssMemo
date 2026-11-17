// Finds web addresses in the text of a memo, for "open this address". Only http and https
// addresses (and ones starting with "www.") qualify: opening is done by handing the address to
// the browser, and nothing that could run code or reach into the device may get that far.

const WEB_SCHEME_PATTERN = /^https?:\/\//i;
// "www." followed by something; such an address is written without a scheme.
const WWW_PATTERN = /^www\../i;
const DEFAULT_SCHEME = 'https://';
const WHITESPACE_PATTERN = /\s/;
// An address in running text: everything up to a space, a quote or an angle bracket.
const ADDRESS_IN_TEXT_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
// Characters that end a sentence or close a bracket around an address rather than belong to it.
const TRAILING_PUNCTUATION_PATTERN = /[.,;:!?)\]}]+$/;

/**
 * The address `text` stands for, in the form the browser uses, if `text` is exactly one web
 * address; undefined otherwise. Surrounding white space is ignored.
 */
export function toWebUrl(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed === '' || WHITESPACE_PATTERN.test(trimmed)) return undefined;
  const candidate = WWW_PATTERN.test(trimmed) ? `${DEFAULT_SCHEME}${trimmed}` : trimmed;
  // Checked on the text itself: the URL parser below would also accept "https:example.com".
  if (!WEB_SCHEME_PATTERN.test(candidate)) return undefined;
  try {
    return new URL(candidate).href;
  } catch {
    return undefined;
  }
}

/**
 * The web address that position `offset` of `line` lies in or directly next to, if any.
 * O(length of the line).
 */
export function findUrlAt(line: string, offset: number): string | undefined {
  for (const match of line.matchAll(ADDRESS_IN_TEXT_PATTERN)) {
    const address = match[0].replace(TRAILING_PUNCTUATION_PATTERN, '');
    if (offset >= match.index && offset <= match.index + address.length) return toWebUrl(address);
  }
  return undefined;
}
