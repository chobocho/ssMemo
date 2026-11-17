// Pure string helpers for assembling the single-file index.html.
// They do no I/O so the error-prone parts (placeholder accounting, inline escaping) are unit-testable.

// Placeholders in src/index.template.html look like %%NAME%%.
const PLACEHOLDER_PATTERN = /%%([A-Z][A-Z0-9_]*)%%/g;

// Inside <script>, "<!--" switches the HTML tokenizer into an escaped state in which a later
// "<script" makes the real "</script>" stop closing the element. "\x3C" is "<" in string,
// template and regex literals alike (unicode-mode regexes included), so the meaning is unchanged.
// Limitation: a tagged template that reads String.raw would see the escape; the bundle has none.
const HTML_COMMENT_OPEN = '<!--';
const ESCAPED_HTML_COMMENT_OPEN = '\\x3C!--';

const SCRIPT_END_PATTERN = /<\/script/i;
const STYLE_END_PATTERN = /<\/style/i;

/**
 * Replaces each %%NAME%% placeholder in `template` with `values[NAME]`.
 *
 * Every provided value must be used exactly once: a missing, unused or repeated placeholder
 * means the template and the build script disagree, and the page would silently lose a part.
 * A replacer function is used so "$&"-style sequences in minified code are inserted literally,
 * and the single pass means inserted values are never scanned for placeholders themselves.
 * O(n) time in the template length.
 */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  const useCounts = new Map<string, number>();
  const filled = template.replace(PLACEHOLDER_PATTERN, (_match, name: string) => {
    if (!Object.hasOwn(values, name)) {
      throw new Error(`Template placeholder %%${name}%% has no value`);
    }
    useCounts.set(name, (useCounts.get(name) ?? 0) + 1);
    return values[name] ?? '';
  });
  for (const name of Object.keys(values)) {
    const useCount = useCounts.get(name) ?? 0;
    if (useCount !== 1) {
      throw new Error(`Template value ${name} must be used exactly once but was used ${useCount} times`);
    }
  }
  return filled;
}

/**
 * Makes bundled JavaScript safe to place inside an inline <script> element.
 *
 * "</script" is rejected rather than rewritten: the bundler already escapes it wherever that is
 * safe, and a blind textual rewrite would break code such as `a</script/.test(b)`.
 */
export function prepareInlineScript(js: string): string {
  if (SCRIPT_END_PATTERN.test(js)) {
    throw new Error('Inline script contains "</script", which would close the script element early');
  }
  return js.replaceAll(HTML_COMMENT_OPEN, ESCAPED_HTML_COMMENT_OPEN);
}

/** Verifies bundled CSS is safe to place inside an inline <style> element. */
export function prepareInlineStyle(css: string): string {
  if (STYLE_END_PATTERN.test(css)) {
    throw new Error('Inline style contains "</style", which would close the style element early');
  }
  return css;
}
