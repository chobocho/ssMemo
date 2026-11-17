// Builds the page skeleton: a header, the main area and a footer. Sizes and positions come
// entirely from src/styles/layout.css; this module only creates the elements.

export interface AppShell {
  element: HTMLElement;
  /** Main area; the editor is mounted here and fills it. */
  editorHost: HTMLElement;
  /** Area below the main area; holds the collapsible diagnostics. */
  footer: HTMLElement;
}

export function createAppShell(doc: Document, title: string): AppShell {
  const element = doc.createElement('div');
  element.className = 'app-shell';

  const header = doc.createElement('header');
  header.className = 'app-header';
  const heading = doc.createElement('h1');
  heading.className = 'app-title';
  heading.textContent = title;
  header.append(heading);

  const main = doc.createElement('main');
  main.className = 'app-main';

  const footer = doc.createElement('footer');
  footer.className = 'app-footer';

  element.append(header, main, footer);
  return { element, editorHost: main, footer };
}
