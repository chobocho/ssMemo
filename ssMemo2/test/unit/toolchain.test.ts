// Guards the toolchain invariants the rest of the project depends on.
// These settings are easy to "fix" by accident (e.g. upgrading TypeScript or
// relaxing a flag) and the breakage would only show up later on another machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('../../', import.meta.url));

interface TsConfig {
  extends?: string;
  compilerOptions?: Record<string, unknown>;
  include?: string[];
}

interface PackageJson {
  type?: string;
  private?: boolean;
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(rootDir + relativePath, 'utf8')) as T;
}

test('source tsconfig keeps the flags that let Node run the same .ts files natively', () => {
  const options = readJson<TsConfig>('tsconfig.json').compilerOptions ?? {};
  // Node strips types but cannot transform enums/namespaces/parameter properties.
  assert.equal(options.erasableSyntaxOnly, true);
  // Type-only imports must be marked, otherwise Node would try to load them at runtime.
  assert.equal(options.verbatimModuleSyntax, true);
  // Node resolves "./x.ts" literally, so sources must be allowed to spell the extension.
  assert.equal(options.allowImportingTsExtensions, true);
  assert.equal(options.noEmit, true);
  assert.equal(options.strict, true);
});

test('source tsconfig targets ES2022 with DOM types and no Node types', () => {
  const config = readJson<TsConfig>('tsconfig.json');
  const options = config.compilerOptions ?? {};
  // TypeScript 6 defaults to a newer target than older Samsung Internet supports.
  assert.equal(options.target, 'ES2022');
  assert.deepEqual(options.lib, ['ES2022', 'DOM', 'DOM.Iterable']);
  // Browser code must not compile against Node globals by accident.
  assert.deepEqual(options.types, []);
  assert.deepEqual(config.include, ['src']);
});

test('test tsconfig extends the source config and adds Node types', () => {
  const config = readJson<TsConfig>('tsconfig.test.json');
  assert.equal(config.extends, './tsconfig.json');
  assert.deepEqual(config.compilerOptions?.types, ['node']);
  assert.deepEqual(config.include, ['src', 'test', 'scripts']);
});

test('package.json is a private ES module package with check and test scripts', () => {
  const pkg = readJson<PackageJson>('package.json');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.private, true);
  assert.match(pkg.scripts?.check ?? '', /\btsc\b/);
  // The glob must be double-quoted: sh would expand an unquoted "**" and cmd rejects single quotes.
  assert.match(pkg.scripts?.test ?? '', /node --test "test\/unit\/\*\*\/\*\.test\.ts"/);
});

test('TypeScript stays on 6.x because 7.x ships no Android binary', () => {
  const range = readJson<PackageJson>('package.json').devDependencies?.typescript ?? '';
  assert.match(range, /^[~^]?6\./);
});

test('dependency versions are pinned by a lockfile', () => {
  assert.equal(existsSync(rootDir + 'package-lock.json'), true);
});
