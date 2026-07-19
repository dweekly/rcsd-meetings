#!/usr/bin/env node
/**
 * Headless verification for the reworked board-policies pages (Package C).
 * Serves docs/ on port 4201 with a minimal static server, then drives
 * Chromium via Playwright:
 *   1. EN index renders rows with AI summaries + AI note; search filters work.
 *   2. Click-through from an index row lands on the per-policy page.
 *   3. /politicas/5132-bp/ shows the Spanish body + machine-translation
 *      disclaimer linking to Simbli.
 *   4. A PDF-exhibit policy page features the Simbli PDF link (no empty body);
 *      its ES twin carries the yellow English-only note.
 *   5. A crossRef link navigates correctly in both languages.
 *   6. 320px viewport: no horizontal overflow on index + a long policy page.
 * Screenshots land in tmp/. Exits non-zero on any failure.
 */
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { existsSync, statSync, readdirSync, readFileSync } from 'fs';
import { resolve, extname, join, normalize } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const DOCS = resolve(ROOT, 'docs');
const TMP = resolve(ROOT, 'tmp');
const PORT = 4201;

const { policySlug } = await import(resolve(ROOT, 'scripts/lib/policy-slug.mjs'));

// Discover test targets from the data instead of hardcoding: the exhibit
// text-extraction pipeline runs concurrently and keeps shrinking the set of
// truly-empty (PDF-box) policies. Requires a build that matches data/.
const keyOf = (f) => f.replace(/\.json$/, '');
const policyFiles = readdirSync(resolve(ROOT, 'data/board-policies')).filter(f => f.endsWith('.json'));
const expectedSummaryCount = Object.keys(JSON.parse(readFileSync(resolve(ROOT, 'data/policy-summaries.json'), 'utf8')).summaries || {}).length;
let emptyKey = null;       // truly-empty contentText -> PDF box page
let extractedKey = null;   // "E PDF" exhibit WITH extracted text -> body page
for (const f of policyFiles) {
  const d = JSON.parse(readFileSync(resolve(ROOT, 'data/board-policies', f), 'utf8'));
  const hasText = !!(d.contentText || '').trim();
  if (!hasText && !emptyKey) emptyKey = keyOf(f);
  if (hasText && /E PDF/.test(f) && !extractedKey) extractedKey = keyOf(f);
}
const slugFromKey = (key) => {
  const m = key.match(/^(.*)-(BP|AR|BB|E)$/);
  return policySlug(m[1], m[2]);
};
const emptySlug = emptyKey ? slugFromKey(emptyKey) : null;
const extractedSlug = extractedKey ? slugFromKey(extractedKey) : null;
console.log(`Targets: empty exhibit = ${emptyKey || '(none)'}, extracted exhibit = ${extractedKey || '(none)'}`);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
    let filePath = normalize(join(DOCS, urlPath));
    if (!filePath.startsWith(DOCS)) { res.writeHead(403).end(); return; }
    if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, 'index.html');
    if (!existsSync(filePath)) { res.writeHead(404).end('not found'); return; }
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
});

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

await new Promise((r) => server.listen(PORT, r));
const browser = await chromium.launch();
const consoleErrors = [];
const page = await browser.newPage();
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', (err) => consoleErrors.push(String(err)));
const base = `http://localhost:${PORT}`;

// ---- 1. EN index ----
await page.goto(`${base}/policies/`, { waitUntil: 'networkidle' });
const rowCount = await page.locator('.policy-row').count();
check('EN index: 619 rows', rowCount === 619, `got ${rowCount}`);
const summaryCount = await page.locator('.policy-summary').count();
check(`EN index: ${expectedSummaryCount} source-backed summaries`, summaryCount === expectedSummaryCount, `got ${summaryCount}`);
const aiNote = await page.locator('.ai-summaries-note').textContent();
check('EN index: AI-summaries note present', /AI-generated/.test(aiNote || ''));
// Search by a summary-only word: "gender identity" appears in 5132's summary.
await page.fill('#search-input', 'gender identity');
await page.waitForTimeout(150);
const visibleAfterSearch = await page.locator('.policy-row:visible').count();
const row5132Visible = await page.locator('[id="5132-bp"]:visible').count();
check('EN index: search matches summary text', visibleAfterSearch > 0 && row5132Visible === 1, `${visibleAfterSearch} visible`);
// Synonym layer: "uniforme" should surface 5132 (dress code).
await page.fill('#search-input', 'uniforme');
await page.waitForTimeout(150);
check('EN index: synonym keyword works', (await page.locator('[id="5132-bp"]:visible').count()) === 1);
// Type filter.
await page.fill('#search-input', '');
await page.click('.filter-btn[data-filter="AR"]');
await page.waitForTimeout(150);
const arVisible = await page.locator('.policy-row:visible').count();
check('EN index: AR filter shows 260', arVisible === 260, `got ${arVisible}`);
await page.click('.filter-btn[data-filter="all"]');
await page.screenshot({ path: join(TMP, 'verify-index-en.png'), fullPage: false });

// ---- 2. Click-through ----
// Clearing filters intentionally collapses the accordion. Open the row's
// native <details> container before exercising the real click-through.
await page.locator('[id="5132-bp"]').evaluate((row) => { row.closest('details').open = true; });
await page.click('[id="5132-bp"]');
await page.waitForLoadState('networkidle');
check('Click-through: lands on /policies/5132-bp/', page.url() === `${base}/policies/5132-bp/`, page.url());
const h1 = await page.locator('.policy-head h1').textContent();
check('EN policy page: title', (h1 || '').trim() === 'Dress And Grooming', h1);
const bodyLen = ((await page.locator('.policy-body-text').textContent()) || '').length;
check('EN policy page: full body rendered', bodyLen > 3000, `${bodyLen} chars`);
check('EN policy page: official Simbli link', (await page.locator('.policy-meta-links a[href*="simbli"]').count()) === 1);
check('EN policy page: View JSON link', (await page.locator('.policy-meta-links a[href="/board-policies/5132-BP.json"]').count()) === 1);
check('EN policy page: no ES disclaimer', (await page.locator('.policy-es-note').count()) === 0);
check('EN policy page: provenance panel', (await page.locator('.policy-provenance').count()) === 1);
check('EN policy page: shared provenance stylesheet', (await page.locator('link[rel="stylesheet"][href="/styles/policy-provenance.css"]').count()) === 1);
const provenanceLayout = await page.locator('.policy-provenance dl').evaluate((node) => getComputedStyle(node).display);
check('EN policy page: provenance stylesheet loaded', provenanceLayout === 'grid', provenanceLayout);
check('EN policy page: provenance JSON link', (await page.locator('.policy-provenance a[href*="/json/provenance/rcsd.board-policies.json"]').count()) === 1);
const enLangToggle = await page.locator('.site-nav-lang').getAttribute('href');
check('EN policy page: lang toggle -> ES twin', enLangToggle === '/politicas/5132-bp/', enLangToggle);
await page.screenshot({ path: join(TMP, 'verify-policy-5132-en.png') });

// ---- 3. ES translated policy ----
await page.goto(`${base}/politicas/5132-bp/`, { waitUntil: 'networkidle' });
const esH1 = await page.locator('.policy-head h1').textContent();
check('ES policy page: translated title', (esH1 || '').includes('Vestimenta'), esH1);
const esNote = await page.locator('.policy-es-note').textContent();
check('ES policy page: MT disclaimer present', /Traducción automática \(IA\)/.test(esNote || ''));
const esNoteLink = await page.locator('.policy-es-note a').getAttribute('href');
check('ES policy page: disclaimer links to Simbli', /^https:\/\/simbli\.eboardsolutions\.com\//.test(esNoteLink || ''), esNoteLink);
const esBody = (await page.locator('.policy-body-text').textContent()) || '';
check('ES policy page: Spanish body', esBody.includes('Mesa Directiva'), esBody.slice(0, 60));
check('ES policy page: View JSON -> ES json', (await page.locator('.policy-meta-links a[href="/board-policies-es/5132-BP.json"]').count()) === 1);
check('ES policy page: provenance panel', (await page.locator('.policy-provenance').count()) === 1);
check('ES policy page: translation provenance JSON link', (await page.locator('.policy-provenance a[href*="/json/provenance/rcsd.board-policies-es.json"]').count()) === 1);
const esLangToggle = await page.locator('.site-nav-lang').getAttribute('href');
check('ES policy page: lang toggle -> EN twin', esLangToggle === '/policies/5132-bp/', esLangToggle);
check('ES policy page: hreflang pair', (await page.locator('link[hreflang="en"][href$="/policies/5132-bp/"]').count()) === 1);
await page.screenshot({ path: join(TMP, 'verify-policy-5132-es.png') });

// ---- 4. PDF exhibit fallback ----
if (emptySlug) {
  await page.goto(`${base}/policies/${emptySlug}/`, { waitUntil: 'networkidle' });
  check(`EN exhibit (${emptySlug}): featured PDF box`, (await page.locator('.policy-exhibit').count()) === 1);
  check('EN exhibit: Simbli PDF link', (await page.locator('.policy-exhibit a[href*="simbli"]').count()) === 1);
  check('EN exhibit: no empty body div', (await page.locator('.policy-body-text').count()) === 0);
  await page.screenshot({ path: join(TMP, 'verify-exhibit-en.png') });
  await page.goto(`${base}/politicas/${emptySlug}/`, { waitUntil: 'networkidle' });
  check('ES exhibit: yellow English-only note', (await page.locator('.policy-lang-note').count()) === 1);
  check('ES exhibit: featured PDF box', (await page.locator('.policy-exhibit').count()) === 1);
  await page.screenshot({ path: join(TMP, 'verify-exhibit-es.png') });
} else {
  console.log('SKIP  exhibit checks — no empty-contentText policy left in data/');
}
// A formerly-empty exhibit that now has extracted PDF text renders a body.
if (extractedSlug) {
  await page.goto(`${base}/policies/${extractedSlug}/`, { waitUntil: 'networkidle' });
  check(`EN extracted exhibit (${extractedSlug}): renders body text`, ((await page.locator('.policy-body-text').textContent()) || '').trim().length > 50);
}

// ---- 5. CrossRef navigation, both languages ----
await page.goto(`${base}/policies/5132-bp/`, { waitUntil: 'networkidle' });
await page.click('.xref-item a[href="/policies/0450-ar/"]');
await page.waitForLoadState('networkidle');
const xrefH1 = await page.locator('.policy-head h1').textContent();
check('EN crossRef: navigates to 0450 AR', page.url() === `${base}/policies/0450-ar/` && /Safety Plan/.test(xrefH1 || ''), `${page.url()} "${xrefH1}"`);
await page.goto(`${base}/politicas/5132-bp/`, { waitUntil: 'networkidle' });
await page.click('.xref-item a[href="/politicas/0450-ar/"]');
await page.waitForLoadState('networkidle');
const xrefEsH1 = await page.locator('.policy-head h1').textContent();
check('ES crossRef: navigates to /politicas/0450-ar/', page.url() === `${base}/politicas/0450-ar/` && /seguridad/i.test(xrefEsH1 || ''), `${page.url()} "${xrefEsH1}"`);
// Out-of-catalog refs stay plain text.
await page.goto(`${base}/policies/5132-bp/`, { waitUntil: 'networkidle' });
const plainRef = await page.locator('.xref-item:has-text("5131 AR") a').count();
check('EN crossRef: out-of-catalog ref is plain text', plainRef === 0);

// ---- 6. 320px viewport ----
const narrow = await browser.newPage({ viewport: { width: 320, height: 900 } });
const overflow = async (url) => {
  const resp = await narrow.goto(`${base}${url}`, { waitUntil: 'networkidle' });
  if (!resp || resp.status() !== 200) return { ox: NaN, rendered: false };
  const rendered = (await narrow.locator('h1').count()) > 0;
  const ox = await narrow.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  return { ox, rendered };
};
// 5144.1-AR is the longest policy body (51KB, 78 legal refs);
// 5145.6-E PDF(1)-AR carries 214 legal refs and renders the English-fallback
// path on /politicas/. Both stress long unbroken citations at 320px.
for (const [url, shot] of [
  ['/policies/', 'verify-320-index-en.png'],
  ['/politicas/', 'verify-320-index-es.png'],
  ['/policies/5144.1-ar/', 'verify-320-policy-en.png'],
  ['/politicas/5145.6-e-pdf-1-ar/', 'verify-320-policy-es.png'],
]) {
  const { ox, rendered } = await overflow(url);
  check(`320px: page renders + no horizontal overflow on ${url}`, rendered && ox <= 0, `overflow ${ox}px, rendered=${rendered}`);
  await narrow.screenshot({ path: join(TMP, shot) });
}

check('No console errors across all pages', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
