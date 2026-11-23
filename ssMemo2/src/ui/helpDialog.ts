// The content of the help dialog: a field that narrows it down, every command with its shortcuts
// and a line of explanation, a few things worth knowing, which build this is, the open-source
// notices and the diagnostics.
import type { HelpGroup } from '../app/helpContent.ts';

/** Something worth knowing that is not a command. */
export interface HelpTip {
  icon: string;
  title: string;
  text: string;
}

export interface HelpOptions {
  /** Placeholder and accessible name of the field that narrows the help down. */
  filterLabel: string;
  /** Shown when nothing in the help contains what was typed into the field. */
  noMatches: string;
  /** The commands, grouped (see app/helpContent.ts). */
  groups: readonly HelpGroup[];
  tipsTitle: string;
  tips: readonly HelpTip[];
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

/** An icon that is decoration: the text next to it says the same in words. */
function createIcon(doc: Document, icon: string): HTMLElement {
  const element = createElement(doc, 'span', 'help-icon', icon);
  element.setAttribute('aria-hidden', 'true');
  return element;
}

/** A part of the help with the entries the filter can hide; it goes away with its last entry. */
interface FilteredSection {
  section: HTMLElement;
  entries: HTMLElement[];
}

export function createHelpContent(doc: Document, options: HelpOptions): HTMLElement {
  const element = createElement(doc, 'div', 'help');
  const sections: FilteredSection[] = [];

  const filter = createElement(doc, 'input', 'modal-input help-filter');
  filter.type = 'search';
  filter.placeholder = options.filterLabel;
  filter.setAttribute('aria-label', options.filterLabel);
  // Not words of a language; a phone should neither correct nor capitalise "ctrl".
  filter.autocomplete = 'off';
  filter.spellcheck = false;

  const empty = createElement(doc, 'p', 'help-empty', options.noMatches);
  empty.setAttribute('role', 'status');
  empty.hidden = true;

  const groups = createElement(doc, 'div', 'help-groups');
  for (const group of options.groups) {
    const section = createElement(doc, 'section', 'help-group');
    section.append(createElement(doc, 'h3', 'help-heading', group.label));
    const list = createElement(doc, 'ul', 'help-list');
    const entries = group.rows.map((row) => {
      const item = createElement(doc, 'li', 'help-row');
      const body = createElement(doc, 'span', 'help-body');
      body.append(createElement(doc, 'span', 'help-label', row.label));
      if (row.hint !== undefined) body.append(createElement(doc, 'span', 'help-hint', row.hint));
      const keys = createElement(doc, 'span', 'help-keys');
      keys.append(...row.shortcuts.map((shortcut) => createElement(doc, 'kbd', 'help-key', shortcut)));
      item.append(createIcon(doc, row.icon), body, keys);
      return item;
    });
    list.append(...entries);
    section.append(list);
    groups.append(section);
    sections.push({ section, entries });
  }

  const tips = createElement(doc, 'section', 'help-notes');
  const tipList = createElement(doc, 'ul', 'help-note-list');
  const tipEntries = options.tips.map((tip) => {
    const item = createElement(doc, 'li', 'help-note');
    const body = createElement(doc, 'span', 'help-body');
    body.append(createElement(doc, 'strong', 'help-note-title', tip.title), createElement(doc, 'span', 'help-note-text', tip.text));
    item.append(createIcon(doc, tip.icon), body);
    return item;
  });
  tipList.append(...tipEntries);
  tips.append(createElement(doc, 'h3', 'help-heading', options.tipsTitle), tipList);
  sections.push({ section: tips, entries: tipEntries });

  const about = createElement(doc, 'section', 'help-about');
  about.append(createElement(doc, 'h3', 'help-heading', options.aboutTitle), createElement(doc, 'p', 'help-text', options.aboutText));

  // Folded away: it has to be there, but hardly anyone wants to scroll past it.
  const licenses = createElement(doc, 'details', 'help-licenses');
  licenses.append(
    createElement(doc, 'summary', '', options.licensesTitle),
    createElement(doc, 'p', 'help-text', options.licensesIntro),
    createElement(doc, 'pre', 'help-license-text', options.licensesText),
  );

  // Every word typed has to occur somewhere in an entry (name, explanation or key), in any order
  // and in any case: "ctrl s" finds what Ctrl+S and Ctrl+Shift+S do.
  filter.addEventListener('input', () => {
    const words = filter.value.toLowerCase().split(/\s+/).filter((word) => word !== '');
    let anyShown = false;
    for (const { section, entries } of sections) {
      let sectionShown = false;
      for (const entry of entries) {
        const text = (entry.textContent ?? '').toLowerCase();
        const shown = words.every((word) => text.includes(word));
        entry.hidden = !shown;
        sectionShown ||= shown;
      }
      section.hidden = !sectionShown;
      anyShown ||= sectionShown;
    }
    empty.hidden = anyShown;
  });

  element.append(filter, empty, groups, tips, about, licenses, options.diagnostics);
  return element;
}
