// Runs build.sh for real into a temporary folder: the release folder must receive index.html only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('../../', import.meta.url));
const buildScript = join(rootDir, 'build.sh');
const EXECUTABLE_BITS = 0o111;

function withTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'ssmemo2-build-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('build.sh is an executable POSIX script with LF line endings', () => {
  assert.equal((statSync(buildScript).mode & EXECUTABLE_BITS) !== 0, true);
  const text = readFileSync(buildScript, 'utf8');
  assert.equal(text.startsWith('#!/bin/sh\n'), true);
  assert.equal(text.includes('\r'), false);
  // "sh -n" parses without executing; it fails on a syntax error.
  execFileSync('sh', ['-n', buildScript]);
});

test('build.sh puts only index.html into the given release folder', () => {
  withTempDir((dir) => {
    const releaseDir = join(dir, 'release');
    execFileSync('sh', [buildScript, releaseDir], { stdio: 'pipe' });
    assert.deepEqual(readdirSync(releaseDir), ['index.html']);
    assert.deepEqual(
      readFileSync(join(releaseDir, 'index.html')),
      readFileSync(join(rootDir, 'dist', 'index.html')),
    );
  });
});

test('build.sh resolves a relative release folder against the caller, not the project', () => {
  withTempDir((dir) => {
    execFileSync('sh', [buildScript, 'out'], { cwd: dir, stdio: 'pipe' });
    assert.deepEqual(readdirSync(join(dir, 'out')), ['index.html']);
  });
});

test('build.sh leaves other files in the release folder alone', () => {
  // The script must never delete a folder the caller points it at.
  withTempDir((dir) => {
    execFileSync('sh', ['-c', 'echo keep > "$1/notes.txt"', 'sh', dir]);
    execFileSync('sh', [buildScript, dir], { stdio: 'pipe' });
    assert.deepEqual(readdirSync(dir).sort(), ['index.html', 'notes.txt']);
    assert.equal(readFileSync(join(dir, 'notes.txt'), 'utf8'), 'keep\n');
  });
});
