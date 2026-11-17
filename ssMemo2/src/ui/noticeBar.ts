// A stack of dismissible messages below the header, for things the user needs to know but that
// must not block typing (storage problems, a memo saved as a copy, ...).

export interface NoticeBar {
  element: HTMLElement;
  /** Adds a message. A message that is already showing is not added twice. */
  show(text: string): void;
}

const DISMISS_SYMBOL = '✕';

export function createNoticeBar(doc: Document, dismissLabel: string): NoticeBar {
  const element = doc.createElement('div');
  element.className = 'notice-bar';
  // Announced immediately by screen readers: these messages are about possible data loss.
  element.setAttribute('role', 'alert');

  const showing = new Map<string, HTMLElement>();

  return {
    element,
    show(text) {
      // A storage that keeps failing would otherwise fill the screen with the same sentence.
      if (showing.has(text)) return;

      const notice = doc.createElement('div');
      notice.className = 'notice';

      const message = doc.createElement('span');
      message.className = 'notice-text';
      message.textContent = text;

      const dismiss = doc.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'notice-dismiss';
      dismiss.textContent = DISMISS_SYMBOL;
      dismiss.setAttribute('aria-label', dismissLabel);
      dismiss.addEventListener('click', () => {
        notice.remove();
        showing.delete(text);
      });

      notice.append(message, dismiss);
      element.append(notice);
      showing.set(text, notice);
    },
  };
}
