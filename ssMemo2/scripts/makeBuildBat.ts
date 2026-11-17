// CLI entry: regenerates build.bat (cp949 + CRLF) from its UTF-8 template.
// Run it with "npm run gen:bat" after editing scripts/build.bat.template.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderBuildBat } from './buildBat.ts';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const TEMPLATE_PATH = 'scripts/build.bat.template';
const OUTPUT_PATH = 'build.bat';

const template = await readFile(rootDir + TEMPLATE_PATH, 'utf8');
const bytes = renderBuildBat(template);
await writeFile(rootDir + OUTPUT_PATH, bytes);

console.log(`[ssMemo2] ${OUTPUT_PATH}: ${bytes.length} bytes (cp949 + CRLF) from ${TEMPLATE_PATH}`);
