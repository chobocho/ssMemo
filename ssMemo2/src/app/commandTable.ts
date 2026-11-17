// Every command of the app as plain data: what it is called, how it looks and which keys run it.
// What a command does is attached separately (bindCommands), so this table can be read without
// starting the app: the help text is generated from it, and a test compares its shortcuts with
// the editor's own key bindings.
import type { MessageKey } from '../i18n/en.ts';
import type { Command, CommandDefinition } from './commands.ts';

/** Sections of the menu and of the help text, in display order. */
export const COMMAND_GROUPS = [
  { id: 'memo', labelKey: 'group.memo' },
  { id: 'file', labelKey: 'group.file' },
  { id: 'search', labelKey: 'group.search' },
  { id: 'move', labelKey: 'group.move' },
  { id: 'insert', labelKey: 'group.insert' },
  { id: 'tools', labelKey: 'group.tools' },
  { id: 'view', labelKey: 'group.view' },
  { id: 'backup', labelKey: 'group.backup' },
  { id: 'app', labelKey: 'group.app' },
] as const satisfies readonly { id: string; labelKey: MessageKey }[];

type GroupId = (typeof COMMAND_GROUPS)[number]['id'];

// Browsers keep Ctrl+T/W/N/Tab for themselves, so the shortcuts for tabs use Alt. Ctrl+O and
// Ctrl+S can be taken over by a page.
export const COMMAND_DEFINITIONS = [
  { id: 'memo.manage', group: 'memo', labelKey: 'command.manageMemos', icon: '📋', shortcuts: ['Alt-o'] },
  { id: 'memo.new', group: 'memo', labelKey: 'command.newMemo', icon: '➕', shortcuts: ['Alt-n'] },
  { id: 'tab.close', group: 'memo', labelKey: 'command.closeTab', icon: '✕', shortcuts: ['Alt-w'] },
  { id: 'tab.next', group: 'memo', labelKey: 'command.nextTab', icon: '▶', shortcuts: ['Alt-PageDown'] },
  { id: 'tab.previous', group: 'memo', labelKey: 'command.previousTab', icon: '◀', shortcuts: ['Alt-PageUp'] },

  { id: 'file.open', group: 'file', labelKey: 'command.openFile', icon: '📂', shortcuts: ['Mod-o'] },
  { id: 'file.save', group: 'file', labelKey: 'command.saveFile', icon: '💾', shortcuts: ['Mod-s'] },
  { id: 'file.saveAs', group: 'file', labelKey: 'command.saveFileAs', icon: '📑', shortcuts: ['Mod-Shift-s'] },
  { id: 'file.encoding', group: 'file', labelKey: 'command.encoding', icon: '🔤', shortcuts: [] },

  // Ctrl+I, Ctrl+<, Ctrl+> and Ctrl+B are the search keys of ssMemoWeb; the others are what editors
  // use. Its Ctrl+N for "next" is missing on purpose: browsers keep that key for a new window.
  { id: 'search.open', group: 'search', labelKey: 'command.search', icon: '🔍', shortcuts: ['Mod-f', 'Mod-i'] },
  { id: 'search.next', group: 'search', labelKey: 'command.findNext', icon: '🔽', shortcuts: ['F3', 'Mod-.', 'Mod->'] },
  { id: 'search.previous', group: 'search', labelKey: 'command.findPrevious', icon: '🔼', shortcuts: ['Shift-F3', 'Mod-,', 'Mod-<', 'Mod-b'] },

  // The keys of ssMemoWeb. Home, End and the page keys work as in any editor besides these.
  { id: 'move.start', group: 'move', labelKey: 'command.goToStart', icon: '⏫', shortcuts: ['Mod-6', 'Mod-h'] },
  { id: 'move.end', group: 'move', labelKey: 'command.goToEnd', icon: '⏬', shortcuts: ['Mod-4', 'Mod-e'] },
  { id: 'move.pageUp', group: 'move', labelKey: 'command.pageUp', icon: '⬆️', shortcuts: ['Alt-b'] },
  { id: 'move.pageDown', group: 'move', labelKey: 'command.pageDown', icon: '⬇️', shortcuts: ['Alt-f'] },

  // For the symbol commands the icon is the symbol that gets inserted.
  { id: 'insert.divider', group: 'insert', labelKey: 'command.insertDivider', icon: '➖', shortcuts: ['Mod-l'] },
  { id: 'insert.arrow', group: 'insert', labelKey: 'command.insertArrow', icon: '→', shortcuts: ['Mod-Shift-a'] },
  { id: 'insert.check', group: 'insert', labelKey: 'command.insertCheck', icon: '✅', shortcuts: ['Mod-Shift-c'] },
  { id: 'insert.box', group: 'insert', labelKey: 'command.insertBox', icon: '□', shortcuts: ['Mod-Shift-o'] },
  { id: 'insert.note', group: 'insert', labelKey: 'command.insertNote', icon: '※', shortcuts: ['Mod-Shift-r'] },
  { id: 'insert.cross', group: 'insert', labelKey: 'command.insertCross', icon: '❎', shortcuts: ['Mod-Shift-x'] },
  { id: 'insert.green', group: 'insert', labelKey: 'command.insertGreen', icon: '🟩', shortcuts: ['Mod-Shift-z'] },

  { id: 'tools.calc', group: 'tools', labelKey: 'command.runCode', icon: '🧮', shortcuts: ['Mod-Enter'] },
  { id: 'tools.chunks', group: 'tools', labelKey: 'command.chunks', icon: '➗', shortcuts: [] },
  { id: 'tools.openUrl', group: 'tools', labelKey: 'command.openUrl', icon: '🔗', shortcuts: [] },

  { id: 'view.preview', group: 'view', labelKey: 'command.preview', icon: '📖', shortcuts: ['Alt-p'] },
  { id: 'view.toggleWrap', group: 'view', labelKey: 'command.toggleWrap', icon: '↩️', shortcuts: ['Alt-z'] },
  { id: 'view.fontSmaller', group: 'view', labelKey: 'command.fontSmaller', icon: 'A−', shortcuts: [] },
  { id: 'view.fontLarger', group: 'view', labelKey: 'command.fontLarger', icon: 'A+', shortcuts: [] },

  { id: 'backup.export', group: 'backup', labelKey: 'command.exportBackup', icon: '📤', shortcuts: [] },
  { id: 'backup.import', group: 'backup', labelKey: 'command.importBackup', icon: '📥', shortcuts: [] },

  { id: 'settings.language', group: 'app', labelKey: 'command.language', icon: '🌐', shortcuts: [] },
  { id: 'help.show', group: 'app', labelKey: 'command.help', icon: '❓', shortcuts: ['F1'] },
  { id: 'app.menu', group: 'app', labelKey: 'command.menu', icon: '☰', shortcuts: ['Alt-m'] },
] as const satisfies readonly (CommandDefinition & { group: GroupId })[];

export type CommandId = (typeof COMMAND_DEFINITIONS)[number]['id'];

/** The commands that insert the symbol shown as their icon. */
export const SYMBOL_COMMAND_IDS = ['insert.arrow', 'insert.check', 'insert.box', 'insert.note', 'insert.cross', 'insert.green'] as const satisfies readonly CommandId[];

export function iconOf(id: CommandId): string {
  return COMMAND_DEFINITIONS.find((definition) => definition.id === id)?.icon ?? '';
}

/** What a command does. Commands that switch something on and off also report their state. */
export type CommandBehavior = (() => void) | { run(): void; isOn(): boolean };

/** One behavior per command; leaving one out is a compile error. */
export type CommandBehaviors = Readonly<Record<CommandId, CommandBehavior>>;

/** The commands of the table with their behaviors attached, in table order. */
export function bindCommands(behaviors: CommandBehaviors): Command[] {
  return COMMAND_DEFINITIONS.map((definition): Command => {
    const behavior = behaviors[definition.id];
    return typeof behavior === 'function' ? { ...definition, run: behavior } : { ...definition, run: behavior.run, isOn: behavior.isOn };
  });
}
