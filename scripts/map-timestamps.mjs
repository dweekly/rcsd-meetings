#!/usr/bin/env node
/**
 * Map agenda items to transcript timestamps.
 * For each meeting with both a transcript (SRT) and agenda items,
 * searches the transcript for keywords from each agenda item title
 * and records the timestamp of the first match.
 *
 * Usage: node scripts/map-timestamps.mjs
 *
 * Input:
 *   - data/meetings-data.json
 *   - data/youtube-index.json
 *   - artifacts/transcripts/*.srt (or *.vtt)
 * Output:
 *   - data/timestamp-map.json
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const dataPath = resolve(ROOT, 'data/meetings-data.json');
const indexPath = resolve(ROOT, 'data/youtube-index.json');
const transcriptDir = resolve(ROOT, 'artifacts/transcripts');

if (!existsSync(dataPath)) {
  console.error('meetings-data.json not found.');
  process.exit(1);
}

const data = JSON.parse(readFileSync(dataPath, 'utf-8'));
const youtubeIndex = existsSync(indexPath)
  ? JSON.parse(readFileSync(indexPath, 'utf-8'))
  : [];

// Build date -> video ID map from both meetings-data and youtube-index
const videoByDate = new Map();
for (const v of youtubeIndex) {
  videoByDate.set(v.date, v.id);
}
for (const m of data.meetings) {
  if (m.youtube && !videoByDate.has(m.date)) {
    videoByDate.set(m.date, m.youtube);
  }
}

/**
 * Parse SRT file into timestamped text blocks.
 * Returns array of { seconds: number, text: string }
 */
function parseSRT(content) {
  const blocks = [];
  const entries = content.split(/\n\n+/);

  for (const entry of entries) {
    const lines = entry.trim().split('\n');
    if (lines.length < 3) continue;

    // Line 2: timestamp "00:42:15,480 --> 00:42:19,160"
    const timeMatch = lines[1].match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!timeMatch) continue;

    const hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    const secs = parseInt(timeMatch[3]);
    const seconds = hours * 3600 + minutes * 60 + secs;

    // Rest is text (may span multiple lines)
    const text = lines.slice(2).join(' ').replace(/<[^>]+>/g, '').trim();
    if (text) {
      blocks.push({ seconds, text });
    }
  }

  return blocks;
}

/**
 * Parse VTT file into timestamped text blocks.
 */
function parseVTT(content) {
  const blocks = [];
  const entries = content.split(/\n\n+/);

  for (const entry of entries) {
    const lines = entry.trim().split('\n');

    // Find the timestamp line
    for (let i = 0; i < lines.length; i++) {
      const timeMatch = lines[i].match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->/);
      if (!timeMatch) continue;

      const hours = parseInt(timeMatch[1]);
      const minutes = parseInt(timeMatch[2]);
      const secs = parseInt(timeMatch[3]);
      const seconds = hours * 3600 + minutes * 60 + secs;

      const text = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').trim();
      if (text) {
        blocks.push({ seconds, text });
      }
      break;
    }
  }

  return blocks;
}

/**
 * Format seconds as HH:MM:SS
 */
function formatTimestamp(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Extract meaningful keywords from an agenda item title.
 * Strips common words, numbers, and short words.
 */
function extractKeywords(title) {
  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'from', 'that', 'this', 'will', 'are', 'was',
    'has', 'have', 'had', 'not', 'but', 'all', 'any', 'can', 'may', 'its',
    'new', 'one', 'two', 'per', 'use', 'our', 'out', 'also', 'been', 'each',
    'year', 'other', 'their', 'which', 'would', 'there', 'about', 'than',
    'into', 'more', 'over', 'such', 'only', 'some', 'very', 'after', 'before',
    'between', 'through', 'during', 'under', 'first', 'second', 'third',
    'approval', 'approve', 'action', 'item', 'report', 'update', 'information',
    'board', 'district', 'school', 'meeting', 'resolution', 'adoption',
    'presentation', 'discussion', 'consent', 'regular', 'special',
  ]);

  return title
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))
    .slice(0, 5);
}

/**
 * Search transcript blocks for keywords, return the earliest sufficient match.
 *
 * Board meetings follow a predictable pattern: the president introduces each
 * agenda item ("next up, we have...") and THEN the discussion/presentation
 * begins. We want the introduction point, not the middle of the discussion.
 *
 * Strategy: find each block where keywords first appear in sufficient density
 * within a short lookahead window. This pinpoints where the keywords are
 * actually spoken rather than the start of a large window that happens to
 * contain them.
 */
function findTimestamp(blocks, keywords, afterSeconds = 0) {
  if (keywords.length === 0) return null;

  // Require at least 2 keyword matches (or 1 if only 1 keyword)
  const threshold = keywords.length === 1 ? 1 : 2;

  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].seconds < afterSeconds) continue;

    // Short lookahead: 30 seconds from this block
    let windowText = '';
    let j = i;
    while (j < blocks.length && blocks[j].seconds - blocks[i].seconds < 30) {
      windowText += ' ' + blocks[j].text;
      j++;
    }
    windowText = windowText.toLowerCase();

    let score = 0;
    for (const kw of keywords) {
      if (windowText.includes(kw)) score++;
    }

    if (score >= threshold) {
      return blocks[i].seconds;
    }
  }

  return null;
}

// Process all meetings
const timestampMap = {};
let mapped = 0;
let noTranscript = 0;
let noItems = 0;

for (const meeting of data.meetings) {
  const videoId = videoByDate.get(meeting.date) || meeting.youtube;
  if (!videoId) continue;
  if (!meeting.items || meeting.items.length === 0) {
    noItems++;
    continue;
  }

  // Find transcript file
  const srtPath = resolve(transcriptDir, `${videoId}.en.srt`);
  const vttPath = resolve(transcriptDir, `${videoId}.en.vtt`);

  let blocks;
  if (existsSync(srtPath)) {
    blocks = parseSRT(readFileSync(srtPath, 'utf-8'));
  } else if (existsSync(vttPath)) {
    blocks = parseVTT(readFileSync(vttPath, 'utf-8'));
  } else {
    noTranscript++;
    continue;
  }

  if (blocks.length === 0) {
    console.warn(`  Empty transcript for ${meeting.date} (${videoId})`);
    continue;
  }

  console.log(`Mapping ${meeting.date} (${meeting.items.length} items, ${blocks.length} transcript blocks)`);

  const itemTimestamps = [];
  let lastTimestamp = 0;

  for (const item of meeting.items) {
    const keywords = extractKeywords(item.title);
    if (keywords.length === 0) {
      itemTimestamps.push(null);
      continue;
    }

    const seconds = findTimestamp(blocks, keywords, lastTimestamp > 0 ? lastTimestamp - 60 : 0);
    if (seconds !== null) {
      // Ensure monotonically increasing (with some tolerance)
      if (seconds >= lastTimestamp - 120) {
        lastTimestamp = seconds;
      }
      itemTimestamps.push({
        timestamp: formatTimestamp(seconds),
        timestampSeconds: seconds,
        keywords
      });
    } else {
      itemTimestamps.push(null);
    }
  }

  const mappedCount = itemTimestamps.filter(Boolean).length;
  if (mappedCount > 0) {
    timestampMap[meeting.date] = {
      videoId,
      items: itemTimestamps
    };
    mapped++;
    console.log(`  Mapped ${mappedCount}/${meeting.items.length} items`);
  }
}

console.log(`\nDone: ${mapped} meetings mapped, ${noTranscript} missing transcripts, ${noItems} no items`);

const outPath = resolve(ROOT, 'data/timestamp-map.json');
writeFileSync(outPath, JSON.stringify(timestampMap, null, 2));
console.log(`Wrote ${outPath}`);
