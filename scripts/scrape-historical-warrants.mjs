#!/usr/bin/env node
/**
 * scrape-historical-warrants.mjs — backfill warrant-register PDFs from pre-April-2020 BoardDocs
 * meetings (the main pipeline's CUTOFF_DATE is 20200401, set to match YouTube coverage, but
 * BoardDocs holds RCSD meetings back to Feb 2011).
 *
 * Warrant-only and self-contained: it does NOT touch meetings-data.json or the rest of the site.
 * It discovers warrant-register attachments in old agendas and downloads just those PDFs into
 * artifacts/board-packets/{date}/, recording provenance in data/warrant-pdf-manifest-historical.json
 * so extract-warrants.mjs can parse them like any other register.
 *
 * BoardDocs API flow (CloudFront-fronted; needs a real UA):
 *   BD-GetMeetingsList -> meetings (unique, numberdate, name)
 *   BD-GetAgenda(id=meeting) -> items (unique, title, hasAttachment)
 *   BD-GetPublicFiles(id=item) -> <a class="public-file" href="…/$file/…pdf">
 *
 * Usage:
 *   node scripts/scrape-historical-warrants.mjs --limit 3      # spot-check a few
 *   node scripts/scrape-historical-warrants.mjs --to 20200401  # full backfill (default range)
 *   node scripts/scrape-historical-warrants.mjs --dry-run
 */

import { writeFileSync, existsSync, mkdirSync, statSync, openSync, readSync, closeSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BASE_URL = 'https://go.boarddocs.com/ca/redwood/Board.nsf';
const COMMITTEE_ID = 'A4EP6J588C05';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DELAY_MS = 350;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : Infinity;
const FROM = args.includes('--from') ? args[args.indexOf('--from') + 1] : '20110101';
const TO = args.includes('--to') ? args[args.indexOf('--to') + 1] : '20200401'; // exclusive (our existing floor)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bdPost(endpoint, body) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(`${BASE_URL}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
        body,
      });
      if (resp.ok) return resp.text();
    } catch { /* retry */ }
    await sleep(1000 * attempt);
  }
  return '';
}

async function fetchPdf(url) {
  const resp = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': USER_AGENT } });
  return { status: resp.status, buf: Buffer.from(await resp.arrayBuffer()) };
}

function isValidPdf(buf) {
  return buf.length > 1024 && buf.subarray(0, 5).toString('ascii') === '%PDF-';
}
function fileValid(p) {
  try {
    if (statSync(p).size < 1024) return false;
    const b = Buffer.alloc(5); const fd = openSync(p, 'r'); readSync(fd, b, 0, 5, 0); closeSync(fd);
    return b.toString('ascii') === '%PDF-';
  } catch { return false; }
}
function sanitize(name, maxLen = 80) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, maxLen);
}
const dateFromNumber = (n) => `${n.slice(0, 4)}-${n.slice(4, 6)}-${n.slice(6, 8)}`;

// Parse the meetings list JSON-ish payload for {unique, numberdate, name}.
function parseMeetings(text) {
  const out = [];
  for (const chunk of text.split('}')) {
    const u = chunk.match(/"unique":\s*"([A-Z0-9]+)"/);
    const d = chunk.match(/"numberdate":\s*"(\d{8})"/);
    const n = chunk.match(/"name":\s*"([^"]*)"/);
    if (u && d) out.push({ unique: u[1], numberdate: d[1], name: n ? n[1] : '' });
  }
  return out;
}

// Find warrant-register items (unique + title) in an agenda HTML.
function parseWarrantItems(html) {
  const items = [];
  const itemRe = /<li[^>]*class="[^"]*item[^"]*"[^>]*unique="([^"]*)"[^>]*Xtitle="([^"]*)"[^>]*>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = itemRe.exec(html)) !== null) {
    const unique = m[1];
    const titleMatch = m[3].match(/<span class="title">([^<]*)<\/span>/);
    const title = (titleMatch ? titleMatch[1] : m[2]).trim();
    if (/warrant/i.test(title)) items.push({ unique, title, hasAttachment: m[3].includes('fa-file-text-o') });
  }
  return items;
}

function parsePublicFiles(html) {
  const out = [];
  const re = /<a[^>]*class="public-file"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const rawName = m[2].trim();
    out.push({ href: `https://go.boarddocs.com${m[1]}`, name: rawName.replace(/\s*\([^)]+\)\s*$/, '') });
  }
  return out;
}

async function main() {
  console.log(`Historical warrant backfill — BoardDocs meetings ${FROM} … <${TO}`);
  const meetings = parseMeetings(await bdPost('BD-GetMeetingsList', `current_committee_id=${COMMITTEE_ID}`))
    .filter((m) => m.numberdate >= FROM && m.numberdate < TO)
    .sort((a, b) => b.numberdate.localeCompare(a.numberdate)); // newest-first
  console.log(`  ${meetings.length} meetings in range to scan.`);

  const manifest = [];
  let downloaded = 0, skipped = 0, failed = 0, scanned = 0, noWarrant = 0;

  for (const mtg of meetings) {
    if (downloaded >= limit) break;
    scanned++;
    const date = dateFromNumber(mtg.numberdate);
    const agenda = await bdPost('BD-GetAgenda', `id=${mtg.unique}&current_committee_id=${COMMITTEE_ID}`);
    await sleep(DELAY_MS);
    const warrantItems = parseWarrantItems(agenda).filter((it) => it.hasAttachment);
    if (!warrantItems.length) { noWarrant++; continue; }

    for (const item of warrantItems) {
      const filesHtml = await bdPost('BD-GetPublicFiles', `id=${item.unique}&current_committee_id=${COMMITTEE_ID}`);
      await sleep(DELAY_MS);
      const files = parsePublicFiles(filesHtml).filter((f) => /warrant|\.pdf$/i.test(f.name) || /\$file\//.test(f.href));
      for (const f of files) {
        if (!/warrant/i.test(f.name) && !/warrant/i.test(item.title)) continue;
        const filename = sanitize(f.name.replace(/\.pdf$/i, '')) + '.pdf';
        const dir = resolve(ROOT, 'artifacts/board-packets', date);
        const localPath = resolve(dir, filename);
        const relPath = `artifacts/board-packets/${date}/${filename}`;
        const entry = {
          meetingDate: date, meetingUnique: mtg.unique, itemTitle: item.title,
          source: 'boarddocs-historical', sourceHref: f.href, filename, localPath: relPath,
          r2Url: `https://data.rcsd.info/board-packets/${date}/${filename}`,
          bytes: null, sha256: null, status: null,
        };
        if (existsSync(localPath) && fileValid(localPath)) {
          entry.status = 'skipped-existing'; entry.bytes = statSync(localPath).size;
          manifest.push(entry); skipped++;
          console.log(`  SKIP  ${date}  ${filename}`); continue;
        }
        if (dryRun) { entry.status = 'would-download'; manifest.push(entry); console.log(`  PLAN  ${date}  ${filename}\n          <- ${f.href}`); continue; }
        try {
          const { status, buf } = await fetchPdf(f.href);
          await sleep(DELAY_MS);
          if (status === 200 && isValidPdf(buf)) {
            mkdirSync(dir, { recursive: true });
            writeFileSync(localPath, buf);
            entry.status = 'downloaded'; entry.bytes = buf.length; entry.sha256 = createHash('sha256').update(buf).digest('hex');
            downloaded++; manifest.push(entry);
            console.log(`  OK    ${date}  ${filename} (${buf.length} bytes)`);
          } else {
            entry.status = 'failed'; failed++; manifest.push(entry);
            console.warn(`  FAIL  ${date}  ${filename}  HTTP ${status} pdf=${isValidPdf(buf)}`);
          }
        } catch (err) { entry.status = 'failed'; failed++; manifest.push(entry); console.warn(`  ERR   ${date}  ${err.message}`); }
      }
    }
  }

  const out = {
    _metadata: {
      description: 'Backfilled warrant-register PDFs from pre-April-2020 BoardDocs meetings (warrant-only; does not touch meetings-data.json).',
      source: 'BoardDocs BD-GetMeetingsList/GetAgenda/GetPublicFiles', script: 'scripts/scrape-historical-warrants.mjs',
      range: { from: FROM, toExclusive: TO }, generated: new Date().toISOString().slice(0, 10),
      counts: { meetingsScanned: scanned, meetingsWithoutWarrant: noWarrant, downloaded, skipped, failed },
    },
    registers: manifest.sort((a, b) => a.meetingDate.localeCompare(b.meetingDate)),
  };
  if (!dryRun) writeFileSync(resolve(ROOT, 'data/warrant-pdf-manifest-historical.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`\nDone. scanned=${scanned} downloaded=${downloaded} skipped=${skipped} failed=${failed} (no-warrant meetings: ${noWarrant})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
