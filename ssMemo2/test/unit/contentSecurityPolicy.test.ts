import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContentSecurityPolicy, hashInlineScript } from '../../scripts/contentSecurityPolicy.ts';

/** The directives of a policy as a map from name to its list of sources. */
function parsePolicy(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .map(([name, ...sources]) => [name ?? '', sources]),
  );
}

test('the hash of a script is the one browsers compute', () => {
  // The example from the Content Security Policy specification.
  assert.equal(hashInlineScript("alert('Hello, world.');"), 'sha256-qznLcsROx4GACP2dm0UCKCzCG+HiZ1guq6ZZDob/Tng=');
  // SHA-256 of nothing.
  assert.equal(hashInlineScript(''), 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
});

test('text outside ASCII is hashed as the UTF-8 bytes the page is stored in', () => {
  // U+D55C is ED 95 9C in UTF-8; the hash must be of those three bytes, not of UTF-16 units.
  const korean = String.fromCharCode(0xd55c);
  assert.notEqual(hashInlineScript(korean), hashInlineScript('?'));
  assert.equal(hashInlineScript(korean), hashInlineScript(new TextDecoder().decode(new Uint8Array([0xed, 0x95, 0x9c]))));
});

test('a script the HTML parser would alter cannot be hashed reliably and is refused', () => {
  // The parser turns CR and CR LF into LF and drops NUL, so the browser would hash other text.
  assert.throws(() => hashInlineScript('a\rb'), /carriage return/i);
  assert.throws(() => hashInlineScript('a\r\nb'), /carriage return/i);
  assert.throws(() => hashInlineScript('a\u0000b'), /NUL/);
  assert.doesNotThrow(() => hashInlineScript('a\nb'));
});

test('the policy allows nothing from outside the page', () => {
  const policy = parsePolicy(buildContentSecurityPolicy('x'));
  assert.deepEqual(policy.get('default-src'), ["'none'"]);
  // Everything not named falls back to default-src: connections, fonts, frames, media, workers.
  for (const directive of ['connect-src', 'font-src', 'frame-src', 'media-src', 'object-src', 'worker-src']) {
    assert.equal(policy.has(directive), false, directive);
  }
  assert.deepEqual(policy.get('base-uri'), ["'none'"]);
  assert.deepEqual(policy.get('form-action'), ["'none'"]);
});

test('only the one inline script of the page may run', () => {
  const sources = parsePolicy(buildContentSecurityPolicy('console.log(1)')).get('script-src');
  assert.deepEqual(sources, [`'${hashInlineScript('console.log(1)')}'`]);
  // In particular nothing that would let injected markup run code.
  const policy = buildContentSecurityPolicy('console.log(1)');
  for (const forbidden of ["'unsafe-eval'", "'strict-dynamic'", 'http:', 'https:', '*']) assert.equal(policy.includes(forbidden), false, forbidden);
  assert.equal((sources ?? []).includes("'unsafe-inline'"), false);
});

test('styles may be inline, images may only be data', () => {
  const policy = parsePolicy(buildContentSecurityPolicy('x'));
  // The editor inserts style elements of its own where it has no other way.
  assert.deepEqual(policy.get('style-src'), ["'unsafe-inline'"]);
  // The icon of the page.
  assert.deepEqual(policy.get('img-src'), ['data:']);
});

test('the policy can be put into an HTML attribute as it is', () => {
  const policy = buildContentSecurityPolicy('x');
  assert.equal(/["<>&]/.test(policy), false);
  assert.equal(policy.includes('\n'), false);
});
