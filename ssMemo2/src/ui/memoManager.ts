// The list of stored memos, shown inside a dialog: open one, rename, delete, start a new one,
// search the text of all of them, or go on to the trash.
// It only displays and reports; what an action does (prompts, confirmations, storage) is decided
// by the callbacks it is given.
import type { MemoSearchHit } from '../app/memoSearch.ts';
import type { DocumentListing, DocumentMeta } from '../storage/storagePort.ts';

export interface MemoManagerLabels {
  newMemo: string;
  trash: string;
  /** Names the search field. */
  search: string;
  noMatches: string;
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
  /** The memos whose text or title contains `query`. */
  searchMemos(query: string): Promise<MemoSearchHit[]>;
  /** `foundText` is what was searched for, if the memo was found by its text. */
  onOpen(meta: DocumentMeta, foundText?: string): Promise<void>;
  onRename(meta: DocumentMeta): Promise<void>;
  onDelete(meta: DocumentMeta): Promise<void>;
  onNew(): void;
  /** Shows the deleted memos. */
  onTrash(): void;
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

  // While it holds text, the list shows the memos containing that text instead of all of them.
  const search = doc.createElement('input');
  search.type = 'search';
  search.className = 'modal-input memo-search';
  search.placeholder = labels.search;
  search.setAttribute('aria-label', labels.search);
  search.autocomplete = 'off';
  search.spellcheck = false;
  search.addEventListener('input', () => {
    problem.textContent = '';
    void refresh();
  });

  const info = doc.createElement('p');
  info.className = 'memo-info';

  const list = doc.createElement('ul');
  list.className = 'memo-list';

  const trashButton = doc.createElement('button');
  trashButton.type = 'button';
  trashButton.className = 'button memo-trash';
  trashButton.textContent = `${DELETE_SYMBOL} ${labels.trash}`;
  trashButton.addEventListener('click', () => {
    // Closed first: a memo restored from the trash would make this list out of date.
    options.close();
    options.onTrash();
  });

  element.append(newButton, search, problem, info, list, trashButton);

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

  /** `foundText` and `snippet` are given for a memo that the search found by its text. */
  function createItem(meta: DocumentMeta, foundText?: string, snippet?: string): HTMLElement {
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
    if (snippet !== undefined) {
      const line = doc.createElement('span');
      line.className = 'memo-snippet';
      // textContent again: this is a line out of a memo.
      line.textContent = snippet;
      open.append(line);
    }
    open.addEventListener('click', () => {
      void runAction(async () => {
        await options.onOpen(meta, foundText);
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

  // Counts the refreshes: while typing, an answer to an earlier one can arrive after a later one
  // and must not replace it.
  let refreshCount = 0;

  async function refresh(): Promise<void> {
    const turn = ++refreshCount;
    const query = search.value;
    info.textContent = labels.loading;
    try {
      if (query.trim() === '') {
        const listing = await options.listMemos();
        if (turn !== refreshCount) return;
        list.replaceChildren(...listing.documents.map((meta) => createItem(meta)));
        if (listing.documents.length === 0) {
          info.textContent = labels.empty;
        } else {
          info.textContent = listing.corruptCount > 0 ? labels.corrupt(listing.corruptCount) : '';
        }
      } else {
        const hits = await options.searchMemos(query);
        if (turn !== refreshCount) return;
        // Only a memo found by its text gets what was searched for, to be shown the place.
        list.replaceChildren(
          ...hits.map((hit) => createItem(hit.meta, hit.snippet === undefined ? undefined : query, hit.snippet)),
        );
        info.textContent = hits.length === 0 ? labels.noMatches : '';
      }
    } catch {
      if (turn !== refreshCount) return;
      list.replaceChildren();
      info.textContent = '';
      problem.textContent = labels.failed;
    }
  }

  void refresh();
  return element;
}
