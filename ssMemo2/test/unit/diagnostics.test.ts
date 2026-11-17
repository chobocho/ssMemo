import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeEnvironment, formatDiagnostics } from '../../src/app/diagnostics.ts';
import type { EnvironmentSnapshot } from '../../src/app/diagnostics.ts';

// A phone-like environment with every optional capability present.
const fullSnapshot: EnvironmentSnapshot = {
  buildId: '0.1.0+abcdef12',
  userAgent: 'TestBrowser/1.0',
  languages: ['ko-KR', 'en-US'],
  viewport: { width: 360, height: 740 },
  widthClass: 'compact',
  visualViewport: { width: 360, height: 500 },
  screen: { width: 360, height: 800 },
  devicePixelRatio: 3,
  devicePosture: 'folded',
  viewportSegmentCount: 2,
  coarsePointer: true,
  canHover: false,
  isSecureContext: true,
  hasIndexedDb: true,
  storage: 'persistent',
  hasFileSystemAccess: false,
};

function valueOf(snapshot: EnvironmentSnapshot, label: string): string | undefined {
  return describeEnvironment(snapshot).find((entry) => entry.label === label)?.value;
}

test('describeEnvironment lists every fact in a stable order', () => {
  assert.deepEqual(describeEnvironment(fullSnapshot), [
    { label: 'build', value: '0.1.0+abcdef12' },
    { label: 'viewport', value: '360 × 740 CSS px' },
    { label: 'width class', value: 'compact' },
    { label: 'visual viewport', value: '360 × 500 CSS px' },
    { label: 'screen', value: '360 × 800 CSS px' },
    { label: 'device pixel ratio', value: '3' },
    { label: 'viewport in device pixels', value: '1080 × 2220' },
    { label: 'device posture', value: 'folded' },
    { label: 'viewport segments', value: '2' },
    { label: 'pointer', value: 'coarse' },
    { label: 'hover', value: 'no' },
    { label: 'secure context', value: 'yes' },
    { label: 'IndexedDB', value: 'available' },
    { label: 'storage', value: 'persistent' },
    { label: 'File System Access', value: 'missing' },
    { label: 'languages', value: 'ko-KR, en-US' },
    { label: 'user agent', value: 'TestBrowser/1.0' },
  ]);
});

test('describeEnvironment marks capabilities the browser does not expose as unsupported', () => {
  const snapshot: EnvironmentSnapshot = {
    ...fullSnapshot,
    visualViewport: undefined,
    devicePosture: undefined,
    viewportSegmentCount: undefined,
  };
  assert.equal(valueOf(snapshot, 'visual viewport'), 'unsupported');
  assert.equal(valueOf(snapshot, 'device posture'), 'unsupported');
  assert.equal(valueOf(snapshot, 'viewport segments'), 'unsupported');
});

test('describeEnvironment describes a desktop pointer', () => {
  const snapshot: EnvironmentSnapshot = { ...fullSnapshot, coarsePointer: false, canHover: true };
  assert.equal(valueOf(snapshot, 'pointer'), 'fine');
  assert.equal(valueOf(snapshot, 'hover'), 'yes');
});

test('describeEnvironment rounds fractional sizes and ratios', () => {
  const snapshot: EnvironmentSnapshot = {
    ...fullSnapshot,
    viewport: { width: 384.456789, height: 853.333333 },
    devicePixelRatio: 2.8125001,
  };
  assert.equal(valueOf(snapshot, 'viewport'), '384.46 × 853.33 CSS px');
  assert.equal(valueOf(snapshot, 'device pixel ratio'), '2.813');
  // Device pixels are whole numbers: 384.456789 * 2.8125001 = 1081.28..., 853.333333 * 2.8125001 = 2400.00...
  assert.equal(valueOf(snapshot, 'viewport in device pixels'), '1081 × 2400');
});

test('describeEnvironment does not invent device pixels from an unusable ratio', () => {
  for (const devicePixelRatio of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const snapshot: EnvironmentSnapshot = { ...fullSnapshot, devicePixelRatio };
    assert.equal(valueOf(snapshot, 'device pixel ratio'), 'unknown');
    assert.equal(valueOf(snapshot, 'viewport in device pixels'), 'unknown');
  }
});

test('describeEnvironment reports missing languages and a missing user agent as unknown', () => {
  const snapshot: EnvironmentSnapshot = { ...fullSnapshot, languages: [], userAgent: '' };
  assert.equal(valueOf(snapshot, 'languages'), 'unknown');
  assert.equal(valueOf(snapshot, 'user agent'), 'unknown');
});

test('formatDiagnostics writes one "label: value" line per entry', () => {
  const text = formatDiagnostics([
    { label: 'build', value: '0.1.0+abcdef12' },
    { label: 'viewport', value: '360 × 740 CSS px' },
  ]);
  assert.equal(text, 'build: 0.1.0+abcdef12\nviewport: 360 × 740 CSS px');
});

test('formatDiagnostics returns an empty string for no entries', () => {
  assert.equal(formatDiagnostics([]), '');
});
