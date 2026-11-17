import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_FORMAT_VERSION, backupFileName, createBackup, serializeBackup } from '../../src/app/backup.ts';
import type { BackupInput } from '../../src/app/backup.ts';
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
