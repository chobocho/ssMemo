// The pane that shows a memo rendered as Markdown.

export interface PreviewPaneOptions {
  /** Accessible name of the rendered text. */
  label: string;
  backLabel: string;
  /** Called when the user wants to leave the preview. */
  onBack(): void;
}

export interface PreviewPane {
  element: HTMLElement;
  /**
   * Shows `html`. This is the one place where the app hands a string to the browser as markup, so
   * the string must come from lib/markdown.ts, which escapes everything it is given.
   */
  setHtml(html: string): void;
}

const BACK_SYMBOL = '✏️';

export function createPreviewPane(doc: Document, options: PreviewPaneOptions): PreviewPane {
  const element = doc.createElement('div');
  element.className = 'preview-pane';

  // On screens where the preview takes the place of the editor, the toolbar may have no button
  // for it; this one is the way back. The stylesheet hides it where both are visible.
  const back = doc.createElement('button');
  back.type = 'button';
  back.className = 'button preview-back';
  back.textContent = `${BACK_SYMBOL} ${options.backLabel}`;
  back.addEventListener('click', () => options.onBack());

  const content = doc.createElement('div');
  content.className = 'preview-content';
  content.setAttribute('role', 'region');
  content.setAttribute('aria-label', options.label);
  // Focusable, so the text can be scrolled with the keyboard.
  content.tabIndex = 0;

  element.append(back, content);
  return {
    element,
    setHtml(html) {
      content.innerHTML = html;
    },
  };
}
