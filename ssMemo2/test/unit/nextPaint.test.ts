import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextPaint } from '../../src/ui/nextPaint.ts';

type FrameCallback = () => void;

/** A window whose animation frames and timers run only when the test says so. */
function createFakeWindow(): { win: Window; runFrame(): void; runTimers(maxDelayMs: number): void } {
  const frames: FrameCallback[] = [];
  const timers: { delayMs: number; callback: FrameCallback }[] = [];
  const win = {
    requestAnimationFrame: (callback: FrameCallback) => frames.push(callback),
    setTimeout: (callback: FrameCallback, delayMs = 0) => timers.push({ delayMs, callback }),
  } as unknown as Window;
  return {
    win,
    runFrame: () => frames.splice(0).forEach((callback) => callback()),
    runTimers(maxDelayMs) {
      const due = timers.filter((timer) => timer.delayMs <= maxDelayMs);
      for (const timer of due) timers.splice(timers.indexOf(timer), 1);
      due.forEach((timer) => timer.callback());
    },
  };
}

async function isSettled(promise: Promise<void>): Promise<boolean> {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  return settled;
}

test('nextPaint resolves only after a frame was drawn', async () => {
  const fake = createFakeWindow();
  const painted = nextPaint(fake.win);
  assert.equal(await isSettled(painted), false);
  // The frame callback runs just before drawing; the task queued from it runs after.
  fake.runFrame();
  assert.equal(await isSettled(painted), false);
  fake.runTimers(0);
  assert.equal(await isSettled(painted), true);
});

test('nextPaint does not wait forever when no frames are drawn', async () => {
  // A page in a background tab gets no animation frames at all.
  const fake = createFakeWindow();
  const painted = nextPaint(fake.win);
  fake.runTimers(1000);
  assert.equal(await isSettled(painted), true);
});
