#!/usr/bin/env node
/**
 * Scrape RCSD YouTube channel for meeting videos.
 * Uses yt-dlp to fetch the channel's video list, classifies each video by `kind`
 * ("board" for Board of Trustees meetings, or a committee id such as "cboc" when the
 * title matches a committee's videoTitleMatch hints), parses dates, and outputs
 * youtube-index.json. Board-only consumers should filter to kind === 'board'.
 *
 * Usage: node scripts/scrape-youtube-index.mjs
 */

import { execFileSync } from 'child_process';
import { writeFileSync, readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Load committee video-title classifiers from data/committees/*.json. Each committee
// may declare `videoTitleMatch` (case-insensitive substrings) used to tag its recordings.
function loadCommitteeMatchers() {
  const dir = resolve(ROOT, 'data/committees');
  if (!existsSync(dir)) return [];
  const matchers = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    try {
      const c = JSON.parse(readFileSync(resolve(dir, file), 'utf-8'));
      const patterns = (c.videoTitleMatch || []).map((p) => p.toLowerCase());
      if (c.id && patterns.length) matchers.push({ id: c.id, patterns });
    } catch (err) {
      console.warn(`  Skipping unreadable committee file ${file}: ${err.message}`);
    }
  }
  return matchers;
}

const COMMITTEE_MATCHERS = loadCommitteeMatchers();

// Classify a video title into a kind: 'board', a committee id, or null (skip).
function classifyKind(title) {
  if (title.includes('Board of Trustees')) return 'board';
  const lower = title.toLowerCase();
  for (const m of COMMITTEE_MATCHERS) {
    if (m.patterns.some((p) => lower.includes(p))) return m.id;
  }
  return null;
}

const CHANNEL_URL = 'https://www.youtube.com/@redwoodcityschooldistrict/videos';

console.log('Fetching video list from RCSD YouTube channel...');

// yt-dlp flat playlist: just get metadata, no downloads
let raw;
try {
  raw = execFileSync('yt-dlp', [
    '--flat-playlist',
    '--print', '%(id)s|%(title)s|%(upload_date)s',
    CHANNEL_URL
  ], { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 120_000 });
} catch (err) {
  console.warn(`\n============================================================`);
  console.warn(`WARNING: Failed to fetch video list from YouTube channel: ${err.message}`);
  console.warn(`Using the existing youtube-index.json instead.`);
  console.warn(`============================================================\n`);
  process.exit(0);
}

const lines = raw.trim().split('\n').filter(Boolean);
console.log(`Found ${lines.length} total videos on channel`);

// Month name -> number
const MONTHS = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12'
};

// District-mistitled videos: the date in the YouTube title is wrong, so the
// video never matches its scraped meeting and gets re-downloaded forever.
// Keyed by video id → the meeting's real date, verified against the recording
// (spoken welcome / closed-session report-out) and the BoardDocs agenda.
// Reported to the district (Jorge) 2026-07-12. If they retitle the videos,
// these entries become redundant but stay correct; safe to delete then.
const DATE_CORRECTIONS = {
  vuzddXz9v4U: '2021-10-20', // titled "October 10, 2021"; opens "Welcome to our October 20 board meeting"
  vs_F7D0rAmE: '2024-05-22', // titled "May 24, 2024"; reports out from that evening's closed session "on May 22nd 2024"
  '5405HztJTp0': '2020-05-06', // titled "May 7, 2020"; agenda matches BoardDocs 5/6/20 ("Report Out on Closed Session from 5.6.20")
};

/**
 * Parse meeting date from title.
 * Titles look like:
 *   "February 26, 2026--Board of Trustees Special Meeting"
 *   "January 14, 2026--Board of Trustees Regular Meeting"
 *   "March 13, 2024 - Board of Trustees Regular Meeting"
 */
function parseDateFromTitle(title) {
  // Handle "Month DD , YYYY" (extra space before comma) and "Month DD, YYYY"
  const m = title.match(/^(\w+)\s+(\d{1,2})\s*,?\s+(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  const day = m[2].padStart(2, '0');
  return `${m[3]}-${month}-${day}`;
}

// Classify each video by kind (board / committee id), parse its date
const meetings = [];
for (const line of lines) {
  const parts = line.split('|');
  const id = parts[0];
  const title = parts[1];
  const uploadDate = parts[2];
  if (!title) continue;

  // Classify: board, a committee id, or skip (superintendent updates, "Meet RCSD", etc.)
  const kind = classifyKind(title);
  if (!kind) continue;

  const meetingDate = DATE_CORRECTIONS[id] ?? parseDateFromTitle(title);
  if (!meetingDate) {
    console.warn(`  Could not parse date from title: "${title}"`);
    continue;
  }

  // Only include videos from Apr 2020 onward (first board meeting on the channel)
  if (meetingDate < '2020-04-01') continue;

  meetings.push({ id, title: title.trim(), date: meetingDate, kind, uploadDate });
}

// Dedup per (kind, date): a date can host both a board meeting and a committee meeting,
// so keying on date alone would let one evict the other. Within board dates with multiple
// videos (e.g. closed + public session), prefer the public/regular one.
const byKindDate = new Map();
for (const v of meetings) {
  const key = `${v.kind}|${v.date}`;
  const existing = byKindDate.get(key);
  if (!existing) {
    byKindDate.set(key, v);
  } else {
    // Prefer "Public Meeting" or "Regular Meeting" over "Closed Session" or "Special"
    const isPublic = v.title.includes('Public') || v.title.includes('Regular');
    const existingIsPublic = existing.title.includes('Public') || existing.title.includes('Regular');
    if (isPublic && !existingIsPublic) {
      byKindDate.set(key, v);
    }
  }
}

const deduped = [...byKindDate.values()].sort((a, b) => b.date.localeCompare(a.date));

const counts = deduped.reduce((acc, v) => { acc[v.kind] = (acc[v.kind] || 0) + 1; return acc; }, {});
const countStr = Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ');
console.log(`Indexed ${deduped.length} meeting videos (${countStr})`);
if (deduped.length > 0) {
  console.log(`  Date range: ${deduped[deduped.length - 1].date} to ${deduped[0].date}`);
}

// Write output
const outPath = resolve(ROOT, 'data/youtube-index.json');
writeFileSync(outPath, JSON.stringify(deduped, null, 2));
console.log(`Wrote ${outPath}`);
