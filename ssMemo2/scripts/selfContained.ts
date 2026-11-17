// Detects anything in the built page that would be loaded from outside the file.
// The app must run on an air-gapped network, so the build fails if this finds a violation.
//
// Checks are construct-based (attributes, CSS rules, API names) rather than "no http:// text":
// bundled libraries legitimately contain URL-shaped identifiers such as XML namespaces.

export interface HtmlParts {
  /** The HTML with the bodies of the inline <style> and <script> removed. */
  markup: string;
  css: string;
  js: string;
}

// URL literals that may appear in bundled JS because they are identifiers, not fetch targets.
// Add an entry only together with the dependency that needs it, and say why.
export const ALLOWED_URL_LITERALS: readonly string[] = [
  // SVG XML namespace, passed to createElementNS by CodeMirror's view; a name, never fetched.
  'http://www.w3.org/2000/svg',
];

// Attributes whose value the browser fetches or navigates to.
const URL_ATTRIBUTE_PATTERN = /\b(src|href|srcset|poster|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

const CSS_IMPORT_PATTERN = /@import\b/gi;
const CSS_FONT_FACE_PATTERN = /@font-face\b/gi;
const CSS_URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;

// APIs that reach the network or load more code. Word boundaries keep identifiers that merely
// contain one of these names (prefetch, important) from matching.
const FORBIDDEN_JS_APIS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'fetch()', pattern: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { name: 'WebSocket', pattern: /\bWebSocket\b/ },
  { name: 'EventSource', pattern: /\bEventSource\b/ },
  { name: 'sendBeacon', pattern: /\bsendBeacon\b/ },
  { name: 'importScripts()', pattern: /\bimportScripts\s*\(/ },
  { name: 'dynamic import()', pattern: /\bimport\s*\(/ },
  { name: 'sourceMappingURL', pattern: /\bsourceMappingURL\b/ },
];

const URL_LITERAL_PATTERN = /\bhttps?:\/\/[^\s"'`<>\\)]+/g;

// A data URI carries its content inline and a fragment points inside the page itself.
function staysInsidePage(target: string): boolean {
  const trimmed = target.trim();
  return trimmed.startsWith('data:') || trimmed.startsWith('#');
}

function findMarkupViolations(markup: string): string[] {
  const violations: string[] = [];
  for (const match of markup.matchAll(URL_ATTRIBUTE_PATTERN)) {
    const target = match[2] ?? match[3] ?? match[4] ?? '';
    if (!staysInsidePage(target)) {
      violations.push(`markup: ${match[1]}="${target}" points outside the page`);
    }
  }
  return violations;
}

function findCssViolations(css: string): string[] {
  const violations: string[] = [];
  for (const _match of css.matchAll(CSS_IMPORT_PATTERN)) {
    violations.push('css: @import loads another stylesheet');
  }
  for (const _match of css.matchAll(CSS_FONT_FACE_PATTERN)) {
    violations.push('css: @font-face is not allowed; only browser default fonts may be used');
  }
  for (const match of css.matchAll(CSS_URL_PATTERN)) {
    const target = match[1] ?? match[2] ?? match[3] ?? '';
    if (!staysInsidePage(target)) {
      violations.push(`css: url(${target}) points outside the page`);
    }
  }
  return violations;
}

function findJsViolations(js: string, allowedUrlLiterals: readonly string[]): string[] {
  const violations: string[] = [];
  for (const { name, pattern } of FORBIDDEN_JS_APIS) {
    if (pattern.test(js)) {
      violations.push(`js: ${name} can reach outside the page`);
    }
  }
  const allowed = new Set(allowedUrlLiterals);
  for (const match of js.matchAll(URL_LITERAL_PATTERN)) {
    if (!allowed.has(match[0])) {
      violations.push(`js: URL literal ${match[0]} is not on the allow-list`);
    }
  }
  return violations;
}

/**
 * Returns one human-readable message per construct that would make the page depend on
 * something outside itself. An empty array means the page is self-contained.
 * O(n) time in the total size of the parts.
 */
export function findExternalReferences(parts: HtmlParts, allowedUrlLiterals: readonly string[]): string[] {
  return [
    ...findMarkupViolations(parts.markup),
    ...findCssViolations(parts.css),
    ...findJsViolations(parts.js, allowedUrlLiterals),
  ];
}
