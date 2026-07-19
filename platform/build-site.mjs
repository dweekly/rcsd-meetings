import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT_DIR = resolve(HERE, '..');
const DEFAULT_PUBLIC_BASE_URL = 'https://district-data-lab.pages.dev';
const ACTIVE_SCHEMA_VERSION = '0.1.0';
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const localeFiles = ['en-US.json', 'es-US.json'];

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

async function readJson(path, label = path) {
  return parseJson(await readFile(path, 'utf8'), label);
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(', ')}`);
  }
}

export function validateActiveConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('districts/active.json must be an object');
  }
  assertExactKeys(value, ['schemaVersion', 'districtSlugs'], 'districts/active.json');
  if (value.schemaVersion !== ACTIVE_SCHEMA_VERSION) {
    throw new Error(`districts/active.json schemaVersion must be ${ACTIVE_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(value.districtSlugs)) {
    throw new Error('districts/active.json districtSlugs must be an array');
  }

  const seen = new Set();
  for (const [index, slug] of value.districtSlugs.entries()) {
    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
      throw new Error(`districts/active.json districtSlugs[${index}] is not a safe district slug`);
    }
    if (seen.has(slug)) {
      throw new Error(`districts/active.json contains duplicate district slug: ${slug}`);
    }
    seen.add(slug);
  }
  return [...value.districtSlugs].sort();
}

function flattenShape(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`locale value at ${prefix || '/'} must be an object`);
  }
  const keys = [];
  for (const key of Object.keys(value).sort()) {
    const path = `${prefix}/${key}`;
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new Error(`locale value at ${path} must be a non-empty string`);
    }
    keys.push(path);
  }
  return keys;
}

export function validateLocaleParity(locales) {
  const [first, ...rest] = locales;
  const expected = flattenShape(first).join('\n');
  for (const locale of rest) {
    if (flattenShape(locale).join('\n') !== expected) {
      throw new Error('English and Spanish locale files must have identical structure');
    }
  }
  const routes = new Set();
  for (const locale of locales) {
    if (!SLUG_RE.test(locale.route)) throw new Error(`invalid locale route: ${locale.route}`);
    if (routes.has(locale.route)) throw new Error(`duplicate locale route: ${locale.route}`);
    routes.add(locale.route);
  }
  for (const locale of locales) {
    if (locale.otherLanguageRoute === locale.route || !routes.has(locale.otherLanguageRoute)) {
      throw new Error(`${locale.route} must link to another configured locale route`);
    }
  }
}

function normalizePublicBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('PUBLIC_BASE_URL must be an absolute HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('PUBLIC_BASE_URL must be a credential-free HTTPS origin');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('PUBLIC_BASE_URL must not include a path');
  }
  return url.origin;
}

function normalizeGeneratedAt(value) {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.valueOf())) throw new Error('generatedAt must be a valid timestamp');
  return parsedDate.toISOString();
}

function normalizeGitCommit(value) {
  if (value === 'local') return value;
  if (typeof value !== 'string' || !/^[0-9a-f]{7,40}$/.test(value)) {
    throw new Error('gitCommit must be "local" or a 7-40 character lowercase hexadecimal commit');
  }
  return value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function pageFrame({ locale, title, canonicalUrl, body }) {
  return `<!doctype html>
<html lang="${escapeHtml(locale.htmlLang)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <title>${escapeHtml(title)}</title>
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <link rel="stylesheet" href="/assets/site.css">
</head>
<body>
${body}
</body>
</html>
`;
}

function renderRoot(locales, publicBaseUrl) {
  const [english, spanish] = locales;
  return pageFrame({
    locale: english,
    title: english.siteName,
    canonicalUrl: `${publicBaseUrl}/`,
    body: `<main>
  <p class="eyebrow">${escapeHtml(english.contractLabel)} · <span lang="${escapeHtml(spanish.htmlLang)}">${escapeHtml(spanish.contractLabel)}</span></p>
  <h1>${escapeHtml(english.siteName)}</h1>
  <p class="lede">${escapeHtml(english.rootPrompt)} / <span lang="${escapeHtml(spanish.htmlLang)}">${escapeHtml(spanish.rootPrompt)}</span></p>
  <nav class="language-nav" aria-label="Language / Idioma">
    <a class="button" lang="${escapeHtml(english.htmlLang)}" href="/${escapeHtml(english.route)}/">${escapeHtml(english.languageName)}</a>
    <a class="button" lang="${escapeHtml(spanish.htmlLang)}" href="/${escapeHtml(spanish.route)}/">${escapeHtml(spanish.languageName)}</a>
  </nav>
</main>`,
  });
}

function renderLocaleIndex(locale, publicBaseUrl) {
  return pageFrame({
    locale,
    title: locale.pageTitle,
    canonicalUrl: `${publicBaseUrl}/${locale.route}/`,
    body: `<main>
  <nav class="language-switcher"><a href="/${escapeHtml(locale.otherLanguageRoute)}/" hreflang="${escapeHtml(locale.otherLanguageRoute)}">${escapeHtml(locale.otherLanguageName)}</a></nav>
  <p class="eyebrow">${escapeHtml(locale.eyebrow)}</p>
  <h1>${escapeHtml(locale.heading)}</h1>
  <p class="lede">${escapeHtml(locale.intro)}</p>
  <h2>${escapeHtml(locale.districtsHeading)}</h2>
  <p class="empty-state">${escapeHtml(locale.emptyState)}</p>
  <p class="meta"><a href="/api/v0/districts/index.json">${escapeHtml(locale.contractLabel)}</a></p>
</main>`,
  });
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function releaseId(generatedAt, gitCommit) {
  const time = generatedAt.replaceAll(/[-:.]/g, '');
  return `platform-${time}-${gitCommit.slice(0, 12)}`;
}

function safeOutputPath(outputDir, path) {
  const target = resolve(outputDir, path);
  if (!target.startsWith(`${resolve(outputDir)}${sep}`)) {
    throw new Error(`refusing to write outside output directory: ${path}`);
  }
  return target;
}

function assertSafeOutputDir(rootDir, outputDir) {
  const resolvedRoot = resolve(rootDir);
  const resolvedOutput = resolve(outputDir);
  const productionOutput = resolve(resolvedRoot, 'build/platform');
  const buildParent = resolve(resolvedRoot, 'build');
  const pathFromBuild = relative(buildParent, resolvedOutput);
  const testNamespace = pathFromBuild.split(sep)[0];
  const isTestOutput = pathFromBuild !== ''
    && pathFromBuild !== '..'
    && !pathFromBuild.startsWith(`..${sep}`)
    && testNamespace.startsWith('platform-test-');
  if (resolvedOutput !== productionOutput && !isTestOutput) {
    throw new Error('refusing to replace anything except build/platform or build/platform-test-*');
  }
}

async function assertOutputAncestorsAreNotSymlinks(rootDir, outputDir) {
  const buildParent = resolve(rootDir, 'build');
  const outputParent = dirname(resolve(outputDir));
  const parts = relative(buildParent, outputParent).split(sep).filter(Boolean);
  let current = buildParent;
  for (const part of ['', ...parts]) {
    if (part) current = join(current, part);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) {
        throw new Error(`refusing to write through symlinked output ancestor: ${relative(rootDir, current)}`);
      }
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }
}

/** Build the additive static lab. Validation finishes before output is replaced. */
export async function buildPlatformSite({
  rootDir = DEFAULT_ROOT_DIR,
  outputDir = join(rootDir, 'build/platform'),
  activeConfig,
  publicBaseUrl = process.env.PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL,
  generatedAt = new Date().toISOString(),
  gitCommit = process.env.GITHUB_SHA || 'local',
} = {}) {
  const root = resolve(rootDir);
  const output = resolve(outputDir);
  assertSafeOutputDir(root, output);
  await assertOutputAncestorsAreNotSymlinks(root, output);

  const baseUrl = normalizePublicBaseUrl(publicBaseUrl);
  const buildTime = normalizeGeneratedAt(generatedAt);
  const commit = normalizeGitCommit(gitCommit);
  const allowlist = activeConfig || await readJson(join(root, 'districts/active.json'));
  const districtSlugs = validateActiveConfig(allowlist);
  if (districtSlugs.length > 0) {
    throw new Error('district publication is disabled until dataset provenance, parity, safety, and lineage gates are implemented');
  }

  const locales = await Promise.all(localeFiles.map((file) => (
    readJson(join(root, 'platform/locales', file), `platform/locales/${file}`)
  )));
  validateLocaleParity(locales);

  const meetingSchema = await readFile(join(root, 'platform/schemas/meetings.schema.json'), 'utf8');
  parseJson(meetingSchema, 'platform/schemas/meetings.schema.json');
  const siteCss = await readFile(join(root, 'platform/styles/site.css'), 'utf8');

  const districtIndex = {
    apiVersion: 'v0',
    contractStatus: 'experimental',
    generatedAt: buildTime,
    districts: [],
    _metadata: {
      source: 'districts/active.json',
      scrapedAt: null,
      method: 'deterministic static build from an explicit publication allowlist',
    },
  };
  const release = {
    apiVersion: 'v0',
    contractStatus: 'experimental',
    releaseId: releaseId(buildTime, commit),
    generatedAt: buildTime,
    gitCommit: commit,
    publicBaseUrl: baseUrl,
    districtCount: 0,
    robots: 'noindex, nofollow, noarchive',
    routes: {
      districtIndex: `${baseUrl}/api/v0/districts/index.json`,
      meetingSchema: `${baseUrl}/api/v0/schemas/meetings.schema.json`,
    },
  };

  const files = new Map([
    ['_headers', `/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n`],
    ['_meta/release.json', json(release)],
    ['api/v0/districts/index.json', json(districtIndex)],
    ['api/v0/schemas/meetings.schema.json', meetingSchema.endsWith('\n') ? meetingSchema : `${meetingSchema}\n`],
    ['assets/site.css', siteCss.endsWith('\n') ? siteCss : `${siteCss}\n`],
    ['index.html', renderRoot(locales, baseUrl)],
  ]);

  for (const locale of locales) {
    files.set(`${locale.route}/index.html`, renderLocaleIndex(locale, baseUrl));
  }

  await rm(output, { recursive: true, force: true });
  for (const [path, contents] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const target = safeOutputPath(output, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, 'utf8');
  }

  return {
    outputDir: output,
    districtCount: 0,
    files: [...files.keys()].sort(),
  };
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  try {
    const result = await buildPlatformSite();
    console.log(`Built ${result.files.length} platform files for ${result.districtCount} districts in ${relative(process.cwd(), result.outputDir) || '.'}`);
  } catch (error) {
    console.error(`Platform build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
