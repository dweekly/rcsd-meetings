#!/usr/bin/env node
/**
 * scrape-warrant-pdfs.mjs — Backfill monthly warrant-register PDFs from BoardDocs.
 *
 * The district's monthly warrant registers (board-ratified lists of every check issued)
 * are agenda attachments. The Simbli-era ones (~Jun 2025+) were already downloaded by
 * scrape-board-packets.mjs; the BoardDocs-era ones (Mar 2020 – May 2025) were never pulled
 * and live only on the vendor portal. Every BoardDocs warrant attachment carries a direct
 * `$file` href in data/meetings-data.json, so this script downloads them over plain HTTPS.
 *
 * Empirically verified 2026-06-24 (see WARRANTS.md):
 *   - BoardDocs `$file` URLs 403 on a bare User-Agent; a full browser UA + polite spacing works.
 *   - PDFs are saved alongside other packet attachments and sync to R2 via upload-to-r2.mjs.
 *
 * Usage:
 *   node scripts/scrape-warrant-pdfs.mjs            # download all missing BoardDocs registers
 *   node scripts/scrape-warrant-pdfs.mjs --dry-run  # list what would be downloaded
 *   node scripts/scrape-warrant-pdfs.mjs --limit 3  # stop after N downloads (probe)
 *   node scripts/scrape-warrant-pdfs.mjs --force     # re-download even if a valid PDF exists
 *   node scripts/scrape-warrant-pdfs.mjs --date 2020-04-22  # single meeting
 *
 * Idempotent: an existing valid PDF (%PDF- magic, >1KB) is skipped unless --force.
 * Output manifest: data/warrant-pdf-manifest.json (provenance for the extractor in PR2).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, openSync, readSync, closeSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// A real browser UA is required — BoardDocs returns HTTP 403 to a bare "Mozilla/5.0".
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Polite pacing between downloads (ms). BoardDocs tolerated ~2s spacing in testing.
const DELAY_BETWEEN_DOWNLOADS = { min: 2000, max: 4000 };
const FETCH_TIMEOUT_MS = 60000;
const MAX_RETRIES = 3;

const PUBLIC_R2_BASE = 'https://data.rcsd.info/board-packets';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function randomDelay({ min, max }) {
  return delay(min + Math.random() * (max - min));
}

// Mirror scrape-board-packets.mjs so warrant PDFs sit alongside other packet attachments.
function sanitizeFilename(name, maxLen = 80) {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, maxLen);
}

function isValidPdf(filePath) {
  try {
    if (statSync(filePath).size < 1024) return false;
    const buf = Buffer.alloc(5);
    const fd = openSync(filePath, 'r');
    readSync(fd, buf, 0, 5, 0);
    closeSync(fd);
    return buf.toString('ascii') === '%PDF-';
  } catch {
    return false;
  }
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * Best-effort covered month (YYYY-MM) + range from a warrant-item title.
 * e.g. "Ratification of Warrant Register, March 1, 2020-March 31, 2020" -> { month: "2020-03", ... }
 * The PDF itself carries the authoritative From/To dates; the extractor (PR2) reads those.
 */
function coveredFromTitle(title) {
  const m = (title || '').match(
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+(\d{4})/i,
  );
  if (!m) return { month: null, range: null };
  const monthNum = String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0');
  return { month: `${m[2]}-${monthNum}`, range: title.replace(/^[^,]*,\s*/, '').trim() };
}

// Derive a stable local filename from the source href (decoded), falling back to the title.
function filenameFor(href, title) {
  let base = '';
  try {
    base = decodeURIComponent(new URL(href).pathname.split('/').pop() || '');
  } catch {
    base = '';
  }
  base = base.replace(/\.pdf$/i, '');
  if (!base) base = title || 'warrant-register';
  return sanitizeFilename(base) + '.pdf';
}

async function fetchPdf(url, referer) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/pdf,*/*',
        ...(referer ? { Referer: referer } : {}),
      },
    });
    const buf = Buffer.from(await resp.arrayBuffer());
    return { status: resp.status, buf };
  } finally {
    clearTimeout(timer);
  }
}

// Collect every BoardDocs warrant attachment (those with a direct href) from meetings-data.json.
function collectTargets(meetingsData, filterDate) {
  const meetings = Array.isArray(meetingsData)
    ? meetingsData
    : meetingsData.meetings || Object.values(meetingsData);
  const targets = [];
  for (const m of meetings) {
    if (filterDate && m.date !== filterDate) continue;
    for (const item of m.items || []) {
      if (!/warrant/i.test(item.title || '')) continue;
      for (const att of item.attachments || []) {
        if (!att.href) continue; // Simbli-era items have no href and are already local.
        if (!/boarddocs\.com/i.test(att.href)) continue;
        const { month, range } = coveredFromTitle(item.title);
        targets.push({
          meetingDate: m.date,
          mid: m.mid ?? null,
          itemLabel: item.itemLabel ?? null,
          title: item.title,
          coveredMonth: month,
          coveredRange: range,
          sourceHref: att.href,
          sourceTitle: att.title ?? null,
          referer: item.url ?? null,
          filename: filenameFor(att.href, att.title || item.title),
        });
      }
    }
  }
  return targets;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : Infinity;
  const filterDate = args.includes('--date') ? args[args.indexOf('--date') + 1] : null;

  const meetingsData = JSON.parse(readFileSync(resolve(ROOT, 'data/meetings-data.json'), 'utf8'));
  const targets = collectTargets(meetingsData, filterDate);

  console.log(`Found ${targets.length} BoardDocs warrant register(s) referenced in meetings-data.json`);
  if (filterDate) console.log(`  (filtered to meeting ${filterDate})`);

  const manifest = [];
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const t of targets) {
    const dir = resolve(ROOT, 'artifacts/board-packets', t.meetingDate);
    const localPath = resolve(dir, t.filename);
    const relPath = `artifacts/board-packets/${t.meetingDate}/${t.filename}`;
    const r2Url = `${PUBLIC_R2_BASE}/${t.meetingDate}/${t.filename}`;

    const entry = {
      meetingDate: t.meetingDate,
      mid: t.mid,
      itemLabel: t.itemLabel,
      title: t.title,
      coveredMonth: t.coveredMonth,
      coveredRange: t.coveredRange,
      source: 'boarddocs',
      sourceHref: t.sourceHref,
      filename: t.filename,
      localPath: relPath,
      r2Url,
      bytes: null,
      sha256: null,
      httpStatus: null,
      status: null,
      fetchedAt: null,
    };

    // Idempotent skip.
    if (!force && existsSync(localPath) && isValidPdf(localPath)) {
      entry.bytes = statSync(localPath).size;
      entry.sha256 = sha256(localPath);
      entry.status = 'skipped-existing';
      manifest.push(entry);
      skipped++;
      console.log(`  SKIP  ${t.meetingDate}  ${t.coveredMonth || '????-??'}  ${t.filename} (already valid)`);
      continue;
    }

    if (dryRun) {
      entry.status = 'would-download';
      manifest.push(entry);
      console.log(`  PLAN  ${t.meetingDate}  ${t.coveredMonth || '????-??'}  ${t.filename}\n          <- ${t.sourceHref}`);
      continue;
    }

    if (downloaded >= limit) {
      entry.status = 'limit-reached';
      manifest.push(entry);
      continue;
    }

    mkdirSync(dir, { recursive: true });
    let ok = false;
    for (let attempt = 1; attempt <= MAX_RETRIES && !ok; attempt++) {
      try {
        const { status, buf } = await fetchPdf(t.sourceHref, t.referer);
        entry.httpStatus = status;
        const looksPdf = buf.length > 1024 && buf.subarray(0, 5).toString('ascii') === '%PDF-';
        if (status === 200 && looksPdf) {
          writeFileSync(localPath, buf);
          entry.bytes = buf.length;
          entry.sha256 = createHash('sha256').update(buf).digest('hex');
          entry.status = 'downloaded';
          entry.fetchedAt = new Date().toISOString();
          ok = true;
          downloaded++;
          console.log(`  OK    ${t.meetingDate}  ${t.coveredMonth || '????-??'}  ${t.filename} (${buf.length} bytes)`);
        } else {
          console.warn(`  WARN  ${t.meetingDate}  HTTP ${status}, ${buf.length}b, pdf=${looksPdf} (attempt ${attempt}/${MAX_RETRIES})`);
          if (attempt < MAX_RETRIES) await delay(3000 * attempt);
        }
      } catch (err) {
        console.warn(`  ERR   ${t.meetingDate}  ${err.message} (attempt ${attempt}/${MAX_RETRIES})`);
        if (attempt < MAX_RETRIES) await delay(3000 * attempt);
      }
    }
    if (!ok) {
      entry.status = 'failed';
      if (existsSync(localPath) && !isValidPdf(localPath)) unlinkSync(localPath);
      failed++;
    }
    manifest.push(entry);
    await randomDelay(DELAY_BETWEEN_DOWNLOADS);
  }

  // Write manifest (sorted by covered month then meeting date) with provenance metadata.
  manifest.sort((a, b) =>
    (a.coveredMonth || '').localeCompare(b.coveredMonth || '') ||
    a.meetingDate.localeCompare(b.meetingDate));
  const out = {
    _metadata: {
      description:
        'Download manifest for BoardDocs-era monthly warrant-register PDFs (board-ratified check registers). ' +
        'Simbli-era registers (~Jun 2025+) are downloaded by scrape-board-packets.mjs and not listed here.',
      source: 'data/meetings-data.json warrant attachments (go.boarddocs.com $file URLs)',
      script: 'scripts/scrape-warrant-pdfs.mjs',
      generated: new Date().toISOString().slice(0, 10),
      counts: { total: targets.length, downloaded, skipped, failed },
    },
    registers: manifest,
  };
  if (!dryRun || filterDate) {
    const manifestPath = resolve(ROOT, 'data/warrant-pdf-manifest.json');
    writeFileSync(manifestPath, JSON.stringify(out, null, 2) + '\n');
    console.log(`\nManifest: ${manifestPath}`);
  }
  console.log(`\nDone. downloaded=${downloaded} skipped=${skipped} failed=${failed} (of ${targets.length})`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
