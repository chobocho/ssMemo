// Renders the diagnostics as a definition list with a copy button.
import { formatDiagnostics } from '../app/diagnostics.ts';
import type { DiagnosticEntry } from '../app/diagnostics.ts';

// English until the message catalog exists (roadmap item 2.1).
const COPY_LABEL = '📋 Copy';
const COPIED_STATUS = 'Copied.';
const SELECTED_STATUS = 'Could not copy automatically. The list is selected: copy it from the system menu.';

export interface DiagnosticsPanel {
  element: HTMLElement;
  /** Replaces the displayed entries, e.g. after the device was folded or unfolded. */
  update(entries: readonly DiagnosticEntry[]): void;
}

function createRow(doc: Document, entry: DiagnosticEntry): HTMLElement {
  // A <div> per pair lets the value wrap under its label on narrow screens without a media query.
  const row = doc.createElement('div');
  row.className = 'diagnostics-row';
  const label = doc.createElement('dt');
  label.textContent = entry.label;
  const value = doc.createElement('dd');
  value.textContent = entry.value;
  row.append(label, value);
  return row;
}

/**
 * @param copyText resolves to false when the clipboard cannot be used; the list is then
 *   selected so the user can copy it by hand.
 */
export function createDiagnosticsPanel(
  doc: Document,
  title: string,
  copyText: (text: string) => Promise<boolean>,
): DiagnosticsPanel {
  const element = doc.createElement('section');
  element.className = 'diagnostics';

  const heading = doc.createElement('h1');
  heading.className = 'diagnostics-title';
  heading.textContent = title;

  const list = doc.createElement('dl');
  list.className = 'diagnostics-list';

  const copyButton = doc.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'diagnostics-copy';
  copyButton.textContent = COPY_LABEL;

  const status = doc.createElement('span');
  status.className = 'diagnostics-status';
  status.setAttribute('role', 'status');

  const actions = doc.createElement('div');
  actions.className = 'diagnostics-actions';
  actions.append(copyButton, status);

  element.append(heading, list, actions);

  let currentEntries: readonly DiagnosticEntry[] = [];

  copyButton.addEventListener('click', () => {
    void copyText(formatDiagnostics(currentEntries)).then((copied) => {
      if (!copied) doc.getSelection()?.selectAllChildren(list);
      status.textContent = copied ? COPIED_STATUS : SELECTED_STATUS;
    });
  });

  return {
    element,
    update(entries) {
      currentEntries = entries;
      list.replaceChildren(...entries.map((entry) => createRow(doc, entry)));
      // A status from an earlier copy would describe values that are no longer shown.
      status.textContent = '';
    },
  };
}
