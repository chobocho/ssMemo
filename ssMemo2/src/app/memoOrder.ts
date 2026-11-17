// The order in which the memo list shows its memos, and with it the results of a search in them.
import type { DocumentMeta } from '../storage/storagePort.ts';

export type MemoSort =
  /** Changed last first. */
  | 'updated'
  /** Made last first. */
  | 'created'
  /** By title, in the alphabet of the app's language. */
  | 'title';

/** In the order they are offered. */
export const MEMO_SORTS: readonly MemoSort[] = ['updated', 'created', 'title'];

export interface MemoOrder {
  sort: MemoSort;
  /** Compares two titles as the language of the app does (an Intl.Collator in the app). */
  compareTitles(left: string, right: string): number;
  /** Memos that come before all others, in the same order among themselves. */
  pinnedIds?: ReadonlySet<string>;
}

export function isMemoSort(value: unknown): value is MemoSort {
  return typeof value === 'string' && (MEMO_SORTS as readonly string[]).includes(value);
}

// Times are compared as moments rather than as text: a backup edited by hand may write the same
// moment with a time zone offset. A time that cannot be read counts as the oldest.
function toMoment(iso: string): number {
  const moment = Date.parse(iso);
  return Number.isNaN(moment) ? Number.NEGATIVE_INFINITY : moment;
}

function laterFirst(left: string, right: string): number {
  const leftMoment = toMoment(left);
  const rightMoment = toMoment(right);
  if (leftMoment === rightMoment) return 0;
  return leftMoment < rightMoment ? 1 : -1;
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * `items` in the given order, pinned memos first, as a new list. `getMeta` says which memo an item
 * belongs to, so search results can be ordered like the memos themselves. Whatever the order is,
 * memos that are equal in it are told apart by their other properties and finally by their id,
 * so the list never changes between two visits without a reason.
 * O(n log n) time.
 */
export function orderMemos<T>(items: readonly T[], getMeta: (item: T) => DocumentMeta, order: MemoOrder): T[] {
  const isPinned = (meta: DocumentMeta): boolean => order.pinnedIds?.has(meta.id) ?? false;
  const compare = (leftItem: T, rightItem: T): number => {
    const left = getMeta(leftItem);
    const right = getMeta(rightItem);
    if (isPinned(left) !== isPinned(right)) return isPinned(left) ? -1 : 1;
    const byTitle = order.compareTitles(left.title, right.title);
    const byChange = laterFirst(left.updatedAt, right.updatedAt);
    let result: number;
    switch (order.sort) {
      case 'updated':
        result = byChange || byTitle;
        break;
      case 'created':
        result = laterFirst(left.createdAt, right.createdAt) || byTitle;
        break;
      case 'title':
        result = byTitle || byChange;
        break;
    }
    return result || compareText(left.id, right.id);
  };
  return [...items].sort(compare);
}
