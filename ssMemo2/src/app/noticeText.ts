// Turns what the workspace and the storage report into the text shown to the user.
// Kept apart from the DOM code so the mapping can be tested and stays in one place.
import type { MessageKey } from '../i18n/en.ts';
import type { Translate } from '../i18n/i18n.ts';
import type { StorageMode, TemporaryReason } from '../storage/openStorage.ts';
import type { AutosaveState } from './autosave.ts';
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

/** The message explaining temporary mode. An unknown reason is explained as the unexpected case. */
export function temporaryModeKey(reason: TemporaryReason | undefined): MessageKey {
  return TEMPORARY_MODE_KEYS[reason ?? 'unavailable'];
}

/** Storage mode for the diagnostics list; an untranslated identifier, like the other entries. */
export function describeStorage(opened: { mode: StorageMode; reason?: TemporaryReason }): string {
  return opened.reason ? `${opened.mode} (${opened.reason})` : opened.mode;
}
