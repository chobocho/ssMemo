// A stack of dismissible messages below the header, for things the user needs to know but that
// must not block typing (storage problems, a memo saved as a copy, a file that was saved, ...).

export interface NoticeBar {
  element: HTMLElement;
  /**
   * Adds a message. A message that is already showing is not added twice. A 'warning' (the
   * default) stays until the user closes it; an 'info' confirms something and leaves by itself.
   */
  show(text: string, kind?: NoticeKind): void;
}

export type NoticeKind = 'warning' | 'info';

const DISMISS_SYMBOL = '✕';

/**
 * @param scheduleRemoval is given a function for each info message and has to call it once the
 *   message was on screen long enough (a timer in the app, by hand in tests).
 */
export function createNoticeBar(doc: Document, dismissLabel: string, scheduleRemoval: (remove: () => void) => void): NoticeBar {
  const element = doc.createElement('div');
  element.className = 'notice-bar';
  // Announced immediately by screen readers: these messages are about possible data loss.
  element.setAttribute('role', 'alert');

  const showing = new Map<string, HTMLElement>();

  return {
    element,
    show(text, kind = 'warning') {
      // A storage that keeps failing would otherwise fill the screen with the same sentence.
      if (showing.has(text)) return;

      const notice = doc.createElement('div');
      notice.className = kind === 'info' ? 'notice notice-info' : 'notice';
      // Removes this very element, so a late timer cannot take away a newer message with the same text.
      const remove = (): void => {
        notice.remove();
        if (showing.get(text) === notice) showing.delete(text);
      };

      const message = doc.createElement('span');
      message.className = 'notice-text';
      message.textContent = text;

      const dismiss = doc.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'notice-dismiss';
      dismiss.textContent = DISMISS_SYMBOL;
      dismiss.setAttribute('aria-label', dismissLabel);
      dismiss.addEventListener('click', remove);

      notice.append(message, dismiss);
      element.append(notice);
      showing.set(text, notice);
      if (kind === 'info') scheduleRemoval(remove);
    },
  };
}
