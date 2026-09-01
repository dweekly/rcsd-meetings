/**
 * Shared YouTube audio fetcher for the transcription pipeline.
 *
 * Why this exists: both `download-audio.mjs` (batch pre-fetch) and
 * `transcribe-assemblyai.mjs` (on-demand fetch) shelled out to
 * `yt-dlp -f bestaudio` with no retry and truncated the error to 100 chars.
 * On 2026-08-14 the August 10 board meeting (video 7ShPhkVjFDQ) failed the
 * whole pipeline's transcription step with `ERROR: u` — the truncated tail of
 * `unable to download video data: HTTP Error 403: Forbidden`.
 *
 * The 403 was reproduced on two independent networks (macOS residential and
 * the trogdor self-hosted runner) and on both the opus (251) and m4a (140)
 * streams, then a plain re-run of the *same* command downloaded all 48 MiB at
 * full speed. That rules out format availability, player-client selection, and
 * yt-dlp version, and leaves transient throttling on YouTube's media hosts as
 * the working hypothesis: the media URL is signed and valid, the CDN just
 * refuses some requests. Not a documented upstream bug — no yt-dlp issue is
 * cited here because the failure is server-side and intermittent.
 *
 * So: retry with backoff first, then fall back across formats, and always
 * surface the real stderr so the next failure is diagnosable from CI logs.
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

/**
 * Extensions yt-dlp may produce for an audio-only stream, in the order we probe
 * for an already-cached file. webm (opus) first because that is what the
 * preferred format selector yields; m4a is the documented fallback below.
 */
export const AUDIO_EXTENSIONS = ['webm', 'm4a', 'opus', 'ogg', 'mp3'];

/**
 * yt-dlp format selectors, tried in order. Every meeting in the cached corpus
 * was fetched with plain `bestaudio`, so it stays first to keep re-runs
 * byte-identical for anything already processed.
 *
 *  1. bestaudio            — opus 251, 48 kHz / ~103 kbps. Preferred input for
 *                            AssemblyAI (see data/METHODOLOGY-transcription.md).
 *  2. bestaudio[ext=m4a]   — AAC 140, 44.1 kHz / ~129 kbps. Same speech content;
 *                            used only if the opus stream stays unreachable.
 *  3. bestaudio/best       — last resort, accepts the progressive 360p mux
 *                            (format 18, 22 kHz audio) so a meeting still gets
 *                            transcribed rather than skipped entirely.
 */
export const FORMAT_CHAIN = ['bestaudio', 'bestaudio[ext=m4a]', 'bestaudio/best'];

/**
 * Attempts per format selector. Three is enough that a single throttled
 * response does not fail a meeting, and small enough that a genuinely
 * unavailable video fails in well under a minute of wall clock.
 */
export const ATTEMPTS_PER_FORMAT = 3;

/** Backoff before retry N (ms): 5s, then 20s. Long enough for short-lived
 *  CDN throttling to clear, short enough to stay inside the pipeline's budget. */
export const RETRY_BACKOFF_MS = [5_000, 20_000];

/** Default per-invocation yt-dlp timeout. A 3-hour meeting's audio is ~150 MiB;
 *  10 minutes covers that even on a slow link. */
export const DEFAULT_TIMEOUT_MS = 600_000;

function sleepSync(ms) {
  // Synchronous sleep: these scripts are straight-line execFileSync pipelines,
  // and making the whole call stack async just to wait would be a larger change
  // than the bug warrants.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Return the cached audio path for a video, or null if we have not fetched it. */
export function cachedAudioPath(videoId, audioDir) {
  for (const ext of AUDIO_EXTENSIONS) {
    const p = resolve(audioDir, `${videoId}.${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Download a video's audio track, returning the local path.
 * No-op (returns the cached path) when the audio is already on disk.
 *
 * @param {string} videoId          YouTube video id
 * @param {object} opts
 * @param {string} opts.audioDir    Directory to write into (created if absent)
 * @param {number} [opts.timeoutMs] Per-attempt yt-dlp timeout
 * @param {(msg: string) => void} [opts.log] Progress sink for retry notices
 * @returns {string} path to the downloaded audio file
 */
export function downloadAudio(videoId, { audioDir, timeoutMs = DEFAULT_TIMEOUT_MS, log = () => {} } = {}) {
  const cached = cachedAudioPath(videoId, audioDir);
  if (cached) return cached;

  mkdirSync(audioDir, { recursive: true });
  const outTemplate = resolve(audioDir, `${videoId}.%(ext)s`);
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const failures = [];

  for (const format of FORMAT_CHAIN) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_FORMAT; attempt++) {
      try {
        execFileSync('yt-dlp', ['-f', format, '--no-warnings', '-o', outTemplate, url], {
          encoding: 'utf-8',
          timeout: timeoutMs,
          stdio: 'pipe',
        });
        const path = cachedAudioPath(videoId, audioDir);
        if (path) return path;
        failures.push(`${format} attempt ${attempt}: yt-dlp exited 0 but wrote no audio file`);
      } catch (err) {
        // execFileSync surfaces the useful text on stderr, not in err.message.
        const detail = (err.stderr || err.message || '').toString().trim().split('\n').slice(-2).join(' ');
        failures.push(`${format} attempt ${attempt}: ${detail}`);
        log(`    retrying (${format}, attempt ${attempt}/${ATTEMPTS_PER_FORMAT} failed): ${detail}`);
      }
      const backoff = RETRY_BACKOFF_MS[attempt - 1];
      if (backoff && attempt < ATTEMPTS_PER_FORMAT) sleepSync(backoff);
    }
  }

  throw new Error(`Audio download failed for ${videoId} after ${FORMAT_CHAIN.length * ATTEMPTS_PER_FORMAT} attempts:\n  ${failures.join('\n  ')}`);
}
