// A row of icon buttons generated from commands, so a button, its label and its shortcut always
// come from the same definition.
import type { Command } from '../app/commands.ts';
import type { Translate } from '../i18n/i18n.ts';

export interface Toolbar {
  element: HTMLElement;
  /** Re-reads which toggle commands are on; call after a setting changed. */
  refresh(): void;
}

/**
 * From which screen width a button is shown: always, from a medium width on (an unfolded
 * foldable), or only on wide screens. Hidden buttons stay reachable through the menu.
 */
export type ToolbarTier = 'always' | 'medium' | 'wide';

export interface ToolbarOptions {
  /** The tier of a command's button; without it every button is always shown. */
  tierOf?: (commandId: string) => ToolbarTier;
  /** Turns a shortcut such as "Mod-o" into what is shown to the user. */
  formatShortcut?: (shortcut: string) => string;
  /** Accessible name of the toolbar as a whole. */
  label?: string;
}

// The stylesheet hides these classes below their width (see styles/manager.css and tokens.css).
const TIER_CLASSES: Readonly<Record<ToolbarTier, string | undefined>> = {
  always: undefined,
  medium: 'toolbar-button-medium',
  wide: 'toolbar-button-wide',
};

export function createToolbar(doc: Document, commands: readonly Command[], t: Translate, options: ToolbarOptions = {}): Toolbar {
  const { tierOf, formatShortcut = (shortcut: string) => shortcut } = options;
  const element = doc.createElement('div');
  element.className = 'toolbar';
  element.setAttribute('role', 'toolbar');
  if (options.label !== undefined) element.setAttribute('aria-label', options.label);

  const toggles: { button: HTMLButtonElement; isOn: () => boolean }[] = [];

  for (const command of commands) {
    const label = t(command.labelKey);
    const [shortcut] = command.shortcuts;

    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'toolbar-button';
    const tierClass = TIER_CLASSES[tierOf?.(command.id) ?? 'always'];
    if (tierClass) button.classList.add(tierClass);
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
