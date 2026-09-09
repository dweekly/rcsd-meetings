#!/usr/bin/env node
/**
 * Batch download audio from YouTube for board meeting videos.
 * Downloads bestaudio via yt-dlp (see lib/yt-audio.mjs for the retry and
 * format-fallback policy) for each video in youtube-index.json that doesn't
 * already have a cached audio file.
 *
 * Records the outcome in data/audio-health.json so a fetch that keeps failing
 * becomes a red run instead of a line in a log nobody reads:
 * check-pipeline-health.mjs asserts the record after the deploy. A video that
 * is genuinely gone from YouTube is retired by adding it to
 * data/audio-unavailable.json with a reason, not by muting the guard.
 *
 * Usage: node scripts/download-audio.mjs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { downloadAudio, AUDIO_EXTENSIONS } from './lib/yt-audio.mjs';
import { loadRetiredVideos } from './lib/audio-retirement.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const AUDIO_DIR = resolve(ROOT, 'artifacts/audio');
const TRANSCRIPTS_DIR = resolve(ROOT, 'artifacts/transcripts-aai');
const HEALTH_PATH = resolve(ROOT, 'data/audio-health.json');

/**
 * Consecutive runs a video may fail to download before the run goes red.
 *
 * Not 1: a single `403 Forbidden` from YouTube's media hosts is a documented,
 * self-healing event (see lib/yt-audio.mjs) and reddening the run for one is
 * noise. Not higher than 2: two consecutive scheduled runs is ~12 hours, and
 * every multi-run failure observed so far has been a real, sticky break (a
 * stale yt-dlp extractor) that stayed broken until someone acted.
 */
const FAILURE_STREAK_THRESHOLD = 2;

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

const unavailable = loadRetiredVideos(ROOT);
const health = existsSync(HEALTH_PATH)
  ? JSON.parse(readFileSync(HEALTH_PATH, 'utf-8'))
  : { failures: {} };
const priorFailures = health.failures || {};
const failures = {};

function hasAudio(videoId) {
  for (const ext of AUDIO_EXTENSIONS) {
    if (existsSync(resolve(AUDIO_DIR, `${videoId}.${ext}`))) return true;
  }
  return false;
}

function hasTranscript(videoId) {
  return existsSync(resolve(TRANSCRIPTS_DIR, `${videoId}.json`));
}

const retired = videos.filter(v => Object.hasOwn(unavailable, v.id) && !hasTranscript(v.id));
for (const v of retired) {
  console.log(`  SKIP ${v.id} (${v.date}) — retired in audio-unavailable.json: ${unavailable[v.id]}`);
}

const needed = videos.filter(
  v => !hasAudio(v.id) && !hasTranscript(v.id) && !Object.hasOwn(unavailable, v.id),
);
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
    const prior = priorFailures[v.id];
    failures[v.id] = {
      date: v.date,
      title: v.title,
      // Streak counts RUNS, not attempts: lib/yt-audio.mjs already retried
      // across formats and backoffs before throwing once.
      consecutiveFailedRuns: (prior?.consecutiveFailedRuns ?? 0) + 1,
      firstFailedAt: prior?.firstFailedAt ?? new Date().toISOString(),
      lastFailedAt: new Date().toISOString(),
      error: err.message,
    };
  }
}

// Written unconditionally so a run in which everything succeeded CLEARS the
// record. An empty `failures` map is the healthy state and is what lets the
// guard distinguish "nothing is broken" from "download-audio never ran".
writeFileSync(
  HEALTH_PATH,
  `${JSON.stringify(
    {
      _metadata: {
        description:
          'Outcome of the most recent YouTube audio fetch. Written by scripts/download-audio.mjs, asserted after deploy by scripts/check-pipeline-health.mjs.',
        generatedBy: 'scripts/download-audio.mjs',
      },
      failureStreakThreshold: FAILURE_STREAK_THRESHOLD,
      lastRun: {
        ranAt: new Date().toISOString(),
        attempted: needed.length,
        downloaded,
        failed,
        retired: retired.length,
      },
      failures,
    },
    null,
    2,
  )}\n`,
);

console.log(`\nDone! Downloaded: ${downloaded}, failed: ${failed}`);
for (const [id, f] of Object.entries(failures)) {
  console.error(
    `  UNFETCHED ${id} (${f.date}) — failed ${f.consecutiveFailedRuns} consecutive run(s); ` +
      `the run goes red at ${FAILURE_STREAK_THRESHOLD}.`,
  );
}
