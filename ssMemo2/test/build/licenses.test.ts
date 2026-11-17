// The built file contains third-party code with its license comments stripped, and it is the
// only thing that gets distributed. The licenses require their notices to travel with the code,
// so the app shows them in its help. This test checks that against what is really in the bundle.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildHtml } from '../../scripts/buildHtml.ts';
import { THIRD_PARTY_PACKAGES, formatThirdPartyNotices } from '../../src/app/licenses.ts';
import { rootDir } from '../helpers/projectFiles.ts';

const PACKAGE_PATH_PATTERN = /node_modules\/((?:@[^/]+\/)?[^/]+)\//;

let bundledPackages: string[] = [];
let html = '';

before(async () => {
  const result = await buildHtml();
  html = result.html;
  bundledPackages = [...new Set(result.sourceFiles.flatMap((file) => PACKAGE_PATH_PATTERN.exec(file)?.[1] ?? []))].sort();
});

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();

function licenseOf(packageName: string): string {
  return readFileSync(join(rootDir, 'node_modules', packageName, 'LICENSE'), 'utf8');
}

test('the bundle contains third-party packages at all, or this test checks nothing', () => {
  assert.ok(bundledPackages.includes('@codemirror/state'), bundledPackages.join(', '));
});

test('the list of notices names exactly the packages that are in the bundle', () => {
  assert.deepEqual(THIRD_PARTY_PACKAGES.map((entry) => entry.name).sort(), bundledPackages);
});

test('each package is listed with the copyright line of its own license file', () => {
  for (const entry of THIRD_PARTY_PACKAGES) {
    const copyrightLines = licenseOf(entry.name).split('\n').filter((line) => line.startsWith('Copyright'));
    assert.deepEqual([entry.copyright], copyrightLines, entry.name);
  }
});

test('the notices contain every word of every license', () => {
  const notices = normalize(formatThirdPartyNotices());
  for (const packageName of bundledPackages) {
    // Compared paragraph by paragraph, so the order of the parts does not matter.
    for (const paragraph of licenseOf(packageName).split(/\n\s*\n/)) {
      const expected = normalize(paragraph);
      if (expected === '') continue;
      assert.ok(notices.includes(expected), `${packageName}: missing ${JSON.stringify(expected.slice(0, 60))}`);
    }
    assert.ok(notices.includes(packageName), `${packageName} is not named`);
  }
});

test('the notices are in the built file', () => {
  // As the program stores them: line breaks escaped, quotes possibly escaped.
  assert.ok(html.includes('Permission is hereby granted, free of charge'));
  assert.ok(html.includes('THE SOFTWARE IS PROVIDED'));
  for (const entry of THIRD_PARTY_PACKAGES) assert.ok(html.includes(entry.name), entry.name);
});
