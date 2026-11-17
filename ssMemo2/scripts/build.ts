// CLI entry: writes the single-file build to dist/index.html.
// build.sh / build.bat copy that file into release/.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildHtml } from './buildHtml.ts';

const outputDir = fileURLToPath(new URL('../dist/', import.meta.url));
const OUTPUT_FILE_NAME = 'index.html';

const { html, buildId } = await buildHtml();
await mkdir(outputDir, { recursive: true });
await writeFile(outputDir + OUTPUT_FILE_NAME, html, 'utf8');

const byteLength = Buffer.byteLength(html, 'utf8');
console.log(`[ssMemo2] dist/${OUTPUT_FILE_NAME}: ${byteLength} bytes, build ${buildId}`);
