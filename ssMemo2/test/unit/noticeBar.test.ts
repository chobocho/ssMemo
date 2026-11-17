import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNoticeBar } from '../../src/ui/noticeBar.ts';
import type { NoticeBar } from '../../src/ui/noticeBar.ts';
import { createTestDom } from '../helpers/dom.ts';

interface Harness {
  bar: NoticeBar;
  texts(): string[];
  /** Runs the removals that were scheduled so far, as the timer would. */
  runScheduled(): void;
  scheduledCount(): number;
}

function createHarness(): Harness {
  const { document } = createTestDom();
  const scheduled: (() => void)[] = [];
  const bar = createNoticeBar(document, 'Close', (remove) => scheduled.push(remove));
  document.body.append(bar.element);
  return {
    bar,
    texts: () => [...bar.element.querySelectorAll('.notice-text')].map((node) => node.textContent ?? ''),
    runScheduled: () => scheduled.splice(0).forEach((remove) => remove()),
    scheduledCount: () => scheduled.length,
  };
}

test('a warning stays until the user closes it', () => {
  const harness = createHarness();
  harness.bar.show('Storage is full');
  assert.deepEqual(harness.texts(), ['Storage is full']);
  assert.equal(harness.scheduledCount(), 0);
  const dismiss = harness.bar.element.querySelector('button');
  assert.equal(dismiss?.getAttribute('aria-label'), 'Close');
  dismiss?.click();
  assert.deepEqual(harness.texts(), []);
});

test('a message that is already showing is not shown twice, but can be shown again after it was closed', () => {
  const harness = createHarness();
  harness.bar.show('Same');
  harness.bar.show('Same');
  harness.bar.show('Other');
  assert.deepEqual(harness.texts(), ['Same', 'Other']);
  harness.bar.element.querySelector('button')?.click();
  harness.bar.show('Same');
  assert.deepEqual(harness.texts(), ['Other', 'Same']);
});

test('an info message leaves by itself', () => {
  const harness = createHarness();
  harness.bar.show('Saved to notes.txt', 'info');
  assert.deepEqual(harness.texts(), ['Saved to notes.txt']);
  assert.ok(harness.bar.element.querySelector('.notice-info'));
  harness.runScheduled();
  assert.deepEqual(harness.texts(), []);
  // Once gone it can be shown again.
  harness.bar.show('Saved to notes.txt', 'info');
  assert.deepEqual(harness.texts(), ['Saved to notes.txt']);
});

test('an info message can also be closed by hand, and its timer then does no harm', () => {
  const harness = createHarness();
  harness.bar.show('Saved', 'info');
  harness.bar.element.querySelector('button')?.click();
  harness.bar.show('Saved', 'info');
  // The first timer fires while the second message is showing; it must not remove that one.
  const [firstTimer] = [harness.scheduledCount()];
  assert.equal(firstTimer, 2);
  harness.runScheduled();
  assert.deepEqual(harness.texts(), []);
});

test('warnings are not affected by the timers of info messages', () => {
  const harness = createHarness();
  harness.bar.show('Storage is full');
  harness.bar.show('Saved', 'info');
  harness.runScheduled();
  assert.deepEqual(harness.texts(), ['Storage is full']);
  assert.equal(harness.bar.element.querySelector('.notice-info'), null);
});

test('a warning interrupts a screen reader, a confirmation waits its turn', () => {
  const harness = createHarness();
  harness.bar.show('Storage is full');
  harness.bar.show('Saved', 'info');
  const roles = [...harness.bar.element.querySelectorAll('.notice')].map((notice) => notice.getAttribute('role'));
  assert.deepEqual(roles, ['alert', 'status']);
  // Not on the container: that would announce every confirmation as urgently as a warning.
  assert.equal(harness.bar.element.hasAttribute('role'), false);
});
