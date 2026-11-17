import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPreview } from '../../src/app/preview.ts';
import type { Preview } from '../../src/app/preview.ts';

const DELAY_MS = 300;
const MAX_LENGTH = 20;

interface Harness {
  preview: Preview;
  /** What the editor currently shows; replacing the object stands for "the content changed". */
  content: { key: unknown; text: string | undefined };
  /** Everything that was put on screen, in order. */
  shown: string[];
  renderCount(): number;
  /** The user typed: new text, and the preview is told that something may have changed. */
  edit(text: string): void;
  advance(ms: number): void;
  pendingTimers(): number;
}

function createHarness(): Harness {
  let nowMs = 0;
  let nextHandle = 1;
  let renders = 0;
  const scheduled = new Map<number, { at: number; callback: () => void }>();
  const content: Harness['content'] = { key: {}, text: '# title' };
  const shown: string[] = [];
  const preview = createPreview({
    getContentKey: () => content.key,
    getText: () => content.text,
    render: (text) => {
      renders += 1;
      return `<rendered>${text}</rendered>`;
    },
    show: (html) => shown.push(html),
    tooLongHtml: (maxLength) => `<too-long max="${maxLength}">`,
    maxLength: MAX_LENGTH,
    delayMs: DELAY_MS,
    timers: {
      setTimeout: (callback, delayMs) => {
        const handle = nextHandle++;
        scheduled.set(handle, { at: nowMs + delayMs, callback });
        return handle;
      },
      clearTimeout: (handle) => {
        scheduled.delete(handle as number);
      },
    },
  });
  return {
    preview,
    content,
    shown,
    renderCount: () => renders,
    edit(text) {
      content.key = {};
      content.text = text;
      preview.contentMayHaveChanged();
    },
    advance(ms) {
      nowMs += ms;
      for (const [handle, timer] of [...scheduled.entries()]) {
        if (timer.at <= nowMs) {
          scheduled.delete(handle);
          timer.callback();
        }
      }
    },
    pendingTimers: () => scheduled.size,
  };
}

test('nothing is rendered while the preview is off', () => {
  const harness = createHarness();
  harness.edit('# changed');
  harness.advance(DELAY_MS * 10);
  assert.equal(harness.preview.isEnabled(), false);
  assert.equal(harness.renderCount(), 0);
  assert.deepEqual(harness.shown, []);
  assert.equal(harness.pendingTimers(), 0);
});

test('switching the preview on shows the current text at once', () => {
  const harness = createHarness();
  harness.preview.setEnabled(true);
  assert.equal(harness.preview.isEnabled(), true);
  assert.deepEqual(harness.shown, ['<rendered># title</rendered>']);
});

test('an edit is rendered after a pause, and a burst of edits only once', () => {
  const harness = createHarness();
  harness.preview.setEnabled(true);
  harness.edit('a');
  harness.advance(DELAY_MS - 1);
  harness.edit('ab');
  harness.advance(DELAY_MS - 1);
  harness.edit('abc');
  assert.equal(harness.renderCount(), 1);
  harness.advance(DELAY_MS);
  assert.equal(harness.renderCount(), 2);
  assert.equal(harness.shown.at(-1), '<rendered>abc</rendered>');
});

test('moving the cursor renders nothing: the content is still the same', () => {
  // The editor reports cursor movements through the same callback as edits.
  const harness = createHarness();
  harness.preview.setEnabled(true);
  for (let i = 0; i < 5; i++) harness.preview.contentMayHaveChanged();
  harness.advance(DELAY_MS * 10);
  assert.equal(harness.renderCount(), 1);
  assert.equal(harness.pendingTimers(), 0);
});

test('another tab is another content and gets rendered', () => {
  const harness = createHarness();
  harness.preview.setEnabled(true);
  harness.content.key = {};
  harness.content.text = 'other tab';
  harness.preview.contentMayHaveChanged();
  harness.advance(DELAY_MS);
  assert.equal(harness.shown.at(-1), '<rendered>other tab</rendered>');
});

test('switching the preview off drops a pending render and empties the pane', () => {
  const harness = createHarness();
  harness.preview.setEnabled(true);
  harness.edit('changed');
  harness.preview.setEnabled(false);
  assert.equal(harness.pendingTimers(), 0);
  harness.advance(DELAY_MS * 10);
  assert.equal(harness.renderCount(), 1);
  // The rendered copy of a large memo is not kept around while nobody looks at it.
  assert.equal(harness.shown.at(-1), '');
});

test('switching it on again renders again, even if nothing changed meanwhile', () => {
  const harness = createHarness();
  harness.preview.setEnabled(true);
  harness.preview.setEnabled(false);
  harness.preview.setEnabled(true);
  assert.equal(harness.renderCount(), 2);
  assert.equal(harness.shown.at(-1), '<rendered># title</rendered>');
});

test('switching it on twice does not render twice', () => {
  const harness = createHarness();
  harness.preview.setEnabled(true);
  harness.preview.setEnabled(true);
  assert.equal(harness.renderCount(), 1);
});

test('a text over the limit is not rendered; a message is shown instead', () => {
  const harness = createHarness();
  harness.preview.setEnabled(true);
  harness.edit('x'.repeat(MAX_LENGTH + 1));
  harness.advance(DELAY_MS);
  assert.equal(harness.renderCount(), 1);
  assert.equal(harness.shown.at(-1), `<too-long max="${MAX_LENGTH}">`);
  // Exactly at the limit it is still rendered.
  harness.edit('x'.repeat(MAX_LENGTH));
  harness.advance(DELAY_MS);
  assert.equal(harness.renderCount(), 2);
});

test('with no document to show, the pane is empty', () => {
  const harness = createHarness();
  harness.content.text = undefined;
  harness.preview.setEnabled(true);
  assert.deepEqual(harness.shown, ['']);
  assert.equal(harness.renderCount(), 0);
});
