/**
 * Copies `text` to the system clipboard. Resolves to false instead of throwing when that is
 * not possible, so callers can fall back to letting the user copy by hand.
 */
export async function copyToClipboard(win: Window, text: string): Promise<boolean> {
  try {
    // navigator.clipboard exists only in secure contexts (https, localhost).
    if (!win.navigator.clipboard) return false;
    await win.navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Permission denied, or the page lost focus while the request was pending.
    return false;
  }
}
