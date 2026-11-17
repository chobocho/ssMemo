// Shared file-system helpers for tests that inspect the project tree itself.
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Project-relative, forward-slash paths of all files under `dir` whose name ends with one of
 * `suffixes`, sorted. Pass [''] to list every file.
 */
export function listFiles(dir: string, suffixes: readonly string[]): string[] {
  return readdirSync(join(rootDir, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && suffixes.some((suffix) => entry.name.endsWith(suffix)))
    .map((entry) => relative(rootDir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}
