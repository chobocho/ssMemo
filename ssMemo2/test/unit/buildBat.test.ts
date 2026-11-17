// build.bat must be cp949 + CRLF so Korean messages are readable in a Windows console.
// A UTF-8 editor or a git line-ending conversion would silently break that, so the committed
// bytes are checked against the UTF-8 template they are generated from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeCp949, renderBuildBat } from '../../scripts/buildBat.ts';

const rootDir = fileURLToPath(new URL('../../', import.meta.url));
const CR = 0x0d;
const LF = 0x0a;
const ASCII_LIMIT = 0x80;

function decodeCp949(bytes: Uint8Array): string {
  return new TextDecoder('euc-kr', { fatal: true }).decode(bytes);
}

function readTemplate(): string {
  return readFileSync(rootDir + 'scripts/build.bat.template', 'utf8');
}

function readBuildBat(): Buffer {
  return readFileSync(rootDir + 'build.bat');
}

// --- encodeCp949 ------------------------------------------------------------

test('encodeCp949 passes ASCII through unchanged', () => {
  assert.deepEqual([...encodeCp949('@echo off\r\n')], [...Buffer.from('@echo off\r\n', 'ascii')]);
});

test('encodeCp949 encodes Hangul syllables as two-byte sequences', () => {
  assert.deepEqual([...encodeCp949('가')], [0xb0, 0xa1]);
  assert.deepEqual([...encodeCp949('한글')], [0xc7, 0xd1, 0xb1, 0xdb]);
});

test('encodeCp949 handles mixed ASCII and Hangul', () => {
  assert.deepEqual([...encodeCp949('a가b')], [0x61, 0xb0, 0xa1, 0x62]);
});

test('encodeCp949 returns no bytes for an empty string', () => {
  assert.equal(encodeCp949('').length, 0);
});

test('encodeCp949 round-trips through the platform decoder', () => {
  const text = '[ssMemo2] 빌드 완료: release\\index.html';
  assert.equal(decodeCp949(encodeCp949(text)), text);
});

test('encodeCp949 rejects characters it cannot represent and names them', () => {
  // U+B620 exists only in the cp949 extension area, which the reverse table does not cover.
  assert.throws(() => encodeCp949('똠'), /똠/);
  assert.throws(() => encodeCp949('ok 🙂'), /🙂/);
});

// --- renderBuildBat ---------------------------------------------------------

test('renderBuildBat converts LF line endings to CRLF', () => {
  assert.deepEqual([...renderBuildBat('a\nb\n')], [0x61, CR, LF, 0x62, CR, LF]);
});

test('renderBuildBat does not double the CR of an existing CRLF', () => {
  assert.deepEqual([...renderBuildBat('a\r\nb\n')], [0x61, CR, LF, 0x62, CR, LF]);
});

// --- committed build.bat ----------------------------------------------------

test('build.bat is exactly what the template renders to', () => {
  assert.deepEqual([...readBuildBat()], [...renderBuildBat(readTemplate())]);
});

test('build.bat decodes strictly as cp949 and has no byte-order mark', () => {
  const bytes = readBuildBat();
  assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(decodeCp949(bytes), readTemplate().replace(/\r?\n/g, '\r\n'));
});

test('build.bat ends every line with CRLF', () => {
  const bytes = readBuildBat();
  assert.equal(bytes.at(-1), LF);
  bytes.forEach((byte, index) => {
    if (byte === LF) assert.equal(bytes[index - 1], CR, `lone LF at byte ${index}`);
  });
});

test('build.bat contains Korean text, so the encoding actually matters', () => {
  assert.equal(readBuildBat().some((byte) => byte >= ASCII_LIMIT), true);
});

test('build.bat switches the console to code page 949 before any Korean byte', () => {
  const bytes = readBuildBat();
  const firstNonAscii = bytes.findIndex((byte) => byte >= ASCII_LIMIT);
  const chcp = bytes.indexOf('chcp 949', 0, 'ascii');
  assert.equal(chcp >= 0, true);
  assert.equal(chcp < firstNonAscii, true);
});

test('build.bat calls npm through "call" and stops on the first failing step', () => {
  const lines = readTemplate().split('\n').map((line) => line.trim());
  const npmLines = lines.filter((line) => /\bnpm\b/.test(line) && !/^(rem|echo)\b/i.test(line));
  assert.equal(npmLines.length > 0, true);
  for (const line of npmLines) {
    // Without "call", control never returns from npm.cmd and the rest of the script is skipped.
    assert.match(line, /^call npm\b/);
  }
  // Every step that can fail must be followed directly by an errorlevel check.
  lines.forEach((line, index) => {
    if (/^(call npm|copy|mkdir|pushd)\b/i.test(line) || /\bmkdir\b/i.test(line)) {
      assert.match(lines[index + 1] ?? '', /^if errorlevel 1\b/i, `no errorlevel check after: ${line}`);
    }
  });
});

test('build.bat copies only index.html into the release folder', () => {
  const copyLines = readTemplate().split('\n').filter((line) => /^\s*(copy|xcopy|robocopy)\b/i.test(line));
  assert.equal(copyLines.length, 1);
  assert.match(copyLines[0] ?? '', /dist\\index\.html/);
  assert.match(copyLines[0] ?? '', /%RELEASE_DIR%\\index\.html/);
});

test('.gitattributes keeps git from converting build.bat', () => {
  const attributes = readFileSync(rootDir + '.gitattributes', 'utf8');
  assert.match(attributes, /^build\.bat\s+-text$/m);
});
