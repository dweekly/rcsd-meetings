#!/usr/bin/env node
/**
 * Scrape RCSD YouTube channel for board meeting videos.
 * Uses yt-dlp to fetch the channel's video list, filters to "Board of Trustees"
 * meetings, parses dates, and outputs youtube-index.json.
 *
 * Usage: node scripts/scrape-youtube-index.mjs
 */

import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const CHANNEL_URL = 'https://www.youtube.com/@redwoodcityschooldistrict/videos';

console.log('Fetching video list from RCSD YouTube channel...');

// yt-dlp flat playlist: just get metadata, no downloads
const raw = execFileSync('yt-dlp', [
  '--flat-playlist',
  '--print', '%(id)s|%(title)s|%(upload_date)s',
  CHANNEL_URL
], { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 120_000 });

const lines = raw.trim().split('\n').filter(Boolean);
console.log(`Found ${lines.length} total videos on channel`);

// Month name -> number
const MONTHS = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12'
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

// Filter to board meeting videos
const boardMeetings = [];
for (const line of lines) {
  const parts = line.split('|');
  const id = parts[0];
  const title = parts[1];
  const uploadDate = parts[2];
  if (!title) continue;

  // Must contain "Board of Trustees" (excludes superintendent updates, "Meet RCSD", etc.)
  if (!title.includes('Board of Trustees')) continue;

  const meetingDate = parseDateFromTitle(title);
  if (!meetingDate) {
    console.warn(`  Could not parse date from title: "${title}"`);
    continue;
  }

  // Only include videos from Mar 2024 onward (matching our meeting data window)
  if (meetingDate < '2024-03-01') continue;

  boardMeetings.push({ id, title: title.trim(), date: meetingDate, uploadDate });
}

// For dates with multiple videos (e.g. closed + public session), prefer the public/regular one
const byDate = new Map();
for (const v of boardMeetings) {
  const existing = byDate.get(v.date);
  if (!existing) {
    byDate.set(v.date, v);
  } else {
    // Prefer "Public Meeting" or "Regular Meeting" over "Closed Session" or "Special"
    const isPublic = v.title.includes('Public') || v.title.includes('Regular');
    const existingIsPublic = existing.title.includes('Public') || existing.title.includes('Regular');
    if (isPublic && !existingIsPublic) {
      byDate.set(v.date, v);
    }
  }
}

const deduped = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));

console.log(`Found ${boardMeetings.length} Board of Trustees meeting videos (${deduped.length} unique dates)`);
if (deduped.length > 0) {
  console.log(`  Date range: ${deduped[deduped.length - 1].date} to ${deduped[0].date}`);
}

// Write output
const outPath = resolve(ROOT, 'data/youtube-index.json');
writeFileSync(outPath, JSON.stringify(deduped, null, 2));
console.log(`Wrote ${outPath}`);
