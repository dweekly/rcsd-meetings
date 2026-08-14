#!/usr/bin/env node
/**
 * Fast Simbli agenda scraper — pulls the formal agenda + per-item attachments
 * via Simbli's Angular SPA APIs (GetItemsTreeDTO + GetSupportingDocuments).
 *
 * Why the API path: the agenda tree the public ViewMeeting page renders is
 * Angular-generated and never includes attachment links in static HTML. The
 * old scraper iterated each item via Next-button clicks (slow, brittle). This
 * scraper hijacks the same XHRs the SPA already makes and reuses the session
 * params, which yields the entire agenda + all attachment AIDs in seconds.
 *
 * Outputs `data/board-memos/{date}.json` in the schema parseSimbliAgenda
 * expects: { date, mid, scrapedAt, items: [{ order, title, memo, attachments }] }.
 *
 * Memo and per-attachment filename/cached fields are written by
 * scrape-board-packets.mjs (which downloads PDFs). When this script writes
 * over an existing memo file, it preserves those enrichments.
 *
 * Usage:
 *   node scripts/scrape-simbli-agendas.mjs               # discover + scrape new
 *   node scripts/scrape-simbli-agendas.mjs --date 2026-05-13
 *   node scripts/scrape-simbli-agendas.mjs --mid 51013
 *   node scripts/scrape-simbli-agendas.mjs --refresh     # re-scrape all known
 *   node scripts/scrape-simbli-agendas.mjs --list-only   # discovery only
 *
 * Networking: Simbli's CDN (Imperva/Incapsula) blocks bare HTTP. Playwright
 * runs a real Chromium so the JS challenge auto-resolves and cookies are kept.
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { extractMemoLinks } from './lib/memo-links.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SIMBLI_BASE = 'https://simbli.eboardsolutions.com';
const SCHOOL_ID = '36030397';
const LISTING_URL = `${SIMBLI_BASE}/SB_Meetings/SB_MeetingListing.aspx?S=${SCHOOL_ID}`;
const MEMO_DIR = resolve(ROOT, 'data/board-memos');
const SOURCES_MD_PATH = resolve(ROOT, 'sources/rcsd-meetings.md');

const INCAPSULA_WAIT_MS = 5000;
const INCAPSULA_MAX_TRIES = 6;
const TREE_WAIT_MS = 30000;

function meetingUrl(mid) {
  return `${SIMBLI_BASE}/SB_Meetings/ViewMeeting.aspx?S=${SCHOOL_ID}&MID=${mid}`;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseUSDate(s) {
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

// Convert Simbli's CKEditor HTML field content to readable plain text:
// drop tags, decode the entities Simbli emits (&nbsp; &#39; &amp; …), and
// collapse whitespace. Used to flatten each agenda item's content fields.
function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&ndash;|&mdash;/gi, '-')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// Flatten a GetMeetingItemDetailsModel response into a memo object keyed by the
// item's field titles (Quick Summary / Abstract, Recommendation, Rationale,
// Financial Impact, Background, Contacts, …). Only fields that actually carry
// content are kept. This is the substance of each agenda item — the prose the
// board reads — which the tree DTO and attachment APIs do not include.
function parseItemContents(detail) {
  const memo = {};
  const contents = detail?.ItemContents;
  if (!Array.isArray(contents)) return memo;
  for (const c of contents) {
    if (!c) continue;
    const text = htmlToText(c.Content);
    if (!text) continue;
    const key = (c.FieldTitle || c.FieldName || '').trim();
    if (key) memo[key] = text;
  }
  return memo;
}

// Each Simbli context is a fresh Incapsula session. This matters: once a
// context has loaded the meeting *listing* page, Imperva flags that session's
// incap_ses cookie and serves an "incident" block on every subsequent
// ViewMeeting request in the same session. A context that goes straight to a
// ViewMeeting (no listing history) is let through. So discovery and each
// per-meeting agenda scrape must run in their own contexts — see main().
async function newSimbliContext(browser) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  return context;
}

async function newSimbliBrowser() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await newSimbliContext(browser);
  return { browser, context };
}

async function waitForIncapsula(page) {
  for (let attempt = 1; attempt <= INCAPSULA_MAX_TRIES; attempt++) {
    await delay(INCAPSULA_WAIT_MS);
    const html = await page.content();
    if (!html.includes('Request unsuccessful') && !html.includes('Incapsula incident')) return true;
  }
  return false;
}

async function discoverMeetings(page) {
  await page.goto(LISTING_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (!(await waitForIncapsula(page))) {
    throw new Error('Incapsula challenge did not clear on listing page');
  }
  await page.waitForSelector('table tr a[onclick*="ViewMeeting"]', { timeout: 15000 });
  const rows = await page.evaluate(() => {
    const out = [];
    const trs = document.querySelectorAll('table tr');
    for (const tr of trs) {
      const dateSpan = tr.querySelector('span[id*="_sptxt_"][id$="_0"]');
      const link = tr.querySelector('a[onclick*="ViewMeeting"]');
      const typeSpan = tr.querySelector('span[id*="_sptxt_"][id$="_3"]');
      if (!dateSpan || !link) continue;
      const onclick = link.getAttribute('onclick') || '';
      const midMatch = onclick.match(/ViewMeeting\(\s*"[^"]+"\s*,\s*"(\d+)"/);
      if (!midMatch) continue;
      const dateText = dateSpan.textContent.trim();
      const dateMatch = dateText.match(/(\d{2}\/\d{2}\/\d{4})/);
      if (!dateMatch) continue;
      out.push({
        usDate: dateMatch[1],
        mid: midMatch[1],
        title: link.textContent.trim(),
        rawType: typeSpan ? typeSpan.textContent.trim() : null,
      });
    }
    return out;
  });
  return rows.map(r => ({
    date: parseUSDate(r.usDate),
    mid: r.mid,
    title: r.title,
    rawType: r.rawType,
  })).filter(r => r.date);
}

async function scrapeMeetingAPI(page, mid) {
  let treeJson = null;
  let sessionParams = null;

  const onResponse = async (response) => {
    const url = response.url();
    if (treeJson === null && url.includes('GetItemsTreeDTO')) {
      try { treeJson = await response.json(); } catch { /* retry */ }
      const u = new URL(url);
      sessionParams = {
        sct: u.searchParams.get('sct'),
        endid: u.searchParams.get('endid'),
        enmid: u.searchParams.get('enmid'),
      };
    }
  };
  page.on('response', onResponse);

  try {
    await page.goto(meetingUrl(mid), { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!(await waitForIncapsula(page))) {
      console.error(`  Incapsula challenge did not clear on ViewMeeting for MID ${mid}`);
      return null;
    }

    const start = Date.now();
    while (treeJson === null && Date.now() - start < TREE_WAIT_MS) {
      await delay(500);
    }
    if (!treeJson || !sessionParams || !sessionParams.sct) {
      console.error(`  Failed to capture GetItemsTreeDTO for MID ${mid}`);
      return null;
    }

    const flat = [];
    function walk(arr) {
      for (const it of arr || []) {
        flat.push(it);
        if (it.Children?.length) walk(it.Children);
      }
    }
    walk(treeJson.Items);

    const itemsWithAtts = flat.filter(it => it.HasAttachment);
    const docsByItemID = await page.evaluate(async ({ ids, sessionParams }) => {
      const out = {};
      const { sct, endid, enmid } = sessionParams;
      for (const id of ids) {
        const url = `/Services/api/GetSupportingDocuments/?sct=${sct}` +
          `&endid=${endid}` +
          `&enentityid=${enmid}` +
          `&enitemid=${encodeURIComponent(id)}`;
        try {
          const resp = await fetch(url, { headers: { Accept: 'application/json' } });
          out[id] = await resp.json();
        } catch (e) {
          out[id] = { _error: e.message };
        }
      }
      return out;
    }, { ids: itemsWithAtts.map(it => it.ID), sessionParams });

    // Fetch each item's content model (the prose fields the board actually
    // reads: abstract, recommendation, rationale, financial impact, etc.).
    // The tree DTO carries only titles/structure, so without this every item's
    // substance is lost. Done for ALL items, in the Incapsula-cleared session.
    const detailByItemID = await page.evaluate(async ({ ids, sessionParams }) => {
      const out = {};
      const { sct, endid, enmid } = sessionParams;
      for (const id of ids) {
        const url = `/Services/api/MeetingView/GetMeetingItemDetailsModel/?sct=${sct}` +
          `&endid=${endid}` +
          `&enmid=${enmid}` +
          `&enitemid=${encodeURIComponent(id)}` +
          `&enuid=&view=&stab=1`;
        try {
          const resp = await fetch(url, { headers: { Accept: 'application/json' } });
          out[id] = await resp.json();
        } catch (e) {
          out[id] = { _error: e.message };
        }
      }
      return out;
    }, { ids: flat.map(it => it.ID), sessionParams });

    const items = flat.map((it, idx) => {
      const docs = docsByItemID[it.ID];
      const attachments = [];
      if (docs && Array.isArray(docs.Attachment)) {
        for (const a of docs.Attachment) {
          const aid = a.AttachmentID || a.attachmentID || a.AID || a.ID;
          if (!aid) continue;
          attachments.push({
            name: a.DisplayName || a.Title || a.Name || a.FileName || `attachment-${aid}`,
            aid: String(aid),
          });
        }
      }
      if (docs && Array.isArray(docs.HyperLink)) {
        for (const h of docs.HyperLink) {
          const url = h.URL || h.Url || h.Link;
          if (!url) continue;
          attachments.push({
            name: h.DisplayName || h.Title || h.Name || url,
            href: url,
          });
        }
      }
      const detail = detailByItemID[it.ID];
      const memo = parseItemContents(detail);
      const d = detail?.ItemDetails;
      const provenance = d
        ? { createdBy: d.CreatedBy || null, modifiedBy: d.ModifiedBy || null, modifiedOn: d.ModifiedOnDate || d.ModifiedOnTime || null }
        : null;
      return {
        order: idx + 1,
        title: (it.Title || '').trim(),
        memo,
        ...(provenance && (provenance.modifiedBy || provenance.createdBy) ? { provenance } : {}),
        attachments,
      };
    });

    // The Zoom URL lives in the page header text, not in any API response.
    const zoom = await page.evaluate(() => {
      const m = document.body.innerText.match(/https:\/\/[a-z0-9.-]*zoom\.us\/[^\s]+/i);
      return m ? m[0].replace(/[).,;]+$/, '') : null;
    });

    return { items, zoom };
  } finally {
    page.off('response', onResponse);
  }
}

function mergeWithExisting(date, fresh) {
  const path = resolve(MEMO_DIR, `${date}.json`);
  if (!existsSync(path)) return fresh;
  let prev;
  try { prev = JSON.parse(readFileSync(path, 'utf-8')); } catch { return fresh; }
  const prevByTitle = new Map();
  for (const it of prev.items || []) {
    if (it.title) prevByTitle.set(it.title.trim(), it);
  }
  const merged = fresh.items.map(it => {
    const old = prevByTitle.get(it.title.trim());
    if (!old) return it;
    // Prefer freshly-scraped memo content (the scraper now populates it from
    // GetMeetingItemDetailsModel); fall back to any prior memo only when this
    // scrape returned nothing for the item. This ensures a revised agenda's
    // edited prose overwrites the stale copy rather than being pinned to it.
    const memo = (it.memo && Object.keys(it.memo).length > 0) ? it.memo : (old.memo || {});
    const oldAttsByAid = new Map();
    for (const a of old.attachments || []) if (a.aid) oldAttsByAid.set(String(a.aid), a);
    const attachments = it.attachments.map(a => {
      const o = a.aid ? oldAttsByAid.get(String(a.aid)) : null;
      if (!o) return a;
      const out = { ...a };
      if (o.filename) out.filename = o.filename;
      if (o.cached !== undefined) out.cached = o.cached;
      return out;
    });
    return { ...it, memo, attachments };
  });
  return { items: merged };
}

function loadKnownMids() {
  const known = new Map();
  if (!existsSync(SOURCES_MD_PATH)) return known;
  const md = readFileSync(SOURCES_MD_PATH, 'utf-8');
  const tableRe = /\|\s*(\d{2}\/\d{2}\/\d{4})\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|/g;
  let m;
  while ((m = tableRe.exec(md)) !== null) {
    const date = parseUSDate(m[1]);
    const type = m[2].trim();
    known.set(m[3], { date, type });
  }
  return known;
}

function typeFor(meeting) {
  const t = (meeting.title || '').toLowerCase();
  if (t.includes('special') && t.includes('closed')) return 'Special (Closed)';
  if (t.includes('special')) return 'Special';
  if (t.includes('study')) return 'Study Session';
  if (t.includes('workshop')) return 'Workshop';
  return 'Regular';
}

function indexRowFor(meeting) {
  const [yyyy, mm, dd] = meeting.date.split('-');
  return `| ${mm}/${dd}/${yyyy} | ${typeFor(meeting)} | ${meeting.mid} | — | (auto-discovered, fill in topics) |`;
}

// Insert newly-discovered meetings into the Meeting Index table of
// sources/rcsd-meetings.md so build-meetings.mjs renders them without a manual
// edit — the gap that kept 2026-06-24 unpublished. Each row lands in
// reverse-chronological position; topics start as a placeholder a human can
// enrich later. Callers pass only meetings whose MID isn't already in the
// table, so this is idempotent (a known MID is never re-added). Returns the
// number of rows inserted.
function insertIndexRows(meetings) {
  if (meetings.length === 0) return 0;
  const lines = readFileSync(SOURCES_MD_PATH, 'utf-8').split('\n');
  const rowRe = /^\|\s*(\d{2}\/\d{2}\/\d{4})\s*\|/;
  // Insert oldest-first so multiple new rows end up correctly ordered.
  for (const m of [...meetings].sort((a, b) => a.date.localeCompare(b.date))) {
    const row = indexRowFor(m);
    let inserted = false;
    for (let i = 0; i < lines.length; i++) {
      const mm = lines[i].match(rowRe);
      if (mm && parseUSDate(mm[1]) < m.date) { lines.splice(i, 0, row); inserted = true; break; }
    }
    if (!inserted) {
      // Older than every existing row (or empty table): append after the last
      // data row, else right after the table separator line.
      let last = -1;
      for (let i = 0; i < lines.length; i++) if (rowRe.test(lines[i])) last = i;
      if (last >= 0) lines.splice(last + 1, 0, row);
      else {
        const sep = lines.findIndex(l => /^\|[-\s|]+\|$/.test(l));
        if (sep < 0) throw new Error('Meeting Index table not found in sources/rcsd-meetings.md');
        lines.splice(sep + 1, 0, row);
      }
    }
  }
  writeFileSync(SOURCES_MD_PATH, lines.join('\n'));
  return meetings.length;
}

async function main() {
  const args = process.argv.slice(2);
  const dateIdx = args.indexOf('--date');
  const midIdx = args.indexOf('--mid');
  const dateFilter = dateIdx >= 0 ? args[dateIdx + 1] : null;
  const midFilter = midIdx >= 0 ? args[midIdx + 1] : null;
  const refresh = args.includes('--refresh');
  const listOnly = args.includes('--list-only');
  // --json: print every meeting discovered on the Simbli listing as a JSON array
  // ([{date, mid, title, rawType}]) to stdout and exit. Used by scripts/watchdog.mjs
  // to diff Simbli against published meetings-data.json. Status goes to stderr so
  // stdout stays pure JSON.
  const jsonOut = args.includes('--json');

  mkdirSync(MEMO_DIR, { recursive: true });

  const { browser, context } = await newSimbliBrowser();
  const page = await context.newPage();

  try {
    if (jsonOut) {
      const all = await discoverMeetings(page);
      process.stdout.write(JSON.stringify(all));
      return;
    }

    let meetings;
    if (midFilter) {
      meetings = [{ mid: midFilter, date: dateFilter || null, title: '', rawType: null }];
    } else {
      console.log('Discovering meetings from Simbli listing...');
      const all = await discoverMeetings(page);
      console.log(`Found ${all.length} meetings on Simbli listing.`);
      const known = loadKnownMids();
      // Simbli's listing extends back into 2020; we only track the
      // 2025-2026 school year onward unless --date overrides.
      const TRACKING_FROM = '2025-06-01';
      const inScope = dateFilter
        ? all.filter(m => m.date === dateFilter)
        : all.filter(m => m.date >= TRACKING_FROM);
      // Dedupe on (date, type), not just MID. Simbli can carry a SECOND record
      // for a meeting we already index under a different MID — in Aug 2026 it
      // grew MIDs 80379/80380/80381 for the June 11/18/25 2025 meetings already
      // indexed as 45272/45380/47153. Keying only on MID let those through as
      // "new", which minted phantom `-regular-2` duplicate meetings on the
      // site. Agenda JSON is keyed by date anyway, so a same-date/same-type
      // record can never be a distinct meeting for us.
      const knownDateTypes = new Set(
        [...known.values()].map(k => `${k.date}|${k.type}`),
      );
      const unknownToMd = inScope
        .filter(m => !known.has(m.mid) && !knownDateTypes.has(`${m.date}|${typeFor(m)}`))
        .sort((a, b) => b.date.localeCompare(a.date));
      // Auto-add newly-discovered meetings to the index so they publish on
      // their own. Skipped for --list-only (discovery-only callers like the
      // watchdog must not mutate the source file).
      if (unknownToMd.length > 0) {
        console.log(`\n${unknownToMd.length} meeting(s) not yet in sources/rcsd-meetings.md:`);
        for (const m of unknownToMd) console.log('  ' + indexRowFor(m));
        if (listOnly) {
          console.log('\n(--list-only: not modifying sources/rcsd-meetings.md.)\n');
        } else {
          const n = insertIndexRows(unknownToMd);
          console.log(`\nAdded ${n} row(s) to sources/rcsd-meetings.md (topics left as a placeholder to enrich later).\n`);
        }
      }
      // Re-scrape upcoming (and same-day) meetings every run so post-publication
      // agenda edits are picked up: a district that revises a resolution or
      // swaps an attachment gets a NEW Simbli aid, and the old aid starts
      // serving an empty Attachment.aspx shell. mergeWithExisting preserves
      // filenames for unchanged aids, so only genuinely-changed attachments
      // re-download. Past meetings are frozen (scraped once). The 1-day grace
      // keeps the meeting day covered regardless of UTC-vs-Pacific rollover.
      const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
      meetings = inScope.filter(m => {
        if (refresh) return true;
        if (!existsSync(resolve(MEMO_DIR, `${m.date}.json`))) return true;
        return m.date && m.date >= cutoff;
      });
    }

    if (listOnly) {
      console.log('--list-only: skipping scrape.');
      return;
    }

    if (meetings.length === 0) {
      console.log('Nothing to scrape (use --refresh to re-pull).');
      return;
    }

    console.log(`\nScraping ${meetings.length} meeting(s)...\n`);
    let ok = 0, failed = 0;
    for (const m of meetings) {
      const label = `${m.date || '????-??-??'} MID ${m.mid}`;
      console.log(`-> ${label}`);
      // Fresh context per meeting: the discovery context above visited the
      // listing page, which poisons its Incapsula session for ViewMeeting
      // requests (see newSimbliContext). A clean session navigates through.
      const mctx = await newSimbliContext(browser);
      const mpage = await mctx.newPage();
      let fresh, date;
      try {
        fresh = await scrapeMeetingAPI(mpage, m.mid);
        if (!fresh) { failed++; continue; }

        date = m.date;
        if (!date) {
          const heading = await mpage.evaluate(() => {
            const m = document.body.innerText.match(/(\d{2}\/\d{2}\/\d{4})/);
            return m ? m[1] : null;
          });
          date = heading ? parseUSDate(heading) : null;
        }
      } finally {
        await mctx.close();
      }
      if (!date) {
        console.error(`  Could not determine date for MID ${m.mid}; skipping write.`);
        failed++;
        continue;
      }

      const merged = mergeWithExisting(date, fresh);
      const totalAtts = merged.items.reduce((s, it) => s + (it.attachments?.length || 0), 0);
      // Derive embedded memo links (public-comment forms, off-portal documents,
      // etc.) from each item's memo prose. See scripts/lib/memo-links.mjs and
      // SEARCH.md — document-kind links are fed into site search.
      const items = merged.items.map(it => ({ ...it, memoLinks: extractMemoLinks(it.memo) }));
      const out = {
        date,
        mid: String(m.mid),
        scrapedAt: new Date().toISOString(),
        zoom: fresh.zoom || null,
        items,
      };
      const outPath = resolve(MEMO_DIR, `${date}.json`);
      // Agenda files are keyed by date, so a *different* Simbli MID landing on
      // an already-scraped date silently replaces it. That is occasionally
      // legitimate (Simbli re-posted the agenda under a new record) but it also
      // destroys the previously-ingested version, so never do it quietly.
      if (existsSync(outPath)) {
        let prevMid = null;
        try { prevMid = JSON.parse(readFileSync(outPath, 'utf-8')).mid; } catch { /* unreadable: fall through */ }
        if (prevMid && String(prevMid) !== String(m.mid)) {
          console.warn(`  WARNING: ${date}.json was scraped from MID ${prevMid}; `
            + `overwriting with MID ${m.mid}. Confirm which record is authoritative.`);
        }
      }
      writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
      console.log(`  wrote ${outPath} (${merged.items.length} items, ${totalAtts} attachments)`);
      ok++;
    }
    console.log(`\nDone: ${ok} scraped, ${failed} failed.`);
    // A discovered meeting we couldn't scrape is a hard failure, not a no-op:
    // exit non-zero so the pipeline run goes red and the watchdog's self-heal
    // dispatch can tell its attempt didn't work (instead of looping on a green
    // run that silently scraped nothing). Successes are still written above.
    if (failed > 0) {
      console.error(`\nFAILED: ${failed} discovered meeting(s) could not be scraped.`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
