// The backup file: every document and the settings as one JSON document.
//
// TODO.md asks for a format that is easy to change and extend, also by hand. So the file is
// indented, has one field per line and names its sections; what the storage derives itself
// (revision, length) is left out, and reading is lenient about anything that is missing.
import { parseStoredEnvironment, toStoredEnvironment } from '../lib/calc.ts';
import type { StoredCalcValue } from '../lib/calc.ts';
import { parseDocumentSource } from '../storage/storagePort.ts';
import type { DocumentDraft, DocumentSource, StoredDocument } from '../storage/storagePort.ts';
import { toValidTitle } from './documentStore.ts';
import { parseSettings } from './settings.ts';
import type { Settings } from './settings.ts';

export const BACKUP_APP_ID = 'ssMemo2';
/** Raised only for a change that older versions of the app could not read. */
export const BACKUP_FORMAT_VERSION = 1;

const INDENTATION = 2;
const BYTE_ORDER_MARK = 0xfeff;
const FILE_NAME_PREFIX = 'ssMemo2-backup-';
const FILE_NAME_EXTENSION = '.json';

export interface BackupDocument {
  id: string;
  title: string;
  /** ISO 8601 timestamps. */
  createdAt: string;
  updatedAt: string;
  content: string;
  /** Present for a document that was opened from a local file. */
  source?: DocumentSource;
}

export interface Backup {
  app: typeof BACKUP_APP_ID;
  formatVersion: number;
  exportedAt: string;
  /** Build of the app that wrote the file; informational. */
  appBuild: string;
  settings: Settings;
  /** The variables kept by the calculator. */
  calcMemory: Record<string, StoredCalcValue>;
  documents: BackupDocument[];
}

export interface BackupInput {
  documents: readonly StoredDocument[];
  settings: Settings;
  calcMemory: Record<string, StoredCalcValue>;
  exportedAt: Date;
  buildId: string;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

function toBackupDocument({ meta, content }: StoredDocument): BackupDocument {
  const document: BackupDocument = { id: meta.id, title: meta.title, createdAt: meta.createdAt, updatedAt: meta.updatedAt, content };
  if (meta.source) document.source = { ...meta.source };
  return document;
}

/** O(n log n) in the number of documents, for the stable order. */
export function createBackup(input: BackupInput): Backup {
  return {
    app: BACKUP_APP_ID,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: input.exportedAt.toISOString(),
    appBuild: input.buildId,
    settings: { ...input.settings },
    calcMemory: { ...input.calcMemory },
    // Oldest first, ids breaking ties: two backups of the same data then compare line by line.
    documents: input.documents
      .map(toBackupDocument)
      .sort((left, right) => compareText(left.createdAt, right.createdAt) || compareText(left.id, right.id)),
  };
}

export function serializeBackup(backup: Backup): string {
  return `${JSON.stringify(backup, null, INDENTATION)}\n`;
}

const twoDigits = (value: number): string => String(value).padStart(2, '0');

/** Named after local time, which is what the person looking for the file remembers. */
export function backupFileName(exportedAt: Date): string {
  const date = `${exportedAt.getFullYear()}${twoDigits(exportedAt.getMonth() + 1)}${twoDigits(exportedAt.getDate())}`;
  const time = `${twoDigits(exportedAt.getHours())}${twoDigits(exportedAt.getMinutes())}`;
  return `${FILE_NAME_PREFIX}${date}-${time}${FILE_NAME_EXTENSION}`;
}

/** A document as found in a backup file. Entries written by hand may lack everything but the text. */
export interface ImportedDocument {
  id: string | undefined;
  title: string | undefined;
  createdAt: string | undefined;
  updatedAt: string | undefined;
  content: string;
  source: DocumentSource | undefined;
}

export interface BackupContent {
  exportedAt: string | undefined;
  documents: ImportedDocument[];
  settings: Settings | undefined;
  /** undefined if the file says nothing about calculator variables, which differs from "none". */
  calcMemory: Record<string, StoredCalcValue> | undefined;
  /** Entries of the document list that could not be used. */
  skippedDocuments: number;
}

export type BackupProblem =
  /** The file is not JSON at all. */
  | 'not-json'
  /** JSON, but not a backup of this app. */
  | 'not-a-backup'
  /** Written by a later version of the app in a format this one cannot read. */
  | 'newer-format';

export type ParsedBackup = { ok: true; content: BackupContent } | { ok: false; problem: BackupProblem };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function timestampOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

/** undefined if the entry has no text, which is the one thing a document cannot do without. */
function parseDocumentEntry(entry: unknown): ImportedDocument | undefined {
  if (!isRecord(entry) || typeof entry.content !== 'string') return undefined;
  return {
    id: textOrUndefined(entry.id),
    title: typeof entry.title === 'string' ? entry.title : undefined,
    createdAt: timestampOrUndefined(entry.createdAt),
    updatedAt: timestampOrUndefined(entry.updatedAt),
    content: entry.content,
    source: parseDocumentSource(entry.source),
  };
}

/**
 * Reads the text of a backup file. Reading is lenient on purpose: only the app name and the
 * document list are required, every other field may be missing or wrong and is then left out,
 * and unknown fields are ignored. A file edited by hand or written by a slightly different
 * version of the app therefore still loads.
 */
export function parseBackup(text: string): ParsedBackup {
  let root: unknown;
  try {
    // Editors on Windows like to put a byte order mark in front, which JSON does not allow.
    root = JSON.parse(text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text);
  } catch {
    return { ok: false, problem: 'not-json' };
  }
  if (!isRecord(root) || root.app !== BACKUP_APP_ID || !Array.isArray(root.documents)) {
    return { ok: false, problem: 'not-a-backup' };
  }
  if (typeof root.formatVersion === 'number' && root.formatVersion > BACKUP_FORMAT_VERSION) {
    return { ok: false, problem: 'newer-format' };
  }

  const documents: ImportedDocument[] = [];
  let skippedDocuments = 0;
  for (const entry of root.documents as unknown[]) {
    const document = parseDocumentEntry(entry);
    if (document) documents.push(document);
    else skippedDocuments += 1;
  }
  return {
    ok: true,
    content: {
      exportedAt: timestampOrUndefined(root.exportedAt),
      documents,
      settings: isRecord(root.settings) ? parseSettings(root.settings) : undefined,
      // Read and written again, which drops whatever is not a usable variable.
      calcMemory: isRecord(root.calcMemory) ? toStoredEnvironment(parseStoredEnvironment(root.calcMemory)) : undefined,
      skippedDocuments,
    },
  };
}

export type ImportMode =
  /** Keep what is stored and add the backup's documents. */
  | 'merge'
  /** Delete what is stored and keep only the backup's documents. */
  | 'replace';

export interface ImportContext {
  mode: ImportMode;
  existing: readonly StoredDocument[];
  now: Date;
  createId(): string;
  /** Title for a document that has none. */
  defaultTitle: string;
  /** Title for a document imported next to a different document with the same id. */
  copyTitle(title: string): string;
}

export interface ImportPlan {
  /** What has to be written to the storage. */
  drafts: DocumentDraft[];
  added: number;
  /** Imported under a new id because a different document with their id already exists. */
  copied: number;
  /** Left out because the stored document is already the same. */
  unchanged: number;
}

function isSameSource(left: DocumentSource | undefined, right: DocumentSource | undefined): boolean {
  if (!left || !right) return left === right;
  return left.fileName === right.fileName && left.encoding === right.encoding && left.eol === right.eol && left.hasBom === right.hasBom;
}

/**
 * Works out what an import has to write, without touching the storage.
 *
 * Replacing takes the backup as it is. Merging never overwrites: a document whose id is already
 * stored is left out if it is the same, and otherwise imported next to the stored one under a
 * new id, because nobody can tell which of the two versions the user wants to keep.
 * O(n + m) for n imported and m stored documents.
 */
export function planImport(documents: readonly ImportedDocument[], context: ImportContext): ImportPlan {
  const { mode, now, defaultTitle } = context;
  const existing = new Map(context.existing.map((document) => [document.meta.id, document]));
  // Ids that must not be given to another document: those in use in the storage after the
  // import, and those already handed out during it.
  const takenIds = new Set<string>(mode === 'merge' ? existing.keys() : []);
  const freshId = (): string => {
    for (;;) {
      const id = context.createId();
      if (!takenIds.has(id)) return id;
    }
  };

  const importTime = now.toISOString();
  const plan: ImportPlan = { drafts: [], added: 0, copied: 0, unchanged: 0 };

  for (const document of documents) {
    let title = toValidTitle(document.title ?? '', defaultTitle);
    let id = document.id;
    const stored = mode === 'merge' && id !== undefined ? existing.get(id) : undefined;
    if (stored) {
      if (stored.meta.title === title && stored.content === document.content && isSameSource(stored.meta.source, document.source)) {
        plan.unchanged += 1;
        continue;
      }
      id = freshId();
      title = toValidTitle(context.copyTitle(title), defaultTitle);
      plan.copied += 1;
    } else {
      // No id, or one that an earlier entry of this backup already used.
      if (id === undefined || takenIds.has(id)) id = freshId();
      plan.added += 1;
    }
    takenIds.add(id);

    const draft: DocumentDraft = {
      id,
      title,
      createdAt: document.createdAt ?? importTime,
      updatedAt: document.updatedAt ?? importTime,
      content: document.content,
    };
    if (document.source) draft.source = { ...document.source };
    plan.drafts.push(draft);
  }
  return plan;
}
