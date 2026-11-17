// Decides when the Markdown preview is rendered. Rendering a long memo and handing the result to
// the browser takes time, so it happens after a pause in typing, only while the preview is
// switched on, and only if the content really changed. It knows nothing about the DOM or about
// Markdown; both are passed in.
import type { AutosaveTimers } from './autosave.ts';

export interface PreviewOptions {
  /**
   * A value that is the same exactly as long as the visible content is the same (see
   * EditorTabs.getContentKey). Lets "did anything change?" be answered without reading the text.
   */
  getContentKey(): unknown;
  /** The visible text; undefined while no document is shown. */
  getText(): string | undefined;
  render(text: string): string;
  /** Puts HTML into the preview pane. */
  show(html: string): void;
  /** What to show instead of a text that is longer than `maxLength`. */
  tooLongHtml(maxLength: number): string;
  /** Longest text, in UTF-16 code units, that is still rendered. */
  maxLength: number;
  /** How long typing has to pause before the preview follows. */
  delayMs: number;
  timers: AutosaveTimers;
}

export interface Preview {
  /** Switching on renders at once; switching off empties the pane. */
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  /**
   * Call whenever the visible content may be different: after an edit, a tab switch, and also on
   * mere cursor movements if those cannot be told apart. Cheap when nothing changed.
   */
  contentMayHaveChanged(): void;
}

export function createPreview(options: PreviewOptions): Preview {
  const { timers } = options;
  // A value no content key can be equal to, so the first comparison always sees a change.
  const nothingShown = {};
  let enabled = false;
  let shownKey: unknown = nothingShown;
  let timer: unknown;

  const cancelPending = (): void => {
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = undefined;
  };

  const renderNow = (): void => {
    cancelPending();
    shownKey = options.getContentKey();
    const text = options.getText();
    if (text === undefined) options.show('');
    else if (text.length > options.maxLength) options.show(options.tooLongHtml(options.maxLength));
    else options.show(options.render(text));
  };

  return {
    setEnabled(next) {
      if (next === enabled) return;
      enabled = next;
      if (enabled) {
        renderNow();
        return;
      }
      cancelPending();
      shownKey = nothingShown;
      // The rendered copy of a large memo is not worth keeping while nobody can see it.
      options.show('');
    },

    isEnabled: () => enabled,

    contentMayHaveChanged() {
      if (!enabled || options.getContentKey() === shownKey) return;
      cancelPending();
      timer = timers.setTimeout(renderNow, options.delayMs);
    },
  };
}
