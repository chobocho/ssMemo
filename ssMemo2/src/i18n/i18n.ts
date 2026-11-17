// Locale selection and message lookup. Every user-visible sentence lives in a catalog
// (en.ts, ko.ts); the rest of the app refers to messages by key only.
import { en } from './en.ts';
import type { MessageKey } from './en.ts';
import { ko } from './ko.ts';

export type Locale = 'ko' | 'en';

/** Used when none of the browser's languages is supported. */
export const FALLBACK_LOCALE: Locale = 'en';

const CATALOGS: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = { ko, en };

export type Translate = (key: MessageKey) => string;

function isLocale(value: string): value is Locale {
  return Object.hasOwn(CATALOGS, value);
}

// "ko-KR" -> "ko". The whole subtag is compared so "kok" (Konkani) is not taken for Korean.
function primarySubtag(languageTag: string): string {
  return languageTag.trim().toLowerCase().split('-')[0] ?? '';
}

/**
 * Picks the app locale from the browser's language list (navigator.languages, most preferred
 * first): the first entry whose primary language is supported wins.
 */
export function resolveLocale(browserLanguages: readonly string[]): Locale {
  for (const languageTag of browserLanguages) {
    const subtag = primarySubtag(languageTag);
    if (isLocale(subtag)) return subtag;
  }
  return FALLBACK_LOCALE;
}

export function createTranslator(locale: Locale): Translate {
  const catalog = CATALOGS[locale];
  return (key) => catalog[key];
}
