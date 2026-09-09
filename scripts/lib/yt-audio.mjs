/**
 * Shared YouTube audio fetcher for the transcription pipeline.
 *
 * Why this exists: both `download-audio.mjs` (batch pre-fetch) and
 * `transcribe-assemblyai.mjs` (on-demand fetch) shell out to yt-dlp, and both
 * need the same retry, format-fallback, and error-reporting policy. A fetch
 * that fails here means a board meeting never gets a transcript, so the
 * failure must be both survivable and diagnosable.
 *
 * `unable to download video data: HTTP Error 403: Forbidden` on the media
 * fetch has two distinct causes, and they are told apart by whether a retry
 * helps:
 *
 *  1. Transient throttling on YouTube's media hosts. The signed media URL is
 *     valid and the CDN simply refuses some requests; a repeat of the very
 *     same command succeeds. Observed across formats (opus 251 and m4a 140)
 *     and across networks. This is what the retry and backoff below exist for,
 *     and it self-heals within a run.
 *  2. A yt-dlp too old for YouTube's current player. Every attempt on every
 *     format fails identically and no amount of retrying helps. Measured
 *     directly: on 2026-09-08 video Y0WtwaJ_3VI failed 9/9 attempts under
 *     yt-dlp 2026.06.09 and downloaded on the first attempt under 2026.08.19,
 *     on the same host and network. This does NOT self-heal — the workflow
 *     installs the current yt-dlp on every run so it cannot recur silently,
 *     and check-pipeline-health.mjs reddens the run if a video stays unfetched
 *     across runs.
 *
 * So: retry with backoff first, then fall back across formats, and always
 * surface the real stderr so the next failure is diagnosable from CI logs —
 * a truncated error (this code once cut stderr to 100 chars, yielding
 * `ERROR: u`) makes cause 1 and cause 2 indistinguishable.
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

/**
 * Extensions yt-dlp may produce, in the order we probe for an already-cached
 * file. webm (opus) first because that is what the preferred format selector
 * yields; m4a is the documented fallback below. mp4 is last because only the
 * final `bestaudio/best` selector reaches it, via the progressive format 18
 * mux — it must be listed, or a completed fallback download is not found by
 * either caller and a successful fetch reports as failure.
 */
export const AUDIO_EXTENSIONS = ['webm', 'm4a', 'opus', 'ogg', 'mp3', 'mp4'];

/**
 * yt-dlp format selectors, tried in order. Every meeting in the cached corpus
 * was fetched with plain `bestaudio`, so it stays first to keep re-runs
 * byte-identical for anything already processed.
 *
 *  1. bestaudio            — opus 251, 48 kHz / ~103 kbps. Preferred input for
 *                            AssemblyAI (see data/METHODOLOGY-transcription.md).
 *  2. bestaudio[ext=m4a]   — AAC 140, 44.1 kHz / ~129 kbps. Same speech content;
 *                            used only if the opus stream stays unreachable.
 *  3. b                    — last resort, accepts the progressive 360p mux
 *                            (format 18, 22 kHz audio) so a meeting still gets
 *                            transcribed rather than skipped entirely.
 */
// The last selector is `b` (yt-dlp's alias for `best`), never `bestaudio/best`.
// yt-dlp's `/` operator chooses on format AVAILABILITY, not on download failure, so
// `bestaudio/best` resolves to the same audio-only stream as selector 1 whenever that
// stream is merely advertised — which it always is in the 403 state this chain exists
// to escape. `b` also suppresses yt-dlp's pre-merged-format warning, which is its
// documented way to say the progressive mux is the intended choice. Resolution is
// verified against the installed yt-dlp by scripts/verify-format-selectors.mjs.
export const FORMAT_CHAIN = ['bestaudio', 'bestaudio[ext=m4a]', 'b'];

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
