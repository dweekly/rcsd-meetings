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
 * only genuinely-missing packets are (re)fetched. The committed memo is the
 * idempotency key: once filenames are committed, the PDFs are on R2 and this
 * step does nothing.
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
 *
 * Exit code: non-zero if any attachment that should have downloaded failed, so
 * a broken packet fetch turns the pipeline red instead of shipping dead links.
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, unlinkSync, readdirSync, openSync, readSync, closeSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SIMBLI_BASE = 'https://simbli.eboardsolutions.com';
const SCHOOL_ID = '36030397';
const MEMO_DIR = resolve(ROOT, 'data/board-memos');
const PDF_BASE_DIR = resolve(ROOT, 'artifacts/board-packets');

const INCAPSULA_WAIT_MS = 5000;
const INCAPSULA_MAX_TRIES = 6;
const DELAY_BETWEEN_DOWNLOADS = { min: 2000, max: 5000 };
const DELAY_BETWEEN_MEETINGS = { min: 15000, max: 30000 };

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

// Collect attachments needing a download: have an aid, lack a filename. Also
// seed the in-use filename set with any filenames already present, so newly
// downloaded packets don't collide with prior ones in the same meeting.
function pendingFor(memo) {
  const pending = [];
  const usedFilenames = new Set();
  for (const item of memo.items || []) {
    for (const att of item.attachments || []) {
      if (att.filename) usedFilenames.add(att.filename);
      else if (att.aid) pending.push(att);
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
      if (await downloadPdfViaBrowser(page, attachmentUrl(att.aid, mid), savePath)) {
        const kb = (statSync(savePath).size / 1024).toFixed(0);
        console.log(`      SAVED: ${filename} (${kb}KB)`);
        att.filename = filename; // record into the memo only on a verified PDF
        ok++;
      } else {
        console.warn(`      FAILED: ${att.name}`);
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

  // First pass: figure out which memos actually need work.
  const work = [];
  for (const f of memoFiles) {
    const memoPath = resolve(MEMO_DIR, f);
    let memo;
    try { memo = JSON.parse(readFileSync(memoPath, 'utf-8')); } catch { continue; }
    if (!memo.mid) continue;
    const { pending } = pendingFor(memo);
    if (pending.length > 0) work.push({ memoPath, memo, pending: pending.length });
  }

  if (work.length === 0) {
    console.log('All board-packet attachments already have filenames. Nothing to download.');
    return;
  }

  console.log(`Board-packet download: ${work.length} meeting(s) with missing packets:`);
  for (const w of work) console.log(`  ${w.memo.date} (MID ${w.memo.mid}): ${w.pending} missing`);
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
  if (totalFailed > 0) {
    console.error(`\nFAILED: ${totalFailed} board-packet attachment(s) could not be downloaded.`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
