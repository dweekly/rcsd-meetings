#!/usr/bin/env node
/**
 * Download auto-generated captions (SRT) for each board meeting video.
 * Reads youtube-index.json and downloads transcripts to artifacts/transcripts/.
 * Skips videos that already have a cached transcript.
 *
 * Usage: node scripts/download-transcripts.mjs
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const indexPath = resolve(ROOT, 'data/youtube-index.json');
const transcriptDir = resolve(ROOT, 'artifacts/transcripts');

if (!existsSync(indexPath)) {
  console.error('youtube-index.json not found. Run scrape-youtube-index.mjs first.');
  process.exit(1);
}

mkdirSync(transcriptDir, { recursive: true });

const videos = JSON.parse(readFileSync(indexPath, 'utf-8'));
console.log(`Processing ${videos.length} videos for transcript download...`);

let downloaded = 0;
let skipped = 0;
let failed = 0;

for (const video of videos) {
  const srtPath = resolve(transcriptDir, `${video.id}.en.srt`);

  if (existsSync(srtPath)) {
    skipped++;
    continue;
  }

  console.log(`  Downloading transcript for ${video.date}: ${video.id}...`);
  try {
    execFileSync('yt-dlp', [
      '--write-auto-sub',
      '--sub-lang', 'en',
      '--sub-format', 'srt',
      '--skip-download',
      '--no-warnings',
      '-o', resolve(transcriptDir, '%(id)s'),
      `https://www.youtube.com/watch?v=${video.id}`
    ], { encoding: 'utf-8', timeout: 60_000, stdio: 'pipe' });

    // yt-dlp outputs as {id}.en.srt
    if (existsSync(srtPath)) {
      downloaded++;
    } else {
      // Check for vtt format fallback
      const vttPath = resolve(transcriptDir, `${video.id}.en.vtt`);
      if (existsSync(vttPath)) {
        downloaded++;
        console.log(`    (saved as .vtt instead of .srt)`);
      } else {
        console.warn(`    No transcript available for ${video.id}`);
        failed++;
      }
    }
  } catch (err) {
    console.warn(`    Failed to download transcript for ${video.id}: ${err.message?.slice(0, 100)}`);
    failed++;
  }
}

console.log(`\nDone: ${downloaded} downloaded, ${skipped} cached, ${failed} failed`);
