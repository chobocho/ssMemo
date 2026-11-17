// The texts of the editor's search panel in the app's languages. The editor asks for a
// translation by the English text, so this maps each of those to a key of the message catalog.
import type { MessageKey } from '../i18n/en.ts';
import type { Translate } from '../i18n/i18n.ts';

/** A test reads the installed search package and fails if it uses a text that is missing here. */
export const SEARCH_PHRASE_KEYS: Readonly<Record<string, MessageKey>> = {
  Find: 'search.find',
  Replace: 'search.replaceField',
  next: 'search.next',
  previous: 'search.previous',
  all: 'search.all',
  'match case': 'search.matchCase',
  regexp: 'search.regexp',
  'by word': 'search.byWord',
  replace: 'search.replace',
  'replace all': 'search.replaceAll',
  close: 'search.close',
  // Announced to screen readers. "$" is where the editor puts a number.
  'current match': 'search.currentMatch',
  'on line': 'search.onLine',
  'replaced $ matches': 'search.replacedMatches',
  'replaced match on line $': 'search.replacedOnLine',
};

export function createSearchPhrases(t: Translate): Record<string, string> {
  return Object.fromEntries(Object.entries(SEARCH_PHRASE_KEYS).map(([original, key]) => [original, t(key)]));
}
