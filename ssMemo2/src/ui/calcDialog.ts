// What the calculator's dialogs show: the result of a run with what can be done with it, or the
// reason a run failed. Text only ever goes in as text, so output can never become markup.
import type { CalcDialogAction, CalcResultView } from '../app/calcActions.ts';

export interface CalcDialogLabels {
  /** The line that lists stored variables; `names` is that list. */
  memory(names: string): string;
  /** Shown in place of the output of a run that printed nothing. */
  noOutput: string;
  insert: string;
  save: string;
  clear: string;
  close: string;
}

const NAME_SEPARATOR = ', ';
const LINE_BREAK = '\n';

function createButton(doc: Document, label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = primary ? 'button button-primary' : 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

/** `close` ends the dialog; without an argument nothing is done with the result. */
export function createCalcResultContent(
  doc: Document,
  view: CalcResultView,
  labels: CalcDialogLabels,
  close: (action?: CalcDialogAction) => void,
): HTMLElement {
  const element = doc.createElement('div');
  element.className = 'calc-result';

  if (view.memoryNames.length > 0) {
    const memory = doc.createElement('p');
    memory.className = 'calc-memory';
    memory.textContent = labels.memory(view.memoryNames.join(NAME_SEPARATOR));
    element.append(memory);
  }

  const hasOutput = view.outputs.length > 0;
  // A <pre> keeps a number of thousands of digits in one piece; it scrolls and can be selected.
  const output = doc.createElement('pre');
  output.className = hasOutput ? 'calc-output' : 'calc-output calc-output-empty';
  output.tabIndex = 0;
  output.textContent = hasOutput ? view.outputs.join(LINE_BREAK) : labels.noOutput;
  element.append(output);

  const actions = doc.createElement('div');
  actions.className = 'modal-actions';
  if (hasOutput) actions.append(createButton(doc, labels.insert, true, () => close('insert')));
  actions.append(createButton(doc, labels.save, false, () => close('save')));
  if (view.memoryNames.length > 0) actions.append(createButton(doc, labels.clear, false, () => close('clear')));
  actions.append(createButton(doc, labels.close, false, () => close()));
  element.append(actions);
  return element;
}

export function createCalcErrorContent(doc: Document, message: string, closeLabel: string, close: () => void): HTMLElement {
  const element = doc.createElement('div');
  const text = doc.createElement('p');
  text.className = 'modal-message';
  text.textContent = message;
  const actions = doc.createElement('div');
  actions.className = 'modal-actions';
  actions.append(createButton(doc, closeLabel, true, close));
  element.append(text, actions);
  return element;
}
