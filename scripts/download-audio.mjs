#!/usr/bin/env node
/**
 * Batch download audio from YouTube for board meeting videos.
 * Downloads bestaudio via yt-dlp (see lib/yt-audio.mjs for the retry and
 * format-fallback policy) for each video in youtube-index.json that doesn't
 * already have a cached audio file.
 *
 * Usage: node scripts/download-audio.mjs
 */

import { readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { downloadAudio, AUDIO_EXTENSIONS } from './lib/yt-audio.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const AUDIO_DIR = resolve(ROOT, 'artifacts/audio');
const TRANSCRIPTS_DIR = resolve(ROOT, 'artifacts/transcripts-aai');

mkdirSync(AUDIO_DIR, { recursive: true });

if (process.env.RUNNER_ENVIRONMENT === 'github-hosted') {
  console.log('\n============================================================');
  console.log('WARNING: Running on a GitHub-hosted runner (github-hosted).');
  console.log('YouTube blocks downloads from datacenter IP addresses.');
  console.log('Skipping YouTube audio download step.');
  console.log('To download new audio, run this pipeline on a self-hosted');
  console.log('residential runner from your home network.');
  console.log('============================================================\n');
  process.exit(0);
}

const videos = JSON.parse(readFileSync(resolve(ROOT, 'data/youtube-index.json'), 'utf-8'));

function hasAudio(videoId) {
  for (const ext of AUDIO_EXTENSIONS) {
    if (existsSync(resolve(AUDIO_DIR, `${videoId}.${ext}`))) return true;
  }
  return false;
}

function hasTranscript(videoId) {
  return existsSync(resolve(TRANSCRIPTS_DIR, `${videoId}.json`));
}

const needed = videos.filter(v => !hasAudio(v.id) && !hasTranscript(v.id));
console.log(`Total videos: ${videos.length}, already transcribed: ${videos.length - needed.length - videos.filter(v => hasAudio(v.id) && !hasTranscript(v.id)).length}, to download: ${needed.length}`);

let downloaded = 0;
let failed = 0;

for (const v of needed) {
  const i = downloaded + failed + 1;
  console.log(`[${i}/${needed.length}] ${v.date} — ${v.title.slice(0, 60)}...`);
  try {
    // Retries + format fallback are in lib/yt-audio.mjs; the full stderr is
    // preserved so a CI failure is diagnosable without a local repro.
    downloadAudio(v.id, { audioDir: AUDIO_DIR, log: (msg) => console.log(msg) });
    downloaded++;
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
    failed++;
  }
}

console.log(`\nDone! Downloaded: ${downloaded}, failed: ${failed}`);
