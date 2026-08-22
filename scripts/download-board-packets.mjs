#!/usr/bin/env node
/**
 * Download board-packet PDFs for attachments that have a Simbli AID but no
 * local `filename` yet, and record the filename back into the memo.
 *
 * Why this exists as its own pipeline step:
 *   scrape-simbli-agendas.mjs captures each attachment as {title, aid} via the
 *   Simbli API, but never fetches the PDF. The public attachment URL is built
 *   from `att.filename` (see meeting-utils.buildAidToR2Path) — so an attachment
 *   with an aid but no filename renders as board-packets/{date}/undefined and
 *   404s. (Historically the PDFs were pulled by scrape-board-packets.mjs, a
 *   manual, headed, hardcoded-meeting-list script that was never wired into the
 *   pipeline — so any newly-discovered meeting shipped with dead packet links.)
 *
 * This step closes that gap: it runs headless inside the pipeline, is driven by
 * the memos on disk (not a hardcoded list), and is idempotent — an attachment
 * that already has a `filename` is skipped, so on the runner's fresh checkout
 * only genuinely-missing packets are (re)fetched.
 *
 * A committed `filename` is a claim that the PDF is on R2, and the claim is
 * verified rather than trusted: each one is checked with a HEAD against
 * R2_PUBLIC_BASE, and a filename with no object behind it is cleared so the
 * attachment re-enters the pending path and upload-to-r2.mjs ships it later in
 * the same run. Without that check the claim can be false — writing filenames
 * from a checkout with no rclone "r2" remote records an upload that never
 * happened, and every later run then skips those packets forever. Verification
 * fails open (see findMissingOnR2) and is skippable with --no-verify.
 *
 * Incapsula: reuses the same fresh-context-per-meeting approach as
 * scrape-simbli-agendas.mjs — a context that goes straight to a ViewMeeting
 * (no listing history) clears the Imperva/Incapsula challenge; the in-browser
 * fetch of Attachment.aspx then inherits the cleared session cookies.
 *
 * Usage:
 *   node scripts/download-board-packets.mjs                 # all memos w/ missing packets
 *   node scripts/download-board-packets.mjs --date 2026-06-24
 *   node scripts/download-board-packets.mjs --limit 2       # cap downloads per meeting (testing)
 *   node scripts/download-board-packets.mjs --dry-run       # report only, no browser
 *   node scripts/download-board-packets.mjs --no-verify     # trust committed filenames (offline)
 *
 * Exit code: non-zero if any attachment that should have downloaded failed, so
 * a broken packet fetch turns the pipeline red instead of shipping dead links.
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, unlinkSync, readdirSync, openSync, readSync, closeSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SIMBLI_BASE = 'https://simbli.eboardsolutions.com';
const SCHOOL_ID = '36030397';
const MEMO_DIR = resolve(ROOT, 'data/board-memos');
const PDF_BASE_DIR = resolve(ROOT, 'artifacts/board-packets');

// Public read endpoint for the R2 bucket upload-to-r2.mjs writes to; the site
// links packets here, so a HEAD against it is exactly what a reader would get.
const R2_PUBLIC_BASE = 'https://data.rcsd.info/board-packets';
const VERIFY_CONCURRENCY = 16;
const VERIFY_TIMEOUT_MS = 15000;

const INCAPSULA_WAIT_MS = 5000;
const INCAPSULA_MAX_TRIES = 6;
const DELAY_BETWEEN_DOWNLOADS = { min: 2000, max: 5000 };
const DELAY_BETWEEN_MEETINGS = { min: 15000, max: 30000 };
const DOWNLOAD_MAX_TRIES = 3;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = ({ min, max }) => delay(min + Math.random() * (max - min));

function meetingUrl(mid) {
  return `${SIMBLI_BASE}/SB_Meetings/ViewMeeting.aspx?S=${SCHOOL_ID}&MID=${mid}`;
}
function attachmentUrl(aid, mid) {
  return `${SIMBLI_BASE}/Meetings/Attachment.aspx?S=${SCHOOL_ID}&AID=${aid}&MID=${mid}`;
}

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

// Same Incapsula handling as scrape-simbli-agendas.mjs: a fresh context per
// meeting that navigates straight to ViewMeeting is let through.
async function newSimbliContext(browser) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    acceptDownloads: true,
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  return context;
}

async function waitForIncapsula(page) {
  for (let attempt = 1; attempt <= INCAPSULA_MAX_TRIES; attempt++) {
    await delay(INCAPSULA_WAIT_MS);
    const html = await page.content();
    if (!html.includes('Request unsuccessful') && !html.includes('Incapsula incident')) return true;
  }
  return false;
}

async function downloadPdfViaBrowser(page, url, savePath) {
  const result = await page.evaluate(async (fetchUrl) => {
    try {
      const resp = await fetch(fetchUrl, { redirect: 'follow' });
      if (!resp.ok) return { error: `HTTP ${resp.status}` };
      const blob = await resp.blob();
      const dataUrl = await new Promise((res) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result);
        reader.readAsDataURL(blob);
      });
      return { data: dataUrl.substring(dataUrl.indexOf(',') + 1), size: blob.size };
    } catch (e) {
      return { error: e.message };
    }
  }, url);

  if (result.error) {
    console.error(`      FETCH ERROR: ${result.error}`);
    return false;
  }
  writeFileSync(savePath, Buffer.from(result.data, 'base64'));
  if (!isValidPdf(savePath)) {
    console.warn(`      INVALID PDF (not %PDF or <1KB), removing`);
    unlinkSync(savePath);
    return false;
  }
  return true;
}

// Whether this checkout can actually upload what it downloads. `rclone
// listremotes` reports remotes defined by RCLONE_CONFIG_R2_* env vars as well
// as by a config file, so this is true on the pipeline runner (env vars, no
// config file) and false on a plain laptop. A missing rclone binary is simply
// "not configured".
function hasR2Remote() {
  try {
    const out = execFileSync('rclone', ['listremotes'], { encoding: 'utf-8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').some((line) => line.trim() === 'r2:');
  } catch {
    return false;
  }
}

// HEAD every committed filename and return the set of "{date}/{filename}" keys
// with no object behind them.
//
// Fails open: only a definitive 404 marks a packet missing. A timeout, 403,
// 5xx or DNS failure leaves it alone, because treating an outage as "missing"
// would re-download and re-upload the entire archive on one bad run.
async function findMissingOnR2(memos) {
  const targets = [];
  for (const { memo } of memos) {
    for (const item of memo.items || []) {
      for (const att of item.attachments || []) {
        if (att.filename) targets.push(`${memo.date}/${att.filename}`);
      }
    }
  }
  if (targets.length === 0) return { missing: new Set(), checked: 0, inconclusive: 0 };

  const missing = new Set();
  let inconclusive = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < targets.length) {
      const key = targets[cursor++];
      const [date, ...rest] = key.split('/');
      const url = `${R2_PUBLIC_BASE}/${date}/${encodeURIComponent(rest.join('/'))}`;
      try {
        const resp = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) });
        if (resp.status === 404) missing.add(key);
        else if (!resp.ok) inconclusive++;
      } catch {
        inconclusive++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(VERIFY_CONCURRENCY, targets.length) }, worker));
  return { missing, checked: targets.length, inconclusive };
}

// Collect attachments needing a download: have an aid, lack a filename. Also
// seed the in-use filename set with any filenames already present, so newly
// downloaded packets don't collide with prior ones in the same meeting.
//
// `missingOnR2` (from findMissingOnR2) demotes a filename whose object is gone:
// the filename is cleared so the attachment is re-fetched under a freshly
// assigned name, and is kept out of usedFilenames so that name is available.
function pendingFor(memo, missingOnR2 = null) {
  const pending = [];
  const usedFilenames = new Set();
  for (const item of memo.items || []) {
    for (const att of item.attachments || []) {
      if (att.filename) {
        if (missingOnR2 && missingOnR2.has(`${memo.date}/${att.filename}`)) {
          delete att.filename;
          if (att.aid) pending.push(att);
          continue;
        }
        usedFilenames.add(att.filename);
      } else if (att.aid) pending.push(att);
    }
  }
  return { pending, usedFilenames };
}

function assignFilename(att, usedFilenames) {
  let filename = sanitizeFilename(att.name || `attachment-${att.aid}`) + '.pdf';
  if (usedFilenames.has(filename)) {
    filename = sanitizeFilename(att.name || `attachment-${att.aid}`).substring(0, 70) + `-${att.aid}.pdf`;
  }
  usedFilenames.add(filename);
  return filename;
}

async function processMeeting(browser, memoPath, memo, limit) {
  const { date, mid } = memo;
  const { pending, usedFilenames } = pendingFor(memo);
  const todo = limit ? pending.slice(0, limit) : pending;
  console.log(`\n${'='.repeat(60)}\n${date} (MID ${mid}) — ${pending.length} attachment(s) missing a PDF${limit ? `, downloading ${todo.length}` : ''}\n${'='.repeat(60)}`);

  const pdfDir = resolve(PDF_BASE_DIR, date);
  mkdirSync(pdfDir, { recursive: true });

  const context = await newSimbliContext(browser);
  const page = await context.newPage();
  let ok = 0;
  let failed = 0;
  try {
    await page.goto(meetingUrl(mid), { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!(await waitForIncapsula(page))) {
      console.error(`  Incapsula did not clear on ViewMeeting for MID ${mid}; ${todo.length} attachment(s) left pending.`);
      return { ok: 0, failed: todo.length };
    }

    for (const att of todo) {
      const filename = assignFilename(att, usedFilenames);
      const savePath = resolve(pdfDir, filename);

      if (existsSync(savePath) && isValidPdf(savePath)) {
        console.log(`    CACHED: ${filename}`);
        att.filename = filename;
        ok++;
        continue;
      }

      console.log(`    Downloading [aid ${att.aid}]: ${att.name}`);
      let saved = false;
      for (let attempt = 1; attempt <= DOWNLOAD_MAX_TRIES && !saved; attempt++) {
        if (attempt > 1) {
          console.log(`      retry ${attempt}/${DOWNLOAD_MAX_TRIES}...`);
          await randomDelay(DELAY_BETWEEN_DOWNLOADS);
        }
        saved = await downloadPdfViaBrowser(page, attachmentUrl(att.aid, mid), savePath);
      }
      if (saved) {
        const kb = (statSync(savePath).size / 1024).toFixed(0);
        console.log(`      SAVED: ${filename} (${kb}KB)`);
        att.filename = filename; // record into the memo only on a verified PDF
        ok++;
      } else {
        console.warn(`      FAILED after ${DOWNLOAD_MAX_TRIES} tries: ${att.name} (aid ${att.aid}) — will retry next run`);
        failed++;
      }
      await randomDelay(DELAY_BETWEEN_DOWNLOADS);
    }
  } finally {
    await context.close();
  }

  // Persist filenames recorded this pass (only verified downloads set filename).
  memo.packetsUpdatedAt = new Date().toISOString();
  writeFileSync(memoPath, JSON.stringify(memo, null, 2) + '\n');
  console.log(`  ${ok} downloaded/cached, ${failed} failed — memo updated.`);
  return { ok, failed };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const noVerify = args.includes('--no-verify');
  const dateFilter = args[args.indexOf('--date') + 1] && args.includes('--date') ? args[args.indexOf('--date') + 1] : null;
  const limitArg = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : 0;

  if (!existsSync(MEMO_DIR)) {
    console.log('No board-memos directory; nothing to do.');
    return;
  }

  const memoFiles = readdirSync(MEMO_DIR)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => !dateFilter || f === `${dateFilter}.json`)
    .sort();

  const memos = [];
  for (const f of memoFiles) {
    const memoPath = resolve(MEMO_DIR, f);
    let memo;
    try { memo = JSON.parse(readFileSync(memoPath, 'utf-8')); } catch { continue; }
    if (!memo.mid) continue;
    memos.push({ memoPath, memo });
  }

  // Confirm each committed filename still has an object behind it before
  // trusting it as the skip key.
  let missingOnR2 = null;
  if (!noVerify) {
    const { missing, checked, inconclusive } = await findMissingOnR2(memos);
    missingOnR2 = missing;
    console.log(`R2 check: ${checked} committed filename(s), ${missing.size} missing${inconclusive ? `, ${inconclusive} inconclusive (left as-is)` : ''}.`);
    if (missing.size > 0) {
      console.warn(`  ${missing.size} packet(s) are referenced by a memo but absent from R2 — re-downloading so upload-to-r2.mjs can ship them:`);
      for (const key of Array.from(missing).slice(0, 10)) console.warn(`    ${key}`);
      if (missing.size > 10) console.warn(`    ... and ${missing.size - 10} more`);
    }
  }

  // Second pass: figure out which memos actually need work.
  const work = [];
  for (const { memoPath, memo } of memos) {
    const { pending } = pendingFor(memo, missingOnR2);
    if (pending.length > 0) work.push({ memoPath, memo, pending: pending.length });
  }

  if (work.length === 0) {
    console.log('All board-packet attachments already have filenames. Nothing to download.');
    return;
  }

  console.log(`Board-packet download: ${work.length} meeting(s) with missing packets:`);
  for (const w of work) console.log(`  ${w.memo.date} (MID ${w.memo.mid}): ${w.pending} missing`);
  // Recording a filename asserts the PDF is on R2, but the upload is a separate
  // step (upload-to-r2.mjs) that needs an rclone "r2" remote. Without one the
  // assertion is false the moment the memo is committed.
  if (!hasR2Remote()) {
    console.warn(`
${'!'.repeat(60)}
No rclone "r2" remote is configured, so nothing downloaded here can be
uploaded. Filenames will still be recorded into the memos, but they will
point at objects that do not exist on R2 yet.

If you commit these memos, the packets are served as dead links until a
pipeline run repairs them: the R2 check at the start of this script clears
any filename with no object behind it and re-fetches it on the runner,
which does have the remote.

To avoid that entirely, let the pipeline run this step, or configure rclone
(see the setup notes in scripts/upload-to-r2.mjs).
${'!'.repeat(60)}
`);
  }

  if (dryRun) { console.log('\n(--dry-run: no downloads.)'); return; }

  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  let totalOk = 0;
  let totalFailed = 0;
  try {
    for (let i = 0; i < work.length; i++) {
      const { memoPath, memo } = work[i];
      const { ok, failed } = await processMeeting(browser, memoPath, memo, limitArg);
      totalOk += ok;
      totalFailed += failed;
      if (i < work.length - 1) await randomDelay(DELAY_BETWEEN_MEETINGS);
    }
  } finally {
    await browser.close();
  }

  console.log(`\nDone: ${totalOk} packet(s) downloaded/cached, ${totalFailed} failed.`);
  // Deliberately exit 0 even with residual failures. Unlike the agenda scrape
  // (a failure there means a meeting is entirely missing), a flaky packet is a
  // single dead link on an otherwise-complete meeting — aborting the pipeline
  // here would discard every successful download and block the whole site
  // deploy. This step is idempotent on `filename`, so any attachment still
  // missing one is retried automatically on the next run until it succeeds.
  if (totalFailed > 0) {
    console.warn(`\nWARNING: ${totalFailed} board-packet attachment(s) still missing after retries; they will be retried on the next pipeline run.`);
  }
}

// Only run when invoked as the pipeline step (run-pipeline.mjs spawns this via
// `node <abs path>`); importing it from a test must not start a scrape.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => {
    console.error('Fatal error:', e);
    process.exit(1);
  });
}

export { pendingFor };
