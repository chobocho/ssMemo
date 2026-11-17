// Text-pattern checkers for the project rules. Each returns the 1-based line numbers (or the
// offending specifiers) so a failing test points straight at the place to fix.
//
// They are simple patterns rather than a parser. Comments are scanned too, on purpose:
// comments must be English and should not carry hard-coded sizes either.

// Hangul jamo, compatibility jamo, extended jamo and precomposed syllables.
const HANGUL_PATTERN = /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-퟿]/;

// `from '...'`, `import '...'` and `import('...')` with a relative specifier.
const RELATIVE_IMPORT_PATTERN = /(?:\bfrom|\bimport)\s*\(?\s*['"](\.{1,2}\/[^'"]*)['"]/g;
const TS_EXTENSION = '.ts';

// Module-level code is written at column 0; anything indented lives inside a function or block.
const TOP_LEVEL_MUTABLE_PATTERN = /^(?:export\s+)?(?:let|var)\s/;

// `window.x = ...` / `globalThis['x'] = ...`, but not `==` / `===` comparisons.
const GLOBAL_WRITE_PATTERN = /\b(?:window|globalThis|self)\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=(?!=)/;

// Geometry must come from CSS (tokens, flex/grid), never from coordinates computed in script.
const GEOMETRY_PROPERTIES = 'left|top|right|bottom|inset|width|height|minWidth|maxWidth|minHeight|maxHeight|transform|translate';
const GEOMETRY_CSS_NAMES = 'left|top|right|bottom|inset|width|height|min-width|max-width|min-height|max-height|transform|translate';
const INLINE_COORDINATE_PATTERN = new RegExp(
  `\\.style\\s*\\.\\s*(?:(?:${GEOMETRY_PROPERTIES})\\s*=(?!=)|setProperty\\s*\\(\\s*['"](?:${GEOMETRY_CSS_NAMES})['"])`,
);

const PIXEL_LITERAL_PATTERN = /\dpx\b/;
// "100vh" ignores the on-screen keyboard and browser bars on mobile; dvh/svh/lvh do not match here.
const STATIC_VIEWPORT_HEIGHT_PATTERN = /\dvh\b/;
const INLINE_EVENT_HANDLER_PATTERN = /<[^>]*\son[a-z]+\s*=/i;

/** 1-based numbers of the lines that match `pattern`. O(n) in the source length. */
function matchingLines(source: string, pattern: RegExp): number[] {
  const lineNumbers: number[] = [];
  source.split('\n').forEach((line, index) => {
    if (pattern.test(line)) lineNumbers.push(index + 1);
  });
  return lineNumbers;
}

export function findHangulLines(source: string): number[] {
  return matchingLines(source, HANGUL_PATTERN);
}

/** Relative import specifiers that Node could not resolve because they lack the .ts extension. */
export function findRelativeImportsWithoutTsExtension(source: string): string[] {
  return [...source.matchAll(RELATIVE_IMPORT_PATTERN)]
    .map((match) => match[1] ?? '')
    .filter((specifier) => !specifier.endsWith(TS_EXTENSION));
}

export function findTopLevelMutableBindings(source: string): number[] {
  return matchingLines(source, TOP_LEVEL_MUTABLE_PATTERN);
}

export function findGlobalWrites(source: string): number[] {
  return matchingLines(source, GLOBAL_WRITE_PATTERN);
}

export function findInlineCoordinateWrites(source: string): number[] {
  return matchingLines(source, INLINE_COORDINATE_PATTERN);
}

export function findPixelLiterals(source: string): number[] {
  return matchingLines(source, PIXEL_LITERAL_PATTERN);
}

export function findStaticViewportHeightUnits(source: string): number[] {
  return matchingLines(source, STATIC_VIEWPORT_HEIGHT_PATTERN);
}

export function findInlineEventHandlers(source: string): number[] {
  return matchingLines(source, INLINE_EVENT_HANDLER_PATTERN);
}
