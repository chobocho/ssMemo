// Turns what the workspace and the storage report into the text shown to the user.
// Kept apart from the DOM code so the mapping can be tested and stays in one place.
import type { MessageKey } from '../i18n/en.ts';
import type { Eol, TextFormat } from '../lib/textFile.ts';
import type { Translate } from '../i18n/i18n.ts';
import type { StorageMode, TemporaryReason } from '../storage/openStorage.ts';
import type { AutosaveState } from './autosave.ts';
import { MAX_TITLE_LENGTH } from './documentStore.ts';
import type { TitleProblem } from './documentStore.ts';
import type { FileNotice } from './localFiles.ts';
import type { EditorStats } from '../editor/editorSetup.ts';
import { MAX_TABS } from './tabManager.ts';
import type { SaveFailureReason, WorkspaceNotice } from './workspace.ts';

export const SAVE_STATE_KEYS: Readonly<Record<AutosaveState, MessageKey>> = {
  saved: 'status.saved',
  pending: 'status.pending',
  saving: 'status.saving',
  failed: 'status.failed',
};

const SAVE_FAILURE_KEYS: Readonly<Record<SaveFailureReason, MessageKey>> = {
  quota: 'notice.saveFailedQuota',
  'connection-lost': 'notice.connectionLost',
  other: 'notice.saveFailed',
};

const TEMPORARY_MODE_KEYS: Readonly<Record<TemporaryReason, MessageKey>> = {
  'safe-mode': 'notice.temporarySafeMode',
  unavailable: 'notice.temporaryUnavailable',
};

export function describeNotice(notice: WorkspaceNotice, t: Translate): string {
  switch (notice.kind) {
    case 'load-failed':
      return t('notice.loadFailed');
    case 'corrupt-records':
      return t('notice.corruptRecords', { count: notice.count });
    case 'saved-as-copy':
      return t('notice.savedAsCopy', { title: notice.title });
    case 'save-failed':
      return t(SAVE_FAILURE_KEYS[notice.reason]);
    case 'tab-limit':
      return t('notice.tabLimit', { max: MAX_TABS });
    case 'memo-missing':
      return t('notice.memoMissing');
  }
}

const BYTES_PER_MEGABYTE = 1024 * 1024;

export function describeFileNotice(notice: FileNotice, t: Translate): string {
  switch (notice.kind) {
    case 'file-too-large':
      return t('notice.fileTooLarge', { name: notice.fileName, max: notice.maxBytes / BYTES_PER_MEGABYTE });
    case 'file-not-text':
      return t('notice.fileNotText', { name: notice.fileName });
    case 'file-unreadable':
      return t('notice.fileUnreadable', { name: notice.fileName });
    case 'file-garbled':
      return t('notice.fileGarbled', { name: notice.fileName, encoding: notice.encoding });
    case 'encoding-not-a-file':
      return t('notice.encodingNotFile');
    case 'encoding-locked':
      return t('notice.encodingLocked');
    case 'file-saved':
      return t('notice.fileSaved', { name: notice.fileName });
    case 'file-save-failed':
      return t('notice.fileSaveFailed', { name: notice.fileName });
  }
}

/** The message explaining temporary mode. An unknown reason is explained as the unexpected case. */
export function temporaryModeKey(reason: TemporaryReason | undefined): MessageKey {
  return TEMPORARY_MODE_KEYS[reason ?? 'unavailable'];
}

/** Storage mode for the diagnostics list; an untranslated identifier, like the other entries. */
export function describeStorage(opened: { mode: StorageMode; reason?: TemporaryReason }): string {
  return opened.reason ? `${opened.mode} (${opened.reason})` : opened.mode;
}

/** Why a title the user typed is refused. */
export function describeTitleProblem(problem: TitleProblem, t: Translate): string {
  switch (problem) {
    case 'empty':
      return t('title.empty');
    case 'too-long':
      return t('title.tooLong', { max: MAX_TITLE_LENGTH });
    case 'line-break':
      return t('title.lineBreak');
  }
}

/**
 * A stored ISO timestamp in the reader's language and time zone. Text that is not a timestamp
 * is returned unchanged rather than shown as "Invalid Date".
 *
 * @param timeZone defaults to the device's time zone; tests pass a fixed one.
 */
export function formatTimestamp(iso: string, locale: string, timeZone?: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(time);
}

const STATUS_SEPARATOR = ' · ';
// Technical names, the same in every language.
const EOL_LABELS: Readonly<Record<Eol, string>> = { lf: 'LF', crlf: 'CRLF', cr: 'CR' };
const BOM_SUFFIX = ' BOM';

/**
 * The status bar text for the visible memo; empty while there is none. `format` is given for a
 * tab that shows a file, whose encoding and line ending are then shown at the end.
 */
export function formatEditorStats(stats: EditorStats | undefined, t: Translate, format?: TextFormat): string {
  if (!stats) return '';
  const parts = [t('statusbar.position', { line: stats.cursorLine, column: stats.cursorColumn })];
  if (stats.selectedCharacters > 0) {
    parts.push(t('statusbar.selection', { count: stats.selectedCharacters }));
  }
  parts.push(t('statusbar.size', { characters: stats.characters, lines: stats.lines }));
  if (format) {
    parts.push(`${format.encoding}${format.hasBom ? BOM_SUFFIX : ''}`, EOL_LABELS[format.eol]);
  }
  return parts.join(STATUS_SEPARATOR);
}
