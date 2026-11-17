// The browser side of local files: choosing, reading and writing them.
//
// Where the File System Access API exists (desktop Chrome and Edge, recent Chrome on Android) a
// chosen file can be written back in place. Everywhere else files are picked with a file input
// and saved as downloads.
import type { PickedFile, SaveTarget, WritableFile } from '../app/localFiles.ts';

export interface PickOptions {
  /** Whether several files may be chosen at once. */
  multiple: boolean;
  /** Restricts the dialog to these types, in the syntax of the input's "accept" attribute. */
  accept?: string;
}

const PICKER_CLASS = 'file-picker';
// What the pickers reject with when the user closes the dialog.
const ABORT_ERROR_NAME = 'AbortError';
// Generic on purpose: the browser must store the bytes as they are, not display or convert them.
const DOWNLOAD_MIME_TYPE = 'application/octet-stream';
// A download reads its data from the URL after the click, so the URL has to outlive it a while.
const DOWNLOAD_URL_LIFETIME_MS = 60_000;

// The pickers of the File System Access API, which TypeScript's DOM typings do not describe yet.
interface FilePickerWindow {
  showOpenFilePicker?: (options: { multiple: boolean }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options: { suggestedName: string }) => Promise<FileSystemFileHandle>;
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === ABORT_ERROR_NAME;
}

function toPickedFile(file: File): PickedFile {
  return { name: file.name, size: file.size, read: async () => new Uint8Array(await file.arrayBuffer()) };
}

export function toPickedFiles(files: Iterable<File>): PickedFile[] {
  return [...files].map(toPickedFile);
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

function toWritableFile(handle: FileSystemFileHandle): WritableFile {
  return {
    name: handle.name,
    async write(bytes) {
      // The browser asks for permission here the first time a file is written.
      const stream = await handle.createWritable();
      try {
        // The typings want a view on a plain ArrayBuffer; these bytes never sit on a shared one.
        await stream.write(bytes as Uint8Array<ArrayBuffer>);
        // The file on disk is replaced only now, so a failed write leaves it as it was.
        await stream.close();
      } catch (error) {
        await stream.abort().catch(() => undefined);
        throw error;
      }
    },
  };
}

function startDownload(win: Window, fileName: string, bytes: Uint8Array): void {
  const doc = win.document;
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: DOWNLOAD_MIME_TYPE }));
  const link = doc.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  doc.body.append(link);
  link.click();
  link.remove();
  win.setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS);
}

export interface FileIo {
  /** Lets the user choose files. Resolves an empty list if they back out. */
  pickFiles(options: PickOptions): Promise<PickedFile[]>;
  /**
   * Saves `bytes` where the user chooses, or as a download where the browser offers no such
   * dialog. Rejects if the chosen file cannot be written.
   */
  saveAs(suggestedName: string, bytes: Uint8Array): Promise<SaveTarget>;
}

/** Both functions must be called from a click or key handler; browsers open dialogs only then. */
export function createFileIo(win: Window): FileIo {
  const pickers = win as unknown as FilePickerWindow;

  return {
    async pickFiles(options) {
      // A request limited to one file type goes to the file input, which filters with a plain
      // "accept"; those files (backups) are never written back anyway.
      if (pickers.showOpenFilePicker && options.accept === undefined) {
        try {
          const handles = await pickers.showOpenFilePicker({ multiple: options.multiple });
          return await Promise.all(
            handles.map(async (handle): Promise<PickedFile> => {
              return { ...toPickedFile(await handle.getFile()), writable: toWritableFile(handle) };
            }),
          );
        } catch (error) {
          if (isAbort(error)) return [];
          // The dialog is not allowed here (inside a frame, for example); the input still works.
        }
      }
      return pickFiles(win.document, options);
    },

    async saveAs(suggestedName, bytes) {
      if (pickers.showSaveFilePicker) {
        let handle: FileSystemFileHandle | undefined;
        try {
          handle = await pickers.showSaveFilePicker({ suggestedName });
        } catch (error) {
          if (isAbort(error)) return { kind: 'cancelled' };
          // Not allowed here; a download still works.
        }
        if (handle) {
          const file = toWritableFile(handle);
          await file.write(bytes);
          return { kind: 'written', file };
        }
      }
      startDownload(win, suggestedName, bytes);
      return { kind: 'downloaded' };
    },
  };
}
