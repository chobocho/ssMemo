// Every command as a list, for the menu dialog. On a narrow screen the toolbar shows only the
// most used commands; this list is how the rest is reached, and it doubles as a reminder of the
// keyboard shortcuts. Like the toolbar it is generated from the command table.
import type { Command } from '../app/commands.ts';
import type { Translate } from '../i18n/i18n.ts';

export interface CommandMenuOptions {
  commands: readonly Command[];
  t: Translate;
  /** Heading for a command group. */
  groupLabel(group: string): string;
  /** Turns a shortcut such as "Mod-o" into what is shown to the user. */
  formatShortcut(shortcut: string): string;
  /**
   * Called with the chosen command. Running it is left to the caller, which has to close the
   * menu's dialog first: a command may open a dialog of its own.
   */
  onPick(command: Command): void;
}

const GROUP_TITLE_ID_PREFIX = 'command-group-';

export function createCommandMenu(doc: Document, options: CommandMenuOptions): HTMLElement {
  const { commands, t, groupLabel, formatShortcut, onPick } = options;
  const element = doc.createElement('div');
  element.className = 'command-menu';

  // One section per group, created when its first command comes along.
  const sections = new Map<string, HTMLElement>();
  const sectionFor = (group: string): HTMLElement => {
    const existing = sections.get(group);
    if (existing) return existing;
    const section = doc.createElement('section');
    section.className = 'command-group';
    const title = doc.createElement('h3');
    title.className = 'command-group-title';
    title.id = `${GROUP_TITLE_ID_PREFIX}${group}`;
    title.textContent = groupLabel(group);
    // Lets a screen reader announce which group a button belongs to.
    section.setAttribute('aria-labelledby', title.id);
    section.append(title);
    element.append(section);
    sections.set(group, section);
    return section;
  };

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
    sectionFor(command.group).append(item);
  }
  return element;
}
