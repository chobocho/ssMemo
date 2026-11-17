// Bringing the memos of ssMemoWeb, the predecessor of this app, into this one.
//
// The old app kept one record per memo, keyed by its title. Here those become ordinary memos with
// ids of their own. The import only ever adds: no stored memo is changed, and the old data is
// left exactly as it is, so importing again is harmless (what is already here is recognized).
import type { DocumentDraft, StoragePort, StoredDocument } from '../storage/storagePort.ts';
import { toValidTitle } from './documentStore.ts';

// How ssMemoWeb named its records.
const MEMO_KEY_PREFIX = 'memo:';
/** The one memo of its earliest version, which later versions moved into a titled memo. */
const SINGLE_MEMO_KEY = 'NOTEPAD';

export interface LegacyMemo {
  title: string;
  content: string;
  /** ISO 8601 time of the last change, if the record has a readable one. */
  updatedAt: string | undefined;
}

export interface LegacyImportPlan {
  /** New memos to store. */
  drafts: DocumentDraft[];
  /** Memos that are here already and were therefore left out. */
  unchanged: number;
}

export interface LegacyPlanContext {
  /** What is stored now. */
  existing: readonly StoredDocument[];
  now: Date;
  createId(): string;
}

/** Something the user should be told about the import. The UI turns it into a translated message. */
export type LegacyImportNotice =
  /** The old app left no memos on this origin. */
  | { kind: 'legacy-nothing' }
  /** All `count` memos of the old app are here already. */
  | { kind: 'legacy-up-to-date'; count: number }
  | { kind: 'legacy-imported'; added: number }
  /** Nothing was written; the stored memos are as they were. */
  | { kind: 'legacy-failed' };

export interface LegacyImportOptions {
  storage: StoragePort;
  /** Reads the records of the old app; undefined if it left no database here. */
  readRecords(): Promise<unknown[] | undefined>;
  /** Writes pending edits, so the storage holds what is on screen. */
  flushAll(): Promise<void>;
  /** Asks whether the memos that were found, `missing` of which are not here yet, should be imported. */
  confirm(summary: { found: number; missing: number }): Promise<boolean>;
  onNotice(notice: LegacyImportNotice): void;
  now(): Date;
  createId(): string;
  /** Title for a memo of the old app that has none of its own. */
  singleMemoTitle: string;
}

export interface LegacyImport {
  /** Never rejects. */
  run(): Promise<void>;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/**
 * The memos among the records of the old app. Everything else that is stored there (calculator
 * variables, records that cannot be read) is left out, and so are empty memos: the old app always
 * kept one memo, even if nothing was ever written into it.
 */
export function parseLegacyRecords(records: readonly unknown[], singleMemoTitle: string): LegacyMemo[] {
  const memos: LegacyMemo[] = [];
  for (const record of records) {
    if (typeof record !== 'object' || record === null) continue;
    const { key, content, updatedAt } = record as Record<string, unknown>;
    if (typeof key !== 'string' || typeof content !== 'string' || content === '') continue;

    let title: string;
    if (key.startsWith(MEMO_KEY_PREFIX)) {
      // The old app set no limits on titles; this one does.
      title = toValidTitle(key.slice(MEMO_KEY_PREFIX.length), singleMemoTitle);
    } else if (key === SINGLE_MEMO_KEY) {
      title = singleMemoTitle;
    } else {
      continue;
    }
    memos.push({ title, content, updatedAt: isTimestamp(updatedAt) ? updatedAt : undefined });
  }
  return memos;
}

/**
 * What to store so that every memo of the old app is here. A memo counts as being here already
 * if a stored one has the same title and the same text.
 * O(n + m) time in the numbers of old and stored memos, apart from comparing the texts.
 */
export function planLegacyImport(memos: readonly LegacyMemo[], context: LegacyPlanContext): LegacyImportPlan {
  // Title → texts stored under it. Titles are not unique in this app.
  const known = new Map<string, Set<string>>();
  const isKnown = (title: string, content: string): boolean => known.get(title)?.has(content) ?? false;
  const remember = (title: string, content: string): void => {
    const texts = known.get(title) ?? new Set<string>();
    texts.add(content);
    known.set(title, texts);
  };
  for (const { meta, content } of context.existing) remember(meta.title, content);

  const importedAt = context.now.toISOString();
  const drafts: DocumentDraft[] = [];
  let unchanged = 0;
  for (const memo of memos) {
    if (isKnown(memo.title, memo.content)) {
      unchanged += 1;
      continue;
    }
    // Remembered at once, so the same memo stored twice in the old data comes in only once.
    remember(memo.title, memo.content);
    const changedAt = memo.updatedAt ?? importedAt;
    drafts.push({ id: context.createId(), title: memo.title, content: memo.content, createdAt: changedAt, updatedAt: changedAt });
  }
  return { drafts, unchanged };
}

export function createLegacyImport(options: LegacyImportOptions): LegacyImport {
  const { storage, onNotice } = options;

  return {
    async run() {
      try {
        const memos = parseLegacyRecords((await options.readRecords()) ?? [], options.singleMemoTitle);
        if (memos.length === 0) {
          onNotice({ kind: 'legacy-nothing' });
          return;
        }

        await options.flushAll();
        const plan = planLegacyImport(memos, {
          existing: (await storage.getAllDocuments()).documents,
          now: options.now(),
          createId: options.createId,
        });
        if (plan.drafts.length === 0) {
          onNotice({ kind: 'legacy-up-to-date', count: memos.length });
          return;
        }
        if (!(await options.confirm({ found: memos.length, missing: plan.drafts.length }))) return;

        // Every draft has a new id, so nothing that is stored can be overwritten, and
        // writeDocuments stores all of them or none.
        await storage.writeDocuments(plan.drafts, { replaceAll: false });
        onNotice({ kind: 'legacy-imported', added: plan.drafts.length });
      } catch {
        onNotice({ kind: 'legacy-failed' });
      }
    },
  };
}
