// Handing the memo on screen to another app through the share sheet of the system (Web Share
// API). Mostly a thing of phones, where it is the usual way to pass text to a messenger or mail.
//
// The browser is passed in as a port, so every path is tested without one: no sharing at all,
// the user backing out, a refusal, and a text too long to hand over as text.
import { toFileName } from './localFiles.ts';

/** What is handed to the system: the text itself or, for a long one, a file holding it. */
export interface ShareContent {
  title: string;
  text?: string;
  files?: File[];
}

/** The part of `navigator` that is used. Both methods are missing in browsers without sharing. */
export interface SharePort {
  share?(content: ShareContent): Promise<void>;
  canShare?(content: ShareContent): boolean;
}

/** Something the user should be told about sharing. The UI turns it into a translated message. */
export type ShareNotice =
  | { kind: 'share-unsupported' }
  /** There is no text to share. */
  | { kind: 'share-nothing' }
  /** Too long to share as text, and this browser cannot share it as a file. */
  | { kind: 'share-too-long' }
  | { kind: 'share-failed' };

/**
 * Longest text, in UTF-16 code units, that is shared as text; anything longer goes as a file.
 * On Android shared text travels inside a message between apps that is limited to about a
 * megabyte for everything in it, and sharing is known to fail beyond that. No browser documents
 * a limit of its own, so this is a cautious guess, not a measured value.
 */
export const SHARE_TEXT_LIMIT = 100_000;

const CANCELLED_ERROR_NAME = 'AbortError';

export interface ShareActionsOptions {
  port: SharePort;
  /** Title and text of the memo on screen; undefined if there is none. */
  getMemo(): { title: string; text: string } | undefined;
  /** Makes the text file that is shared in place of a text that is too long. */
  createFile(name: string, text: string): File;
  onNotice(notice: ShareNotice): void;
}

export interface ShareActions {
  /**
   * Never rejects. Must be called directly from the tap or key press that asked for it: browsers
   * allow sharing only then, which is also why nothing is awaited before the system is asked.
   */
  share(): Promise<void>;
}

function isCancelled(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === CANCELLED_ERROR_NAME;
}

export function createShareActions(options: ShareActionsOptions): ShareActions {
  const { port, onNotice } = options;

  function canShare(content: ShareContent): boolean {
    try {
      // A browser that cannot say what it is able to share is taken to share text only.
      return port.canShare?.(content) ?? false;
    } catch {
      return false;
    }
  }

  return {
    async share() {
      if (!port.share) {
        onNotice({ kind: 'share-unsupported' });
        return;
      }
      const memo = options.getMemo();
      if (!memo || memo.text === '') {
        onNotice({ kind: 'share-nothing' });
        return;
      }

      let content: ShareContent = { title: memo.title, text: memo.text };
      if (memo.text.length > SHARE_TEXT_LIMIT) {
        content = { title: memo.title, files: [options.createFile(toFileName(memo.title), memo.text)] };
        if (!canShare(content)) {
          onNotice({ kind: 'share-too-long' });
          return;
        }
      }

      try {
        // Called on the port itself: the browser's method does not work detached from its object.
        await port.share(content);
      } catch (error) {
        // Closing the share sheet without choosing anything ends up here as well.
        if (!isCancelled(error)) onNotice({ kind: 'share-failed' });
      }
    },
  };
}
