import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_DEFINITIONS, COMMAND_GROUPS, COMMAND_HINT_KEYS } from '../../src/app/commandTable.ts';
import { buildHelpGroups } from '../../src/app/helpContent.ts';
import { en } from '../../src/i18n/en.ts';
import { createTranslator } from '../../src/i18n/i18n.ts';

const t = createTranslator('en');
const groups = buildHelpGroups(COMMAND_DEFINITIONS, COMMAND_GROUPS, t, (shortcut) => `<${shortcut}>`);

test('the help lists the groups of the command table, in its order, by their names', () => {
  assert.deepEqual(groups.map((group) => group.label), COMMAND_GROUPS.map((group) => en[group.labelKey]));
});

test('every command is listed exactly once, in table order, with its icon and name', () => {
  const rows = groups.flatMap((group) => group.rows);
  assert.deepEqual(rows.map((row) => [row.icon, row.label]), COMMAND_DEFINITIONS.map((definition) => [definition.icon, en[definition.labelKey]]));
});

test('a command shows all of its shortcuts, formatted, and none if it has none', () => {
  const rows = groups.flatMap((group) => group.rows);
  const search = rows.find((row) => row.label === en['command.search']);
  assert.deepEqual(search?.shortcuts, ['<Mod-f>', '<Mod-i>']);
  const encoding = rows.find((row) => row.label === en['command.encoding']);
  assert.deepEqual(encoding?.shortcuts, []);
});

test('a group without commands is left out, and a command of an unlisted group is not lost', () => {
  const built = buildHelpGroups(
    [
      { id: 'a', group: 'used', labelKey: 'command.newMemo', icon: 'A', shortcuts: [] },
      { id: 'b', group: 'unlisted', labelKey: 'command.closeTab', icon: 'B', shortcuts: ['Alt-w'] },
    ],
    [
      { id: 'empty', labelKey: 'group.file' },
      { id: 'used', labelKey: 'group.memo' },
    ],
    t,
    (shortcut) => shortcut,
  );
  assert.deepEqual(built.map((group) => group.label), [en['group.memo'], 'unlisted']);
  assert.deepEqual(built[1]?.rows, [{ icon: 'B', label: en['command.closeTab'], shortcuts: ['Alt-w'] }]);
});

test('a command gets its line of explanation where the table has one, and only there', () => {
  const rows = buildHelpGroups(COMMAND_DEFINITIONS, COMMAND_GROUPS, t, (shortcut) => shortcut, COMMAND_HINT_KEYS).flatMap((group) => group.rows);
  const trash = rows.find((row) => row.label === en['command.trash']);
  assert.equal(trash?.hint, en['hint.trash']);
  const next = rows.find((row) => row.label === en['command.findNext']);
  assert.equal(next !== undefined && 'hint' in next, false);
  assert.equal(rows.filter((row) => row.hint !== undefined).length, Object.keys(COMMAND_HINT_KEYS).length);
});

test('every explanation belongs to a command of the table and has a text', () => {
  const ids = new Set<string>(COMMAND_DEFINITIONS.map((definition) => definition.id));
  for (const [id, key] of Object.entries(COMMAND_HINT_KEYS)) {
    assert.equal(ids.has(id), true, id);
    assert.notEqual(en[key], '', id);
  }
});
