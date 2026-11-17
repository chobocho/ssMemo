import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findExternalReferences } from '../../scripts/selfContained.ts';

const clean = { markup: '<p>hello</p>', css: 'body{margin:0}', js: 'var a=1;' };

function violationsIn(part: Partial<typeof clean>, allowedUrls: readonly string[] = []): string[] {
  return findExternalReferences({ ...clean, ...part }, allowedUrls);
}

test('clean parts produce no violations', () => {
  assert.deepEqual(violationsIn({}), []);
});

test('empty parts produce no violations', () => {
  assert.deepEqual(findExternalReferences({ markup: '', css: '', js: '' }, []), []);
});

// --- markup -----------------------------------------------------------------

test('markup: external script, stylesheet and image sources are reported', () => {
  assert.equal(violationsIn({ markup: '<script src="https://cdn.example/x.js"></script>' }).length, 1);
  assert.equal(violationsIn({ markup: '<link rel="stylesheet" href="style.css">' }).length, 1);
  assert.equal(violationsIn({ markup: "<img src='//cdn.example/x.png'>" }).length, 1);
});

test('markup: unquoted and oddly spaced attribute values are reported', () => {
  assert.equal(violationsIn({ markup: '<script src=app.js></script>' }).length, 1);
  assert.equal(violationsIn({ markup: '<IMG SRC = "pic.png">' }).length, 1);
});

test('markup: other URL-loading attributes are reported', () => {
  assert.equal(violationsIn({ markup: '<img srcset="a.png 2x">' }).length, 1);
  assert.equal(violationsIn({ markup: '<video poster="p.png"></video>' }).length, 1);
  assert.equal(violationsIn({ markup: '<form action="/submit"></form>' }).length, 1);
});

test('markup: data URIs and in-page anchors are allowed', () => {
  assert.deepEqual(violationsIn({ markup: '<link rel="icon" href="data:image/svg+xml;base64,AAAA">' }), []);
  assert.deepEqual(violationsIn({ markup: '<a href="#top">top</a>' }), []);
});

test('markup: a violation message names the offending attribute', () => {
  const [message] = violationsIn({ markup: '<script src="https://cdn.example/x.js"></script>' });
  assert.match(message ?? '', /markup/);
  assert.match(message ?? '', /cdn\.example/);
});

// --- css --------------------------------------------------------------------

test('css: @import and @font-face are reported', () => {
  assert.equal(violationsIn({ css: '@import url("x.css");' }).length >= 1, true);
  assert.equal(violationsIn({ css: '@import "x.css";' }).length, 1);
  assert.equal(violationsIn({ css: '@font-face{font-family:x;src:local("x")}' }).length, 1);
});

test('css: url() pointing at a file or a remote host is reported', () => {
  assert.equal(violationsIn({ css: 'a{background:url(https://x.example/y.png)}' }).length, 1);
  assert.equal(violationsIn({ css: "a{background:url( 'img.png' )}" }).length, 1);
});

test('css: url() with a data URI or a fragment is allowed', () => {
  assert.deepEqual(violationsIn({ css: 'a{background:url(data:image/png;base64,AAAA)}' }), []);
  assert.deepEqual(violationsIn({ css: 'a{fill:url("#gradient")}' }), []);
});

// --- js ---------------------------------------------------------------------

test('js: network and code-loading APIs are reported', () => {
  const snippets = [
    'fetch("/api")',
    'new XMLHttpRequest',
    'new WebSocket(u)',
    'new EventSource(u)',
    'navigator.sendBeacon(u)',
    'importScripts("x.js")',
    'import("x.js")',
    'var a=1;\n//# sourceMappingURL=app.js.map',
  ];
  for (const js of snippets) {
    assert.equal(violationsIn({ js }).length >= 1, true, `expected a violation for: ${js}`);
  }
});

test('js: identifiers that merely contain a forbidden name are not reported', () => {
  assert.deepEqual(violationsIn({ js: 'prefetch(1);important(2);reimport(3);' }), []);
});

test('js: URL literals are reported unless explicitly allowed', () => {
  const js = 'var ns="http://www.w3.org/2000/svg";';
  assert.equal(violationsIn({ js }).length, 1);
  assert.deepEqual(violationsIn({ js }, ['http://www.w3.org/2000/svg']), []);
});

test('js: an allowed URL does not excuse a different one', () => {
  const js = 'var a="http://www.w3.org/2000/svg",b="https://evil.example/x";';
  const violations = violationsIn({ js }, ['http://www.w3.org/2000/svg']);
  assert.equal(violations.length, 1);
  assert.match(violations[0] ?? '', /evil\.example/);
});
