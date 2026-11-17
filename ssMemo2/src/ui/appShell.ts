// Builds the page skeleton: header, tab bar, notices, the main area (editor and preview) and a footer. Sizes and positions come
// entirely from src/styles/layout.css; this module only creates the elements.

export interface AppShell {
  element: HTMLElement;
  /** Top bar; already holds the title. Status indicators are appended after it. */
  header: HTMLElement;
  /** Below the header; holds the tab bar. */
  tabBarHost: HTMLElement;
  /** Between header and main area; holds messages for the user. */
  noticeHost: HTMLElement;
  /** Main area; holds the editor and, while it is switched on, the preview next to or instead of it. */
  main: HTMLElement;
  /** The editor is mounted here and fills it. */
  editorHost: HTMLElement;
  /** Holds the preview pane. */
  previewHost: HTMLElement;
  /** Area below the main area; holds the collapsible diagnostics. */
  footer: HTMLElement;
}

const EDITOR_PANEL_ID = 'editor-panel';

export function createAppShell(doc: Document, title: string): AppShell {
  const element = doc.createElement('div');
  element.className = 'app-shell';

  const header = doc.createElement('header');
  header.className = 'app-header';
  const heading = doc.createElement('h1');
  heading.className = 'app-title';
  heading.textContent = title;
  header.append(heading);

  const tabBarHost = doc.createElement('div');
  tabBarHost.className = 'app-tabs';

  const noticeHost = doc.createElement('div');
  noticeHost.className = 'app-notices';

  const main = doc.createElement('main');
  main.className = 'app-main';
  const editorHost = doc.createElement('div');
  editorHost.className = 'editor-pane';
  // The tab strip refers to this area by its id.
  editorHost.id = EDITOR_PANEL_ID;
  const previewHost = doc.createElement('div');
  previewHost.className = 'preview-host';
  main.append(editorHost, previewHost);

  const footer = doc.createElement('footer');
  footer.className = 'app-footer';

  element.append(header, tabBarHost, noticeHost, main, footer);
  return { element, header, tabBarHost, noticeHost, main, editorHost, previewHost, footer };
}
