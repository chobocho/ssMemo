// English message catalog. Its keys define the set of messages; ko.ts must provide every one.
// Placeholders are written {name} and filled in by the translator.
export const en = {
  'diagnostics.title': 'ℹ️ Diagnostics',
  'diagnostics.copy': '📋 Copy',
  'diagnostics.copied': 'Copied.',
  'diagnostics.copyFailed': 'Could not copy automatically. The list is selected: copy it from the system menu.',

  'status.saved': 'Saved',
  'status.pending': 'Not saved yet',
  'status.saving': 'Saving…',
  'status.failed': 'Save failed',
  'storage.temporary': '⚠️ Temporary mode',

  'command.newMemo': 'New memo',
  'command.manageMemos': 'Memo list',
  'command.closeTab': 'Close tab',
  'command.nextTab': 'Next tab',
  'command.previousTab': 'Previous tab',
  'command.toggleWrap': 'Line wrapping',
  'command.fontSmaller': 'Smaller text',
  'command.fontLarger': 'Larger text',
  'command.language': 'Language',

  'language.auto': 'Automatic (browser language)',
  // The language's own name, shown the same in every locale. Escaped because Korean text may only
  // appear literally in ko.ts.
  'language.ko': '\uD55C\uAD6D\uC5B4',
  'language.en': 'English',

  'statusbar.position': 'Ln {line}, Col {column}',
  'statusbar.selection': '{count} selected',
  'statusbar.size': '{characters} characters · {lines} lines',

  'tab.close': 'Close {title}',
  'tab.closeUnsaved': 'This memo could not be saved. Close it anyway? The unsaved changes will be lost.',
  'tab.closeDiscard': 'Close without saving',

  'manager.title': 'Memos',
  'manager.loading': 'Loading…',
  'manager.empty': 'No saved memos yet.',
  'manager.failed': 'That did not work. The memo may have been changed in another window, so the list was reloaded.',
  'manager.details': '{time} · {count} characters',
  'manager.renameOf': 'Rename {title}',
  'manager.renamePrompt': 'New title',
  'manager.deleteOf': 'Delete {title}',
  'manager.deleteConfirm': 'Delete "{title}"? This cannot be undone.',
  'manager.delete': 'Delete',

  'title.empty': 'Enter a title.',
  'title.tooLong': 'Use at most {max} characters.',
  'title.lineBreak': 'A title cannot contain a line break.',

  'modal.confirm': 'OK',
  'modal.cancel': 'Cancel',

  'notice.dismiss': 'Close',
  'notice.temporaryUnavailable': 'Browser storage cannot be used, so memos are kept only until this page is closed.',
  'notice.temporarySafeMode': 'Safe mode (?safe): stored memos are not loaded and nothing typed here is kept.',
  'notice.loadFailed': 'Stored memos could not be loaded. A new memo was started and the stored ones were left untouched.',
  'notice.corruptRecords': 'Skipped {count} damaged memo record(s).',
  'notice.savedAsCopy': 'This memo was changed in another window, so your text was saved separately as "{title}".',
  'notice.saveFailed': 'The memo could not be saved. Your text is still on screen but not stored.',
  'notice.saveFailedQuota': 'Browser storage is full, so the memo could not be saved.',
  'notice.connectionLost': 'The storage connection was closed. Reload the page to save again.',
  'notice.tabLimit': 'No more than {max} tabs can be open. Close a tab first.',
  'notice.memoMissing': 'That memo no longer exists.',

  'memo.defaultTitle': 'New memo',
  'memo.conflictCopyTitle': '{title} (conflict copy)',
} as const satisfies Record<string, string>;

export type MessageKey = keyof typeof en;
