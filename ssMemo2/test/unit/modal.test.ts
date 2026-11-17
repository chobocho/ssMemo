import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModals } from '../../src/ui/modal.ts';
import type { Modals } from '../../src/ui/modal.ts';
import { createTestDom, nextTick } from '../helpers/dom.ts';
import type { TestDom } from '../helpers/dom.ts';

interface Harness extends TestDom {
  modals: Modals;
  /** The dialog on top (the last one opened that is still open). */
  topDialog(): HTMLDialogElement;
  openDialogCount(): number;
  button(label: string): HTMLButtonElement;
  /** What the browser does when Escape is pressed in a modal dialog. */
  pressEscape(): void;
}

function createHarness(): Harness {
  const dom = createTestDom();
  const { document, window } = dom;
  const openDialogs = (): HTMLDialogElement[] => [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')];
  const topDialog = (): HTMLDialogElement => {
    const dialog = openDialogs().at(-1);
    assert.ok(dialog, 'expected an open dialog');
    return dialog;
  };
  return {
    ...dom,
    modals: createModals(document, { confirm: 'OK', cancel: 'Cancel' }),
    topDialog,
    openDialogCount: () => openDialogs().length,
    button(label) {
      const found = [...topDialog().querySelectorAll('button')].find((candidate) => candidate.textContent === label);
      assert.ok(found, `expected a button labelled "${label}"`);
      return found;
    },
    pressEscape: () => {
      topDialog().dispatchEvent(new window.Event('cancel', { cancelable: true }));
    },
  };
}

// --- confirm ----------------------------------------------------------------

test('confirm shows the question modally and resolves true when confirmed', async () => {
  const harness = createHarness();
  const answer = harness.modals.confirm('Delete this memo?');
  assert.equal(harness.openDialogCount(), 1);
  assert.equal(harness.topDialog().textContent?.includes('Delete this memo?'), true);
  harness.button('OK').click();
  assert.equal(await answer, true);
});

test('confirm resolves false when cancelled', async () => {
  const harness = createHarness();
  const answer = harness.modals.confirm('Delete this memo?');
  harness.button('Cancel').click();
  assert.equal(await answer, false);
});

test('confirm resolves false when dismissed with Escape', async () => {
  const harness = createHarness();
  const answer = harness.modals.confirm('Delete this memo?');
  harness.pressEscape();
  assert.equal(await answer, false);
});

test('confirm can name the action on its button', async () => {
  const harness = createHarness();
  const answer = harness.modals.confirm('Delete this memo?', 'Delete');
  harness.button('Delete').click();
  assert.equal(await answer, true);
});

test('the safe choice comes first, so it receives the initial focus', () => {
  // The browser focuses the first focusable element of a modal dialog; Enter must not delete.
  const harness = createHarness();
  void harness.modals.confirm('Delete this memo?', 'Delete');
  const labels = [...harness.topDialog().querySelectorAll('button')].map((button) => button.textContent);
  assert.deepEqual(labels, ['Cancel', 'Delete']);
});

test('a closed dialog is removed from the page', async () => {
  const harness = createHarness();
  const answer = harness.modals.confirm('Sure?');
  harness.button('OK').click();
  await answer;
  assert.equal(harness.document.querySelectorAll('dialog').length, 0);
});

test('a click on the backdrop cancels, a click inside the dialog does not', async () => {
  const harness = createHarness();
  const answer = harness.modals.confirm('Sure?');
  const dialog = harness.topDialog();
  // A click on the message bubbles up to the dialog but did not hit the backdrop.
  dialog.querySelector('p')?.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  assert.equal(harness.openDialogCount(), 1);
  // The backdrop belongs to the dialog element itself.
  dialog.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  assert.equal(await answer, false);
});

// --- prompt -----------------------------------------------------------------

function promptInput(harness: Harness): HTMLInputElement {
  const input = harness.topDialog().querySelector('input');
  assert.ok(input, 'expected a text input');
  return input;
}

function submit(harness: Harness): void {
  const form = harness.topDialog().querySelector('form');
  assert.ok(form, 'expected a form');
  form.dispatchEvent(new harness.window.Event('submit', { bubbles: true, cancelable: true }));
}

const acceptAnything = { initialValue: '', validate: () => undefined };

test('prompt starts with the initial value and resolves what was entered', async () => {
  const harness = createHarness();
  const answer = harness.modals.prompt('Memo title', { initialValue: 'old title', validate: () => undefined });
  const input = promptInput(harness);
  assert.equal(input.value, 'old title');
  input.value = 'new title';
  submit(harness);
  assert.equal(await answer, 'new title');
});

test('prompt resolves undefined when cancelled or dismissed', async () => {
  const harness = createHarness();
  const cancelled = harness.modals.prompt('Memo title', acceptAnything);
  harness.button('Cancel').click();
  assert.equal(await cancelled, undefined);

  const dismissed = harness.modals.prompt('Memo title', acceptAnything);
  harness.pressEscape();
  assert.equal(await dismissed, undefined);
});

test('prompt keeps asking while the value is not acceptable and says why', async () => {
  const harness = createHarness();
  const answer = harness.modals.prompt('Memo title', {
    initialValue: '',
    validate: (value) => (value.trim() === '' ? 'Enter a title.' : undefined),
  });
  submit(harness);
  await nextTick();
  assert.equal(harness.openDialogCount(), 1);
  assert.equal(harness.topDialog().querySelector('[role="alert"]')?.textContent, 'Enter a title.');

  promptInput(harness).value = 'a title';
  submit(harness);
  assert.equal(await answer, 'a title');
});

test('an empty string is a valid answer and differs from cancelling', async () => {
  const harness = createHarness();
  const answer = harness.modals.prompt('Optional note', acceptAnything);
  submit(harness);
  assert.equal(await answer, '');
});

// --- open (custom content) --------------------------------------------------

test('open shows custom content and resolves the value it closes with', async () => {
  const harness = createHarness();
  const answer = harness.modals.open<string>((close) => {
    const content = harness.document.createElement('button');
    content.textContent = 'Pick me';
    content.addEventListener('click', () => close('picked'));
    return { title: 'Memos', content };
  });
  assert.equal(harness.topDialog().textContent?.includes('Memos'), true);
  harness.button('Pick me').click();
  assert.equal(await answer, 'picked');
});

test('open resolves undefined when dismissed', async () => {
  const harness = createHarness();
  const answer = harness.modals.open<string>(() => ({ title: 'Memos', content: harness.document.createElement('div') }));
  harness.pressEscape();
  assert.equal(await answer, undefined);
});

test('with two dialogs open, only the one on top is answered', async () => {
  const harness = createHarness();
  let listAnswered = false;
  const list = harness.modals.open<string>(() => ({ title: 'Memos', content: harness.document.createElement('div') }));
  void list.then(() => {
    listAnswered = true;
  });
  const confirmation = harness.modals.confirm('Delete?', 'Delete');
  assert.equal(harness.openDialogCount(), 2);

  harness.button('Delete').click();
  assert.equal(await confirmation, true);
  await nextTick();
  assert.equal(listAnswered, false);
  assert.equal(harness.openDialogCount(), 1);

  harness.pressEscape();
  assert.equal(await list, undefined);
});

// --- choose -----------------------------------------------------------------

const languages = [
  { label: 'Automatic', value: 'auto' },
  { label: '한국어', value: 'ko' },
  { label: 'English', value: 'en' },
];

test('choose offers every choice and resolves the one that is picked', async () => {
  const harness = createHarness();
  const answer = harness.modals.choose('Language', languages, 'auto');
  const labels = [...harness.topDialog().querySelectorAll('.choice')].map((button) => button.textContent);
  assert.deepEqual(labels, ['Automatic', '한국어', 'English']);
  harness.button('한국어').click();
  assert.equal(await answer, 'ko');
});

test('choose marks the current choice', () => {
  const harness = createHarness();
  void harness.modals.choose('Language', languages, 'en');
  const pressed = [...harness.topDialog().querySelectorAll('.choice')].map((button) => button.getAttribute('aria-pressed'));
  assert.deepEqual(pressed, ['false', 'false', 'true']);
});

test('choose resolves undefined when dismissed, which is not the same as picking the current choice', async () => {
  const harness = createHarness();
  const dismissed = harness.modals.choose('Language', languages, 'auto');
  harness.pressEscape();
  assert.equal(await dismissed, undefined);

  const repicked = harness.modals.choose('Language', languages, 'auto');
  harness.button('Automatic').click();
  assert.equal(await repicked, 'auto');
});
