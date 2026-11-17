import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBuildId, UNKNOWN_BUILD_ID } from '../../src/app/buildInfo.ts';

// Minimal stand-in for Document: readBuildId only needs querySelector.
function documentWithMeta(content: string | null | undefined): Pick<Document, 'querySelector'> {
  return {
    querySelector: (selector: string) => {
      assert.equal(selector, 'meta[name="app-build"]');
      if (content === undefined) return null;
      return { getAttribute: () => content } as unknown as Element;
    },
  } as Pick<Document, 'querySelector'>;
}

test('readBuildId returns the content of the app-build meta tag', () => {
  assert.equal(readBuildId(documentWithMeta('0.1.0+abcdef12')), '0.1.0+abcdef12');
});

test('readBuildId falls back when the meta tag is missing', () => {
  assert.equal(readBuildId(documentWithMeta(undefined)), UNKNOWN_BUILD_ID);
});

test('readBuildId falls back when the meta tag has no or empty content', () => {
  assert.equal(readBuildId(documentWithMeta(null)), UNKNOWN_BUILD_ID);
  assert.equal(readBuildId(documentWithMeta('')), UNKNOWN_BUILD_ID);
  assert.equal(readBuildId(documentWithMeta('   ')), UNKNOWN_BUILD_ID);
});
