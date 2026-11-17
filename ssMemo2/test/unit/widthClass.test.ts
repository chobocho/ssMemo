import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EXPANDED_MIN_WIDTH_EM,
  MEDIUM_MIN_WIDTH_EM,
  WIDTH_CLASS_QUERIES,
  pickWidthClass,
} from '../../src/app/widthClass.ts';
import { listFiles, rootDir } from '../helpers/projectFiles.ts';

const CSS_PIXELS_PER_EM = 16;
const MEDIA_CONDITION_PATTERN = /@media\s*([^{]+)\{/g;

/** Stand-in for window.matchMedia on a viewport that is `widthEm` wide. */
function viewportOf(widthEm: number): (query: string) => boolean {
  return (query) => {
    const match = /^\(min-width: ([\d.]+)em\)$/.exec(query);
    assert.ok(match, `unexpected media query: ${query}`);
    return widthEm >= Number(match[1]);
  };
}

function classForPixels(widthPx: number): string {
  return pickWidthClass(viewportOf(widthPx / CSS_PIXELS_PER_EM));
}

test('the measured foldable lands in the intended width classes', () => {
  // Measured on the target device (Samsung Internet): the unfolded viewport is 579.76 CSS px wide.
  assert.equal(classForPixels(579.76), 'medium');
  // Its cover screen is about 300 CSS px wide at the same display density.
  assert.equal(classForPixels(300), 'compact');
  assert.equal(classForPixels(1280), 'expanded');
});

test('pickWidthClass switches exactly at the declared boundaries', () => {
  const justBelow = 0.01;
  assert.equal(pickWidthClass(viewportOf(MEDIUM_MIN_WIDTH_EM - justBelow)), 'compact');
  assert.equal(pickWidthClass(viewportOf(MEDIUM_MIN_WIDTH_EM)), 'medium');
  assert.equal(pickWidthClass(viewportOf(EXPANDED_MIN_WIDTH_EM - justBelow)), 'medium');
  assert.equal(pickWidthClass(viewportOf(EXPANDED_MIN_WIDTH_EM)), 'expanded');
});

test('pickWidthClass treats a zero-width viewport as compact', () => {
  assert.equal(pickWidthClass(viewportOf(0)), 'compact');
});

test('width-class queries are em-based so they follow the browser font-size setting', () => {
  assert.equal(WIDTH_CLASS_QUERIES.medium, `(min-width: ${MEDIUM_MIN_WIDTH_EM}em)`);
  assert.equal(WIDTH_CLASS_QUERIES.expanded, `(min-width: ${EXPANDED_MIN_WIDTH_EM}em)`);
  assert.equal(MEDIUM_MIN_WIDTH_EM < EXPANDED_MIN_WIDTH_EM, true);
});

test('stylesheets branch on width only through the declared width-class queries', () => {
  // Media queries cannot read CSS variables, so the breakpoints exist twice (CSS and TypeScript).
  // This keeps the two copies identical.
  const declared: readonly string[] = Object.values(WIDTH_CLASS_QUERIES);
  const widthConditions = listFiles('src/styles', ['.css']).flatMap((file) =>
    [...readFileSync(join(rootDir, file), 'utf8').matchAll(MEDIA_CONDITION_PATTERN)]
      .map((match) => (match[1] ?? '').trim())
      .filter((condition) => condition.includes('width'))
      .map((condition) => ({ file, condition })),
  );
  assert.equal(widthConditions.length > 0, true, 'expected at least one width-based media query');
  const undeclared = widthConditions.filter(({ condition }) => !declared.includes(condition));
  assert.deepEqual(undeclared, []);
  // Every declared class must actually be used, otherwise the TypeScript side reports a class CSS ignores.
  for (const query of declared) {
    assert.equal(widthConditions.some(({ condition }) => condition === query), true, `no stylesheet uses ${query}`);
  }
});
