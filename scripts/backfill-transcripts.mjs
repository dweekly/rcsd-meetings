#!/usr/bin/env node
/**
 * Full-corpus AssemblyAI re-transcription driver (July 2026 backfill).
 * See TRANSCRIPTION-BACKFILL.md for the why and the publish gate.
 *
 * Enumerates every meeting recording (board + committee), pre-stages its audio
 * from the R2 mirror at data.rcsd.info/audio/ (never YouTube in bulk), and runs
 * transcribe-assemblyai.mjs one date at a time with --force.
 *
 * Resumable: a cached transcript whose speech_model_used is already
 * 'universal-3-5-pro' is skipped, so a crashed or interrupted run continues
 * where it left off. Failures are retried once at the end.
 *
 * Run from a standalone clone, NOT the Actions runner workspace:
 *   nohup node scripts/backfill-transcripts.mjs > backfill.log 2>&1 &
 */
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO_DIR = resolve(ROOT, 'artifacts/audio');
const CACHE_DIR = resolve(ROOT, 'artifacts/transcripts-aai');
mkdirSync(AUDIO_DIR, { recursive: true });
mkdirSync(CACHE_DIR, { recursive: true });

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

// ---- Enumerate recordings the same way transcribe-assemblyai.mjs does ----
const meetingsRaw = JSON.parse(readFileSync(resolve(ROOT, 'data/meetings-data.json'), 'utf-8'));
const recordings = (meetingsRaw.meetings || meetingsRaw)
  .filter((m) => m.youtube)
  .map((m) => ({ date: m.date, vid: m.youtube }));
const committeesDir = resolve(ROOT, 'data/committees');
if (existsSync(committeesDir)) {
  for (const file of readdirSync(committeesDir).filter((f) => f.endsWith('.json'))) {
    const c = JSON.parse(readFileSync(resolve(committeesDir, file), 'utf-8'));
    for (const m of c.meetings || []) {
      if (m.youtube) recordings.push({ date: m.date, vid: m.youtube });
    }
  }
}

function isDone(vid) {
  const p = resolve(CACHE_DIR, `${vid}.json`);
  if (!existsSync(p)) return false;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')).speech_model_used === 'universal-3-5-pro';
  } catch {
    return false;
  }
}

function hasAudio(vid) {
  return ['webm', 'm4a', 'opus', 'ogg', 'mp3'].some((ext) => existsSync(resolve(AUDIO_DIR, `${vid}.${ext}`)));
}

// Pull audio from our own R2 mirror; anything missing there falls back to
// yt-dlp inside the transcribe script (rare, one-off, residential IP).
function stageAudio(vid) {
  if (hasAudio(vid)) return true;
  const dest = resolve(AUDIO_DIR, `${vid}.webm`);
  try {
    execFileSync('curl', ['-sSf', '--max-time', '900', '-o', dest, `https://data.rcsd.info/audio/${vid}.webm`], {
      timeout: 16 * 60_000,
    });
    if (statSync(dest).size > 1024 * 1024) return true;
    rmSync(dest);
  } catch {
    if (existsSync(dest)) rmSync(dest);
  }
  return false;
}

// ---- Group by date (one transcribe invocation covers every meeting that day) ----
const byDate = new Map();
for (const r of recordings) {
  if (!byDate.has(r.date)) byDate.set(r.date, []);
  if (!byDate.get(r.date).some((v) => v === r.vid)) byDate.get(r.date).push(r.vid);
}
const dates = [...byDate.keys()].sort();

function runDate(date) {
  execFileSync(process.execPath, [resolve(ROOT, 'scripts/transcribe-assemblyai.mjs'), '--date', date, '--force'], {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: 60 * 60_000,
  });
}

const failed = [];
let done = 0;
let skipped = 0;
log(`Backfill: ${recordings.length} recordings across ${dates.length} dates`);
for (const date of dates) {
  const vids = byDate.get(date);
  if (vids.every(isDone)) {
    skipped += vids.length;
    continue;
  }
  for (const vid of vids) {
    if (!isDone(vid) && !stageAudio(vid)) log(`  ${date} ${vid}: no R2 audio, will fall back to yt-dlp`);
  }
  try {
    runDate(date);
    const ok = vids.filter(isDone).length;
    done += ok;
    if (ok < vids.length) failed.push(date);
    log(`${date}: ${ok}/${vids.length} done (${done} new, ${skipped} skipped, ${failed.length} failed dates so far)`);
  } catch (err) {
    failed.push(date);
    log(`${date}: FAILED — ${String(err.message).slice(0, 200)}`);
  }
}

// One retry pass over failures.
for (const date of [...failed]) {
  log(`retrying ${date}...`);
  try {
    runDate(date);
    if (byDate.get(date).every(isDone)) failed.splice(failed.indexOf(date), 1);
  } catch (err) {
    log(`${date}: retry failed — ${String(err.message).slice(0, 200)}`);
  }
}

// ---- QA summary ----
log('--- QA summary ---');
const counts = [];
let confusables = 0;
let esWords = 0;
for (const { vid } of recordings) {
  const p = resolve(CACHE_DIR, `${vid}.json`);
  if (!existsSync(p)) continue;
  try {
    const t = JSON.parse(readFileSync(p, 'utf-8'));
    if (t.speech_model_used !== 'universal-3-5-pro') continue;
    counts.push(new Set((t.utterances || []).map((u) => u.speaker)).size);
    confusables += (t.text.match(/\bLCP\b|Trustee Lee\b/g) || []).length;
    esWords += (t.text.match(/\b(gracias|escuela|estudiantes|niños|familias|buenas noches)\b/gi) || []).length;
  } catch {
    /* counted as missing below */
  }
}
counts.sort((a, b) => a - b);
log(`transcripts on 3.5 Pro: ${counts.length}/${recordings.length}`);
log(`speaker counts: min ${counts[0]}, median ${counts[Math.floor(counts.length / 2)]}, max ${counts.at(-1)}`);
log(`known-confusable hits (LCP / Trustee Lee): ${confusables}`);
log(`spanish marker words across corpus: ${esWords}`);
log(failed.length ? `INCOMPLETE — failed dates: ${failed.join(', ')}` : 'COMPLETE — all recordings on universal-3-5-pro');
