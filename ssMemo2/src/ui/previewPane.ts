// The pane that shows a memo rendered as Markdown.

export interface PreviewPane {
  element: HTMLElement;
  /**
   * Shows `html`. This is the one place where the app hands a string to the browser as markup, so
   * the string must come from lib/markdown.ts, which escapes everything it is given.
   */
  setHtml(html: string): void;
}

export function createPreviewPane(doc: Document, label: string): PreviewPane {
  const element = doc.createElement('div');
  element.className = 'preview-pane';
  element.setAttribute('role', 'region');
  element.setAttribute('aria-label', label);
  // Focusable, so the pane can be scrolled with the keyboard.
  element.tabIndex = 0;
  return {
    element,
    setHtml(html) {
      element.innerHTML = html;
    },
  };
}
