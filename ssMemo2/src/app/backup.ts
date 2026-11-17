// The backup file: every document and the settings as one JSON document.
//
// TODO.md asks for a format that is easy to change and extend, also by hand. So the file is
// indented, has one field per line and names its sections; what the storage derives itself
// (revision, length) is left out, and reading is lenient about anything that is missing.
import type { DocumentSource, StoredDocument } from '../storage/storagePort.ts';
import type { Settings } from './settings.ts';

export const BACKUP_APP_ID = 'ssMemo2';
/** Raised only for a change that older versions of the app could not read. */
export const BACKUP_FORMAT_VERSION = 1;

const INDENTATION = 2;
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
  documents: BackupDocument[];
}

export interface BackupInput {
  documents: readonly StoredDocument[];
  settings: Settings;
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
