// What can be checked about the stylesheets without a browser: that the design tokens are
// consistent, and that the rules for narrow, medium and wide screens say what was decided.
// Whether the result looks right can only be seen on a device (test/manual/checklist.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WIDTH_CLASS_QUERIES } from '../../src/app/widthClass.ts';
import { listFiles, rootDir } from '../helpers/projectFiles.ts';

const read = (file: string): string => readFileSync(join(rootDir, file), 'utf8');
const tokensCss = read('src/styles/tokens.css');

/** The declarations of a `:root { ... }` block as a map from property to value. */
function parseDeclarations(block: string): Map<string, string> {
  const declarations = new Map<string, string>();
  // Comments may contain semicolons and colons.
  for (const declaration of block.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const colon = declaration.indexOf(':');
    if (colon > 0) declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
  }
  return declarations;
}

/** Tokens as they apply by default (narrow screens) and what each width class changes. */
function parseTokens(): { compact: Map<string, string>; medium: Map<string, string>; expanded: Map<string, string> } {
  const rootBlocks = [...tokensCss.matchAll(/(@media\s*([^{]+)\{\s*)?:root\s*\{([^}]*)\}/g)];
  const byCondition = new Map(rootBlocks.map((match) => [(match[2] ?? '').trim(), parseDeclarations(match[3] ?? '')]));
  const block = (condition: string): Map<string, string> => {
    const found = byCondition.get(condition);
    assert.ok(found, `tokens.css has no :root block for "${condition}"`);
    return found;
  };
  return { compact: block(''), medium: block(WIDTH_CLASS_QUERIES.medium), expanded: block(WIDTH_CLASS_QUERIES.expanded) };
}

const tokens = parseTokens();
/** The value a token has in a width class: wider classes inherit what narrower ones set. */
const valueAt = (widthClass: 'compact' | 'medium' | 'expanded', name: string): string | undefined => {
  if (widthClass === 'expanded' && tokens.expanded.has(name)) return tokens.expanded.get(name);
  if (widthClass !== 'compact' && tokens.medium.has(name)) return tokens.medium.get(name);
  return tokens.compact.get(name);
};
const remOf = (value: string | undefined): number => {
  const match = /^([\d.]+)rem$/.exec(value ?? '');
  assert.ok(match, `expected a rem value, got ${value}`);
  return Number(match[1]);
};

test('every design token that is used is defined, and every one that is defined is used', () => {
  const defined = new Set([...tokensCss.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1] ?? ''));
  const sources = [...listFiles('src/styles', ['.css']), ...listFiles('src', ['.ts'])].map(read).join('\n');
  const used = new Set([...sources.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1] ?? ''));
  // A typo in a token name fails silently in the browser: the declaration is just dropped.
  assert.deepEqual([...used].filter((name) => !defined.has(name)).sort(), []);
  assert.deepEqual([...defined].filter((name) => !used.has(name)).sort(), []);
});

test('a width class only changes tokens that have a default', () => {
  for (const widthClass of ['medium', 'expanded'] as const) {
    for (const name of tokens[widthClass].keys()) assert.ok(tokens.compact.has(name), `${name} is set for ${widthClass} only`);
  }
});

test('toolbar buttons come in three steps: always, from the unfolded foldable on, and on wide screens', () => {
  assert.equal(valueAt('compact', '--toolbar-medium-display'), 'none');
  assert.equal(valueAt('compact', '--toolbar-wide-display'), 'none');
  assert.equal(valueAt('medium', '--toolbar-medium-display'), 'inline-block');
  assert.equal(valueAt('medium', '--toolbar-wide-display'), 'none');
  assert.equal(valueAt('expanded', '--toolbar-medium-display'), 'inline-block');
  assert.equal(valueAt('expanded', '--toolbar-wide-display'), 'inline-block');
});

test('the title gives its room to the toolbar except on wide screens, but stays there for screen readers', () => {
  // Hidden by clipping, not by "display: none", which would also remove it for screen readers.
  for (const widthClass of ['compact', 'medium'] as const) {
    assert.equal(valueAt(widthClass, '--title-position'), 'absolute', widthClass);
    assert.equal(valueAt(widthClass, '--title-clip'), 'inset(50%)', widthClass);
  }
  assert.equal(valueAt('expanded', '--title-position'), 'static');
  assert.equal(valueAt('expanded', '--title-clip'), 'none');
  assert.equal(/\.app-title\s*\{[^}]*display\s*:\s*none/.test(read('src/styles/layout.css')), false);
});

test('tabs get narrower on narrower screens, so more of them fit', () => {
  const widths = (['compact', 'medium', 'expanded'] as const).map((widthClass) => remOf(valueAt(widthClass, '--tab-max-width')));
  assert.ok((widths[0] ?? 0) < (widths[1] ?? 0) && (widths[1] ?? 0) < (widths[2] ?? 0), widths.join(' < '));
});

test('nothing that is tapped is smaller than a touch target', () => {
  // 44 CSS px at the default font size; ssMemoWeb's 32 px buttons were hard to hit.
  assert.ok(remOf(valueAt('compact', '--touch-target')) * 16 >= 44);
  assert.equal(valueAt('compact', '--tab-close-width'), 'var(--touch-target)');
});

test('the page does not scroll or zoom on its own where a finger is used', () => {
  const base = read('src/styles/index.css');
  // Pulling down at the top of a memo must not reload the page.
  assert.match(base, /overscroll-behavior:\s*none/);
  // A fast second tap on a button is a second tap, not a zoom.
  assert.match(base, /touch-action:\s*manipulation/);
  // Rotating the phone must not inflate the text.
  assert.match(base, /text-size-adjust:\s*100%/);
});

test('the find bar is a single row on narrow screens; replacing and the finer options come with more width', () => {
  assert.equal(valueAt('compact', '--search-layout'), 'flex');
  assert.equal(valueAt('compact', '--search-extra-display'), 'none');
  for (const widthClass of ['medium', 'expanded'] as const) {
    assert.equal(valueAt(widthClass, '--search-layout'), 'block', widthClass);
    assert.equal(valueAt(widthClass, '--search-extra-display'), 'inline-block', widthClass);
  }
});

test('wherever the preview takes the place of the editor, there is a button to get back', () => {
  for (const widthClass of ['compact', 'medium', 'expanded'] as const) {
    const editorHidden = valueAt(widthClass, '--preview-editor-display') === 'none';
    const backShown = valueAt(widthClass, '--preview-back-display') !== 'none';
    assert.equal(backShown, editorHidden, widthClass);
  }
});

// --- accessibility ----------------------------------------------------------

/** Relative luminance of an #rrggbb colour, as WCAG defines it. */
function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  assert.ok(match, `expected a colour like #1f2328, got ${hex}`);
  const [red, green, blue] = match.slice(1).map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

test('the contrast helper agrees with the known extremes', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
  assert.equal(contrast('#777777', '#777777'), 1);
});

test('every text colour is readable on the background it is used on', () => {
  // WCAG AA asks for 4.5 : 1 for text of normal size.
  const pairs: [string, string][] = [
    ['--color-text', '--color-surface'],
    ['--color-text', '--color-surface-muted'],
    ['--color-text-muted', '--color-surface'],
    ['--color-text-muted', '--color-surface-muted'],
    ['--color-accent', '--color-surface'],
    ['--color-accent', '--color-surface-muted'],
    ['--color-on-accent', '--color-accent'],
    ['--color-danger', '--color-surface'],
    ['--color-text', '--color-warning-surface'],
    ['--color-text', '--color-info-surface'],
  ];
  for (const [foreground, background] of pairs) {
    const ratio = contrast(valueAt('compact', foreground) ?? '', valueAt('compact', background) ?? '');
    assert.ok(ratio >= 4.5, `${foreground} on ${background} is only ${ratio.toFixed(2)} : 1`);
  }
});

test('keyboard focus is always visible, except in the text area where the caret shows it', () => {
  const base = read('src/styles/index.css');
  assert.match(base, /:focus-visible\s*\{[^}]*outline:\s*var\(--focus-ring-width\) solid var\(--color-accent\)/);
  const stylesheets = listFiles('src/styles', ['.css']).map((file) => ({ file, css: read(file) }));
  for (const { file, css } of stylesheets) {
    const removals = [...css.matchAll(/([^{}]+)\{[^}]*outline:\s*(?:none|0)\b/g)].map((match) => (match[1] ?? '').trim());
    assert.deepEqual(removals.filter((selector) => !selector.includes('.cm-content')), [], file);
  }
});

// --- dark theme -------------------------------------------------------------

/** The declarations of the first block whose selector text matches. */
function blockOf(selectorPattern: RegExp): Map<string, string> {
  const match = selectorPattern.exec(tokensCss);
  assert.ok(match, `tokens.css has no block for ${selectorPattern}`);
  const open = tokensCss.indexOf('{', match.index + match[0].length - 1);
  return parseDeclarations(tokensCss.slice(open + 1, tokensCss.indexOf('}', open)));
}

// The dark colours exist twice, because CSS cannot share one block between "the system is dark
// and the user did not choose light" and "the user chose dark".
const darkBySystem = blockOf(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{/);
const darkByChoice = blockOf(/:root\[data-theme="dark"\]\s*\{/);
const colourTokens = [...tokens.compact.keys()].filter((name) => name.startsWith('--color-'));

test('the two copies of the dark colours are identical', () => {
  assert.deepEqual([...darkBySystem].sort(), [...darkByChoice].sort());
});

test('the dark theme redefines every colour and nothing else', () => {
  assert.ok(colourTokens.length >= 10);
  const expected = [...colourTokens, 'color-scheme'].sort();
  assert.deepEqual([...darkByChoice.keys()].sort(), expected);
});

test('form controls and scrollbars follow the theme', () => {
  assert.equal(tokens.compact.get('color-scheme'), 'light');
  assert.equal(darkByChoice.get('color-scheme'), 'dark');
});

test('every text colour is readable on its background in the dark theme too', () => {
  const pairs: [string, string][] = [
    ['--color-text', '--color-surface'],
    ['--color-text', '--color-surface-muted'],
    ['--color-text-muted', '--color-surface'],
    ['--color-text-muted', '--color-surface-muted'],
    ['--color-accent', '--color-surface'],
    ['--color-accent', '--color-surface-muted'],
    ['--color-on-accent', '--color-accent'],
    ['--color-danger', '--color-surface'],
    ['--color-text', '--color-warning-surface'],
    ['--color-text', '--color-info-surface'],
  ];
  for (const [foreground, background] of pairs) {
    const ratio = contrast(darkByChoice.get(foreground) ?? '', darkByChoice.get(background) ?? '');
    assert.ok(ratio >= 4.5, `dark: ${foreground} on ${background} is only ${ratio.toFixed(2)} : 1`);
  }
});

test('the dark theme is dark and the light theme is light', () => {
  assert.ok(luminance(darkByChoice.get('--color-surface') ?? '') < 0.1);
  assert.ok(luminance(tokens.compact.get('--color-surface') ?? '') > 0.9);
});

test('the editor takes its colours from the tokens instead of its own light defaults', () => {
  // The editor library colours its gutter, panels, buttons and matches for a light page.
  const theme = read('src/editor/editorSetup.ts');
  for (const part of ['.cm-gutters', '.cm-panels', '.cm-button', '.cm-textfield', '.cm-searchMatch', '.cm-content']) {
    assert.match(theme, new RegExp(`'[^']*\\${part}[^']*':\\s*\\{[^}]*var\\(--color-`), part);
  }
});
