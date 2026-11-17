// The line under the editor that shows cursor position and document size.

export interface StatusBar {
  element: HTMLElement;
  setText(text: string): void;
}

export function createStatusBar(doc: Document): StatusBar {
  // Deliberately not a live region: it changes with every key press and would flood a screen reader.
  const element = doc.createElement('div');
  element.className = 'status-bar';
  return {
    element,
    setText(text) {
      element.textContent = text;
    },
  };
}
