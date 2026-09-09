#!/usr/bin/env node
/**
 * Assert pipeline health guards — final workflow step (after upload/commit/
 * deploy, so a failure alerts WITHOUT discarding the run's paid API work).
 *
 * Reads data/translation-health.json, written by translate-transcripts.mjs
 * each full run, and exits non-zero when:
 *   - the per-run cost guard tripped (spend hit MAX_RUN_COST), or
 *   - the stale-refresh backlog has not shrunk for staleStuckThreshold
 *     consecutive saturated-cap runs (the Aug 2026 poisoned-cache failure
 *     mode: work completes and is paid for, then reads as stale again next
 *     run — see pipeline.yml and ROADMAP.md).
 *
 * Reads data/audio-health.json, written by download-audio.mjs, and exits
 * non-zero when a meeting's audio has failed to download for
 * failureStreakThreshold consecutive runs. Without this the step logs a
 * failure, returns 0, and a posted board meeting silently never gets a
 * transcript — the site keeps deploying, so nothing else notices.
 *
 * A red scheduled run triggers GitHub's workflow-failure notification, which
 * is the alert channel. The condition re-fails on every run (including
 * --quick runs, which don't rewrite the file) until a healthy full run
 * clears it — that persistence is intentional.
 *
 * Usage: node scripts/check-pipeline-health.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadRetiredVideos } from './lib/audio-retirement.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HEALTH_PATH = resolve(ROOT, 'data/translation-health.json');
const AUDIO_HEALTH_PATH = resolve(ROOT, 'data/audio-health.json');
const TRANSCRIPTS_DIR = resolve(ROOT, 'artifacts/transcripts-aai');

const problems = [];

// Each guard reads its own record and is skipped only when THAT record is
// absent. An early return on one missing record would silently disable every
// later guard — which it did: a workspace with no translation record never
// reached the audio check at all.
const health = existsSync(HEALTH_PATH) ? JSON.parse(readFileSync(HEALTH_PATH, 'utf-8')) : null;
if (!health) {
  console.log('No translation health record yet — translation guards not evaluated (first run or translation never executed).');
}
const { lastRun = {}, staleStuckRuns = 0, staleStuckThreshold = 4 } = health ?? {};

if (lastRun.guardTripped) {
  problems.push(`Cost guard tripped: translate run spent $${lastRun.totalCost} (ceiling $${lastRun.maxRunCost}) at ${lastRun.generatedAt}. Investigate before the next scheduled run re-spends.`);
}
if (staleStuckRuns >= staleStuckThreshold) {
  problems.push(`Stale backlog stuck: ${staleStuckRuns} consecutive saturated-cap runs without staleDeferred shrinking (last: ${lastRun.staleQueued} queued / ${lastRun.staleDeferred} deferred). Completed translations are likely being lost — check the R2 restore/upload path (see the Aug 2026 incident in pipeline.yml).`);
}

// Audio fetch. Absent record = download-audio.mjs has not run in this
// workspace (a --quick run, or a hosted runner where it exits early); that is
// not evidence of health, so say nothing rather than pass silently.
if (existsSync(AUDIO_HEALTH_PATH)) {
  const audio = JSON.parse(readFileSync(AUDIO_HEALTH_PATH, 'utf-8'));
  const threshold = audio.failureStreakThreshold ?? 2;
  const retired = loadRetiredVideos(ROOT);
  // The claim being asserted is about the OUTCOME — "this meeting has no
  // transcript" — not about which script exited non-zero. download-audio.mjs
  // records its own failures, but transcribe-assemblyai.mjs fetches on demand
  // afterwards and often succeeds where the batch pass did not; a guard that
  // trusted the recorded streak alone would fail a run that had in fact
  // recovered, and say the meeting has no transcript while the transcript sat
  // on disk beside it. So re-derive the truth here, from the transcript.
  const stuck = Object.entries(audio.failures ?? {}).filter(
    ([videoId, f]) =>
      f.consecutiveFailedRuns >= threshold &&
      !existsSync(resolve(TRANSCRIPTS_DIR, `${videoId}.json`)) &&
      !Object.hasOwn(retired, videoId),
  );
  for (const [videoId, f] of stuck) {
    problems.push(
      `Audio never fetched for ${f.date} (${videoId}): ${f.consecutiveFailedRuns} consecutive failed runs since ${f.firstFailedAt}. ` +
        `That meeting has no transcript and will not get one until this is fixed. Last error: ${f.error}. ` +
        `Check yt-dlp is current on the runner; if the video is genuinely gone, retire it in data/audio-unavailable.json.`,
    );
  }
} else {
  console.log('No audio health record in this workspace — audio guard not evaluated.');
}

if (problems.length > 0) {
  console.error('PIPELINE HEALTH GUARD FAILED:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(
  health
    ? `Pipeline health OK (last translate run: ${lastRun.translated} translated, $${lastRun.totalCost}, ${lastRun.staleDeferred} deferred; stuck streak ${staleStuckRuns}/${staleStuckThreshold}).`
    : 'Pipeline health OK (no translation record to evaluate).',
);
