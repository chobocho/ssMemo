// Guards against accidentally quadratic code on the paths a large file takes: opening, editing,
// saving and backing up. The limits are far above what was measured (see history.html, item 4.9)
// so the tests do not fail on a slow machine; what they catch is a step that suddenly takes many
// seconds, as string building per character did in ssMemoWeb. Real rendering speed can only be
// judged in a browser and is part of the manual checklist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, parseBackup, planImport, serializeBackup } from '../../src/app/backup.ts';
import { DEFAULT_SETTINGS } from '../../src/app/settings.ts';
import { createEditorState, getEditorStats } from '../../src/editor/editorSetup.ts';
import { decodeText } from '../../src/lib/encoding.ts';
import type { TextEncoding } from '../../src/lib/encoding.ts';
import { readTextFile, writeTextFile } from '../../src/lib/textFile.ts';
import type { StoredDocument } from '../../src/storage/storagePort.ts';

const FIVE_MEBIBYTES = 5 * 1024 * 1024;
const STEP_LIMIT_MS = 2500;

// One line of mixed Korean and ASCII text ending in CR LF, in each encoding.
const LINE_HEX: Readonly<Record<'UTF-8' | 'CP949' | 'Johab', string>> = {
  'UTF-8': 'ec9588eb8595ed9598ec84b8ec9a942c2054686520717569636b2062726f776e20666f782e0d0a',
  CP949: 'bec8b3e7c7cfbcbcbfe42c2054686520717569636b2062726f776e20666f782e0d0a',
  Johab: 'b4659177d061ad41b6612c2054686520717569636b2062726f776e20666f782e0d0a',
};
// Characters per line, counted from the line itself rather than typed in by hand.
const LINE_LENGTH = new TextDecoder().decode(Buffer.from(LINE_HEX['UTF-8'], 'hex')).length;

function repeatToSize(unit: Uint8Array, size: number): Uint8Array {
  const result = new Uint8Array(Math.floor(size / unit.length) * unit.length);
  for (let offset = 0; offset < result.length; offset += unit.length) result.set(unit, offset);
  return result;
}

function bigFile(encoding: keyof typeof LINE_HEX): Uint8Array {
  return repeatToSize(new Uint8Array(Buffer.from(LINE_HEX[encoding], 'hex')), FIVE_MEBIBYTES);
}

function timed<T>(work: () => T): { result: T; elapsedMs: number } {
  const startedAt = performance.now();
  const result = work();
  return { result, elapsedMs: performance.now() - startedAt };
}

function assertFast(label: string, elapsedMs: number): void {
  assert.ok(elapsedMs < STEP_LIMIT_MS, `${label} took ${elapsedMs.toFixed(0)} ms`);
}

for (const encoding of ['UTF-8', 'CP949', 'Johab'] as const) {
  test(`a 5 MB ${encoding} file is detected and decoded quickly`, () => {
    const bytes = bigFile(encoding);
    const { result, elapsedMs } = timed(() => readTextFile(bytes));
    const expected: TextEncoding = encoding;
    assert.equal(result.format.encoding, expected);
    assert.equal(result.format.eol, 'crlf');
    assert.equal(result.text.length, (bytes.length / (LINE_HEX[encoding].length / 2)) * LINE_LENGTH);
    assert.ok(result.text.endsWith('fox.\r\n'));
    assertFast(`decoding ${encoding}`, elapsedMs);
  });
}

test('a 5 MB UTF-16 file is decoded quickly', () => {
  const text = 'The quick brown fox.\r\n'.repeat(Math.floor(FIVE_MEBIBYTES / 44));
  const bytes = writeTextFile(text, { encoding: 'UTF-16LE', eol: 'crlf', hasBom: true });
  const { result, elapsedMs } = timed(() => decodeText(bytes));
  assert.equal(result.encoding, 'UTF-16LE');
  assert.equal(result.text.length, text.length);
  assertFast('decoding UTF-16', elapsedMs);
});

test('a 5 MB text opens in the editor, is read back and written to a file quickly', () => {
  const { text } = readTextFile(bigFile('UTF-8'));

  const opened = timed(() => createEditorState(text));
  assertFast('creating the editor state', opened.elapsedMs);
  // What every autosave and every save to a file starts with.
  const readBack = timed(() => opened.result.doc.toString());
  assertFast('reading the text back', readBack.elapsedMs);
  assert.equal(readBack.result.length, text.length - text.length / LINE_LENGTH);
  // Runs on every key press and cursor movement.
  assertFast('status bar facts', timed(() => getEditorStats(opened.result)).elapsedMs);

  for (const encoding of ['UTF-8', 'UTF-16LE'] as const) {
    const written = timed(() => writeTextFile(readBack.result, { encoding, eol: 'crlf', hasBom: true }));
    assertFast(`writing ${encoding}`, written.elapsedMs);
    assert.ok(written.result.length >= FIVE_MEBIBYTES / 2);
  }
});

test('a 5 MB memo goes into a backup and comes out again quickly', () => {
  const { text } = readTextFile(bigFile('UTF-8'));
  const timestamp = '2026-01-01T00:00:00.000Z';
  const stored: StoredDocument[] = [{ meta: { id: 'a', title: 'big', createdAt: timestamp, updatedAt: timestamp, length: text.length, rev: 1 }, content: text }];

  const exported = timed(() =>
    new TextEncoder().encode(serializeBackup(createBackup({ documents: stored, settings: DEFAULT_SETTINGS, calcMemory: {}, exportedAt: new Date(0), buildId: 'test' }))),
  );
  assertFast('exporting', exported.elapsedMs);

  const imported = timed(() => {
    const parsed = parseBackup(decodeText(exported.result).text);
    assert.ok(parsed.ok);
    return planImport(parsed.content.documents, {
      mode: 'merge',
      existing: stored,
      now: new Date(0),
      createId: () => 'new',
      defaultTitle: 'memo',
      copyTitle: (title) => title,
    });
  });
  assertFast('importing', imported.elapsedMs);
  // The same text came back, so merging recognizes it as already there.
  assert.equal(imported.result.unchanged, 1);
});
