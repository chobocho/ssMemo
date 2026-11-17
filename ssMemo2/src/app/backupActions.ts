// Exporting everything to a backup file and importing such a file again. Like the other
// procedures it knows nothing about the DOM: dialogs, the file picker and the reload are passed
// in, so every path (including the ones that must not lose data) is tested without a browser.
import { decodeText } from '../lib/encoding.ts';
import type { StoragePort } from '../storage/storagePort.ts';
import { backupFileName, createBackup, parseBackup, planImport, serializeBackup } from './backup.ts';
import type { BackupContent, BackupProblem, ImportMode } from './backup.ts';
import type { PickedFile, SaveTarget } from './localFiles.ts';
import type { Settings } from './settings.ts';

/** Something the user should be told about a backup. The UI turns it into a translated message. */
export type BackupNotice =
  /** `unreadable` counts damaged records that are missing from the file. */
  | { kind: 'backup-exported'; documents: number; unreadable: number }
  | { kind: 'backup-export-failed' }
  | { kind: 'backup-unreadable-file' }
  | { kind: 'backup-invalid'; problem: BackupProblem }
  /** The file is a backup but holds no memo. */
  | { kind: 'backup-empty' }
  /** A merge finished. `skipped` counts entries of the file that could not be used. */
  | { kind: 'backup-imported'; added: number; copied: number; unchanged: number; skipped: number }
  /** Nothing was written; the stored memos are as they were. */
  | { kind: 'backup-import-failed' };

/** What the user is shown before deciding how to import. */
export interface BackupSummary {
  /** Usable memos in the file. */
  documents: number;
  /** Entries of the file that cannot be used. */
  skipped: number;
  /** When the backup was made, if the file says so. */
  exportedAt: string | undefined;
  /** Memos stored in the app right now. */
  stored: number;
}

export interface BackupActionsOptions {
  storage: StoragePort;
  getSettings(): Settings;
  /** Stores settings taken from a backup. */
  saveSettings(settings: Settings): Promise<unknown>;
  /** Writes pending edits, so the storage holds what is on screen. */
  flushAll(): Promise<void>;
  saveAs(suggestedName: string, bytes: Uint8Array): Promise<SaveTarget>;
  /** Lets the user choose a backup file; undefined if they back out. */
  pickFile(): Promise<PickedFile | undefined>;
  /** Lets the user choose how to import; undefined if they back out. */
  chooseMode(summary: BackupSummary): Promise<ImportMode | undefined>;
  /** Asks whether the stored memos may really be deleted. */
  confirmReplace(storedCount: number): Promise<boolean>;
  /** Shows that the backup file is being read. Returns the function that removes the indicator. */
  showBusy(): () => void;
  onNotice(notice: BackupNotice): void;
  /** Called after the stored memos were replaced: everything on screen is out of date. */
  restart(): void;
  now(): Date;
  createId(): string;
  buildId: string;
  defaultTitle: string;
  /** Title for a memo imported next to a different stored memo with the same id. */
  copyTitle(title: string): string;
}

export interface BackupActions {
  /** Never rejects. */
  exportBackup(): Promise<void>;
  /** Never rejects. */
  importBackup(): Promise<void>;
}

export function createBackupActions(options: BackupActionsOptions): BackupActions {
  const { storage, onNotice } = options;

  /** Reads and checks the file. Reports what is wrong with it and returns undefined in that case. */
  async function readBackup(file: PickedFile): Promise<BackupContent | undefined> {
    const hideBusy = options.showBusy();
    try {
      // Backups are UTF-8, but an editor may have saved one differently; detection costs nothing.
      const parsed = parseBackup(decodeText(await file.read()).text);
      if (!parsed.ok) {
        onNotice({ kind: 'backup-invalid', problem: parsed.problem });
        return undefined;
      }
      if (parsed.content.documents.length === 0) {
        // Offering to replace everything with nothing would be an invitation to lose data.
        onNotice({ kind: 'backup-empty' });
        return undefined;
      }
      return parsed.content;
    } catch {
      onNotice({ kind: 'backup-unreadable-file' });
      return undefined;
    } finally {
      // Gone before any question is asked: two dialogs on top of each other help nobody.
      hideBusy();
    }
  }

  return {
    async exportBackup() {
      try {
        await options.flushAll();
        const snapshot = await storage.getAllDocuments();
        const exportedAt = options.now();
        const backup = createBackup({
          documents: snapshot.documents,
          settings: options.getSettings(),
          exportedAt,
          buildId: options.buildId,
        });
        const target = await options.saveAs(backupFileName(exportedAt), new TextEncoder().encode(serializeBackup(backup)));
        if (target.kind === 'cancelled') return;
        onNotice({ kind: 'backup-exported', documents: snapshot.documents.length, unreadable: snapshot.corruptCount });
      } catch {
        onNotice({ kind: 'backup-export-failed' });
      }
    },

    async importBackup() {
      const file = await options.pickFile();
      if (!file) return;
      const content = await readBackup(file);
      if (!content) return;

      try {
        await options.flushAll();
        const stored = (await storage.listDocuments()).documents.length;
        const mode = await options.chooseMode({
          documents: content.documents.length,
          skipped: content.skippedDocuments,
          exportedAt: content.exportedAt,
          stored,
        });
        if (mode === undefined) return;
        if (mode === 'replace' && stored > 0 && !(await options.confirmReplace(stored))) return;

        const plan = planImport(content.documents, {
          mode,
          // Read after the questions were answered, so it is as current as it can be. Replacing
          // does not look at what is stored.
          existing: mode === 'merge' ? (await storage.getAllDocuments()).documents : [],
          now: options.now(),
          createId: options.createId,
          defaultTitle: options.defaultTitle,
          copyTitle: options.copyTitle,
        });
        await storage.writeDocuments(plan.drafts, { replaceAll: mode === 'replace' });

        if (mode === 'replace') {
          if (content.settings) await options.saveSettings(content.settings);
          options.restart();
          return;
        }
        onNotice({
          kind: 'backup-imported',
          added: plan.added,
          copied: plan.copied,
          unchanged: plan.unchanged,
          skipped: content.skippedDocuments,
        });
      } catch {
        // writeDocuments stores all or nothing, so a failure leaves the memos as they were.
        onNotice({ kind: 'backup-import-failed' });
      }
    },
  };
}
