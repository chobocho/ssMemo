import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CalcDialogAction, CalcResultView } from '../../src/app/calcActions.ts';
import { createCalcErrorContent, createCalcResultContent } from '../../src/ui/calcDialog.ts';
import { createTestDom } from '../helpers/dom.ts';

const LABELS = {
  memory: (names: string) => `Stored: ${names}`,
  noOutput: '(no output)',
  insert: 'Insert',
  save: 'Keep',
  clear: 'Forget',
  close: 'Close',
};

interface Harness {
  content: HTMLElement;
  /** What the dialog was closed with; "dismissed" stands for closing without an action. */
  closedWith: (CalcDialogAction | 'dismissed')[];
  buttonLabels(): string[];
  press(label: string): void;
}

function createHarness(view: CalcResultView): Harness {
  const { document } = createTestDom();
  const closedWith: Harness['closedWith'] = [];
  const content = createCalcResultContent(document, view, LABELS, (action) => closedWith.push(action ?? 'dismissed'));
  document.body.append(content);
  const buttons = (): HTMLButtonElement[] => [...content.querySelectorAll('button')];
  return {
    content,
    closedWith,
    buttonLabels: () => buttons().map((button) => button.textContent ?? ''),
    press(label) {
      const button = buttons().find((candidate) => candidate.textContent === label);
      assert.ok(button, `no button labelled ${label}`);
      button.click();
    },
  };
}

test('the result shows one line per output, exactly as calculated', () => {
  const { content } = createHarness({ outputs: ['x = 10', '30'], memoryNames: [] });
  const output = content.querySelector('.calc-output');
  assert.equal(output?.tagName, 'PRE');
  assert.equal(output?.textContent, 'x = 10\n30');
  assert.equal(content.querySelector('.calc-memory'), null);
});

test('a very long number is not cut off: the output can be scrolled and selected', () => {
  const digits = '9'.repeat(5000);
  const { content } = createHarness({ outputs: [digits], memoryNames: [] });
  const output = content.querySelector<HTMLElement>('.calc-output');
  assert.equal(output?.textContent, digits);
  assert.equal(output?.tabIndex, 0);
});

test('a run without output says so and offers nothing to insert', () => {
  const harness = createHarness({ outputs: [], memoryNames: [] });
  assert.equal(harness.content.querySelector('.calc-output')?.textContent, '(no output)');
  assert.deepEqual(harness.buttonLabels(), ['Keep', 'Close']);
});

test('stored variables are named, and can then be forgotten', () => {
  const harness = createHarness({ outputs: ['3'], memoryNames: ['x', 'y'] });
  assert.equal(harness.content.querySelector('.calc-memory')?.textContent, 'Stored: x, y');
  assert.deepEqual(harness.buttonLabels(), ['Insert', 'Keep', 'Forget', 'Close']);
});

test('each button closes the dialog with its action, and Close with none', () => {
  for (const [label, expected] of [['Insert', 'insert'], ['Keep', 'save'], ['Forget', 'clear'], ['Close', 'dismissed']] as const) {
    const harness = createHarness({ outputs: ['3'], memoryNames: ['x'] });
    harness.press(label);
    assert.deepEqual(harness.closedWith, [expected]);
  }
});

test('output that looks like markup is shown as text', () => {
  const { content } = createHarness({ outputs: ['<img src=x onerror=alert(1)>'], memoryNames: ['<b>'] });
  assert.equal(content.querySelector('img'), null);
  assert.equal(content.querySelector('b'), null);
});

test('an error is shown as a message with a way to close it', () => {
  const { document } = createTestDom();
  let closed = 0;
  const content = createCalcErrorContent(document, 'Cannot divide by zero.', 'Close', () => {
    closed += 1;
  });
  assert.equal(content.querySelector('.modal-message')?.textContent, 'Cannot divide by zero.');
  const buttons = [...content.querySelectorAll('button')];
  assert.deepEqual(buttons.map((button) => button.textContent), ['Close']);
  buttons[0]?.click();
  assert.equal(closed, 1);
});
