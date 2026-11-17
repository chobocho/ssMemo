// What the help dialog lists, generated from the command table. Because the help, the menu, the
// toolbar and the key handling all read the same table, the help cannot describe a shortcut that
// does not exist or miss one that does (in ssMemoWeb it was a hand-written copy and drifted).
import type { MessageKey } from '../i18n/en.ts';
import type { Translate } from '../i18n/i18n.ts';
import type { CommandDefinition } from './commands.ts';

export interface HelpRow {
  icon: string;
  label: string;
  /** Every shortcut of the command, as shown to the user. */
  shortcuts: string[];
}

export interface HelpGroup {
  label: string;
  rows: HelpRow[];
}

/**
 * The commands grouped as in `groups`, each group in table order. Groups without commands are
 * left out. A command whose group is not listed still appears, under the group's raw name, so a
 * mistake in the table shows up instead of hiding a command.
 */
export function buildHelpGroups(
  definitions: readonly CommandDefinition[],
  groups: readonly { id: string; labelKey: MessageKey }[],
  t: Translate,
  formatShortcut: (shortcut: string) => string,
): HelpGroup[] {
  const labels = new Map(groups.map((group) => [group.id, t(group.labelKey)]));
  const order = [...new Set([...groups.map((group) => group.id), ...definitions.map((definition) => definition.group)])];
  return order.flatMap((groupId) => {
    const rows = definitions
      .filter((definition) => definition.group === groupId)
      .map((definition) => ({ icon: definition.icon, label: t(definition.labelKey), shortcuts: definition.shortcuts.map(formatShortcut) }));
    return rows.length === 0 ? [] : [{ label: labels.get(groupId) ?? groupId, rows }];
  });
}
