// Decides when the current document is written to storage.
//
// A change is saved after a short pause in typing, and at the latest after a maximum wait while
// typing continues. Saves never overlap: each save carries the document revision it is based on,
// so two saves in flight from the same window would look like a conflict between two windows.
// Timers are injected so the timing can be tested without waiting.

export type AutosaveState =
  /** Everything is stored. */
  | 'saved'
  /** There are changes waiting for the next save. */
  | 'pending'
  /** A save is being written. */
  | 'saving'
  /** The last save failed; the changes are still only in the editor. */
  | 'failed';

export interface AutosaveTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AutosaveOptions {
  /** Writes the current content. Must reject (or throw) when the content was not stored. */
  save: () => Promise<void>;
  /** Save this long after the most recent change. */
  idleDelayMs: number;
  /** Save at the latest this long after the first unsaved change, even if typing never pauses. */
  maxWaitMs: number;
  timers: AutosaveTimers;
  /** Called for every failed save. */
  onError: (error: unknown) => void;
  /** Called whenever the state changes, never twice in a row with the same state. */
  onStateChange: (state: AutosaveState) => void;
}

export interface Autosave {
  /** Call on every change to the content. */
  notifyChange(): void;
  /**
   * Saves now instead of waiting for a timer; used when the page is being hidden or closed.
   * The save starts before this method returns unless one is already running, in which case it
   * follows that one. Resolves when everything is stored or a save has failed; never rejects.
   */
  flush(): Promise<void>;
  /** True while there are changes that are not known to be stored. */
  hasUnsavedChanges(): boolean;
}

export function createAutosave(options: AutosaveOptions): Autosave {
  const { save, idleDelayMs, maxWaitMs, timers, onError, onStateChange } = options;

  /** Changes exist that no started save has picked up yet. */
  let dirty = false;
  /** The most recent save failed and nothing has been retried since. */
  let failed = false;
  let runningSave: Promise<void> | undefined;
  let idleTimer: unknown;
  let maxWaitTimer: unknown;
  let state: AutosaveState = 'saved';

  const setState = (next: AutosaveState): void => {
    if (next === state) return;
    state = next;
    onStateChange(next);
  };

  const clearTimers = (): void => {
    if (idleTimer !== undefined) timers.clearTimeout(idleTimer);
    if (maxWaitTimer !== undefined) timers.clearTimeout(maxWaitTimer);
    idleTimer = undefined;
    maxWaitTimer = undefined;
  };

  // The idle timer restarts with every change; the maximum-wait timer runs from the first one.
  const scheduleSave = (): void => {
    if (idleTimer !== undefined) timers.clearTimeout(idleTimer);
    idleTimer = timers.setTimeout(startSave, idleDelayMs);
    maxWaitTimer ??= timers.setTimeout(startSave, maxWaitMs);
  };

  function startSave(): Promise<void> {
    // Saves are serialized; the running one picks up newer changes when it finishes.
    if (runningSave) return runningSave;
    if (!dirty) return Promise.resolve();

    clearTimers();
    dirty = false;
    failed = false;
    setState('saving');

    let attempt: Promise<void>;
    try {
      attempt = save();
    } catch (error) {
      attempt = Promise.reject(error);
    }

    runningSave = attempt.then(
      () => {
        runningSave = undefined;
        if (dirty) {
          // The user kept typing while the save was being written.
          setState('pending');
          scheduleSave();
        } else {
          setState('saved');
        }
      },
      (error: unknown) => {
        runningSave = undefined;
        dirty = true;
        failed = true;
        setState('failed');
        // No automatic retry: a full or broken storage does not recover by being hammered.
        // The next change or flush tries again.
        onError(error);
      },
    );
    return runningSave;
  }

  function flush(): Promise<void> {
    return startSave().then(() => {
      // A change made while that save was running still has to be written.
      if (dirty && !failed) return flush();
      return undefined;
    });
  }

  return {
    notifyChange() {
      dirty = true;
      // While a save is running, its completion schedules the follow-up save.
      if (runningSave) return;
      setState('pending');
      scheduleSave();
    },
    flush,
    hasUnsavedChanges: () => dirty || runningSave !== undefined,
  };
}
