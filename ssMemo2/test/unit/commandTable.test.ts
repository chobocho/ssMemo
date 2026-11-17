import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_DEFINITIONS, COMMAND_GROUPS, bindCommands } from '../../src/app/commandTable.ts';
import type { CommandBehaviors } from '../../src/app/commandTable.ts';
import { createCommandRegistry } from '../../src/app/commands.ts';
import { parseShortcut } from '../../src/app/shortcut.ts';
import { en } from '../../src/i18n/en.ts';

/** A behavior for every command, each recording that it ran. */
function recordingBehaviors(): { behaviors: CommandBehaviors; ran: string[] } {
  const ran: string[] = [];
  const entries = COMMAND_DEFINITIONS.map((definition) => [definition.id, () => ran.push(definition.id)]);
  return { behaviors: Object.fromEntries(entries) as CommandBehaviors, ran };
}

test('the table defines the commands the app has had so far', () => {
  const ids: string[] = COMMAND_DEFINITIONS.map((definition) => definition.id);
  for (const id of ['memo.manage', 'memo.new', 'tab.close', 'file.open', 'file.save', 'file.encoding', 'view.toggleWrap', 'backup.export', 'settings.language', 'app.menu']) {
    assert.ok(ids.includes(id), `${id} is missing`);
  }
});

test('every command has a unique id, a label that exists, an icon and well-formed shortcuts', () => {
  const ids = new Set<string>();
  for (const definition of COMMAND_DEFINITIONS) {
    assert.equal(ids.has(definition.id), false, `duplicate id ${definition.id}`);
    ids.add(definition.id);
    assert.ok(definition.labelKey in en, `${definition.id}: unknown label ${definition.labelKey}`);
    assert.ok(definition.icon.length > 0, `${definition.id}: no icon`);
    for (const shortcut of definition.shortcuts) assert.doesNotThrow(() => parseShortcut(shortcut), `${definition.id}: ${shortcut}`);
  }
});

test('every command belongs to a listed group, and every group has a label and at least one command', () => {
  const groupIds = COMMAND_GROUPS.map((group) => group.id);
  assert.equal(new Set(groupIds).size, groupIds.length);
  for (const definition of COMMAND_DEFINITIONS) {
    assert.ok(groupIds.includes(definition.group), `${definition.id}: unknown group ${definition.group}`);
  }
  for (const group of COMMAND_GROUPS) {
    assert.ok(group.labelKey in en, `group ${group.id}: unknown label ${group.labelKey}`);
    assert.ok(COMMAND_DEFINITIONS.some((definition) => definition.group === group.id), `group ${group.id} is empty`);
  }
});

test('the commands of a group stand together, in the order of the groups', () => {
  // The menu and the help text list the table as it is, so its order is what the user sees.
  const groupOrder = COMMAND_GROUPS.map((group) => group.id);
  const sequence = COMMAND_DEFINITIONS.map((definition) => groupOrder.indexOf(definition.group));
  assert.deepEqual(sequence, [...sequence].sort((left, right) => left - right));
});

test('bindCommands gives every definition its behavior, in table order', () => {
  const { behaviors, ran } = recordingBehaviors();
  const commands = bindCommands(behaviors);
  assert.deepEqual(commands.map((command) => command.id), COMMAND_DEFINITIONS.map((definition) => definition.id));
  for (const command of commands) command.run();
  assert.deepEqual(ran, COMMAND_DEFINITIONS.map((definition) => definition.id));
  assert.equal(commands[0]?.labelKey, COMMAND_DEFINITIONS[0]?.labelKey);
  assert.equal(commands[0]?.group, COMMAND_DEFINITIONS[0]?.group);
});

test('a toggle behavior carries its state, a plain one has none', () => {
  let on = false;
  const { behaviors } = recordingBehaviors();
  const commands = bindCommands({ ...behaviors, 'view.toggleWrap': { run: () => { on = !on; }, isOn: () => on } });
  const wrap = commands.find((command) => command.id === 'view.toggleWrap');
  assert.equal(wrap?.isOn?.(), false);
  wrap?.run();
  assert.equal(wrap?.isOn?.(), true);
  assert.equal(commands.find((command) => command.id === 'memo.new')?.isOn, undefined);
});

test('the table as a whole is accepted by the registry: no shortcut is used twice', () => {
  assert.doesNotThrow(() => createCommandRegistry(bindCommands(recordingBehaviors().behaviors)));
});
