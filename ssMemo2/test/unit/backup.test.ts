import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_FORMAT_VERSION, backupFileName, createBackup, parseBackup, planImport, serializeBackup } from '../../src/app/backup.ts';
import type { BackupContent, BackupInput, ImportContext, ImportedDocument } from '../../src/app/backup.ts';
import { MAX_TITLE_LENGTH, findTitleProblem } from '../../src/app/documentStore.ts';
import { DEFAULT_SETTINGS } from '../../src/app/settings.ts';
import type { DocumentSource, StoredDocument } from '../../src/storage/storagePort.ts';

const EXPORTED_AT = new Date(Date.UTC(2026, 10, 17, 3, 4, 5));
const SOURCE: DocumentSource = { fileName: 'notes.txt', encoding: 'CP949', eol: 'crlf', hasBom: false };

function stored(id: string, content: string, createdAt: string, source?: DocumentSource): StoredDocument {
  const meta = { id, title: `title of ${id}`, createdAt, updatedAt: '2026-06-01T00:00:00.000Z', length: content.length, rev: 7 };
  return { meta: source ? { ...meta, source } : meta, content };
}

function input(documents: StoredDocument[]): BackupInput {
  return { documents, settings: { ...DEFAULT_SETTINGS, language: 'ko' }, exportedAt: EXPORTED_AT, buildId: '0.1.0+abc' };
}

test('a backup says what it is, when it was made and by which build', () => {
  const backup = createBackup(input([]));
  assert.equal(backup.app, 'ssMemo2');
  assert.equal(backup.formatVersion, BACKUP_FORMAT_VERSION);
  assert.equal(backup.exportedAt, '2026-11-17T03:04:05.000Z');
  assert.equal(backup.appBuild, '0.1.0+abc');
  assert.deepEqual(backup.documents, []);
});

test('a backup holds every document with its text and the file it came from', () => {
  const backup = createBackup(input([stored('a', 'memo text', '2026-01-01T00:00:00.000Z'), stored('b', 'file text', '2026-01-02T00:00:00.000Z', SOURCE)]));
  assert.deepEqual(backup.documents, [
    { id: 'a', title: 'title of a', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z', content: 'memo text' },
    { id: 'b', title: 'title of b', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z', content: 'file text', source: SOURCE },
  ]);
});

test('a backup leaves out what the storage derives itself', () => {
  // Revision and length would only invite inconsistencies when a backup is edited by hand.
  const [document] = createBackup(input([stored('a', 'text', '2026-01-01T00:00:00.000Z')])).documents;
  assert.ok(document);
  assert.equal('rev' in document, false);
  assert.equal('length' in document, false);
});

test('documents are listed oldest first, whatever order the storage returned them in', () => {
  // A stable order keeps two backups of the same data comparable.
  const documents = [
    stored('c', '', '2026-03-01T00:00:00.000Z'),
    stored('b', '', '2026-01-01T00:00:00.000Z'),
    stored('a', '', '2026-01-01T00:00:00.000Z'),
  ];
  assert.deepEqual(createBackup(input(documents)).documents.map((document) => document.id), ['a', 'b', 'c']);
  assert.deepEqual(documents.map((document) => document.meta.id), ['c', 'b', 'a']);
});

test('a backup carries the settings', () => {
  assert.deepEqual(createBackup(input([])).settings, { ...DEFAULT_SETTINGS, language: 'ko' });
});

test('a backup shares nothing with the documents it was made from', () => {
  const original = stored('b', 'text', '2026-01-01T00:00:00.000Z', { ...SOURCE });
  const backup = createBackup(input([original]));
  const source = backup.documents[0]?.source;
  assert.ok(source);
  source.fileName = 'changed';
  assert.equal(original.meta.source?.fileName, 'notes.txt');
});

test('the serialized backup is indented JSON that reads back identically', () => {
  const backup = createBackup(input([stored('a', 'line one\nline two', '2026-01-01T00:00:00.000Z', SOURCE)]));
  const text = serializeBackup(backup);
  assert.deepEqual(JSON.parse(text), backup);
  // Indented and one field per line, so a person can read and edit it.
  assert.match(text, /^\{\n  "app": "ssMemo2",\n  "formatVersion": 1,\n/);
  assert.ok(text.endsWith('}\n'));
});

test('text of any kind survives serialization', () => {
  const samples = ['', 'tab\there', 'quote " and backslash \\', 'emoji \u{1F600}', 'x\uD83Dy', '</script>', 'a\r\nb'];
  const documents = samples.map((content, index) => stored(`id-${index}`, content, '2026-01-01T00:00:00.000Z'));
  const parsed = JSON.parse(serializeBackup(createBackup(input(documents)))) as { documents: { content: string }[] };
  assert.deepEqual(parsed.documents.map((document) => document.content), samples);
});

test('Korean text is written as it is, not as escape codes', () => {
  const korean = String.fromCharCode(0xd55c, 0xae00);
  const text = serializeBackup(createBackup(input([stored('a', korean, '2026-01-01T00:00:00.000Z')])));
  assert.ok(text.includes(korean));
});

test('the backup file is named after the local date and time it was made', () => {
  // Built from local time parts, so the expectation holds in every time zone.
  assert.equal(backupFileName(new Date(2026, 10, 17, 9, 5)), 'ssMemo2-backup-20261117-0905.json');
  assert.equal(backupFileName(new Date(2026, 0, 1, 0, 0)), 'ssMemo2-backup-20260101-0000.json');
  assert.equal(backupFileName(new Date(2026, 11, 31, 23, 59)), 'ssMemo2-backup-20261231-2359.json');
});

// --- parseBackup ------------------------------------------------------------

function parsed(value: unknown): BackupContent {
  const result = parseBackup(typeof value === 'string' ? value : JSON.stringify(value));
  assert.ok(result.ok, `expected a readable backup, got ${JSON.stringify(result)}`);
  return result.content;
}

function problemOf(value: unknown): string {
  const result = parseBackup(typeof value === 'string' ? value : JSON.stringify(value));
  assert.equal(result.ok, false);
  return result.ok ? '' : result.problem;
}

test('a backup that was just written reads back with everything in it', () => {
  const backup = createBackup(input([stored('a', 'memo text', '2026-01-01T00:00:00.000Z'), stored('b', 'file text', '2026-01-02T00:00:00.000Z', SOURCE)]));
  const content = parsed(serializeBackup(backup));
  assert.equal(content.exportedAt, '2026-11-17T03:04:05.000Z');
  assert.equal(content.skippedDocuments, 0);
  assert.deepEqual(content.settings, { ...DEFAULT_SETTINGS, language: 'ko' });
  assert.deepEqual(content.documents, [
    { id: 'a', title: 'title of a', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z', content: 'memo text', source: undefined },
    { id: 'b', title: 'title of b', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z', content: 'file text', source: SOURCE },
  ]);
});

test('text that is not JSON is told apart from JSON that is not a backup', () => {
  assert.equal(problemOf(''), 'not-json');
  assert.equal(problemOf('just some notes'), 'not-json');
  assert.equal(problemOf('{"app": "ssMemo2", "documents": ['), 'not-json');
  for (const value of [null, 42, [], {}, { documents: [] }, { app: 'other', documents: [] }, { app: 'ssMemo2' }, { app: 'ssMemo2', documents: {} }]) {
    assert.equal(problemOf(value), 'not-a-backup', JSON.stringify(value));
  }
  // A JSON string, as opposed to text that is not JSON (the helper passes strings through as they are).
  assert.equal(problemOf('"text"'), 'not-a-backup');
});

test('a backup in a newer format is refused rather than half-read', () => {
  assert.equal(problemOf({ app: 'ssMemo2', formatVersion: BACKUP_FORMAT_VERSION + 1, documents: [] }), 'newer-format');
});

test('a backup without a format version, or with a nonsensical one, is read as the current format', () => {
  for (const formatVersion of [undefined, null, 'one', 0, -1]) {
    assert.deepEqual(parsed({ app: 'ssMemo2', formatVersion, documents: [] }).documents, [], String(formatVersion));
  }
});

test('the smallest backup a person could write by hand is accepted', () => {
  const content = parsed('{ "app": "ssMemo2", "documents": [ { "content": "typed by hand" } ] }');
  assert.deepEqual(content, {
    exportedAt: undefined,
    settings: undefined,
    skippedDocuments: 0,
    documents: [{ id: undefined, title: undefined, createdAt: undefined, updatedAt: undefined, content: 'typed by hand', source: undefined }],
  });
});

test('entries without text are skipped and counted, the rest is kept', () => {
  const content = parsed({
    app: 'ssMemo2',
    documents: [{ id: 'good', content: 'kept' }, null, 'text', 42, [], {}, { id: 'no-content', title: 't' }, { id: 'bad-content', content: 5 }, { id: 'empty', content: '' }],
  });
  assert.deepEqual(content.documents.map((document) => document.id), ['good', 'empty']);
  // null, 'text', 42, [], {}, and the two entries whose content is missing or not text.
  assert.equal(content.skippedDocuments, 7);
});

test('fields of the wrong kind are dropped one by one instead of losing the document', () => {
  const [document] = parsed({
    app: 'ssMemo2',
    documents: [{ id: 7, title: ['x'], createdAt: 'yesterday', updatedAt: 12345, content: 'text', source: { fileName: 'a.txt', encoding: 'EBCDIC' } }],
  }).documents;
  assert.deepEqual(document, { id: undefined, title: undefined, createdAt: undefined, updatedAt: undefined, content: 'text', source: undefined });
  const [blankId] = parsed({ app: 'ssMemo2', documents: [{ id: '', content: 'text' }] }).documents;
  assert.equal(blankId?.id, undefined);
});

test('unknown fields are ignored, so a backup from a later version with additions still loads', () => {
  const content = parsed({
    app: 'ssMemo2',
    formatVersion: BACKUP_FORMAT_VERSION,
    futureSection: { anything: true },
    documents: [{ id: 'a', content: 'text', futureField: 1 }],
  });
  assert.deepEqual(Object.keys(content.documents[0] ?? {}).sort(), ['content', 'createdAt', 'id', 'source', 'title', 'updatedAt']);
});

test('damaged settings fall back field by field, and settings of the wrong kind are left out', () => {
  const partly = parsed({ app: 'ssMemo2', documents: [], settings: { language: 'klingon', lineWrapping: false } });
  assert.deepEqual(partly.settings, { ...DEFAULT_SETTINGS, lineWrapping: false });
  assert.equal(parsed({ app: 'ssMemo2', documents: [], settings: 'dark' }).settings, undefined);
  assert.equal(parsed({ app: 'ssMemo2', documents: [], exportedAt: 'some day' }).exportedAt, undefined);
});

test('a byte order mark in front of the JSON does not make it unreadable', () => {
  assert.deepEqual(parsed(`${String.fromCharCode(0xfeff)}{"app":"ssMemo2","documents":[]}`).documents, []);
});

// --- planImport -------------------------------------------------------------

const NOW = new Date(Date.UTC(2026, 10, 17, 12, 0, 0));

function imported(overrides: Partial<ImportedDocument> & { content: string }): ImportedDocument {
  return { id: undefined, title: undefined, createdAt: undefined, updatedAt: undefined, source: undefined, ...overrides };
}

function context(mode: ImportContext['mode'], existing: StoredDocument[] = []): ImportContext {
  let count = 0;
  return { mode, existing, now: NOW, createId: () => `new-${(count += 1)}`, defaultTitle: 'New memo', copyTitle: (title) => `${title} (imported)` };
}

test('replacing writes every document of the backup under its own id', () => {
  const plan = planImport(
    [imported({ id: 'a', title: 'A', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z', content: 'one', source: SOURCE })],
    context('replace', [stored('a', 'something else', '2025-01-01T00:00:00.000Z'), stored('z', 'will be removed', '2025-01-01T00:00:00.000Z')]),
  );
  assert.deepEqual(plan, {
    drafts: [{ id: 'a', title: 'A', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z', content: 'one', source: SOURCE }],
    added: 1,
    copied: 0,
    unchanged: 0,
  });
});

test('a document without a source gets no source field', () => {
  const [draft] = planImport([imported({ id: 'a', content: 'x' })], context('replace')).drafts;
  assert.ok(draft);
  assert.equal('source' in draft, false);
});

test('missing pieces are filled in: an id, a title and the time of the import', () => {
  const plan = planImport([imported({ content: 'typed by hand' })], context('merge'));
  assert.deepEqual(plan.drafts, [
    { id: 'new-1', title: 'New memo', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), content: 'typed by hand' },
  ]);
  assert.equal(plan.added, 1);
});

test('a title that the app would not accept is fitted', () => {
  const plan = planImport(
    [imported({ id: 'a', title: 'x'.repeat(300), content: '' }), imported({ id: 'b', title: 'two\nlines', content: '' }), imported({ id: 'c', title: '   ', content: '' })],
    context('replace'),
  );
  assert.deepEqual(plan.drafts.map((draft) => draft.title), ['x'.repeat(MAX_TITLE_LENGTH), 'two lines', 'New memo']);
});

test('merging adds documents whose id is not stored yet', () => {
  const plan = planImport([imported({ id: 'b', title: 'B', content: 'new' })], context('merge', [stored('a', 'kept', '2026-01-01T00:00:00.000Z')]));
  assert.deepEqual(plan.drafts.map((draft) => draft.id), ['b']);
  assert.deepEqual([plan.added, plan.copied, plan.unchanged], [1, 0, 0]);
});

test('merging leaves out a document that is already stored exactly like that', () => {
  const existing = stored('a', 'same text', '2026-01-01T00:00:00.000Z', SOURCE);
  const plan = planImport(
    [imported({ id: 'a', title: 'title of a', content: 'same text', source: { ...SOURCE } })],
    context('merge', [existing]),
  );
  assert.deepEqual(plan, { drafts: [], added: 0, copied: 0, unchanged: 1 });
});

test('merging never overwrites: a different document with a stored id is imported as a copy', () => {
  const existing = [stored('a', 'edited since the backup', '2026-01-01T00:00:00.000Z')];
  const differentText = planImport([imported({ id: 'a', title: 'title of a', content: 'text in the backup' })], context('merge', existing));
  assert.deepEqual(differentText.drafts.map((draft) => [draft.id, draft.title, draft.content]), [['new-1', 'title of a (imported)', 'text in the backup']]);
  assert.deepEqual([differentText.added, differentText.copied, differentText.unchanged], [0, 1, 0]);

  const differentTitle = planImport([imported({ id: 'a', title: 'old title', content: 'edited since the backup' })], context('merge', existing));
  assert.equal(differentTitle.copied, 1);
  const differentSource = planImport([imported({ id: 'a', title: 'title of a', content: 'edited since the backup', source: SOURCE })], context('merge', existing));
  assert.equal(differentSource.copied, 1);
});

test('the title of a copy stays within the allowed length', () => {
  const longTitle = 'x'.repeat(MAX_TITLE_LENGTH);
  const existing = [{ meta: { id: 'a', title: longTitle, createdAt: 't', updatedAt: 't', length: 1, rev: 1 }, content: 'stored' }];
  const [draft] = planImport([imported({ id: 'a', title: longTitle, content: 'backup' })], context('merge', existing)).drafts;
  assert.equal(findTitleProblem(draft?.title ?? ''), undefined);
});

test('ids that repeat inside the backup do not overwrite each other', () => {
  const plan = planImport([imported({ id: 'a', content: 'first' }), imported({ id: 'a', content: 'second' })], context('replace'));
  assert.deepEqual(plan.drafts.map((draft) => [draft.id, draft.content]), [['a', 'first'], ['new-1', 'second']]);
  assert.equal(plan.added, 2);
});

test('a generated id never collides with a stored one or one from the backup', () => {
  // The generator hands out "new-1" first, which is taken both times.
  const merge = planImport([imported({ content: 'x' })], context('merge', [stored('new-1', 'stored', '2026-01-01T00:00:00.000Z')]));
  assert.deepEqual(merge.drafts.map((draft) => draft.id), ['new-2']);
  const replace = planImport([imported({ id: 'new-1', content: 'x' }), imported({ content: 'y' })], context('replace'));
  assert.deepEqual(replace.drafts.map((draft) => draft.id), ['new-1', 'new-2']);
});

test('an empty backup plans nothing', () => {
  assert.deepEqual(planImport([], context('merge', [stored('a', 'x', '2026-01-01T00:00:00.000Z')])), { drafts: [], added: 0, copied: 0, unchanged: 0 });
  assert.deepEqual(planImport([], context('replace')), { drafts: [], added: 0, copied: 0, unchanged: 0 });
});
