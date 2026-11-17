import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  EDITOR_FONT_SIZES_REM,
  createSettingsStore,
  parseSettings,
  stepEditorFontSize,
} from '../../src/app/settings.ts';
import type { Settings } from '../../src/app/settings.ts';
import { createMemoryStorage } from '../../src/storage/memoryStorage.ts';
import { StorageError } from '../../src/storage/storagePort.ts';

const SMALLEST = EDITOR_FONT_SIZES_REM[0] ?? 0;
const LARGEST = EDITOR_FONT_SIZES_REM.at(-1) ?? 0;
const custom: Settings = { language: 'ko', theme: 'dark', lineWrapping: false, editorFontSizeRem: LARGEST };

// --- parseSettings ----------------------------------------------------------

test('parseSettings returns the defaults for missing or unusable input', () => {
  for (const value of [undefined, null, 'text', 42, [], true]) {
    assert.deepEqual(parseSettings(value), DEFAULT_SETTINGS);
  }
});

test('parseSettings accepts a complete valid record', () => {
  assert.deepEqual(parseSettings(custom), custom);
});

test('parseSettings keeps valid fields and replaces each invalid one by its default', () => {
  // One damaged field must not throw away the rest of the user's settings.
  assert.deepEqual(parseSettings({ language: 'en', lineWrapping: 'yes', editorFontSizeRem: LARGEST }), {
    language: 'en',
    // Not given at all, so the default.
    theme: DEFAULT_SETTINGS.theme,
    lineWrapping: DEFAULT_SETTINGS.lineWrapping,
    editorFontSizeRem: LARGEST,
  });
  assert.deepEqual(parseSettings({ lineWrapping: false }), { ...DEFAULT_SETTINGS, lineWrapping: false });
});

test('parseSettings rejects unsupported languages and font sizes that are not offered', () => {
  assert.equal(parseSettings({ language: 'ja' }).language, DEFAULT_SETTINGS.language);
  assert.equal(parseSettings({ language: 'auto' }).language, 'auto');
  for (const size of [0, -1, 999, Number.NaN, '1', 0.8]) {
    assert.equal(parseSettings({ editorFontSizeRem: size }).editorFontSizeRem, DEFAULT_SETTINGS.editorFontSizeRem);
  }
});

test('parseSettings ignores unknown fields', () => {
  assert.deepEqual(parseSettings({ ...custom, addedByANewerVersion: 1 }), custom);
});

test('the default font size is one of the offered sizes', () => {
  assert.equal(EDITOR_FONT_SIZES_REM.includes(DEFAULT_SETTINGS.editorFontSizeRem), true);
  assert.deepEqual([...EDITOR_FONT_SIZES_REM].sort((left, right) => left - right), [...EDITOR_FONT_SIZES_REM]);
});

// --- stepEditorFontSize -----------------------------------------------------

test('stepEditorFontSize moves one step up or down', () => {
  const second = EDITOR_FONT_SIZES_REM[1] ?? 0;
  assert.equal(stepEditorFontSize(SMALLEST, 1), second);
  assert.equal(stepEditorFontSize(second, -1), SMALLEST);
});

test('stepEditorFontSize stops at the smallest and largest size', () => {
  assert.equal(stepEditorFontSize(SMALLEST, -1), SMALLEST);
  assert.equal(stepEditorFontSize(LARGEST, 1), LARGEST);
});

test('stepEditorFontSize starts from the default when the current size is not an offered one', () => {
  const defaultIndex = EDITOR_FONT_SIZES_REM.indexOf(DEFAULT_SETTINGS.editorFontSizeRem);
  assert.equal(stepEditorFontSize(0.8, 1), EDITOR_FONT_SIZES_REM[defaultIndex + 1]);
});

// --- createSettingsStore ----------------------------------------------------

test('the settings store returns defaults until something is saved, then what was saved', async () => {
  const store = createSettingsStore(createMemoryStorage());
  assert.deepEqual(await store.load(), DEFAULT_SETTINGS);
  assert.equal(await store.save(custom), true);
  assert.deepEqual(await store.load(), custom);
});

test('the settings store falls back to defaults when storage cannot be read', async () => {
  const storage = createMemoryStorage();
  const store = createSettingsStore({
    ...storage,
    getValue: async () => {
      throw new StorageError('connection-lost', 'closed');
    },
  });
  assert.deepEqual(await store.load(), DEFAULT_SETTINGS);
});

test('the settings store reports a failed save instead of throwing', async () => {
  const storage = createMemoryStorage();
  const store = createSettingsStore({
    ...storage,
    setValue: async () => {
      throw new StorageError('quota', 'full');
    },
  });
  assert.equal(await store.save(custom), false);
});

test('the settings store repairs damaged stored settings when loading', async () => {
  const storage = createMemoryStorage();
  await storage.setValue('settings', { language: 'ko', lineWrapping: 'broken' });
  assert.deepEqual(await createSettingsStore(storage).load(), { ...DEFAULT_SETTINGS, language: 'ko' });
});

// --- theme ------------------------------------------------------------------

test('the theme follows the system unless the user chose one', () => {
  assert.equal(DEFAULT_SETTINGS.theme, 'auto');
  assert.equal(parseSettings({}).theme, 'auto');
  for (const theme of ['auto', 'light', 'dark'] as const) assert.equal(parseSettings({ theme }).theme, theme);
});

test('a theme that does not exist falls back to the default without touching other settings', () => {
  for (const theme of ['sepia', '', 1, null, true]) {
    assert.deepEqual(parseSettings({ theme, language: 'ko' }), { ...DEFAULT_SETTINGS, language: 'ko' }, String(theme));
  }
});

test('settings stored before themes existed load with the default theme', async () => {
  const storage = createMemoryStorage();
  await storage.setValue('settings', { language: 'en', lineWrapping: false, editorFontSizeRem: 1 });
  assert.deepEqual(await createSettingsStore(storage).load(), { language: 'en', lineWrapping: false, editorFontSizeRem: 1, theme: 'auto' });
});
