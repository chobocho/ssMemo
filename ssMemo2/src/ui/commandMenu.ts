// Every command as a list, for the menu dialog. On a narrow screen the toolbar shows only the
// most used commands; this list is how the rest is reached, and it doubles as a reminder of the
// keyboard shortcuts. Like the toolbar it is generated from the command table.
import type { Command } from '../app/commands.ts';
import type { Translate } from '../i18n/i18n.ts';

export interface CommandMenuOptions {
  commands: readonly Command[];
  t: Translate;
  /** Turns a shortcut such as "Mod-o" into what is shown to the user. */
  formatShortcut(shortcut: string): string;
  /**
   * Called with the chosen command. Running it is left to the caller, which has to close the
   * menu's dialog first: a command may open a dialog of its own.
   */
  onPick(command: Command): void;
}

export function createCommandMenu(doc: Document, options: CommandMenuOptions): HTMLElement {
  const { commands, t, formatShortcut, onPick } = options;
  const element = doc.createElement('div');
  element.className = 'command-menu';

  for (const command of commands) {
    const item = doc.createElement('button');
    item.type = 'button';
    item.className = 'button command-item';
    if (command.isOn) item.setAttribute('aria-pressed', String(command.isOn()));

    const icon = doc.createElement('span');
    icon.className = 'command-icon';
    // The label next to it says the same in words.
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = command.icon;

    const label = doc.createElement('span');
    label.className = 'command-label';
    label.textContent = t(command.labelKey);
    item.append(icon, label);

    const [shortcut] = command.shortcuts;
    if (shortcut !== undefined) {
      const hint = doc.createElement('kbd');
      hint.className = 'command-shortcut';
      hint.textContent = formatShortcut(shortcut);
      item.append(hint);
    }

    item.addEventListener('click', () => onPick(command));
    element.append(item);
  }
  return element;
}
