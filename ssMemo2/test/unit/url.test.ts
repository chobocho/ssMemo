import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findUrlAt, toWebUrl } from '../../src/lib/url.ts';

test('web addresses are recognized, with or without surrounding space', () => {
  assert.equal(toWebUrl('https://example.com/a?b=1#c'), 'https://example.com/a?b=1#c');
  assert.equal(toWebUrl('http://example.com'), 'http://example.com/');
  assert.equal(toWebUrl('  https://example.com/path \n'), 'https://example.com/path');
  assert.equal(toWebUrl('HTTPS://Example.COM/Path'), 'https://example.com/Path');
});

test('an address starting with www gets https in front', () => {
  assert.equal(toWebUrl('www.example.com'), 'https://www.example.com/');
  assert.equal(toWebUrl('WWW.example.com/a'), 'https://www.example.com/a');
});

test('anything that is not one web address is refused', () => {
  const refused = [
    '',
    '   ',
    'example.com',
    'just some text',
    'https://',
    'www.',
    'https://example.com and more',
    'two\nlines https://example.com',
    'ftp://example.com/file',
    'mailto:a@example.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'https://exa mple.com',
    'https:example.com',
  ];
  for (const text of refused) assert.equal(toWebUrl(text), undefined, JSON.stringify(text));
});

test('an address that merely contains a scheme that runs code is still only a web address', () => {
  assert.equal(toWebUrl('https://example.com/?next=javascript:alert(1)'), 'https://example.com/?next=javascript:alert(1)');
});

test('the address under the cursor is found wherever in it the cursor is', () => {
  const line = 'see https://example.com/a?b=1 for details';
  const start = line.indexOf('https');
  const end = start + 'https://example.com/a?b=1'.length;
  for (const offset of [start, start + 5, end - 1, end]) {
    assert.equal(findUrlAt(line, offset), 'https://example.com/a?b=1', String(offset));
  }
  assert.equal(findUrlAt(line, start - 1), undefined);
  assert.equal(findUrlAt(line, end + 1), undefined);
  assert.equal(findUrlAt(line, 0), undefined);
});

test('of several addresses on a line, the one with the cursor is taken', () => {
  const line = 'www.first.example https://second.example/x';
  assert.equal(findUrlAt(line, 3), 'https://www.first.example/');
  assert.equal(findUrlAt(line, line.length - 2), 'https://second.example/x');
});

test('punctuation that ends a sentence or closes a bracket is not part of the address', () => {
  assert.equal(findUrlAt('Read https://example.com/a.', 10), 'https://example.com/a');
  assert.equal(findUrlAt('(see https://example.com/a)', 10), 'https://example.com/a');
  assert.equal(findUrlAt('"https://example.com/a", he said', 5), 'https://example.com/a');
  assert.equal(findUrlAt('<https://example.com/a>', 5), 'https://example.com/a');
  // A dot inside the address stays.
  assert.equal(findUrlAt('https://example.com/a.html!', 5), 'https://example.com/a.html');
});

test('a line without an address, or an offset outside the line, finds nothing', () => {
  assert.equal(findUrlAt('no address here', 4), undefined);
  assert.equal(findUrlAt('', 0), undefined);
  assert.equal(findUrlAt('https://example.com', -1), undefined);
  assert.equal(findUrlAt('https://example.com', 99), undefined);
});
