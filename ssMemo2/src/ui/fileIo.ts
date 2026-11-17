// The browser side of local files: showing the file dialog and reading what was chosen.
import type { PickedFile } from '../app/localFiles.ts';

export interface PickOptions {
  /** Whether several files may be chosen at once. */
  multiple: boolean;
  /** Restricts the dialog to these types, in the syntax of the input's "accept" attribute. */
  accept?: string;
}

const PICKER_CLASS = 'file-picker';

export function toPickedFiles(files: Iterable<File>): PickedFile[] {
  return [...files].map((file) => ({
    name: file.name,
    size: file.size,
    read: async () => new Uint8Array(await file.arrayBuffer()),
  }));
}

/**
 * Opens the browser's file dialog. Resolves the chosen files, or an empty list if the user backed
 * out. Must be called from a click or key handler: browsers open the dialog only then.
 */
export function pickFiles(doc: Document, options: PickOptions): Promise<PickedFile[]> {
  // Browsers without the "cancel" event leave the input of a dismissed dialog behind.
  doc.querySelector(`input.${PICKER_CLASS}`)?.remove();

  const input = doc.createElement('input');
  input.type = 'file';
  input.className = PICKER_CLASS;
  input.hidden = true;
  input.multiple = options.multiple;
  if (options.accept !== undefined) input.accept = options.accept;

  return new Promise((resolve) => {
    const finish = (files: PickedFile[]): void => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish(toPickedFiles(input.files ?? [])));
    input.addEventListener('cancel', () => finish([]));
    // Some mobile browsers ignore a click on an input that is not part of the document.
    doc.body.append(input);
    input.click();
  });
}
