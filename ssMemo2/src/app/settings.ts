// User preferences that apply to the whole app and survive a reload.
import type { Locale } from '../i18n/i18n.ts';
import type { StoragePort } from '../storage/storagePort.ts';

/** "auto" follows the browser's language. */
export type LanguageSetting = 'auto' | Locale;

export interface Settings {
  language: LanguageSetting;
  lineWrapping: boolean;
  /** Editor text size in rem; always one of EDITOR_FONT_SIZES_REM. */
  editorFontSizeRem: number;
}

/** The sizes the user can step through, smallest first. */
export const EDITOR_FONT_SIZES_REM: readonly number[] = [0.75, 0.875, 1, 1.125, 1.25, 1.5, 1.75];

export const DEFAULT_SETTINGS: Settings = { language: 'auto', lineWrapping: true, editorFontSizeRem: 0.875 };

const SETTINGS_KEY = 'settings';
const LANGUAGE_SETTINGS: readonly string[] = ['auto', 'ko', 'en'];

function isLanguageSetting(value: unknown): value is LanguageSetting {
  return typeof value === 'string' && LANGUAGE_SETTINGS.includes(value);
}

/**
 * Turns whatever was stored into valid settings. Each field is checked on its own and falls back
 * to its default, so one damaged field does not discard the others, and settings written by an
 * older or newer version of the app still load.
 */
export function parseSettings(value: unknown): Settings {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_SETTINGS };
  const { language, lineWrapping, editorFontSizeRem } = value as Record<string, unknown>;
  return {
    language: isLanguageSetting(language) ? language : DEFAULT_SETTINGS.language,
    lineWrapping: typeof lineWrapping === 'boolean' ? lineWrapping : DEFAULT_SETTINGS.lineWrapping,
    editorFontSizeRem:
      typeof editorFontSizeRem === 'number' && EDITOR_FONT_SIZES_REM.includes(editorFontSizeRem)
        ? editorFontSizeRem
        : DEFAULT_SETTINGS.editorFontSizeRem,
  };
}

/** The next larger (1) or smaller (-1) offered size; unchanged at either end of the range. */
export function stepEditorFontSize(current: number, direction: 1 | -1): number {
  const currentIndex = EDITOR_FONT_SIZES_REM.indexOf(current);
  const startIndex = currentIndex >= 0 ? currentIndex : EDITOR_FONT_SIZES_REM.indexOf(DEFAULT_SETTINGS.editorFontSizeRem);
  const nextIndex = Math.min(Math.max(startIndex + direction, 0), EDITOR_FONT_SIZES_REM.length - 1);
  return EDITOR_FONT_SIZES_REM[nextIndex] ?? DEFAULT_SETTINGS.editorFontSizeRem;
}

export interface SettingsStore {
  /** Never rejects: unreadable or damaged settings come back as defaults. */
  load(): Promise<Settings>;
  /** Resolves to false if the settings could not be stored; they still apply until the page closes. */
  save(settings: Settings): Promise<boolean>;
}

// Settings are a convenience. A storage problem here must not stop the app or produce an error
// message on top of the one the user already gets for their memo.
export function createSettingsStore(storage: StoragePort): SettingsStore {
  return {
    async load() {
      try {
        return parseSettings(await storage.getValue(SETTINGS_KEY));
      } catch {
        return { ...DEFAULT_SETTINGS };
      }
    },
    async save(settings) {
      try {
        await storage.setValue(SETTINGS_KEY, settings);
        return true;
      } catch {
        return false;
      }
    },
  };
}
