import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutosave } from '../../src/app/autosave.ts';
import type { Autosave, AutosaveState } from '../../src/app/autosave.ts';

const IDLE_DELAY_MS = 1000;
const MAX_WAIT_MS = 5000;

interface PendingSave {
  succeed(): void;
  fail(error: unknown): void;
}

interface Harness {
  autosave: Autosave;
  /** Saves that were started and not yet settled, oldest first. */
  pendingSaves: PendingSave[];
  saveCount(): number;
  /** Highest number of saves that were ever running at the same time. */
  maxConcurrentSaves(): number;
  states: AutosaveState[];
  errors: unknown[];
  /** Moves the fake clock forward, running the timers that become due, in order. */
  advance(ms: number): void;
  /** Lets promise callbacks run. */
  settle(): Promise<void>;
}

function createHarness(): Harness {
  let nowMs = 0;
  let nextHandle = 1;
  const scheduled = new Map<number, { at: number; callback: () => void }>();
  const pendingSaves: PendingSave[] = [];
  const states: AutosaveState[] = [];
  const errors: unknown[] = [];
  let started = 0;
  let running = 0;
  let maxRunning = 0;

  const autosave = createAutosave({
    save: () =>
      new Promise<void>((resolve, reject) => {
        started += 1;
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        pendingSaves.push({
          succeed: () => {
            running -= 1;
            resolve();
          },
          fail: (error) => {
            running -= 1;
            reject(error);
          },
        });
      }),
    idleDelayMs: IDLE_DELAY_MS,
    maxWaitMs: MAX_WAIT_MS,
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
    onError: (error) => errors.push(error),
    onStateChange: (state) => states.push(state),
  });

  return {
    autosave,
    pendingSaves,
    saveCount: () => started,
    maxConcurrentSaves: () => maxRunning,
    states,
    errors,
    advance(ms) {
      const target = nowMs + ms;
      for (;;) {
        const due = [...scheduled.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort(([, left], [, right]) => left.at - right.at)[0];
        if (!due) break;
        const [handle, timer] = due;
        scheduled.delete(handle);
        nowMs = timer.at;
        timer.callback();
      }
      nowMs = target;
    },
    settle: () => new Promise((resolve) => setImmediate(resolve)),
  };
}

/** Finishes the oldest running save and lets the scheduler react. */
async function finishSave(harness: Harness, outcome: 'ok' | Error = 'ok'): Promise<void> {
  const save = harness.pendingSaves.shift();
  assert.ok(save, 'expected a save to be running');
  if (outcome === 'ok') save.succeed();
  else save.fail(outcome);
  await harness.settle();
}

test('nothing is saved while nothing changed', async () => {
  const harness = createHarness();
  harness.advance(MAX_WAIT_MS * 10);
  await harness.autosave.flush();
  assert.equal(harness.saveCount(), 0);
  assert.equal(harness.autosave.hasUnsavedChanges(), false);
  assert.deepEqual(harness.states, []);
});

test('a change is saved once, after the idle delay', async () => {
  const harness = createHarness();
  harness.autosave.notifyChange();
  assert.equal(harness.autosave.hasUnsavedChanges(), true);

  harness.advance(IDLE_DELAY_MS - 1);
  assert.equal(harness.saveCount(), 0);
  harness.advance(1);
  assert.equal(harness.saveCount(), 1);

  await finishSave(harness);
  assert.equal(harness.autosave.hasUnsavedChanges(), false);
  assert.deepEqual(harness.states, ['pending', 'saving', 'saved']);

  harness.advance(MAX_WAIT_MS * 10);
  assert.equal(harness.saveCount(), 1);
});

test('changes in quick succession are written by a single save after the last one', () => {
  const harness = createHarness();
  for (let i = 0; i < 3; i++) {
    harness.autosave.notifyChange();
    harness.advance(IDLE_DELAY_MS - 1);
  }
  assert.equal(harness.saveCount(), 0);
  harness.advance(1);
  assert.equal(harness.saveCount(), 1);
});

test('continuous typing is still saved once the maximum wait is reached', () => {
  const harness = createHarness();
  const typingIntervalMs = IDLE_DELAY_MS / 2;
  for (let elapsed = 0; elapsed < MAX_WAIT_MS; elapsed += typingIntervalMs) {
    harness.autosave.notifyChange();
    assert.equal(harness.saveCount(), 0, `saved too early at ${elapsed} ms`);
    harness.advance(typingIntervalMs);
  }
  assert.equal(harness.saveCount(), 1);
});

test('a change made while a save is running is saved afterwards, never concurrently', async () => {
  const harness = createHarness();
  harness.autosave.notifyChange();
  harness.advance(IDLE_DELAY_MS);
  assert.equal(harness.saveCount(), 1);

  // Still typing while the first save is being written.
  harness.autosave.notifyChange();
  harness.advance(MAX_WAIT_MS * 2);
  assert.equal(harness.saveCount(), 1);

  await finishSave(harness);
  assert.equal(harness.autosave.hasUnsavedChanges(), true);
  harness.advance(IDLE_DELAY_MS);
  assert.equal(harness.saveCount(), 2);
  await finishSave(harness);

  assert.equal(harness.autosave.hasUnsavedChanges(), false);
  assert.equal(harness.maxConcurrentSaves(), 1);
  assert.deepEqual(harness.states, ['pending', 'saving', 'pending', 'saving', 'saved']);
});

test('flush starts the save before it returns', async () => {
  // On pagehide there is no later moment: the write has to begin within the event handler.
  const harness = createHarness();
  harness.autosave.notifyChange();
  const flushed = harness.autosave.flush();
  assert.equal(harness.saveCount(), 1);

  await finishSave(harness);
  await flushed;
  assert.equal(harness.autosave.hasUnsavedChanges(), false);

  // The timers of the change that was flushed must not cause a second save.
  harness.advance(MAX_WAIT_MS * 10);
  assert.equal(harness.saveCount(), 1);
});

test('flush during a running save waits for it and then saves the newer change', async () => {
  const harness = createHarness();
  harness.autosave.notifyChange();
  harness.advance(IDLE_DELAY_MS);
  harness.autosave.notifyChange();

  let flushFinished = false;
  const flushed = harness.autosave.flush().then(() => {
    flushFinished = true;
  });
  assert.equal(harness.saveCount(), 1);

  await finishSave(harness);
  assert.equal(harness.saveCount(), 2);
  assert.equal(flushFinished, false);

  await finishSave(harness);
  await flushed;
  assert.equal(harness.autosave.hasUnsavedChanges(), false);
  assert.equal(harness.maxConcurrentSaves(), 1);
});

test('a failed save keeps the changes pending, reports once and does not retry by itself', async () => {
  const harness = createHarness();
  const failure = new Error('disk full');
  harness.autosave.notifyChange();
  harness.advance(IDLE_DELAY_MS);
  await finishSave(harness, failure);

  assert.deepEqual(harness.errors, [failure]);
  assert.equal(harness.autosave.hasUnsavedChanges(), true);
  assert.deepEqual(harness.states, ['pending', 'saving', 'failed']);

  // No retry storm: a storage that is full will not get better by hammering it.
  harness.advance(MAX_WAIT_MS * 10);
  assert.equal(harness.saveCount(), 1);
});

test('the next change after a failure is saved again', async () => {
  const harness = createHarness();
  harness.autosave.notifyChange();
  harness.advance(IDLE_DELAY_MS);
  await finishSave(harness, new Error('temporary problem'));

  harness.autosave.notifyChange();
  harness.advance(IDLE_DELAY_MS);
  assert.equal(harness.saveCount(), 2);
  await finishSave(harness);
  assert.equal(harness.autosave.hasUnsavedChanges(), false);
  assert.deepEqual(harness.states, ['pending', 'saving', 'failed', 'pending', 'saving', 'saved']);
});

test('flush after a failure tries once more and resolves even if that fails too', async () => {
  const harness = createHarness();
  harness.autosave.notifyChange();
  harness.advance(IDLE_DELAY_MS);
  await finishSave(harness, new Error('first failure'));

  const flushed = harness.autosave.flush();
  assert.equal(harness.saveCount(), 2);
  await finishSave(harness, new Error('second failure'));
  await flushed;

  assert.equal(harness.saveCount(), 2);
  assert.equal(harness.errors.length, 2);
  assert.equal(harness.autosave.hasUnsavedChanges(), true);
});

test('a save function that throws instead of rejecting is handled like a failed save', async () => {
  const errors: unknown[] = [];
  const failure = new Error('thrown synchronously');
  const autosave = createAutosave({
    save: () => {
      throw failure;
    },
    idleDelayMs: IDLE_DELAY_MS,
    maxWaitMs: MAX_WAIT_MS,
    timers: { setTimeout: () => 0, clearTimeout: () => undefined },
    onError: (error) => errors.push(error),
    onStateChange: () => undefined,
  });
  autosave.notifyChange();
  await autosave.flush();
  assert.deepEqual(errors, [failure]);
  assert.equal(autosave.hasUnsavedChanges(), true);
});
