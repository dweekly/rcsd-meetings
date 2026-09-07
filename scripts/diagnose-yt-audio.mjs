#!/usr/bin/env node
/**
 * Standalone diagnostic for "the pipeline could not fetch a meeting's audio".
 *
 * Kept in the repo deliberately: this is the spike that identified the
 * 2026-08-14 failure (August 10 board meeting, video 7ShPhkVjFDQ). The pipeline
 * reported only `ERROR: u`, and the useful facts — which formats YouTube
 * offers, which of them actually transfer bytes, and whether a failure survives
 * a retry — took a dozen manual yt-dlp invocations to establish. Re-run this
 * instead of redoing that by hand.
 *
 * Usage:
 *   node scripts/diagnose-yt-audio.mjs <videoId> [--trials 3]
 *
 * Output: the format table, then per-format trial results. A format that fails
 * once and succeeds on retry is transient CDN throttling (the observed case).
 * A format that fails every trial on two different networks is genuinely
 * unavailable, and the fallback chain in lib/yt-audio.mjs should be revisited.
 *
 * Downloads a short section only (see PROBE_SECONDS), so a full run costs a few
 * hundred KiB rather than the ~50 MiB of a real fetch. Note the tradeoff:
 * --download-sections hands the transfer to ffmpeg, so a throttled response
 * shows up as `ffmpeg exited with code 8` rather than the HTTP 403 that
 * yt-dlp's own downloader would print. Same failure, different messenger.
 */

import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, readdirSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { FORMAT_CHAIN } from './lib/yt-audio.mjs';

/** Seconds of audio to pull per probe — enough to prove the transfer works. */
const PROBE_SECONDS = 10;
/** Per-probe timeout. A probe that cannot start in 90s is a failure, not slowness. */
const PROBE_TIMEOUT_MS = 90_000;

const args = process.argv.slice(2);
const videoId = args.find((a) => !a.startsWith('--'));
const trialsFlag = args.indexOf('--trials');
const TRIALS = trialsFlag >= 0 ? Number(args[trialsFlag + 1]) : 3;

if (!videoId) {
  console.error('Usage: node scripts/diagnose-yt-audio.mjs <videoId> [--trials 3]');
  process.exit(1);
}

const url = `https://www.youtube.com/watch?v=${videoId}`;

function run(ytArgs, timeout = PROBE_TIMEOUT_MS) {
  return execFileSync('yt-dlp', ytArgs, { encoding: 'utf-8', timeout, stdio: 'pipe' });
}

console.log(`\nyt-dlp version: ${run(['--version'], 20_000).trim()}`);
console.log(`Video: ${url}\n`);

console.log('--- Available formats ---');
try {
  console.log(run(['--no-warnings', '-F', url]));
} catch (err) {
  console.error(`Format listing FAILED: ${(err.stderr || err.message).toString().trim()}`);
  console.error('The extractor itself is broken for this video — retries will not help.');
  process.exit(2);
}

console.log(`--- Transfer probes (${PROBE_SECONDS}s per attempt, ${TRIALS} trials per format) ---`);
const results = [];
for (const format of FORMAT_CHAIN) {
  for (let trial = 1; trial <= TRIALS; trial++) {
    const dir = mkdtempSync(resolve(tmpdir(), 'yt-probe-'));
    let outcome;
    try {
      run([
        '--no-warnings', '-f', format,
        '--download-sections', `*0-${PROBE_SECONDS}`,
        '-o', resolve(dir, 'probe.%(ext)s'), url,
      ]);
      const files = readdirSync(dir);
      const bytes = files.reduce((sum, f) => sum + statSync(resolve(dir, f)).size, 0);
      outcome = bytes > 0 ? `ok (${bytes} bytes)` : 'exit 0 but no bytes written';
    } catch (err) {
      outcome = (err.stderr || err.message).toString().trim().split('\n').pop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    results.push({ format, trial, outcome });
    console.log(`  ${format.padEnd(22)} trial ${trial}: ${outcome}`);
  }
}

const anyOk = results.some((r) => r.outcome.startsWith('ok'));
const allOk = results.every((r) => r.outcome.startsWith('ok'));
console.log(
  `\nVerdict: ${allOk ? 'all probes succeeded — audio fetch is healthy.'
    : anyOk ? 'intermittent — some probes succeeded. Retry policy in lib/yt-audio.mjs should cover this.'
      : 'every probe failed — check network/IP reputation (datacenter IPs are blocked) before changing the format chain.'}`,
);
process.exit(anyOk ? 0 : 3);
