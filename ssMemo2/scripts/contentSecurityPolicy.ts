// The content security policy of the built page.
//
// The build already refuses anything that would be loaded from outside. The policy makes the
// browser enforce the same at run time, and it is a second line of defence behind the Markdown
// renderer: even if markup from a memo ever got into the page as HTML, the script in it would not
// run, because only the one inline script whose hash is listed here may.
//
// It is delivered as a <meta> element, the only way a single file can carry it.
import { createHash } from 'node:crypto';

const HASH_ALGORITHM = 'sha256';

// What the HTML parser changes before the browser hashes the script: every carriage return
// becomes or joins a line feed, and NUL is replaced. A script containing either would get a hash
// in the browser that differs from the one computed here, and would be blocked.
const CARRIAGE_RETURN = '\r';
const NUL = '\0';

/**
 * The hash source for an inline script, e.g. 'sha256-…', computed over the UTF-8 bytes of exactly
 * the text between <script> and </script>. Throws if the parser would not keep that text as it is.
 */
export function hashInlineScript(script: string): string {
  if (script.includes(CARRIAGE_RETURN)) {
    throw new Error('Inline script contains a carriage return, which the HTML parser would change before hashing');
  }
  if (script.includes(NUL)) {
    throw new Error('Inline script contains a NUL character, which the HTML parser would replace before hashing');
  }
  return `${HASH_ALGORITHM}-${createHash(HASH_ALGORITHM).update(script, 'utf8').digest('base64')}`;
}

/** The policy for a page whose only script is `inlineScript`. */
export function buildContentSecurityPolicy(inlineScript: string): string {
  return [
    // Nothing is fetched, connected to, framed or embedded: the page is complete in itself.
    "default-src 'none'",
    // The hash belongs here and not in default-src, where it would apply to styles as well.
    `script-src '${hashInlineScript(inlineScript)}'`,
    // The stylesheet is inline, and the editor adds style elements of its own in browsers
    // without constructable stylesheets. Styles cannot run code.
    "style-src 'unsafe-inline'",
    // The page icon is a data URI.
    'img-src data:',
    // No <base> can redirect relative addresses, and no form can send anything anywhere.
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
