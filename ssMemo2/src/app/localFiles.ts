// Brings local files into the app: checks them, decodes them and hands them to the workspace.
// It knows nothing about the DOM. How files are picked and how a busy indicator looks is passed
// in, so the whole procedure is tested without a browser.
import { looksGarbled } from '../lib/encoding.ts';
import type { TextEncoding } from '../lib/encoding.ts';
import { getSaveFormat, looksBinary, readTextFile, writeTextFile } from '../lib/textFile.ts';
import type { TextFormat } from '../lib/textFile.ts';
import type { DocumentSource } from '../storage/storagePort.ts';
import type { ActiveDocument, OpenedFile, SavedToFile } from './workspace.ts';

/** Larger files are refused: neither the editor nor the browser storage is meant for them. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** From this size on, opening takes long enough on a phone to deserve an indicator. */
export const LOADING_INDICATOR_BYTES = 200 * 1024;

/** A file on the device that can be written again without asking where it is. */
export interface WritableFile {
  name: string;
  /** Replaces the file's content. Rejects if the file cannot be written. */
  write(bytes: Uint8Array): Promise<void>;
}

/** A file the user chose, from a file dialog or by dropping it on the page. */
export interface PickedFile {
  name: string;
  /** Size in bytes, as reported before reading. */
  size: number;
  read(): Promise<Uint8Array>;
  /** Present when the browser allows writing back to the chosen file. */
  writable?: WritableFile;
}

/** What became of a request to save somewhere the user chooses. */
export type SaveTarget =
  /** Written to a file that can be written again later. */
  | { kind: 'written'; file: WritableFile }
  /** Handed to the browser as a download; where it ends up is not known. */
  | { kind: 'downloaded' }
  /** The user closed the dialog without choosing. */
  | { kind: 'cancelled' };

/** Something the user should be told about a file. The UI turns it into a translated message. */
export type FileNotice =
  | { kind: 'file-too-large'; fileName: string; maxBytes: number }
  /** The file holds something other than text (an image, an archive, ...). */
  | { kind: 'file-not-text'; fileName: string }
  | { kind: 'file-unreadable'; fileName: string }
  /** The file was opened, but the text suggests the encoding was guessed wrong. */
  | { kind: 'file-garbled'; fileName: string; encoding: TextEncoding }
  /** The encoding was to be changed, but the visible tab is a memo, not a file. */
  | { kind: 'encoding-not-a-file' }
  /** The encoding can no longer be changed: the file's bytes are gone or the text was edited. */
  | { kind: 'encoding-locked' }
  | { kind: 'file-saved'; fileName: string }
  | { kind: 'file-save-failed'; fileName: string };

export interface LocalFilesOptions {
  /** Shows a decoded file in a tab; false if no more tabs can be opened (see Workspace.openFile). */
  openFile(file: OpenedFile): boolean;
  onNotice(notice: FileNotice): void;
  getActiveDocument(): ActiveDocument | undefined;
  /** Replaces a tab's text with another decoding of its file (see Workspace.redecode). */
  redecode(tabId: string, text: string, source: DocumentSource): boolean;
  /** Lets the user pick an encoding; `current` is the one in use. Resolves undefined if they back out. */
  chooseEncoding(current: TextEncoding): Promise<TextEncoding | undefined>;
  getText(tabId: string): string | undefined;
  /** Lets the user choose where to save and writes `bytes` there. Rejects if writing fails. */
  saveAs(suggestedName: string, bytes: Uint8Array): Promise<SaveTarget>;
  /** Asks whether a file may be rewritten in another encoding. */
  confirmConversion(fileName: string, from: TextEncoding, to: TextEncoding): Promise<boolean>;
  /** Records where and in which form a tab was saved (see Workspace.markSavedToFile). */
  markSaved(tabId: string, saved: SavedToFile): Promise<void>;
  /** Shows that `fileName` is being opened. Returns the function that removes the indicator. */
  showLoading(fileName: string): () => void;
  /** Resolves once the browser had a chance to draw and to handle input. */
  yieldToUi(): Promise<void>;
}

export interface LocalFiles {
  /** Opens each file in a tab of its own, in the order given. Never rejects. */
  openFiles(files: readonly PickedFile[]): Promise<void>;
  /** Asks for another encoding and reads the visible file again with it. Never rejects. */
  changeEncoding(): Promise<void>;
  /**
   * Writes the visible tab to a local file: back to the file it is linked to, or, with
   * `chooseTarget` or without such a file, wherever the user chooses. Never rejects.
   */
  saveToFile(chooseTarget: boolean): Promise<void>;
}

// A memo has no file format of its own; it is written the way most tools expect text today.
const MEMO_FILE_FORMAT: TextFormat = { encoding: 'UTF-8', eol: 'lf', hasBom: false };
const MEMO_FILE_EXTENSION = '.txt';
const FALLBACK_FILE_NAME = 'memo';
// Characters that Windows, Android or Unix refuse in a file name, and control characters.
const UNSAFE_FILE_NAME_CHARACTERS = /[\\/:*?"<>|\x00-\x1f]/g;
// Windows silently drops these from the end of a name, which would save under another name.
const TRAILING_DOTS_AND_SPACES = /[. ]+$/;

/** A file name for a memo, made from its title. */
export function toFileName(title: string): string {
  const base = title.replace(UNSAFE_FILE_NAME_CHARACTERS, '_').trim().replace(TRAILING_DOTS_AND_SPACES, '');
  return `${base === '' ? FALLBACK_FILE_NAME : base}${MEMO_FILE_EXTENSION}`;
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
      const opened: OpenedFile = { text, source: { fileName: file.name, ...format }, bytes };
      if (file.writable) opened.writable = file.writable;
      if (!options.openFile(opened)) return 'no-room';
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

    async saveToFile(chooseTarget) {
      const active = options.getActiveDocument();
      const text = active ? options.getText(active.tabId) : undefined;
      if (!active || text === undefined) return;
      const { source, tabId } = active;
      const format = getSaveFormat(source ?? MEMO_FILE_FORMAT);
      const suggestedName = source?.fileName ?? toFileName(active.title);

      // Rewriting a CP949 or Johab file as UTF-8 changes every Korean byte in it, which a program
      // that expects the old encoding will not read. That must be the user's decision.
      if (source && format.encoding !== source.encoding) {
        if (!(await options.confirmConversion(source.fileName, source.encoding, format.encoding))) return;
      }

      let fileName = suggestedName;
      try {
        const bytes = writeTextFile(text, format);
        let localFile = chooseTarget ? undefined : active.localFile;
        if (localFile) {
          fileName = localFile.name;
          await localFile.write(bytes);
        } else {
          const target = await options.saveAs(suggestedName, bytes);
          if (target.kind === 'cancelled') return;
          if (target.kind === 'written') {
            localFile = target.file;
            fileName = localFile.name;
          }
        }
        const saved: SavedToFile = {};
        if (source) saved.source = { fileName, ...format };
        if (localFile) saved.localFile = localFile;
        await options.markSaved(tabId, saved);
        // A download appears in the browser's own list. Writing to a known file shows nothing
        // anywhere, so that case is confirmed here.
        if (localFile) onNotice({ kind: 'file-saved', fileName });
      } catch {
        onNotice({ kind: 'file-save-failed', fileName });
      }
    },

    async changeEncoding() {
      const active = options.getActiveDocument();
      if (!active?.source) {
        onNotice({ kind: 'encoding-not-a-file' });
        return;
      }
      const { source, originalBytes: bytes, tabId } = active;
      if (!bytes) {
        onNotice({ kind: 'encoding-locked' });
        return;
      }
      const encoding = await options.chooseEncoding(source.encoding);
      if (encoding === undefined || encoding === source.encoding) return;

      const isLarge = bytes.length >= LOADING_INDICATOR_BYTES;
      const hideLoading = isLarge ? options.showLoading(source.fileName) : undefined;
      try {
        if (isLarge) await options.yieldToUi();
        const { text, format } = readTextFile(bytes, encoding);
        if (isLarge) await options.yieldToUi();
        if (!options.redecode(tabId, text, { fileName: source.fileName, ...format })) {
          // Edited while the dialog was open.
          onNotice({ kind: 'encoding-locked' });
          return;
        }
        if (looksGarbled(text)) {
          onNotice({ kind: 'file-garbled', fileName: source.fileName, encoding });
        }
      } finally {
        hideLoading?.();
      }
    },
  };
}
