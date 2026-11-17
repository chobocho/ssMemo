// The content of the help dialog: every command with its shortcuts, a few things worth knowing,
// which build this is, the open-source notices and the diagnostics.
import type { HelpGroup } from '../app/helpContent.ts';

export interface HelpOptions {
  /** The commands, grouped (see app/helpContent.ts). */
  groups: readonly HelpGroup[];
  notesTitle: string;
  notes: readonly string[];
  aboutTitle: string;
  /** Name and build of the app. */
  aboutText: string;
  licensesTitle: string;
  licensesIntro: string;
  /** The notices of the bundled open-source software, as plain text. */
  licensesText: string;
  /** The diagnostics panel; it is moved into the help while the dialog is open. */
  diagnostics: HTMLElement;
}

function createElement<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  if (className !== '') element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function createHelpContent(doc: Document, options: HelpOptions): HTMLElement {
  const element = createElement(doc, 'div', 'help');

  for (const group of options.groups) {
    const section = createElement(doc, 'section', 'help-group');
    section.append(createElement(doc, 'h3', 'help-heading', group.label));
    const list = createElement(doc, 'ul', 'help-list');
    for (const row of group.rows) {
      const item = createElement(doc, 'li', 'help-row');
      const icon = createElement(doc, 'span', 'help-icon', row.icon);
      // The name next to it says the same in words.
      icon.setAttribute('aria-hidden', 'true');
      const keys = createElement(doc, 'span', 'help-keys');
      keys.append(...row.shortcuts.map((shortcut) => createElement(doc, 'kbd', 'help-key', shortcut)));
      item.append(icon, createElement(doc, 'span', 'help-label', row.label), keys);
      list.append(item);
    }
    section.append(list);
    element.append(section);
  }

  const notes = createElement(doc, 'section', 'help-notes');
  const noteList = createElement(doc, 'ul', 'help-note-list');
  noteList.append(...options.notes.map((note) => createElement(doc, 'li', '', note)));
  notes.append(createElement(doc, 'h3', 'help-heading', options.notesTitle), noteList);

  const about = createElement(doc, 'section', 'help-about');
  about.append(createElement(doc, 'h3', 'help-heading', options.aboutTitle), createElement(doc, 'p', 'help-text', options.aboutText));

  // Folded away: it has to be there, but hardly anyone wants to scroll past it.
  const licenses = createElement(doc, 'details', 'help-licenses');
  licenses.append(
    createElement(doc, 'summary', '', options.licensesTitle),
    createElement(doc, 'p', 'help-text', options.licensesIntro),
    createElement(doc, 'pre', 'help-license-text', options.licensesText),
  );

  element.append(notes, about, licenses, options.diagnostics);
  return element;
}
