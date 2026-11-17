// A reminder to make a backup now and then. The memos live in one browser on one device; a
// backup file is the only copy anywhere else, and nobody thinks of making one unprompted.
//
// The rule is deliberately quiet: one reminder when a whole interval has passed without a backup
// (or, after a reminder, without another one), and none while there is nothing to back up.
import type { StoragePort } from '../storage/storagePort.ts';

export const BACKUP_REMINDER_KEY = 'backupReminder';
export const BACKUP_REMINDER_INTERVAL_DAYS = 30;

const MS_PER_DAY = 86_400_000;

export interface BackupReminderState {
  /** ISO 8601 time of the last backup exported from this browser; undefined if there was none. */
  lastBackupAt: string | undefined;
  /** From when the interval counts: the last backup, the last reminder, or the first memo. */
  countingSince: string;
}

/** What to tell the user. The UI turns it into a translated message. */
export type BackupReminderNotice =
  | { kind: 'backup-never' }
  /** `days` is the age of the last backup in whole days. */
  | { kind: 'backup-old'; days: number };

export interface BackupReminderOptions {
  storage: StoragePort;
  now(): Date;
}

export interface BackupReminder {
  /**
   * To be called once when the app has started, with the number of stored memos. Resolves with
   * the reminder that is due, or with undefined. Never rejects.
   */
  check(memoCount: number): Promise<BackupReminderNotice | undefined>;
  /** To be called when a backup was exported. Never rejects. */
  noteBackup(): Promise<void>;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/** The stored state, or undefined if there is none that can be used. */
export function parseBackupReminderState(value: unknown): BackupReminderState | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { lastBackupAt, countingSince } = value as Record<string, unknown>;
  if (!isTimestamp(countingSince)) return undefined;
  return { lastBackupAt: isTimestamp(lastBackupAt) ? lastBackupAt : undefined, countingSince };
}

export function createBackupReminder(options: BackupReminderOptions): BackupReminder {
  const { storage, now } = options;

  // A reminder is a courtesy: when its own bookkeeping fails, the app carries on without it.
  const save = (state: BackupReminderState): Promise<void> => storage.setValue(BACKUP_REMINDER_KEY, state).catch(() => undefined);

  return {
    async check(memoCount) {
      let state: BackupReminderState | undefined;
      try {
        state = parseBackupReminderState(await storage.getValue(BACKUP_REMINDER_KEY));
      } catch {
        return undefined;
      }
      const moment = now();
      const restartCounting = (): Promise<void> => save({ lastBackupAt: state?.lastBackupAt, countingSince: moment.toISOString() });

      // A first visit, and likewise a time without memos: there is nothing to be reminded of
      // yet, so the interval starts only now.
      if (!state || memoCount === 0) {
        await restartCounting();
        return undefined;
      }
      // Negative if the clock was set back, which is no reason for a reminder either.
      if (moment.getTime() - Date.parse(state.countingSince) < BACKUP_REMINDER_INTERVAL_DAYS * MS_PER_DAY) return undefined;

      await restartCounting();
      if (state.lastBackupAt === undefined) return { kind: 'backup-never' };
      return { kind: 'backup-old', days: Math.floor((moment.getTime() - Date.parse(state.lastBackupAt)) / MS_PER_DAY) };
    },

    noteBackup() {
      const moment = now().toISOString();
      return save({ lastBackupAt: moment, countingSince: moment });
    },
  };
}
