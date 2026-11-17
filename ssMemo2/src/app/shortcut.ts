// Keyboard shortcuts written as text ("Mod-Alt-n") and matched against key presses.
//
// ssMemoWeb compared event.key by hand in each handler, which broke with Caps Lock, with the
// Korean input method (the key arrives as Hangul or "Process") and on macOS. Here every shortcut
// goes through one matcher that also knows about those cases.

/** The part of KeyboardEvent the matcher reads; lets tests pass plain objects. */
export interface ShortcutEvent {
  key: string;
  /** Physical key, e.g. "KeyN"; independent of layout and input method. */
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** True while an input method is composing text. */
  isComposing: boolean;
}

export interface Shortcut {
  /** Ctrl on Windows, Linux and Android; Command on macOS. */
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Lower-cased key name: a single character, or a name such as "pagedown" or "f2". */
  key: string;
}

type ModifierName = 'mod' | 'ctrl' | 'alt' | 'shift';

const SEPARATOR = '-';
const MODIFIER_NAMES: Readonly<Record<string, ModifierName>> = { Mod: 'mod', Ctrl: 'ctrl', Alt: 'alt', Shift: 'shift' };
const LETTER_PATTERN = /^[a-z]$/;
const DIGIT_PATTERN = /^[0-9]$/;

/** Parses "Mod-Shift-k" style text. Throws on anything malformed, so typos surface at startup. */
export function parseShortcut(text: string): Shortcut {
  const parts = text.split(SEPARATOR);
  const keyPart = parts.pop() ?? '';
  const shortcut: Shortcut = { mod: false, ctrl: false, alt: false, shift: false, key: keyPart.toLowerCase() };
  if (keyPart === '' || Object.hasOwn(MODIFIER_NAMES, keyPart)) {
    throw new Error(`Invalid shortcut "${text}": it names no key`);
  }
  for (const part of parts) {
    const modifier = Object.hasOwn(MODIFIER_NAMES, part) ? MODIFIER_NAMES[part] : undefined;
    if (!modifier) {
      throw new Error(`Invalid shortcut "${text}": unknown modifier "${part}"`);
    }
    if (shortcut[modifier]) {
      throw new Error(`Invalid shortcut "${text}": modifier "${part}" is repeated`);
    }
    shortcut[modifier] = true;
  }
  return shortcut;
}

/** A spelling-independent form: two shortcuts are the same binding exactly when these are equal. */
export function shortcutIdentity(shortcut: Shortcut): string {
  const flags = [shortcut.mod, shortcut.ctrl, shortcut.alt, shortcut.shift].map((flag) => (flag ? '1' : '0')).join('');
  return `${flags}:${shortcut.key}`;
}

function keyMatches(event: ShortcutEvent, key: string): boolean {
  if (LETTER_PATTERN.test(key)) {
    // The code fallback keeps letters working when an input method reports another character.
    return event.key.toLowerCase() === key || event.code === `Key${key.toUpperCase()}`;
  }
  if (DIGIT_PATTERN.test(key)) {
    return event.key === key || event.code === `Digit${key}`;
  }
  return event.key.toLowerCase() === key;
}

// A punctuation character such as "<" already encodes whether Shift was held, and which
// combination produces it depends on the layout, so Shift is not compared for those.
function shiftMatters(key: string): boolean {
  return key.length > 1 || LETTER_PATTERN.test(key) || DIGIT_PATTERN.test(key);
}

export function matchesShortcut(event: ShortcutEvent, shortcut: Shortcut, isMac: boolean): boolean {
  // Keys pressed while composing belong to the input method, not to the app.
  if (event.isComposing) return false;
  const wantCtrl = shortcut.ctrl || (shortcut.mod && !isMac);
  const wantMeta = shortcut.mod && isMac;
  if (event.ctrlKey !== wantCtrl || event.metaKey !== wantMeta || event.altKey !== shortcut.alt) return false;
  if (shiftMatters(shortcut.key) && event.shiftKey !== shortcut.shift) return false;
  return keyMatches(event, shortcut.key);
}

const DISPLAY_SEPARATOR = '+';
// How each modifier is labelled on the keyboard: elsewhere, and on a Mac.
const MODIFIER_LABELS: Readonly<Record<ModifierName, { other: string; mac: string }>> = {
  mod: { other: 'Ctrl', mac: 'Cmd' },
  ctrl: { other: 'Ctrl', mac: 'Ctrl' },
  alt: { other: 'Alt', mac: 'Option' },
  shift: { other: 'Shift', mac: 'Shift' },
};

/** A shortcut as shown to the user, e.g. "Mod-Shift-s" as "Ctrl+Shift+S". Throws like parseShortcut. */
export function formatShortcut(text: string, isMac: boolean): string {
  parseShortcut(text);
  const parts = text.split(SEPARATOR);
  const key = parts.pop() ?? '';
  const labels = parts.map((part) => {
    const label = MODIFIER_LABELS[MODIFIER_NAMES[part] ?? 'mod'];
    return isMac ? label.mac : label.other;
  });
  // Single characters are printed on the key in upper case; names such as PageDown stay as written.
  labels.push(key.length === 1 ? key.toUpperCase() : key);
  return labels.join(DISPLAY_SEPARATOR);
}
