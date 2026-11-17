// Dialogs built on the native <dialog> element. The browser supplies the hard parts: the dialog
// is modal, focus stays inside it and returns to where it was afterwards, and with several
// dialogs open only the one on top reacts to Escape. ssMemoWeb had six hand-written modal
// implementations that each handled Escape and focus differently, or not at all.

export interface ModalLabels {
  /** Default label of the confirming button, e.g. "OK". */
  confirm: string;
  cancel: string;
}

export interface PromptOptions {
  initialValue: string;
  /** Returns a message explaining why `value` is not acceptable, or undefined if it is. */
  validate(value: string): string | undefined;
}

export interface Choice<T> {
  label: string;
  value: T;
}

export interface CustomDialog {
  title: string;
  content: HTMLElement;
}

export interface Modals {
  /** Resolves true only if the user chose the confirming button. */
  confirm(message: string, confirmLabel?: string): Promise<boolean>;
  /** Resolves the entered text, or undefined if the user backed out. */
  prompt(message: string, options: PromptOptions): Promise<string | undefined>;
  /**
   * Lets the user pick one of a few options; `current` is shown as selected. Resolves the picked
   * value, or undefined if the user backed out.
   */
  choose<T>(title: string, choices: readonly Choice<T>[], current?: T): Promise<T | undefined>;
  /**
   * Shows a dialog with custom content. `build` receives a function that closes the dialog with
   * a result; the promise resolves that result, or undefined if the user dismissed the dialog.
   */
  open<T>(build: (close: (result?: T) => void) => CustomDialog): Promise<T | undefined>;
  /**
   * Shows a message while something slow is running. It cannot be answered or dismissed and it
   * blocks the page underneath. Returns the function that removes it.
   */
  busy(message: string): () => void;
}

function createButton(doc: Document, label: string, className: string): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  return button;
}

/**
 * Opens a modal dialog filled by `fill` and resolves when it closes: with the value passed to
 * `close`, or undefined if it was dismissed (Escape, or a click on the backdrop).
 */
function showDialog<T>(doc: Document, fill: (dialog: HTMLDialogElement, close: (result?: T) => void) => void): Promise<T | undefined> {
  return new Promise((resolve) => {
    const dialog = doc.createElement('dialog');
    dialog.className = 'modal';

    let result: T | undefined;
    const close = (value?: T): void => {
      result = value;
      dialog.close();
    };

    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    // "cancel" is what Escape (and the Android back gesture) sends to the top dialog.
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    // The backdrop is part of the dialog element; a click inside reaches a child element first.
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) close();
    });

    fill(dialog, close);
    doc.body.append(dialog);
    dialog.showModal();
  });
}

const LABEL_ID_PREFIX = 'modal-label-';

export function createModals(doc: Document, labels: ModalLabels): Modals {
  let labelCount = 0;
  /** Names the dialog by one of its elements, which is what a screen reader announces when it opens. */
  const nameBy = (dialog: HTMLDialogElement, element: HTMLElement): void => {
    labelCount += 1;
    element.id = `${LABEL_ID_PREFIX}${labelCount}`;
    dialog.setAttribute('aria-labelledby', element.id);
  };

  const createActions = (...buttons: HTMLButtonElement[]): HTMLElement => {
    const actions = doc.createElement('div');
    actions.className = 'modal-actions';
    actions.append(...buttons);
    return actions;
  };

  return {
    async confirm(message, confirmLabel = labels.confirm) {
      const confirmed = await showDialog<boolean>(doc, (dialog, close) => {
        const text = doc.createElement('p');
        text.className = 'modal-message';
        text.textContent = message;

        // Cancel comes first: the browser focuses the first button, so a stray Enter is harmless.
        const cancel = createButton(doc, labels.cancel, 'button');
        cancel.addEventListener('click', () => close(false));
        const confirm = createButton(doc, confirmLabel, 'button button-primary');
        confirm.addEventListener('click', () => close(true));

        nameBy(dialog, text);
        dialog.append(text, createActions(cancel, confirm));
      });
      return confirmed === true;
    },

    prompt(message, options) {
      return showDialog<string>(doc, (dialog, close) => {
        const form = doc.createElement('form');
        form.className = 'modal-form';

        const label = doc.createElement('label');
        label.className = 'modal-message';
        label.textContent = message;

        const input = doc.createElement('input');
        input.type = 'text';
        input.className = 'modal-input';
        input.value = options.initialValue;
        // Focused by the browser when the dialog opens.
        input.autofocus = true;
        label.append(input);

        const problem = doc.createElement('p');
        problem.className = 'modal-problem';
        problem.setAttribute('role', 'alert');

        const cancel = createButton(doc, labels.cancel, 'button');
        cancel.addEventListener('click', () => close());
        const confirm = createButton(doc, labels.confirm, 'button button-primary');
        confirm.type = 'submit';

        // A form makes Enter in the input confirm, like the button does.
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const reason = options.validate(input.value);
          if (reason === undefined) {
            close(input.value);
          } else {
            problem.textContent = reason;
            input.focus();
          }
        });

        form.append(label, problem, createActions(cancel, confirm));
        nameBy(dialog, label);
        dialog.append(form);
      });
    },

    choose<T>(title: string, choices: readonly Choice<T>[], current?: T) {
      return showDialog<T>(doc, (dialog, close) => {
        const heading = doc.createElement('h2');
        heading.className = 'modal-title';
        heading.textContent = title;

        const list = doc.createElement('div');
        list.className = 'choice-list';
        for (const choice of choices) {
          const button = createButton(doc, choice.label, 'button choice');
          button.setAttribute('aria-pressed', String(choice.value === current));
          button.addEventListener('click', () => close(choice.value));
          list.append(button);
        }
        nameBy(dialog, heading);
        dialog.append(heading, list);
      });
    },

    busy(message) {
      const dialog = doc.createElement('dialog');
      dialog.className = 'modal modal-busy';
      const text = doc.createElement('p');
      text.className = 'modal-message';
      // Nothing else on the page changes meanwhile, so screen readers are told what is going on.
      text.setAttribute('role', 'status');
      text.textContent = message;
      nameBy(dialog, text);
      dialog.append(text);

      // Escape must not hide the indicator while the work is still running.
      dialog.addEventListener('cancel', (event) => event.preventDefault());
      // Also reached if the browser closes the dialog regardless (a second Escape does that).
      dialog.addEventListener('close', () => dialog.remove());
      doc.body.append(dialog);
      dialog.showModal();
      // Closing a dialog that is already closed does nothing.
      return () => dialog.close();
    },

    open<T>(build: (close: (result?: T) => void) => CustomDialog) {
      return showDialog<T>(doc, (dialog, close) => {
        const { title, content } = build(close);
        const heading = doc.createElement('h2');
        heading.className = 'modal-title';
        heading.textContent = title;
        nameBy(dialog, heading);
        dialog.append(heading, content);
      });
    },
  };
}
