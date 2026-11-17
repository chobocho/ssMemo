// The list of stored memos, shown inside a dialog: open one, rename, delete, or start a new one.
// It only displays and reports; what an action does (prompts, confirmations, storage) is decided
// by the callbacks it is given.
import type { DocumentListing, DocumentMeta } from '../storage/storagePort.ts';

export interface MemoManagerLabels {
  newMemo: string;
  loading: string;
  empty: string;
  /** Shown when the list could not be read or an action failed. */
  failed: string;
  renameOf: (title: string) => string;
  deleteOf: (title: string) => string;
  /** One line under the title, e.g. modification time and size. */
  details: (meta: DocumentMeta) => string;
  corrupt: (count: number) => string;
}

export interface MemoManagerOptions {
  labels: MemoManagerLabels;
  listMemos(): Promise<DocumentListing>;
  onOpen(meta: DocumentMeta): Promise<void>;
  onRename(meta: DocumentMeta): Promise<void>;
  onDelete(meta: DocumentMeta): Promise<void>;
  onNew(): void;
  /** Closes the dialog the manager is shown in. */
  close(): void;
}

const NEW_SYMBOL = '➕';
const RENAME_SYMBOL = '✏️';
const DELETE_SYMBOL = '🗑️';

export function createMemoManager(doc: Document, options: MemoManagerOptions): HTMLElement {
  const { labels } = options;

  const element = doc.createElement('div');
  element.className = 'memo-manager';

  const newButton = doc.createElement('button');
  newButton.type = 'button';
  newButton.className = 'button memo-new';
  newButton.textContent = `${NEW_SYMBOL} ${labels.newMemo}`;
  newButton.addEventListener('click', () => {
    options.onNew();
    options.close();
  });

  const problem = doc.createElement('p');
  problem.className = 'modal-problem';
  problem.setAttribute('role', 'alert');

  const info = doc.createElement('p');
  info.className = 'memo-info';

  const list = doc.createElement('ul');
  list.className = 'memo-list';

  element.append(newButton, problem, info, list);

  function createIconButton(className: string, symbol: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = `button ${className}`;
    button.textContent = symbol;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.addEventListener('click', onClick);
    return button;
  }

  function createItem(meta: DocumentMeta): HTMLElement {
    const item = doc.createElement('li');
    item.className = 'memo-item';

    const open = doc.createElement('button');
    open.type = 'button';
    open.className = 'memo-open';
    const title = doc.createElement('span');
    title.className = 'memo-title';
    // textContent, never innerHTML: a memo title is arbitrary user text.
    title.textContent = meta.title;
    const details = doc.createElement('span');
    details.className = 'memo-details';
    details.textContent = labels.details(meta);
    open.append(title, details);
    open.addEventListener('click', () => {
      void runAction(async () => {
        await options.onOpen(meta);
        options.close();
      });
    });

    const rename = createIconButton('memo-rename', RENAME_SYMBOL, labels.renameOf(meta.title), () => {
      void runAction(() => options.onRename(meta)).then(refresh);
    });
    const remove = createIconButton('memo-delete', DELETE_SYMBOL, labels.deleteOf(meta.title), () => {
      void runAction(() => options.onDelete(meta)).then(refresh);
    });

    item.append(open, rename, remove);
    return item;
  }

  // An action can fail because another window changed or deleted the memo. The failure is
  // reported here; callers reload the list afterwards so it shows what is really stored.
  async function runAction(action: () => Promise<void>): Promise<void> {
    problem.textContent = '';
    try {
      await action();
    } catch {
      problem.textContent = labels.failed;
    }
  }

  async function refresh(): Promise<void> {
    info.textContent = labels.loading;
    try {
      const listing = await options.listMemos();
      list.replaceChildren(...listing.documents.map(createItem));
      if (listing.documents.length === 0) {
        info.textContent = labels.empty;
      } else {
        info.textContent = listing.corruptCount > 0 ? labels.corrupt(listing.corruptCount) : '';
      }
    } catch {
      list.replaceChildren();
      info.textContent = '';
      problem.textContent = labels.failed;
    }
  }

  void refresh();
  return element;
}
