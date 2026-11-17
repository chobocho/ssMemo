// The list of things the user can do, in one table. The toolbar, the menu on narrow screens,
// the keyboard shortcuts and the help text are all generated from it, so they cannot drift apart
// (in ssMemoWeb the help text was a hand-written copy of the key handlers).
import type { MessageKey } from '../i18n/en.ts';
import { matchesShortcut, parseShortcut, shortcutIdentity } from './shortcut.ts';
import type { Shortcut, ShortcutEvent } from './shortcut.ts';

export interface Command {
  /** Stable identifier such as "memo.new". */
  id: string;
  /** Message shown as the button's accessible name and in the help text. */
  labelKey: MessageKey;
  /** Emoji shown on the button. */
  icon: string;
  /** Shortcuts such as "Alt-n" (see shortcut.ts); empty if the command has none. */
  shortcuts: readonly string[];
  run(): void;
}

export interface CommandRegistry {
  /** In the order given, which is the order buttons appear in. */
  list(): readonly Command[];
  get(id: string): Command | undefined;
  /** The command bound to this key press, if any. */
  findByKeyEvent(event: ShortcutEvent, isMac: boolean): Command | undefined;
}

interface Binding {
  shortcut: Shortcut;
  command: Command;
}

/**
 * Throws on a duplicate id, a malformed shortcut, or a shortcut used by two commands, so such
 * mistakes are caught when the app starts rather than when someone happens to press the key.
 */
export function createCommandRegistry(commands: readonly Command[]): CommandRegistry {
  const byId = new Map<string, Command>();
  const bindings: Binding[] = [];
  const claimedShortcuts = new Map<string, string>();

  for (const command of commands) {
    if (byId.has(command.id)) {
      throw new Error(`Duplicate command id: ${command.id}`);
    }
    byId.set(command.id, command);

    for (const text of command.shortcuts) {
      const shortcut = parseShortcut(text);
      const identity = shortcutIdentity(shortcut);
      const claimedBy = claimedShortcuts.get(identity);
      if (claimedBy !== undefined) {
        throw new Error(`Shortcut ${text} of command ${command.id} is already used by ${claimedBy}`);
      }
      claimedShortcuts.set(identity, `${command.id} (${text})`);
      bindings.push({ shortcut, command });
    }
  }

  return {
    list: () => commands,
    get: (id) => byId.get(id),
    // O(number of shortcuts) per key press; there are a few dozen at most.
    findByKeyEvent: (event, isMac) =>
      bindings.find((binding) => matchesShortcut(event, binding.shortcut, isMac))?.command,
  };
}
