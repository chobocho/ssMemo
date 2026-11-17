// Whether the browser may throw the stored memos away, and how full the storage is.
//
// By default a site's storage is "best effort": when the device runs short of space the browser
// may delete all of it without asking. A site can ask for its storage to be made persistent;
// Chrome decides by itself (it grants it to sites that are used regularly, bookmarked or
// installed), Firefox asks the user. The request cannot be forced, so the outcome is only shown
// in the diagnostics, and regular backups remain the real protection.

/** The part of navigator.storage that is used. Every method may be missing in a browser. */
export interface StorageManagerPort {
  persisted?(): Promise<boolean>;
  persist?(): Promise<boolean>;
  estimate?(): Promise<{ usage?: number; quota?: number }>;
}

export type Durability =
  /** The browser will not delete the data on its own. */
  | 'persistent'
  /** The browser may delete the data when space runs short. */
  | 'best-effort'
  /** The browser does not say. */
  | 'unknown';

export interface StorageFacts {
  durability: Durability;
  /** Bytes this site uses; an estimate, as the browser reports it. */
  usageBytes: number | undefined;
  /** Bytes the browser lets this site use. */
  quotaBytes: number | undefined;
}

const BYTES_PER_UNIT = 1024;
const LARGER_UNITS: readonly string[] = ['KB', 'MB', 'GB'];

function toDurability(persisted: boolean): Durability {
  return persisted ? 'persistent' : 'best-effort';
}

async function readDurability(manager: StorageManagerPort): Promise<Durability> {
  try {
    return manager.persisted ? toDurability(await manager.persisted()) : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Never rejects: what cannot be found out comes back as unknown or undefined. */
export async function readStorageFacts(manager: StorageManagerPort | undefined): Promise<StorageFacts> {
  const facts: StorageFacts = { durability: 'unknown', usageBytes: undefined, quotaBytes: undefined };
  if (!manager) return facts;
  facts.durability = await readDurability(manager);
  try {
    const estimate = await manager.estimate?.();
    facts.usageBytes = estimate?.usage;
    facts.quotaBytes = estimate?.quota;
  } catch {
    // The usage is nice to know, nothing more.
  }
  return facts;
}

/**
 * Asks the browser to keep the stored data, unless it already does. Resolves the state after
 * the request and never rejects.
 */
export async function requestPersistence(manager: StorageManagerPort | undefined): Promise<Durability> {
  if (!manager) return 'unknown';
  const before = await readDurability(manager);
  if (before === 'persistent' || !manager.persist) return before;
  try {
    return toDurability(await manager.persist());
  } catch {
    return before;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < BYTES_PER_UNIT) return `${bytes} B`;
  let value = bytes / BYTES_PER_UNIT;
  let unit = 0;
  while (value >= BYTES_PER_UNIT && unit < LARGER_UNITS.length - 1) {
    value /= BYTES_PER_UNIT;
    unit += 1;
  }
  return `${value.toFixed(1)} ${LARGER_UNITS[unit] ?? ''}`;
}

/** One line for the diagnostics, e.g. "persistent, 3.0 MB of 2.0 GB used". Untranslated, like the rest of them. */
export function describeStorageFacts(facts: StorageFacts): string {
  if (facts.usageBytes === undefined) return facts.durability;
  const usage = formatBytes(facts.usageBytes);
  return `${facts.durability}, ${facts.quotaBytes === undefined ? usage : `${usage} of ${formatBytes(facts.quotaBytes)}`} used`;
}
