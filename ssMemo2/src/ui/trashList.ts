// The trash, shown inside a dialog: the deleted memos, each of which can be restored or deleted
// for good. Like the memo list it only displays and reports; what an action does (questions,
// storage) is decided by the callbacks it is given.
import type { TrashedMemo } from '../app/trash.ts';

export interface TrashListLabels {
  /** Says how long deleted memos are kept. */
  hint: string;
  loading: string;
  empty: string;
  /** Shown when the trash could not be read or an action failed. */
  failed: string;
  emptyAll: string;
  restoreOf: (title: string) => string;
  removeOf: (title: string) => string;
  /** One line under the title, e.g. when the memo was deleted and its size. */
  details: (memo: TrashedMemo) => string;
}

export interface TrashListOptions {
  labels: TrashListLabels;
  listTrash(): Promise<TrashedMemo[]>;
  /** Rejects if the memo could not be restored. */
  onRestore(memo: TrashedMemo): Promise<void>;
  onRemove(memo: TrashedMemo): Promise<void>;
  onEmpty(): Promise<void>;
  /** Closes the dialog the trash is shown in. */
  close(): void;
}

const RESTORE_SYMBOL = '↩️';
const REMOVE_SYMBOL = '🗑️';

export function createTrashList(doc: Document, options: TrashListOptions): HTMLElement {
  const { labels } = options;

  const element = doc.createElement('div');
  element.className = 'memo-manager';

  const hint = doc.createElement('p');
  hint.className = 'memo-hint';
  hint.textContent = labels.hint;

  const emptyButton = doc.createElement('button');
  emptyButton.type = 'button';
  emptyButton.className = 'button trash-empty';
  emptyButton.textContent = `${REMOVE_SYMBOL} ${labels.emptyAll}`;
  emptyButton.hidden = true;
  emptyButton.addEventListener('click', () => {
    void runAction(() => options.onEmpty()).then(refresh);
  });

  const problem = doc.createElement('p');
  problem.className = 'modal-problem';
  problem.setAttribute('role', 'alert');

  const info = doc.createElement('p');
  info.className = 'memo-info';

  const list = doc.createElement('ul');
  list.className = 'memo-list';

  element.append(hint, problem, info, list, emptyButton);

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

  function createItem(memo: TrashedMemo): HTMLElement {
    const item = doc.createElement('li');
    item.className = 'memo-item';

    // Not a button, unlike in the memo list: a deleted memo comes back only on purpose.
    const text = doc.createElement('div');
    text.className = 'memo-text';
    const title = doc.createElement('span');
    title.className = 'memo-title';
    // textContent, never innerHTML: a memo title is arbitrary user text.
    title.textContent = memo.title;
    const details = doc.createElement('span');
    details.className = 'memo-details';
    details.textContent = labels.details(memo);
    text.append(title, details);

    const restore = createIconButton('memo-restore', RESTORE_SYMBOL, labels.restoreOf(memo.title), () => {
      void runAction(async () => {
        await options.onRestore(memo);
        options.close();
      }).then((done) => (done ? undefined : refresh()));
    });
    const remove = createIconButton('memo-delete', REMOVE_SYMBOL, labels.removeOf(memo.title), () => {
      void runAction(() => options.onRemove(memo)).then(refresh);
    });

    item.append(text, restore, remove);
    return item;
  }

  // An action can fail because another window emptied the trash or restored the memo. The
  // failure is reported here; the list is reloaded afterwards so it shows what is really there.
  async function runAction(action: () => Promise<void>): Promise<boolean> {
    problem.textContent = '';
    try {
      await action();
      return true;
    } catch {
      problem.textContent = labels.failed;
      return false;
    }
  }

  async function refresh(): Promise<void> {
    info.textContent = labels.loading;
    try {
      const memos = await options.listTrash();
      list.replaceChildren(...memos.map(createItem));
      info.textContent = memos.length === 0 ? labels.empty : '';
      emptyButton.hidden = memos.length === 0;
    } catch {
      list.replaceChildren();
      info.textContent = '';
      emptyButton.hidden = true;
      problem.textContent = labels.failed;
    }
  }

  void refresh();
  return element;
}
