// A row of icon buttons generated from commands, so a button, its label and its shortcut always
// come from the same definition.
import type { Command } from '../app/commands.ts';
import type { Translate } from '../i18n/i18n.ts';

export function createToolbar(doc: Document, commands: readonly Command[], t: Translate): HTMLElement {
  const element = doc.createElement('div');
  element.className = 'toolbar';
  element.setAttribute('role', 'toolbar');

  for (const command of commands) {
    const label = t(command.labelKey);
    const [shortcut] = command.shortcuts;

    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'toolbar-button';
    button.textContent = command.icon;
    // The icon alone says nothing to a screen reader.
    button.setAttribute('aria-label', label);
    button.title = shortcut ? `${label} (${shortcut})` : label;
    button.addEventListener('click', () => command.run());
    element.append(button);
  }
  return element;
}
