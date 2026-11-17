// Brings local files into the app: checks them, decodes them and hands them to the workspace.
// It knows nothing about the DOM. How files are picked and how a busy indicator looks is passed
// in, so the whole procedure is tested without a browser.
import { looksGarbled } from '../lib/encoding.ts';
import type { TextEncoding } from '../lib/encoding.ts';
import { looksBinary, readTextFile } from '../lib/textFile.ts';
import type { OpenedFile } from './workspace.ts';

/** Larger files are refused: neither the editor nor the browser storage is meant for them. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** From this size on, opening takes long enough on a phone to deserve an indicator. */
export const LOADING_INDICATOR_BYTES = 200 * 1024;

/** A file the user chose, from a file dialog or by dropping it on the page. */
export interface PickedFile {
  name: string;
  /** Size in bytes, as reported before reading. */
  size: number;
  read(): Promise<Uint8Array>;
}

/** Something the user should be told about a file. The UI turns it into a translated message. */
export type FileNotice =
  | { kind: 'file-too-large'; fileName: string; maxBytes: number }
  /** The file holds something other than text (an image, an archive, ...). */
  | { kind: 'file-not-text'; fileName: string }
  | { kind: 'file-unreadable'; fileName: string }
  /** The file was opened, but the text suggests the encoding was guessed wrong. */
  | { kind: 'file-garbled'; fileName: string; encoding: TextEncoding };

export interface LocalFilesOptions {
  /** Shows a decoded file in a tab; false if no more tabs can be opened (see Workspace.openFile). */
  openFile(file: OpenedFile): boolean;
  onNotice(notice: FileNotice): void;
  /** Shows that `fileName` is being opened. Returns the function that removes the indicator. */
  showLoading(fileName: string): () => void;
  /** Resolves once the browser had a chance to draw and to handle input. */
  yieldToUi(): Promise<void>;
}

export interface LocalFiles {
  /** Opens each file in a tab of its own, in the order given. Never rejects. */
  openFiles(files: readonly PickedFile[]): Promise<void>;
}

type OpenOutcome = 'opened' | 'skipped' | 'no-room';

export function createLocalFiles(options: LocalFilesOptions): LocalFiles {
  const { onNotice } = options;

  async function openOne(file: PickedFile): Promise<OpenOutcome> {
    const tooLarge = (): OpenOutcome => {
      onNotice({ kind: 'file-too-large', fileName: file.name, maxBytes: MAX_FILE_BYTES });
      return 'skipped';
    };
    if (file.size > MAX_FILE_BYTES) return tooLarge();

    const isLarge = file.size >= LOADING_INDICATOR_BYTES;
    const hideLoading = isLarge ? options.showLoading(file.name) : undefined;
    // Reading, decoding and filling the editor in one go would freeze a phone for seconds.
    // Pausing between the steps lets the indicator appear and keeps touches responsive.
    const pause = async (): Promise<void> => {
      if (isLarge) await options.yieldToUi();
    };

    try {
      await pause();
      const bytes = await file.read();
      // The reported size is only a claim; the file may have grown since it was picked.
      if (bytes.length > MAX_FILE_BYTES) return tooLarge();
      if (looksBinary(bytes)) {
        onNotice({ kind: 'file-not-text', fileName: file.name });
        return 'skipped';
      }
      await pause();
      const { text, format } = readTextFile(bytes);
      await pause();
      if (!options.openFile({ text, source: { fileName: file.name, ...format } })) return 'no-room';
      if (looksGarbled(text)) {
        onNotice({ kind: 'file-garbled', fileName: file.name, encoding: format.encoding });
      }
      return 'opened';
    } catch {
      onNotice({ kind: 'file-unreadable', fileName: file.name });
      return 'skipped';
    } finally {
      // Whatever happened, the indicator must not stay on screen.
      hideLoading?.();
    }
  }

  return {
    async openFiles(files) {
      for (const file of files) {
        // Without a free tab there is no point in reading the rest.
        if ((await openOne(file)) === 'no-room') break;
      }
    },
  };
}
