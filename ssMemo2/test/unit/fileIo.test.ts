import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickFiles, toPickedFiles } from '../../src/ui/fileIo.ts';
import { createTestDom, nextTick } from '../helpers/dom.ts';
import type { TestDom } from '../helpers/dom.ts';

const INPUT_SELECTOR = 'input[type="file"]';

function textFile(dom: TestDom, name: string, content: string): File {
  return new dom.window.File([content], name, { type: 'text/plain' });
}

/** Simulates the user choosing files in the browser's dialog. */
function choose(dom: TestDom, input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new dom.window.Event('change'));
}

function currentInput(dom: TestDom): HTMLInputElement {
  const input = dom.document.querySelector<HTMLInputElement>(INPUT_SELECTOR);
  assert.ok(input, 'no file input on the page');
  return input;
}

test('toPickedFiles describes each file and reads its bytes', async () => {
  const dom = createTestDom();
  const picked = toPickedFiles([textFile(dom, 'a.txt', 'hello'), textFile(dom, 'empty.txt', '')]);
  assert.deepEqual(picked.map((file) => [file.name, file.size]), [['a.txt', 5], ['empty.txt', 0]]);
  const bytes = await picked[0]?.read();
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(bytes), 'hello');
  assert.equal((await picked[1]?.read())?.length, 0);
});

test('pickFiles opens the file dialog through a hidden input', () => {
  const dom = createTestDom();
  let clicks = 0;
  dom.document.addEventListener('click', (event) => {
    if ((event.target as Element).matches(INPUT_SELECTOR)) clicks += 1;
  });
  void pickFiles(dom.document, { multiple: true, accept: '.json' });
  const input = currentInput(dom);
  assert.equal(clicks, 1);
  assert.equal(input.hidden, true);
  assert.equal(input.multiple, true);
  assert.equal(input.accept, '.json');
});

test('pickFiles asks for a single file of any type unless told otherwise', () => {
  const dom = createTestDom();
  void pickFiles(dom.document, { multiple: false });
  const input = currentInput(dom);
  assert.equal(input.multiple, false);
  assert.equal(input.accept, '');
});

test('pickFiles resolves the chosen files and removes its input', async () => {
  const dom = createTestDom();
  const picking = pickFiles(dom.document, { multiple: true });
  choose(dom, currentInput(dom), [textFile(dom, 'a.txt', 'one'), textFile(dom, 'b.txt', 'two')]);
  const picked = await picking;
  assert.deepEqual(picked.map((file) => file.name), ['a.txt', 'b.txt']);
  assert.equal(new TextDecoder().decode(await picked[1]?.read()), 'two');
  assert.equal(dom.document.querySelector(INPUT_SELECTOR), null);
});

test('pickFiles resolves an empty list when the dialog is cancelled', async () => {
  const dom = createTestDom();
  const picking = pickFiles(dom.document, { multiple: true });
  currentInput(dom).dispatchEvent(new dom.window.Event('cancel'));
  assert.deepEqual(await picking, []);
  assert.equal(dom.document.querySelector(INPUT_SELECTOR), null);
});

test('an input left behind by a dialog that never answered is replaced by the next one', async () => {
  // Older browsers send no "cancel" event, so a dismissed dialog leaves its input waiting.
  const dom = createTestDom();
  void pickFiles(dom.document, { multiple: true });
  const picking = pickFiles(dom.document, { multiple: false });
  assert.equal(dom.document.querySelectorAll(INPUT_SELECTOR).length, 1);
  choose(dom, currentInput(dom), [textFile(dom, 'c.txt', 'three')]);
  await nextTick();
  assert.deepEqual((await picking).map((file) => file.name), ['c.txt']);
});
