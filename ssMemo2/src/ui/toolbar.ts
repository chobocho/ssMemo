// A row of icon buttons generated from commands, so a button, its label and its shortcut always
// come from the same definition.
import type { Command } from '../app/commands.ts';
import type { Translate } from '../i18n/i18n.ts';

export interface Toolbar {
  element: HTMLElement;
  /** Re-reads which toggle commands are on; call after a setting changed. */
  refresh(): void;
}

export interface ToolbarOptions {
  /** Commands whose buttons give way on narrow screens; they stay reachable through the menu. */
  secondaryIds?: ReadonlySet<string>;
  /** Turns a shortcut such as "Mod-o" into what is shown to the user. */
  formatShortcut?: (shortcut: string) => string;
}

const SECONDARY_CLASS = 'toolbar-button-secondary';

export function createToolbar(doc: Document, commands: readonly Command[], t: Translate, options: ToolbarOptions = {}): Toolbar {
  const { secondaryIds, formatShortcut = (shortcut: string) => shortcut } = options;
  const element = doc.createElement('div');
  element.className = 'toolbar';
  element.setAttribute('role', 'toolbar');

  const toggles: { button: HTMLButtonElement; isOn: () => boolean }[] = [];

  for (const command of commands) {
    const label = t(command.labelKey);
    const [shortcut] = command.shortcuts;

    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'toolbar-button';
    if (secondaryIds?.has(command.id)) button.classList.add(SECONDARY_CLASS);
    button.textContent = command.icon;
    // The icon alone says nothing to a screen reader.
    button.setAttribute('aria-label', label);
    button.title = shortcut ? `${label} (${formatShortcut(shortcut)})` : label;
    button.addEventListener('click', () => command.run());
    if (command.isOn) toggles.push({ button, isOn: command.isOn });
    element.append(button);
  }

  const refresh = (): void => {
    for (const { button, isOn } of toggles) {
      // aria-pressed is what makes a button a toggle for assistive technology.
      button.setAttribute('aria-pressed', String(isOn()));
    }
  };
  refresh();

  return { element, refresh };
}
