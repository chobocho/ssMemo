// English message catalog. Its keys define the set of messages; ko.ts must provide every one.
export const en = {
  'diagnostics.title': 'ℹ️ Diagnostics',
  'diagnostics.copy': '📋 Copy',
  'diagnostics.copied': 'Copied.',
  'diagnostics.copyFailed': 'Could not copy automatically. The list is selected: copy it from the system menu.',
} as const satisfies Record<string, string>;

export type MessageKey = keyof typeof en;
