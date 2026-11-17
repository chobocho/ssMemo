// Enforces the project rules from TODO.md sections 0, 3 and 5 mechanically, so they do not
// depend on anyone remembering them: no global state, no hard-coded coordinates or sizes,
// no Korean text outside the message catalog, and imports that Node can resolve natively.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listFiles, rootDir } from '../helpers/projectFiles.ts';
import {
  findGlobalWrites,
  findHangulLines,
  findInlineCoordinateWrites,
  findInlineEventHandlers,
  findPixelLiterals,
  findRelativeImportsWithoutTsExtension,
  findStaticViewportHeightUnits,
  findTopLevelMutableBindings,
} from '../helpers/projectRules.ts';

// The Korean message catalog is the one place Korean UI text is allowed to live.
const HANGUL_ALLOWED_FILES: readonly string[] = ['src/i18n/ko.ts'];
// Pixel values are allowed only where design tokens are defined.
const PIXEL_ALLOWED_FILES: readonly string[] = ['src/styles/tokens.css'];
// This file holds deliberately broken import fixtures for the checker tests below.
const IMPORT_SCAN_SKIPPED_FILES: readonly string[] = ['test/unit/projectRules.test.ts'];
const TEST_FILE_SUFFIX = '.test.ts';

/** Runs a line-based checker over files and returns "path:line" for every hit. */
function scan(files: readonly string[], findLines: (source: string) => number[]): string[] {
  return files.flatMap((file) =>
    findLines(readFileSync(join(rootDir, file), 'utf8')).map((line) => `${file}:${line}`),
  );
}

// --- checker behaviour ------------------------------------------------------

test('findHangulLines reports lines containing Hangul syllables or jamo', () => {
  assert.deepEqual(findHangulLines('const a = 1;\nconst b = "메모";\n// ㄱㄴ\nconst c = 2;'), [2, 3]);
});

test('findHangulLines ignores ASCII, emoji and empty input', () => {
  assert.deepEqual(findHangulLines('const icon = "📋 memo";'), []);
  assert.deepEqual(findHangulLines(''), []);
});

test('findRelativeImportsWithoutTsExtension reports every import form', () => {
  const source = [
    "import { a } from './a';",
    "import type { T } from '../types/t';",
    "import './side-effect';",
    "export { b } from './b.js';",
    "const lazy = import('./lazy');",
    'import {',
    '  c,',
    "} from './multi/line';",
  ].join('\n');
  assert.deepEqual(findRelativeImportsWithoutTsExtension(source), [
    './a',
    '../types/t',
    './side-effect',
    './b.js',
    './lazy',
    './multi/line',
  ]);
});

test('findRelativeImportsWithoutTsExtension accepts .ts specifiers and package imports', () => {
  const source = [
    "import { a } from './a.ts';",
    "import type { T } from '../types/t.ts';",
    "import { test } from 'node:test';",
    "import { build } from 'esbuild';",
  ].join('\n');
  assert.deepEqual(findRelativeImportsWithoutTsExtension(source), []);
});

test('findTopLevelMutableBindings reports module-level let and var', () => {
  const source = ['let count = 0;', 'export let shared = 1;', 'var legacy = 2;', 'const fixed = 3;'].join('\n');
  assert.deepEqual(findTopLevelMutableBindings(source), [1, 2, 3]);
});

test('findTopLevelMutableBindings ignores bindings inside functions', () => {
  const source = ['function run(): void {', '  let local = 0;', '  for (let i = 0; i < 1; i++) local += i;', '}'].join('\n');
  assert.deepEqual(findTopLevelMutableBindings(source), []);
});

test('findGlobalWrites reports assignments to window, globalThis and self', () => {
  const source = ['window.app = app;', 'globalThis.cache={};', 'self.onmessage = handle;', 'window.onresize = fit;'].join('\n');
  assert.deepEqual(findGlobalWrites(source), [1, 2, 3, 4]);
});

test('findGlobalWrites ignores reads, calls and comparisons', () => {
  const source = [
    'window.addEventListener("resize", fit);',
    'const width = window.innerWidth;',
    'if (window.name === "x") run();',
    'if (window.name == "x") run();',
  ].join('\n');
  assert.deepEqual(findGlobalWrites(source), []);
});

test('findInlineCoordinateWrites reports position and size set from script', () => {
  const source = [
    "el.style.left = '10px';",
    'el.style.top=y;',
    "el.style.setProperty('width', w);",
    'el.style.height = h;',
    'el.style.transform = t;',
  ].join('\n');
  assert.deepEqual(findInlineCoordinateWrites(source), [1, 2, 3, 4, 5]);
});

test('findInlineCoordinateWrites allows custom properties and non-geometry styles', () => {
  const source = ["el.style.setProperty('--split-ratio', ratio);", "el.style.display = 'none';"].join('\n');
  assert.deepEqual(findInlineCoordinateWrites(source), []);
});

test('findPixelLiterals reports pixel sizes once per line', () => {
  assert.deepEqual(findPixelLiterals("a{padding:2px 4px}\nb{margin:1rem}\nconst size = '14px';\nc{border:0.5px solid}"), [1, 3, 4]);
});

test('findPixelLiterals ignores other units and the bare word px', () => {
  assert.deepEqual(findPixelLiterals('a{margin:1rem;width:50%}\nconst px = 1;\nconst unit = "px";'), []);
});

test('findStaticViewportHeightUnits reports vh but not the dynamic units', () => {
  assert.deepEqual(findStaticViewportHeightUnits('a{height:100vh}\nb{height:100dvh}\nc{min-height:80vh}\nd{height:50svh}'), [1, 3]);
});

test('findInlineEventHandlers reports on* attributes in markup', () => {
  assert.deepEqual(findInlineEventHandlers('<div id="app"></div>\n<button onclick="run()">x</button>\n<body ONLOAD = "boot()">'), [2, 3]);
});

test('findInlineEventHandlers ignores attributes that merely contain "on"', () => {
  assert.deepEqual(findInlineEventHandlers('<meta name="viewport" content="width=device-width">\n<link rel="icon" href="#">'), []);
});

// --- the rules applied to this project --------------------------------------

test('src has no Korean text outside the Korean message catalog', () => {
  const files = listFiles('src', ['.ts', '.css', '.html']).filter((file) => !HANGUL_ALLOWED_FILES.includes(file));
  assert.equal(files.length > 0, true);
  assert.deepEqual(scan(files, findHangulLines), []);
});

test('relative imports spell out the .ts extension so Node can run the files directly', () => {
  const files = ['src', 'scripts', 'test']
    .flatMap((dir) => listFiles(dir, ['.ts']))
    .filter((file) => !IMPORT_SCAN_SKIPPED_FILES.includes(file));
  assert.equal(files.length > 0, true);
  const violations = files.flatMap((file) =>
    findRelativeImportsWithoutTsExtension(readFileSync(join(rootDir, file), 'utf8')).map(
      (specifier) => `${file}: ${specifier}`,
    ),
  );
  assert.deepEqual(violations, []);
});

test('src has no module-level mutable bindings', () => {
  assert.deepEqual(scan(listFiles('src', ['.ts']), findTopLevelMutableBindings), []);
});

test('src never assigns to window, globalThis or self', () => {
  assert.deepEqual(scan(listFiles('src', ['.ts']), findGlobalWrites), []);
});

test('src never positions or sizes elements from script', () => {
  assert.deepEqual(scan(listFiles('src', ['.ts']), findInlineCoordinateWrites), []);
});

test('pixel sizes appear only in the token stylesheet', () => {
  const files = listFiles('src', ['.ts', '.css', '.html']).filter((file) => !PIXEL_ALLOWED_FILES.includes(file));
  assert.deepEqual(scan(files, findPixelLiterals), []);
});

test('stylesheets use dynamic viewport units instead of vh', () => {
  assert.deepEqual(scan(listFiles('src', ['.css']), findStaticViewportHeightUnits), []);
});

test('the page template has no inline event handlers', () => {
  assert.deepEqual(scan(listFiles('src', ['.html']), findInlineEventHandlers), []);
});

test('every file in the test folders matches the runner glob', () => {
  // A test file with another suffix would be skipped silently and still look green.
  const strays = ['test/unit', 'test/build']
    .flatMap((dir) => listFiles(dir, ['']))
    .filter((file) => !file.endsWith(TEST_FILE_SUFFIX));
  assert.deepEqual(strays, []);
});
