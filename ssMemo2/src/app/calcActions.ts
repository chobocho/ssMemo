// "Run code": calculates the selected text or the current line and offers to put the result
// into the memo or to keep the variables. The variables kept that way are stored and are there
// again on the next visit. Knows nothing about the DOM; the editor and the dialogs are passed in.
import { CalcError, parseStoredEnvironment, runCode, toStoredEnvironment } from '../lib/calc.ts';
import type { CalcErrorCode, CalcValue } from '../lib/calc.ts';
import type { StoragePort } from '../storage/storagePort.ts';

/** Name of the stored value that holds the kept variables. */
export const CALC_MEMORY_KEY = 'calcMemory';
// Results are put into the memo as comments, so running the same lines again ignores them.
const RESULT_PREFIX = '# ';

export type CalcDialogAction =
  /** Put the result into the memo, below the code. */
  | 'insert'
  /** Keep the variables of this run for later runs. */
  | 'save'
  /** Forget every kept variable. */
  | 'clear';

export interface CalcResultView {
  /** One line per statement of the code; empty if it only held comments. */
  outputs: readonly string[];
  /** Variables that were kept before this run, which the code could therefore use. */
  memoryNames: readonly string[];
}

export type CalcNotice =
  /** There is no selection and the cursor is on an empty line. */
  | { kind: 'calc-nothing-to-run' }
  /** The variables apply until the page is closed but could not be stored. */
  | { kind: 'calc-memory-not-saved' };

export interface CalcActionsOptions {
  storage: StoragePort;
  /** The text to run and the position behind it; undefined while no document is showing. */
  getCode(): { code: string; end: number } | undefined;
  /** Puts lines into the document behind position `end`. */
  insertResult(end: number, lines: readonly string[]): void;
  /** Shows the result and resolves what the user chose to do with it; undefined if nothing. */
  showResult(view: CalcResultView): Promise<CalcDialogAction | undefined>;
  showError(code: CalcErrorCode, detail: string): Promise<void>;
  onNotice(notice: CalcNotice): void;
}

export interface CalcActions {
  /** Never rejects. */
  run(): Promise<void>;
}

export function createCalcActions(options: CalcActionsOptions): CalcActions {
  const { storage, onNotice } = options;
  // Read from storage the first time it is needed; from then on this copy is what counts, so the
  // variables keep working even if storing them fails.
  let memory: Map<string, CalcValue> | undefined;

  async function loadMemory(): Promise<Map<string, CalcValue>> {
    if (memory) return memory;
    try {
      memory = parseStoredEnvironment(await storage.getValue(CALC_MEMORY_KEY));
    } catch {
      memory = new Map();
    }
    return memory;
  }

  async function replaceMemory(next: Map<string, CalcValue>): Promise<void> {
    memory = next;
    try {
      await storage.setValue(CALC_MEMORY_KEY, toStoredEnvironment(next));
    } catch {
      onNotice({ kind: 'calc-memory-not-saved' });
    }
  }

  return {
    async run() {
      const selection = options.getCode();
      if (!selection || selection.code.trim() === '') {
        onNotice({ kind: 'calc-nothing-to-run' });
        return;
      }
      const kept = await loadMemory();

      let result;
      try {
        result = runCode(selection.code, kept);
      } catch (error) {
        // runCode only throws CalcError; anything else is treated like its catch-all so that this
        // function never rejects.
        const problem = error instanceof CalcError ? error : new CalcError('too-complex');
        await options.showError(problem.code, problem.detail);
        return;
      }

      const action = await options.showResult({ outputs: result.outputs, memoryNames: [...kept.keys()] });
      if (action === 'insert') {
        options.insertResult(selection.end, result.outputs.map((output) => `${RESULT_PREFIX}${output}`));
      } else if (action === 'save') {
        // The run started from the kept variables, so its environment is those plus the new ones.
        await replaceMemory(result.environment);
      } else if (action === 'clear') {
        await replaceMemory(new Map());
      }
    },
  };
}
