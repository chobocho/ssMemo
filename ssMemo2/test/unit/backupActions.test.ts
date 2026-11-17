import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBackup } from '../../src/app/backup.ts';
import type { ImportMode } from '../../src/app/backup.ts';
import { createBackupActions } from '../../src/app/backupActions.ts';
import { CALC_MEMORY_KEY } from '../../src/app/calcActions.ts';
import type { BackupActions, BackupNotice, BackupSummary } from '../../src/app/backupActions.ts';
import type { PickedFile, SaveTarget } from '../../src/app/localFiles.ts';
import { DEFAULT_SETTINGS } from '../../src/app/settings.ts';
import type { Settings } from '../../src/app/settings.ts';
import { encodeText } from '../../src/lib/encoding.ts';
import { createMemoryStorage } from '../../src/storage/memoryStorage.ts';
import { NEW_DOCUMENT_REV, StorageError } from '../../src/storage/storagePort.ts';
import type { StoragePort } from '../../src/storage/storagePort.ts';

const NOW = new Date(2026, 10, 17, 9, 5);
const TIMESTAMP = '2026-01-01T00:00:00.000Z';
const CURRENT_SETTINGS: Settings = { ...DEFAULT_SETTINGS, language: 'en' };
const BACKUP_SETTINGS: Settings = { language: 'ko', lineWrapping: false, editorFontSizeRem: 1.25 };

interface Harness {
  actions: BackupActions;
  storage: StoragePort;
  notices: BackupNotice[];
  /** Everything that happened, in order. */
  events: string[];
  /** Files handed over for saving. */
  saved: { name: string; text: string }[];
  saveOutcome: { value: SaveTarget | Error };
  /** The file the user picks; undefined means they back out. */
  picked: { file: PickedFile | undefined };
  summaries: BackupSummary[];
  mode: { value: ImportMode | undefined };
  replaceQuestions: number[];
  allowReplace: { value: boolean };
  savedSettings: Settings[];
  restarts: { count: number };
  stored(): Promise<[string, string, string][]>;
  /** A backup file with these documents, as the app would write it. */
  backupFile(documents: unknown[], extra?: Record<string, unknown>): PickedFile;
  fileOf(text: string): PickedFile;
}

async function createHarness(storage: StoragePort = createMemoryStorage()): Promise<Harness> {
  const notices: BackupNotice[] = [];
  const events: string[] = [];
  const saved: Harness['saved'] = [];
  const saveOutcome: Harness['saveOutcome'] = { value: { kind: 'downloaded' } };
  const picked: Harness['picked'] = { file: undefined };
  const summaries: BackupSummary[] = [];
  const mode: Harness['mode'] = { value: 'merge' };
  const replaceQuestions: number[] = [];
  const allowReplace = { value: true };
  const savedSettings: Settings[] = [];
  const restarts = { count: 0 };
  let idCount = 0;

  await storage.saveDocument({ id: 'a', title: 'Shopping', content: 'milk', createdAt: TIMESTAMP, updatedAt: TIMESTAMP }, NEW_DOCUMENT_REV);
  await storage.saveDocument({ id: 'b', title: 'Ideas', content: 'tests', createdAt: TIMESTAMP, updatedAt: TIMESTAMP }, NEW_DOCUMENT_REV);

  const fileOf = (text: string): PickedFile => ({ name: 'backup.json', size: text.length, read: async () => new TextEncoder().encode(text) });

  const actions = createBackupActions({
    storage,
    getSettings: () => CURRENT_SETTINGS,
    async saveSettings(settings) {
      savedSettings.push(settings);
    },
    async flushAll() {
      events.push('flush');
    },
    async saveAs(name, bytes) {
      events.push('save');
      if (saveOutcome.value instanceof Error) throw saveOutcome.value;
      saved.push({ name, text: new TextDecoder().decode(bytes) });
      return saveOutcome.value;
    },
    async pickFile() {
      events.push('pick');
      return picked.file;
    },
    async chooseMode(summary) {
      events.push('choose');
      summaries.push(summary);
      return mode.value;
    },
    async confirmReplace(storedCount) {
      events.push('confirm');
      replaceQuestions.push(storedCount);
      return allowReplace.value;
    },
    showBusy() {
      events.push('busy');
      return () => events.push('idle');
    },
    onNotice: (notice) => notices.push(notice),
    restart: () => {
      events.push('restart');
      restarts.count += 1;
    },
    now: () => NOW,
    createId: () => `new-${(idCount += 1)}`,
    buildId: '0.1.0+test',
    defaultTitle: 'New memo',
    copyTitle: (title) => `${title} (imported)`,
  });

  return {
    actions,
    storage,
    notices,
    events,
    saved,
    saveOutcome,
    picked,
    summaries,
    mode,
    replaceQuestions,
    allowReplace,
    savedSettings,
    restarts,
    async stored() {
      const { documents } = await storage.getAllDocuments();
      return documents.map((document): [string, string, string] => [document.meta.id, document.meta.title, document.content]).sort();
    },
    backupFile: (documents, extra = {}) =>
      fileOf(JSON.stringify({ app: 'ssMemo2', formatVersion: 1, exportedAt: '2026-10-01T00:00:00.000Z', settings: BACKUP_SETTINGS, documents, ...extra })),
    fileOf,
  };
}

const STORED_AT_START: [string, string, string][] = [
  ['a', 'Shopping', 'milk'],
  ['b', 'Ideas', 'tests'],
];

// --- export -----------------------------------------------------------------

test('exporting saves every stored memo and the settings as one file named after the time', async () => {
  const harness = await createHarness();
  await harness.actions.exportBackup();
  assert.equal(harness.saved.length, 1);
  assert.equal(harness.saved[0]?.name, 'ssMemo2-backup-20261117-0905.json');
  const parsed = parseBackup(harness.saved[0]?.text ?? '');
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.content.documents.map((document) => [document.id, document.title, document.content]), STORED_AT_START);
  assert.deepEqual(parsed.content.settings, CURRENT_SETTINGS);
  assert.deepEqual(harness.notices, [{ kind: 'backup-exported', documents: 2, unreadable: 0 }]);
});

test('exporting writes pending edits first, so the backup holds what is on screen', async () => {
  const harness = await createHarness();
  await harness.actions.exportBackup();
  assert.deepEqual(harness.events, ['flush', 'save']);
});

test('an empty storage can be exported too', async () => {
  const harness = await createHarness();
  await harness.storage.writeDocuments([], { replaceAll: true });
  await harness.actions.exportBackup();
  assert.deepEqual(harness.notices, [{ kind: 'backup-exported', documents: 0, unreadable: 0 }]);
});

test('exporting reports how many records could not be read', async () => {
  const storage = createMemoryStorage();
  const harness = await createHarness({
    ...storage,
    getAllDocuments: async () => ({ ...(await storage.getAllDocuments()), corruptCount: 3 }),
  });
  await harness.actions.exportBackup();
  assert.deepEqual(harness.notices, [{ kind: 'backup-exported', documents: 2, unreadable: 3 }]);
});

test('closing the save dialog reports nothing', async () => {
  const harness = await createHarness();
  harness.saveOutcome.value = { kind: 'cancelled' };
  await harness.actions.exportBackup();
  assert.deepEqual(harness.notices, []);
});

test('a failed export is reported, whether reading or writing failed', async () => {
  const writing = await createHarness();
  writing.saveOutcome.value = new Error('disk full');
  await writing.actions.exportBackup();
  assert.deepEqual(writing.notices, [{ kind: 'backup-export-failed' }]);

  const storage = createMemoryStorage();
  const reading = await createHarness({
    ...storage,
    getAllDocuments: async () => {
      throw new StorageError('connection-lost', 'closed');
    },
  });
  await reading.actions.exportBackup();
  assert.deepEqual(reading.notices, [{ kind: 'backup-export-failed' }]);
  assert.deepEqual(reading.saved, []);
});

// --- import: reading the file -----------------------------------------------

test('backing out of the file dialog does nothing', async () => {
  const harness = await createHarness();
  await harness.actions.importBackup();
  assert.deepEqual(harness.events, ['pick']);
  assert.deepEqual(harness.notices, []);
});

test('a file that is not a usable backup is refused with the reason, before anything is asked', async () => {
  const cases: [string, string][] = [
    ['some notes', 'not-json'],
    ['{"app":"other","documents":[]}', 'not-a-backup'],
    ['{"app":"ssMemo2","formatVersion":99,"documents":[]}', 'newer-format'],
  ];
  for (const [text, problem] of cases) {
    const harness = await createHarness();
    harness.picked.file = harness.fileOf(text);
    await harness.actions.importBackup();
    assert.deepEqual(harness.notices, [{ kind: 'backup-invalid', problem }], text);
    assert.equal(harness.events.includes('choose'), false);
    assert.deepEqual(await harness.stored(), STORED_AT_START);
  }
});

test('a backup without memos is reported instead of offering to replace everything with nothing', async () => {
  const harness = await createHarness();
  harness.picked.file = harness.backupFile([]);
  await harness.actions.importBackup();
  assert.deepEqual(harness.notices, [{ kind: 'backup-empty' }]);
  assert.equal(harness.events.includes('choose'), false);
});

test('a file that cannot be read is reported', async () => {
  const harness = await createHarness();
  harness.picked.file = {
    name: 'backup.json',
    size: 10,
    read: async () => {
      throw new Error('removed');
    },
  };
  await harness.actions.importBackup();
  assert.deepEqual(harness.notices, [{ kind: 'backup-unreadable-file' }]);
});

test('the busy indicator covers reading the file and is gone before any question is asked', async () => {
  const harness = await createHarness();
  harness.picked.file = harness.backupFile([{ id: 'c', title: 'C', content: 'x' }]);
  await harness.actions.importBackup();
  const { events } = harness;
  assert.deepEqual(events.slice(0, 3), ['pick', 'busy', 'idle']);
  assert.ok(events.indexOf('idle') < events.indexOf('choose'));

  const broken = await createHarness();
  broken.picked.file = broken.fileOf('not json');
  await broken.actions.importBackup();
  assert.deepEqual(broken.events, ['pick', 'busy', 'idle']);
});

test('a backup that an editor re-saved as UTF-16 or with a byte order mark is still read', async () => {
  for (const encoding of ['UTF-8', 'UTF-16LE', 'UTF-16BE'] as const) {
    const harness = await createHarness();
    const text = JSON.stringify({ app: 'ssMemo2', documents: [{ id: 'c', title: 'C', content: 'x' }] });
    harness.picked.file = { name: 'backup.json', size: 1, read: async () => encodeText(text, encoding, true) };
    await harness.actions.importBackup();
    assert.deepEqual(harness.notices, [{ kind: 'backup-imported', added: 1, copied: 0, unchanged: 0, skipped: 0 }], encoding);
  }
});

// --- import: merge ----------------------------------------------------------

test('the user is told what the backup holds and what is stored before choosing', async () => {
  const harness = await createHarness();
  harness.picked.file = harness.backupFile([{ id: 'c', content: 'x' }, { id: 'd', content: 'y' }, 'junk']);
  harness.mode.value = undefined;
  await harness.actions.importBackup();
  assert.deepEqual(harness.summaries, [{ documents: 2, skipped: 1, exportedAt: '2026-10-01T00:00:00.000Z', stored: 2 }]);
  // Backing out here changes nothing.
  assert.deepEqual(await harness.stored(), STORED_AT_START);
  assert.deepEqual(harness.notices, []);
});

test('merging adds new memos, keeps the stored ones and leaves the settings alone', async () => {
  const harness = await createHarness();
  harness.picked.file = harness.backupFile([
    { id: 'c', title: 'New one', content: 'from the backup' },
    { id: 'a', title: 'Shopping', content: 'milk' },
    { id: 'b', title: 'Ideas', content: 'an older version' },
    'junk',
  ]);
  await harness.actions.importBackup();
  assert.deepEqual(await harness.stored(), [
    ...STORED_AT_START,
    ['c', 'New one', 'from the backup'],
    ['new-1', 'Ideas (imported)', 'an older version'],
  ]);
  assert.deepEqual(harness.notices, [{ kind: 'backup-imported', added: 1, copied: 1, unchanged: 1, skipped: 1 }]);
  assert.deepEqual(harness.savedSettings, []);
  assert.equal(harness.restarts.count, 0);
  assert.deepEqual(harness.replaceQuestions, []);
});

test('pending edits are written before the storage is compared with the backup', async () => {
  const harness = await createHarness();
  harness.picked.file = harness.backupFile([{ id: 'c', content: 'x' }]);
  await harness.actions.importBackup();
  assert.ok(harness.events.indexOf('flush') < harness.events.indexOf('choose'));
});

// --- import: replace --------------------------------------------------------

test('replacing asks once more, naming how many memos will be deleted', async () => {
  const harness = await createHarness();
  harness.picked.file = harness.backupFile([{ id: 'c', title: 'Only', content: 'backup' }]);
  harness.mode.value = 'replace';
  harness.allowReplace.value = false;
  await harness.actions.importBackup();
  assert.deepEqual(harness.replaceQuestions, [2]);
  assert.deepEqual(await harness.stored(), STORED_AT_START);
  assert.equal(harness.restarts.count, 0);
  assert.deepEqual(harness.notices, []);
});

test('replacing leaves exactly the backup, takes over its settings and restarts the page', async () => {
  const harness = await createHarness();
  harness.picked.file = harness.backupFile([
    { id: 'a', title: 'Shopping', content: 'as it was back then' },
    { id: 'c', title: 'Only in the backup', content: 'x' },
  ]);
  harness.mode.value = 'replace';
  await harness.actions.importBackup();
  assert.deepEqual(await harness.stored(), [
    ['a', 'Shopping', 'as it was back then'],
    ['c', 'Only in the backup', 'x'],
  ]);
  assert.deepEqual(harness.savedSettings, [BACKUP_SETTINGS]);
  assert.equal(harness.restarts.count, 1);
  // The page is about to be rebuilt; settings must be stored before that.
  assert.equal(harness.events.at(-1), 'restart');
});

test('replacing an empty storage needs no second question', async () => {
  const harness = await createHarness();
  await harness.storage.writeDocuments([], { replaceAll: true });
  harness.picked.file = harness.backupFile([{ id: 'c', title: 'C', content: 'x' }]);
  harness.mode.value = 'replace';
  await harness.actions.importBackup();
  assert.deepEqual(harness.replaceQuestions, []);
  assert.deepEqual(await harness.stored(), [['c', 'C', 'x']]);
});

test('a backup without settings keeps the current ones when replacing', async () => {
  const harness = await createHarness();
  harness.picked.file = harness.fileOf(JSON.stringify({ app: 'ssMemo2', documents: [{ id: 'c', content: 'x' }] }));
  harness.mode.value = 'replace';
  await harness.actions.importBackup();
  assert.deepEqual(harness.savedSettings, []);
  assert.equal(harness.restarts.count, 1);
});

test('when the import cannot be written, nothing changes and the user is told', async () => {
  for (const mode of ['merge', 'replace'] as const) {
    const storage = createMemoryStorage();
    const harness = await createHarness({
      ...storage,
      writeDocuments: async () => {
        throw new StorageError('quota', 'full');
      },
    });
    harness.picked.file = harness.backupFile([{ id: 'c', title: 'C', content: 'x' }]);
    harness.mode.value = mode;
    await harness.actions.importBackup();
    assert.deepEqual(harness.notices, [{ kind: 'backup-import-failed' }], mode);
    assert.deepEqual(await harness.stored(), STORED_AT_START);
    assert.equal(harness.restarts.count, 0);
    assert.deepEqual(harness.savedSettings, []);
  }
});

// --- calculator variables ---------------------------------------------------

const STORED_VARIABLES = { rate: { big: '1250' } };
const BACKUP_VARIABLES = { rate: { big: '900' }, ratio: { num: 0.5 } };

test('exporting includes the stored calculator variables', async () => {
  const harness = await createHarness();
  await harness.storage.setValue(CALC_MEMORY_KEY, STORED_VARIABLES);
  await harness.actions.exportBackup();
  const parsed = parseBackup(harness.saved[0]?.text ?? '');
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.content.calcMemory, STORED_VARIABLES);
});

test('exporting works when no variables were ever stored, or what is stored is damaged', async () => {
  for (const stored of [undefined, 'garbage', { broken: { big: 'x' } }]) {
    const harness = await createHarness();
    if (stored !== undefined) await harness.storage.setValue(CALC_MEMORY_KEY, stored);
    await harness.actions.exportBackup();
    const parsed = parseBackup(harness.saved[0]?.text ?? '');
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.content.calcMemory, {});
    assert.equal(harness.notices[0]?.kind, 'backup-exported');
  }
});

test('replacing takes over the calculator variables of the backup, adding leaves them as they are', async () => {
  const replacing = await createHarness();
  await replacing.storage.setValue(CALC_MEMORY_KEY, STORED_VARIABLES);
  replacing.picked.file = replacing.backupFile([{ id: 'c', content: 'x' }], { calcMemory: BACKUP_VARIABLES });
  replacing.mode.value = 'replace';
  await replacing.actions.importBackup();
  assert.deepEqual(await replacing.storage.getValue(CALC_MEMORY_KEY), BACKUP_VARIABLES);

  const adding = await createHarness();
  await adding.storage.setValue(CALC_MEMORY_KEY, STORED_VARIABLES);
  adding.picked.file = adding.backupFile([{ id: 'c', content: 'x' }], { calcMemory: BACKUP_VARIABLES });
  await adding.actions.importBackup();
  assert.deepEqual(await adding.storage.getValue(CALC_MEMORY_KEY), STORED_VARIABLES);
});

test('replacing with a backup that has no calculator variables keeps the current ones', async () => {
  const harness = await createHarness();
  await harness.storage.setValue(CALC_MEMORY_KEY, STORED_VARIABLES);
  harness.picked.file = harness.backupFile([{ id: 'c', content: 'x' }]);
  harness.mode.value = 'replace';
  await harness.actions.importBackup();
  assert.deepEqual(await harness.storage.getValue(CALC_MEMORY_KEY), STORED_VARIABLES);
  assert.equal(harness.restarts.count, 1);
});

test('a failure to store the variables does not undo a replace that already happened', async () => {
  const storage = createMemoryStorage();
  const harness = await createHarness({
    ...storage,
    setValue: async (key, value) => {
      if (key === CALC_MEMORY_KEY) throw new StorageError('quota', 'full');
      return storage.setValue(key, value);
    },
  });
  harness.picked.file = harness.backupFile([{ id: 'c', title: 'C', content: 'x' }], { calcMemory: BACKUP_VARIABLES });
  harness.mode.value = 'replace';
  await harness.actions.importBackup();
  assert.deepEqual(await harness.stored(), [['c', 'C', 'x']]);
  assert.equal(harness.restarts.count, 1);
});
