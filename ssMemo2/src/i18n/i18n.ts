// Locale selection and message lookup. Every user-visible sentence lives in a catalog
// (en.ts, ko.ts); the rest of the app refers to messages by key only.
import { en } from './en.ts';
import type { MessageKey } from './en.ts';
import { ko } from './ko.ts';

export type Locale = 'ko' | 'en';

/** Used when none of the browser's languages is supported. */
export const FALLBACK_LOCALE: Locale = 'en';

const CATALOGS: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = { ko, en };

/** Values for the {name} placeholders of a message. */
export type MessageParams = Readonly<Record<string, string | number>>;

export type Translate = (key: MessageKey, params?: MessageParams) => string;

const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

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

/**
 * Fills the {name} placeholders of `template` from `params`. A placeholder without a value is
 * left as written: a visible "{name}" gets noticed and reported, a silently missing word does not.
 * The replacer function inserts values literally and never re-scans them.
 */
export function formatMessage(template: string, params: MessageParams = {}): string {
  return template.replace(PLACEHOLDER_PATTERN, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}

export function createTranslator(locale: Locale): Translate {
  const catalog = CATALOGS[locale];
  return (key, params) => formatMessage(catalog[key], params);
}
