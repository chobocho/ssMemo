// Reading what ssMemoWeb, the predecessor of this app, stored. That is possible only on the same
// origin (scheme, host and port), where the browser keeps the old database next to the new one.
//
// The old database is only ever read: nothing is written to it, it is not upgraded, and it is not
// created where it does not exist.

export const LEGACY_DATABASE_NAME = 'ssMemo';
export const LEGACY_STORE_NAME = 'notes';

const DEFAULT_OPEN_TIMEOUT_MS = 5000;

/**
 * Every record ssMemoWeb stored on this origin, as it is. Resolves with undefined if the old app
 * left no database here. Rejects if there is one that cannot be read.
 */
export function readLegacyRecords(factory: IDBFactory, timeoutMs = DEFAULT_OPEN_TIMEOUT_MS): Promise<unknown[] | undefined> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish();
    };
    const timer = setTimeout(
      () => settle(() => reject(new Error(`The database of ssMemoWeb did not open within ${timeoutMs} ms`))),
      timeoutMs,
    );

    let request: IDBOpenDBRequest;
    try {
      // No version is given, so an existing database is opened as it is, never upgraded.
      request = factory.open(LEGACY_DATABASE_NAME);
    } catch (error) {
      settle(() => reject(error));
      return;
    }

    // Opening a database that does not exist creates it, and this event is where that shows:
    // the "upgrade" starts from version 0. Aborting it leaves no database behind.
    let absent = false;
    request.onupgradeneeded = (event) => {
      if (event.oldVersion !== 0) return;
      absent = true;
      request.transaction?.abort();
    };
    request.onerror = (event) => {
      // The abort above ends here as well; that is the expected way out, not a failure.
      event.preventDefault();
      settle(() => (absent ? resolve(undefined) : reject(request.error)));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        // Too late: the caller was already told that the database did not open.
        database.close();
        return;
      }
      // Closed in every case, so the old app (or the browser) can still remove its database.
      const finish = (result: () => void): void => {
        database.close();
        settle(result);
      };
      if (!database.objectStoreNames.contains(LEGACY_STORE_NAME)) {
        finish(() => resolve(undefined));
        return;
      }
      try {
        const transaction = database.transaction(LEGACY_STORE_NAME, 'readonly');
        const records = transaction.objectStore(LEGACY_STORE_NAME).getAll();
        transaction.oncomplete = () => finish(() => resolve(records.result));
        transaction.onabort = () => finish(() => reject(transaction.error));
      } catch (error) {
        finish(() => reject(error));
      }
    };
  });
}
