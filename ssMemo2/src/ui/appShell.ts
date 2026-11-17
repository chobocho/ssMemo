// Builds the page skeleton: header, notices, the main area and a footer. Sizes and positions come
// entirely from src/styles/layout.css; this module only creates the elements.

export interface AppShell {
  element: HTMLElement;
  /** Top bar; already holds the title. Status indicators are appended after it. */
  header: HTMLElement;
  /** Between header and main area; holds messages for the user. */
  noticeHost: HTMLElement;
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

  const noticeHost = doc.createElement('div');
  noticeHost.className = 'app-notices';

  const main = doc.createElement('main');
  main.className = 'app-main';

  const footer = doc.createElement('footer');
  footer.className = 'app-footer';

  element.append(header, noticeHost, main, footer);
  return { element, header, noticeHost, editorHost: main, footer };
}
