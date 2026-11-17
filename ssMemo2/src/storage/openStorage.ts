// Chooses the storage for this page load: IndexedDB when it works, memory when it does not.
//
// The choice is made once, at startup. ssMemoWeb switched to an empty in-memory store in the
// middle of a session on the first error, which made every memo appear to vanish; here a failure
// after startup is reported to the user instead and the storage stays what it was.
import { openIndexedDbStorage } from './indexedDbStorage.ts';
import { createMemoryStorage } from './memoryStorage.ts';
import { StorageError } from './storagePort.ts';
import type { StoragePort } from './storagePort.ts';

export type StorageMode =
  /** Saved documents survive a reload. */
  | 'persistent'
  /** Everything is kept in memory only and is gone when the page closes. */
  | 'temporary';

export type TemporaryReason =
  /** The user asked for it with ?safe in the address. */
  | 'safe-mode'
  /** IndexedDB could not be opened. */
  | 'unavailable';

export interface OpenedStorage {
  storage: StoragePort;
  mode: StorageMode;
  /** Why the mode is temporary; undefined when it is persistent. */
  reason?: TemporaryReason;
  /** What went wrong when IndexedDB was unavailable, for the console. */
  error?: unknown;
}

export interface OpenStorageOptions {
  /**
   * Returns window.indexedDB, or undefined if the browser has none. It is a function because
   * merely reading that property throws when storage is blocked for the page.
   */
  getIndexedDb: () => IDBFactory | undefined;
  /** Skip IndexedDB entirely; see isSafeModeRequested. */
  safeMode: boolean;
  timeoutMs?: number;
  onConnectionLost?: () => void;
}

const SAFE_MODE_PARAMETER = 'safe';
const SAFE_MODE_OFF_VALUES: readonly string[] = ['0', 'false', 'off', 'no'];

/**
 * Whether the page address asks for temporary mode: "?safe" (any value except 0/false/off/no).
 * It is the user's way out when the stored data makes the app misbehave, and the practical way
 * to see how the app looks without storage.
 *
 * @param search the query part of the address, e.g. window.location.search
 */
export function isSafeModeRequested(search: string): boolean {
  const value = new URLSearchParams(search).get(SAFE_MODE_PARAMETER);
  return value !== null && !SAFE_MODE_OFF_VALUES.includes(value.toLowerCase());
}

/** Never rejects: when IndexedDB cannot be used, the result is a working temporary storage. */
export async function openStorage(options: OpenStorageOptions): Promise<OpenedStorage> {
  if (options.safeMode) {
    return { storage: createMemoryStorage(), mode: 'temporary', reason: 'safe-mode' };
  }
  try {
    const factory = options.getIndexedDb();
    if (!factory) {
      throw new StorageError('unavailable', 'This browser has no IndexedDB');
    }
    const storage = await openIndexedDbStorage(factory, {
      timeoutMs: options.timeoutMs,
      onConnectionLost: options.onConnectionLost,
    });
    return { storage, mode: 'persistent' };
  } catch (error) {
    return { storage: createMemoryStorage(), mode: 'temporary', reason: 'unavailable', error };
  }
}
