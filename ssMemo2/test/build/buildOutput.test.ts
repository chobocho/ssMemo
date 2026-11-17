// Guards the single-file build output: one self-contained index.html, nothing fetched at runtime.
import { createHash } from 'node:crypto';
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../../scripts/buildHtml.ts';
import type { BuildResult } from '../../scripts/buildHtml.ts';
import { ALLOWED_URL_LITERALS, findExternalReferences } from '../../scripts/selfContained.ts';
import { listFiles } from '../helpers/projectFiles.ts';

// Upper bound for the whole page. CodeMirror 6 alone is ~310 KB minified, so this leaves
// room for the app while still catching an accidental heavy dependency.
const MAX_OUTPUT_BYTES = 1_500_000;
// Browsers only sniff the first 1024 bytes for a charset; python's http.server sends none.
const CHARSET_SNIFF_BYTES = 1024;
// Modules written test-first ahead of the roadmap item that wires them into the app.
// The list must be empty again at every milestone.
const NOT_YET_WIRED: readonly string[] = [];

interface InlineParts {
  markup: string;
  css: string;
  js: string;
}

// The builder guarantees the inline bodies cannot contain their own closing tag,
// so the first closing tag after the opening one is the real end.
function splitInlineHtml(html: string): InlineParts {
  const style = /<style>([\s\S]*?)<\/style>/.exec(html);
  const script = /<script>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(style, 'output has an inline <style>');
  assert.ok(script, 'output has an inline <script>');
  const markup = html.split(style[0]).join('<style></style>').split(script[0]).join('<script></script>');
  return { markup, css: style[1] ?? '', js: script[1] ?? '' };
}

function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

let result: BuildResult;
let parts: InlineParts;

before(async () => {
  result = await buildHtml();
  parts = splitInlineHtml(result.html);
});

test('output is one HTML document with exactly one inline script and one inline style', () => {
  assert.equal(result.html.startsWith('<!DOCTYPE html>'), true);
  assert.equal(countMatches(result.html, /<script\b/gi), 1);
  assert.equal(countMatches(result.html, /<style\b/gi), 1);
  assert.equal(parts.js.length > 0, true);
  assert.equal(parts.css.length > 0, true);
});

test('output references nothing outside itself', () => {
  assert.deepEqual(findExternalReferences(parts, ALLOWED_URL_LITERALS), []);
});

test('every template placeholder was replaced', () => {
  assert.equal(countMatches(parts.markup, /%%[A-Z][A-Z0-9_]*%%/g), 0);
});

test('charset declaration sits inside the first bytes the browser sniffs', () => {
  const head = Buffer.from(result.html, 'utf8').subarray(0, CHARSET_SNIFF_BYTES).toString('utf8');
  assert.match(head, /<meta charset="utf-8">/i);
});

test('inline script cannot terminate or comment out its own element', () => {
  assert.equal(/<\/script/i.test(parts.js), false);
  assert.equal(parts.js.includes('<!--'), false);
});

test('favicon is embedded as a base64 data URI', () => {
  assert.match(parts.markup, /<link rel="icon" href="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+">/);
});

test('viewport meta enables safe-area and on-screen-keyboard handling', () => {
  assert.match(parts.markup, /<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*">/);
  assert.match(parts.markup, /<meta name="viewport" content="[^"]*interactive-widget=resizes-content[^"]*">/);
});

test('build id is the package version plus a content hash and is embedded in the page', () => {
  assert.match(result.buildId, /^\d+\.\d+\.\d+\+[0-9a-f]{8}$/);
  assert.equal(parts.markup.includes(`<meta name="app-build" content="${result.buildId}">`), true);
});

test('building twice yields identical output', async () => {
  const second = await buildHtml();
  assert.equal(second.html, result.html);
  assert.equal(second.buildId, result.buildId);
});

test('every file under src is part of the build', () => {
  // A source file the build never reads is dead code; TODO.md requires deleting it at once.
  const built = new Set(result.sourceFiles);
  const sources = listFiles('src', ['']);
  const unused = sources.filter((file) => !built.has(file) && !NOT_YET_WIRED.includes(file));
  assert.deepEqual(unused, []);
  // An entry that is wired by now, or that no longer exists, must leave the list.
  const stale = NOT_YET_WIRED.filter((file) => built.has(file) || !sources.includes(file));
  assert.deepEqual(stale, []);
});

test('the bundle contains exactly one copy of each CodeMirror core package', () => {
  // Two copies of @codemirror/state or view break the editor at runtime (extensions from one
  // copy are not recognized by the other), and npm can install nested duplicates silently.
  for (const name of ['state', 'view']) {
    const copies = new Set(
      result.sourceFiles
        .filter((file) => file.includes(`/@codemirror/${name}/`))
        .map((file) => file.slice(0, file.indexOf(`/@codemirror/${name}/`))),
    );
    assert.deepEqual([...copies], ['node_modules'], `@codemirror/${name} copies`);
  }
});

test('output stays within the size budget', () => {
  const bytes = Buffer.byteLength(result.html, 'utf8');
  assert.equal(bytes > 0, true);
  assert.equal(bytes <= MAX_OUTPUT_BYTES, true, `output is ${bytes} bytes, budget is ${MAX_OUTPUT_BYTES}`);
});

test('the page carries a message for the case that the app never starts, in both languages', () => {
  // Without it a blocked or broken script leaves a blank page and nothing to go on.
  const message = /<p id="boot-message"[^>]*>([\s\S]*?)<\/p>/.exec(parts.markup);
  assert.ok(message, 'no boot message in the page');
  assert.ok(parts.markup.indexOf('id="boot-message"') < parts.markup.indexOf('id="app"'));
  const text = message[1] ?? '';
  assert.match(text, /<span lang="ko">[^<]+<\/span>/);
  assert.match(text, /<span lang="en">[^<]*could not start[^<]*<\/span>/);
  // Hidden while the app is still loading; the stylesheet reveals it only after a while.
  assert.match(parts.css, /\.boot-message\{[^}]*max-block-size:0/);
  assert.match(parts.css, /@keyframes boot-message-reveal/);
});

// --- content security policy ------------------------------------------------

const CSP_META_PATTERN = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/g;

function policyOfPage(): string {
  const metas = [...result.html.matchAll(CSP_META_PATTERN)];
  assert.equal(metas.length, 1, 'expected exactly one content security policy');
  return metas[0]?.[1] ?? '';
}

test('the policy comes before everything it has to govern, and after the character set', () => {
  const policyAt = result.html.search(CSP_META_PATTERN);
  assert.ok(policyAt > result.html.indexOf('<meta charset'));
  // A policy only applies to what follows it in the document.
  assert.ok(policyAt < result.html.indexOf('<style>'));
  assert.ok(policyAt < result.html.indexOf('<script>'));
  assert.ok(policyAt < result.html.indexOf('<link'));
});

test('the script hash in the policy is the hash of the script as a browser reads it', async () => {
  // Parsed by a real HTML parser, not cut out with a pattern: what counts is the text the
  // browser ends up with. A mismatch would block the script, and with it the whole app.
  const { JSDOM } = await import('jsdom');
  const scripts = new JSDOM(result.html).window.document.querySelectorAll('script');
  assert.equal(scripts.length, 1);
  const expected = `sha256-${createHash('sha256').update(scripts[0]?.textContent ?? '', 'utf8').digest('base64')}`;
  const scriptSources = /script-src ([^;]*)/.exec(policyOfPage())?.[1];
  assert.equal(scriptSources, `'${expected}'`);
});

test('the policy lets nothing in from outside and runs no script but the page\'s own', () => {
  const policy = policyOfPage();
  assert.match(policy, /default-src 'none'/);
  assert.equal(/script-src[^;]*'unsafe-inline'/.test(policy), false);
  assert.equal(policy.includes("'unsafe-eval'"), false);
  assert.equal(/https?:|\*/.test(policy), false);
});

test('the character set is still declared within the first kilobyte', () => {
  // Browsers only look that far for it; the policy sits right behind it and is long.
  assert.ok(result.html.indexOf('<meta charset="utf-8">') < 1024);
});
