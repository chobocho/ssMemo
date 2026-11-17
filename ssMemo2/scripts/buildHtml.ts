// Builds the whole app into one self-contained HTML string.
// Exposed as a function (not only a CLI) so the output guard tests can call it in-process.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { BuildOptions } from 'esbuild';
import { en } from '../src/i18n/en.ts';
import { ko } from '../src/i18n/ko.ts';
import { escapeHtml } from '../src/lib/markdown.ts';
import { buildContentSecurityPolicy } from './contentSecurityPolicy.ts';
import { fillTemplate, prepareInlineScript, prepareInlineStyle } from './htmlTemplate.ts';
import { ALLOWED_URL_LITERALS, findExternalReferences } from './selfContained.ts';

const rootDir = fileURLToPath(new URL('../', import.meta.url));

const SCRIPT_ENTRY = 'src/main.ts';
const STYLE_ENTRY = 'src/styles/index.css';
const TEMPLATE_PATH = 'src/index.template.html';
const FAVICON_PATH = 'src/assets/favicon.svg';
const PACKAGE_PATH = 'package.json';

// Short enough to read aloud when reporting a problem, long enough to tell builds apart.
const BUILD_HASH_LENGTH = 8;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

const SHARED_BUNDLE_OPTIONS: BuildOptions = {
  absWorkingDir: rootDir,
  bundle: true,
  write: false,
  minify: true,
  // Keep Korean text as-is instead of \uXXXX escapes; the page declares UTF-8.
  charset: 'utf8',
  // Third-party notices are shown inside the app instead of as comments in the bundle.
  legalComments: 'none',
  sourcemap: false,
  // Problems are raised as exceptions below; esbuild must not print on its own.
  logLevel: 'silent',
  // Lists the files each bundle actually read, which is how unused sources are detected.
  metafile: true,
};

const SCRIPT_BUNDLE_OPTIONS: BuildOptions = {
  ...SHARED_BUNDLE_OPTIONS,
  entryPoints: [SCRIPT_ENTRY],
  platform: 'browser',
  // An IIFE keeps every top-level binding out of the global scope of the inline script.
  format: 'iife',
  target: 'es2022',
};

const STYLE_BUNDLE_OPTIONS: BuildOptions = {
  ...SHARED_BUNDLE_OPTIONS,
  entryPoints: [STYLE_ENTRY],
};

export interface BuildResult {
  html: string;
  /** `<package version>+<content hash>`, also embedded in the page as a meta tag. */
  buildId: string;
  /** Project-relative paths of every file that went into the page, sorted. */
  sourceFiles: string[];
}

interface Bundle {
  text: string;
  /** Project-relative paths of the files esbuild read for this bundle. */
  inputs: string[];
}

async function bundle(options: BuildOptions): Promise<Bundle> {
  const result = await build(options);
  if (result.warnings.length > 0) {
    const details = result.warnings.map((warning) => warning.text).join('\n- ');
    throw new Error(`Bundling produced warnings:\n- ${details}`);
  }
  const [output] = result.outputFiles ?? [];
  if (!output || result.outputFiles?.length !== 1) {
    throw new Error(`Expected exactly one bundled file for ${String(options.entryPoints)}`);
  }
  return { text: output.text.trimEnd(), inputs: Object.keys(result.metafile?.inputs ?? {}) };
}

async function readProjectFile(relativePath: string): Promise<Buffer> {
  return readFile(rootDir + relativePath);
}

async function readVersion(): Promise<string> {
  const pkg: unknown = JSON.parse((await readProjectFile(PACKAGE_PATH)).toString('utf8'));
  const version = typeof pkg === 'object' && pkg !== null && 'version' in pkg ? pkg.version : undefined;
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    throw new Error(`${PACKAGE_PATH} must declare a version like 1.2.3`);
  }
  return version;
}

// The hash covers everything that ends up in the page, so identical inputs give an identical id
// and any change to code, style, icon or template gives a new one.
function computeBuildId(version: string, contents: readonly string[]): string {
  const hash = createHash('sha256');
  for (const content of contents) {
    hash.update(content);
    hash.update('\0');
  }
  return `${version}+${hash.digest('hex').slice(0, BUILD_HASH_LENGTH)}`;
}

// The page's own words for "the app did not start". They cannot come from the app, which is
// exactly what is not running then, so both languages are written into the markup.
function renderBootMessage(): string {
  return [
    ['ko', ko['boot.failed']],
    ['en', en['boot.failed']],
  ]
    .map(([language, text]) => `<span lang="${language}">${escapeHtml(text ?? '')}</span>`)
    .join('');
}

export async function buildHtml(): Promise<BuildResult> {
  const [script, style, template, favicon, version] = await Promise.all([
    bundle(SCRIPT_BUNDLE_OPTIONS),
    bundle(STYLE_BUNDLE_OPTIONS),
    readProjectFile(TEMPLATE_PATH).then((buffer) => buffer.toString('utf8')),
    // base64 keeps any non-ASCII bytes in the SVG intact inside the attribute.
    readProjectFile(FAVICON_PATH).then((buffer) => buffer.toString('base64')),
    readVersion(),
  ]);

  const js = script.text;
  const css = style.text;
  const buildId = computeBuildId(version, [template, css, js, favicon]);
  // The script exactly as it goes into the page: the policy lists the hash of this very text.
  const inlineScript = prepareInlineScript(js);
  const pageValues = {
    FAVICON: `data:image/svg+xml;base64,${favicon}`,
    BUILD_ID: buildId,
    BOOT_MESSAGE: renderBootMessage(),
    CONTENT_SECURITY_POLICY: buildContentSecurityPolicy(inlineScript),
  };

  const markup = fillTemplate(template, { ...pageValues, STYLE: '', SCRIPT: '' });
  const violations = findExternalReferences({ markup, css, js }, ALLOWED_URL_LITERALS);
  if (violations.length > 0) {
    throw new Error(`Build output is not self-contained:\n- ${violations.join('\n- ')}`);
  }

  const html = fillTemplate(template, {
    ...pageValues,
    STYLE: prepareInlineStyle(css),
    SCRIPT: inlineScript,
  });
  const sourceFiles = [...script.inputs, ...style.inputs, TEMPLATE_PATH, FAVICON_PATH].sort();
  return { html, buildId, sourceFiles };
}
