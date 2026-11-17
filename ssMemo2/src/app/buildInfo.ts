// The build script writes the build id into <meta name="app-build">. Reading it from the page
// keeps the id out of the bundle, which lets the id be a hash of the bundle itself.
const BUILD_META_SELECTOR = 'meta[name="app-build"]';

export const UNKNOWN_BUILD_ID = 'unknown';

export function readBuildId(doc: Pick<Document, 'querySelector'>): string {
  const content = doc.querySelector(BUILD_META_SELECTOR)?.getAttribute('content')?.trim();
  return content ? content : UNKNOWN_BUILD_ID;
}
