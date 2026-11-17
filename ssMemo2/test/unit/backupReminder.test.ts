import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKUP_REMINDER_INTERVAL_DAYS,
  BACKUP_REMINDER_KEY,
  createBackupReminder,
  parseBackupReminderState,
} from '../../src/app/backupReminder.ts';
import type { BackupReminder } from '../../src/app/backupReminder.ts';
import { createMemoryStorage } from '../../src/storage/memoryStorage.ts';
import { StorageError } from '../../src/storage/storagePort.ts';
import type { StoragePort } from '../../src/storage/storagePort.ts';

const START = Date.parse('2026-03-01T00:00:00.000Z');
const ONE_DAY = 24 * 60 * 60 * 1000;
const INTERVAL = BACKUP_REMINDER_INTERVAL_DAYS * ONE_DAY;

interface Harness {
  storage: StoragePort;
  reminder: BackupReminder;
  /** Moves the clock forward. */
  wait(ms: number): void;
}

function createHarness(storage: StoragePort = createMemoryStorage()): Harness {
  let time = START;
  return {
    storage,
    reminder: createBackupReminder({ storage, now: () => new Date(time) }),
    wait: (ms) => {
      time += ms;
    },
  };
}

test('the interval is long enough not to nag', () => {
  assert.ok(BACKUP_REMINDER_INTERVAL_DAYS >= 14);
});

test('a first visit is no occasion for a reminder', async () => {
  const { reminder } = createHarness();
  assert.equal(await reminder.check(3), undefined);
});

test('someone who never made a backup is reminded once the interval has passed', async () => {
  const { reminder, wait } = createHarness();
  await reminder.check(3);
  wait(INTERVAL - 1);
  assert.equal(await reminder.check(3), undefined);
  wait(1);
  assert.deepEqual(await reminder.check(3), { kind: 'backup-never' });
});

test('after a reminder there is quiet for another interval', async () => {
  const { reminder, wait } = createHarness();
  await reminder.check(3);
  wait(INTERVAL);
  assert.ok(await reminder.check(3));
  // Reloading the page a moment later, or the next day, must not repeat it.
  assert.equal(await reminder.check(3), undefined);
  wait(ONE_DAY);
  assert.equal(await reminder.check(3), undefined);
  wait(INTERVAL - ONE_DAY);
  assert.deepEqual(await reminder.check(3), { kind: 'backup-never' });
});

test('a backup starts the interval anew, and the next reminder says how old the backup is', async () => {
  const { reminder, wait } = createHarness();
  await reminder.check(3);
  wait(INTERVAL - ONE_DAY);
  await reminder.noteBackup();
  wait(ONE_DAY);
  assert.equal(await reminder.check(3), undefined);
  wait(INTERVAL - ONE_DAY);
  assert.deepEqual(await reminder.check(3), { kind: 'backup-old', days: BACKUP_REMINDER_INTERVAL_DAYS });
  // A second reminder counts on from the backup, not from the first reminder.
  wait(INTERVAL + ONE_DAY / 2);
  assert.deepEqual(await reminder.check(3), { kind: 'backup-old', days: 2 * BACKUP_REMINDER_INTERVAL_DAYS });
});

test('a backup made before the app was ever checked counts as well', async () => {
  const { reminder, wait } = createHarness();
  await reminder.noteBackup();
  wait(INTERVAL - 1);
  assert.equal(await reminder.check(1), undefined);
  wait(1);
  assert.deepEqual(await reminder.check(1), { kind: 'backup-old', days: BACKUP_REMINDER_INTERVAL_DAYS });
});

test('without memos there is nothing to back up, and the interval only starts once there is one', async () => {
  const { reminder, wait } = createHarness();
  await reminder.check(0);
  wait(2 * INTERVAL);
  assert.equal(await reminder.check(0), undefined);
  // The first memo was written just now: a reminder would be about nothing.
  wait(ONE_DAY);
  assert.equal(await reminder.check(1), undefined);
  wait(INTERVAL);
  assert.deepEqual(await reminder.check(1), { kind: 'backup-never' });
});

test('a clock that was set back does not cause a reminder', async () => {
  const { reminder, wait } = createHarness();
  await reminder.check(3);
  wait(-10 * INTERVAL);
  assert.equal(await reminder.check(3), undefined);
});

test('the state survives a new start of the app', async () => {
  const first = createHarness();
  await first.reminder.check(3);
  const second = createHarness(first.storage);
  second.wait(INTERVAL);
  assert.deepEqual(await second.reminder.check(3), { kind: 'backup-never' });
});

test('parseBackupReminderState accepts what the reminder stores and nothing else', async () => {
  const { reminder, storage } = createHarness();
  await reminder.noteBackup();
  const iso = new Date(START).toISOString();
  assert.deepEqual(parseBackupReminderState(await storage.getValue(BACKUP_REMINDER_KEY)), { lastBackupAt: iso, countingSince: iso });
  assert.deepEqual(parseBackupReminderState({ countingSince: iso }), { lastBackupAt: undefined, countingSince: iso });
  for (const value of [undefined, null, 'text', 5, [], {}, { countingSince: 'not a date' }, { countingSince: 7 }]) {
    assert.equal(parseBackupReminderState(value), undefined, JSON.stringify(value));
  }
  // A damaged date of the last backup does not make the rest useless.
  assert.deepEqual(parseBackupReminderState({ countingSince: iso, lastBackupAt: 'not a date' }), { lastBackupAt: undefined, countingSince: iso });
});

test('damaged stored state is treated like a first visit', async () => {
  const { reminder, storage, wait } = createHarness();
  await storage.setValue(BACKUP_REMINDER_KEY, { countingSince: 'garbage' });
  assert.equal(await reminder.check(3), undefined);
  wait(INTERVAL);
  assert.deepEqual(await reminder.check(3), { kind: 'backup-never' });
});

test('a storage that fails never makes the reminder fail', async () => {
  const broken: StoragePort = {
    ...createMemoryStorage(),
    getValue: async () => {
      throw new StorageError('connection-lost', 'closed');
    },
    setValue: async () => {
      throw new StorageError('connection-lost', 'closed');
    },
  };
  const { reminder } = createHarness(broken);
  assert.equal(await reminder.check(3), undefined);
  await reminder.noteBackup();
});

test('a reminder is given even if it cannot be recorded that it was given', async () => {
  const storage = createMemoryStorage();
  let failWriting = false;
  const { reminder, wait } = createHarness({
    ...storage,
    setValue: async (key, value) => {
      if (failWriting) throw new StorageError('quota', 'full');
      return storage.setValue(key, value);
    },
  });
  await reminder.check(3);
  wait(INTERVAL);
  failWriting = true;
  assert.deepEqual(await reminder.check(3), { kind: 'backup-never' });
});
