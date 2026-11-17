import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PickedFile } from '../../src/app/localFiles.ts';
import { installFileDrop } from '../../src/ui/fileDrop.ts';
import { createTestDom } from '../helpers/dom.ts';
import type { TestDom } from '../helpers/dom.ts';

const ACTIVE_CLASS = 'is-drop-target';

interface DragData {
  types: string[];
  files: File[];
  dropEffect: string;
}

interface Harness {
  dom: TestDom;
  target: HTMLElement;
  /** Stands in for the editor, which handles dragged text itself. */
  child: HTMLElement;
  dropped: PickedFile[][];
  /** Events of each type that reached the child's own listeners. */
  seenByChild: string[];
  /** Dispatches a drag event on the child and returns it together with its data. */
  drag(type: string, data: DragData, relatedTarget?: Element | null): { event: Event; data: DragData };
  filesData(...names: string[]): DragData;
  textData(): DragData;
}

function createHarness(): Harness {
  const dom = createTestDom();
  const target = dom.document.createElement('div');
  const child = dom.document.createElement('div');
  target.append(child);
  dom.document.body.append(target);

  const dropped: PickedFile[][] = [];
  const seenByChild: string[] = [];
  for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) {
    child.addEventListener(type, () => seenByChild.push(type));
  }
  installFileDrop(target, { activeClass: ACTIVE_CLASS, onDrop: (files) => dropped.push(files) });

  return {
    dom,
    target,
    child,
    dropped,
    seenByChild,
    drag(type, data, relatedTarget = null) {
      const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: data });
      Object.defineProperty(event, 'relatedTarget', { value: relatedTarget });
      child.dispatchEvent(event);
      return { event, data };
    },
    filesData: (...names) => ({
      types: ['Files'],
      files: names.map((name) => new dom.window.File(['content'], name)),
      dropEffect: 'none',
    }),
    textData: () => ({ types: ['text/plain'], files: [], dropEffect: 'none' }),
  };
}

test('dragging files over the target is accepted and highlighted', () => {
  const harness = createHarness();
  for (const type of ['dragenter', 'dragover']) {
    const { event, data } = harness.drag(type, harness.filesData('a.txt'));
    assert.equal(event.defaultPrevented, true, type);
    assert.equal(data.dropEffect, 'copy', type);
    assert.equal(harness.target.classList.contains(ACTIVE_CLASS), true, type);
  }
});

test('dropping files hands them over and removes the highlight', async () => {
  const harness = createHarness();
  harness.drag('dragover', harness.filesData('a.txt', 'b.txt'));
  const { event } = harness.drag('drop', harness.filesData('a.txt', 'b.txt'));
  // Without this the browser would navigate away to the dropped file.
  assert.equal(event.defaultPrevented, true);
  assert.equal(harness.target.classList.contains(ACTIVE_CLASS), false);
  assert.equal(harness.dropped.length, 1);
  assert.deepEqual(harness.dropped[0]?.map((file) => file.name), ['a.txt', 'b.txt']);
  assert.equal(new TextDecoder().decode(await harness.dropped[0]?.[0]?.read()), 'content');
});

test('a file drop does not reach the editor, which would insert the file as text', () => {
  const harness = createHarness();
  harness.drag('drop', harness.filesData('a.txt'));
  assert.equal(harness.seenByChild.includes('drop'), false);
});

test('dragged text is left to the editor', () => {
  const harness = createHarness();
  const over = harness.drag('dragover', harness.textData());
  const drop = harness.drag('drop', harness.textData());
  assert.equal(over.event.defaultPrevented, false);
  assert.equal(drop.event.defaultPrevented, false);
  assert.equal(harness.target.classList.contains(ACTIVE_CLASS), false);
  assert.deepEqual(harness.dropped, []);
  assert.deepEqual(harness.seenByChild, ['dragover', 'drop']);
});

test('a drag event without any data is ignored', () => {
  const harness = createHarness();
  const event = new harness.dom.window.Event('dragover', { bubbles: true, cancelable: true });
  harness.child.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
});

test('the highlight goes away when the drag leaves the target, but not when it moves inside it', () => {
  const harness = createHarness();
  harness.drag('dragover', harness.filesData('a.txt'));
  harness.drag('dragleave', harness.filesData('a.txt'), harness.child);
  assert.equal(harness.target.classList.contains(ACTIVE_CLASS), true);
  harness.drag('dragleave', harness.filesData('a.txt'), harness.dom.document.body);
  assert.equal(harness.target.classList.contains(ACTIVE_CLASS), false);

  harness.drag('dragover', harness.filesData('a.txt'));
  // Leaving the window: there is no element the pointer moved to.
  harness.drag('dragleave', harness.filesData('a.txt'), null);
  assert.equal(harness.target.classList.contains(ACTIVE_CLASS), false);
});

test('dropping an empty list of files hands over nothing', () => {
  const harness = createHarness();
  harness.drag('drop', harness.filesData());
  assert.deepEqual(harness.dropped, []);
});
