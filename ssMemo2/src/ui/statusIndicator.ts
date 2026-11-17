// Header status: whether the memo is saved, and a permanent badge while nothing is being kept.

export interface StatusIndicator {
  element: HTMLElement;
  /** Shows the current save state, e.g. "Saved". */
  setSaveState(label: string): void;
  /** Shows the badge that stays visible for as long as the app runs without persistent storage. */
  showTemporaryBadge(label: string): void;
}

export function createStatusIndicator(doc: Document): StatusIndicator {
  const element = doc.createElement('div');
  element.className = 'app-status';

  const badge = doc.createElement('span');
  badge.className = 'app-badge';
  badge.hidden = true;

  // A polite live region: screen readers announce a change without interrupting typing.
  const saveState = doc.createElement('span');
  saveState.className = 'app-save-state';
  saveState.setAttribute('role', 'status');

  element.append(badge, saveState);

  return {
    element,
    setSaveState(label) {
      saveState.textContent = label;
    },
    showTemporaryBadge(label) {
      badge.textContent = label;
      badge.hidden = false;
    },
  };
}
