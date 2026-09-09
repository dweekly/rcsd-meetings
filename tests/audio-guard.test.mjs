/**
 * Entry-point tests for the unfetched-audio guard.
 *
 * These run the real commands (`node scripts/download-audio.mjs`,
 * `node scripts/check-pipeline-health.mjs`) rather than importing pieces of
 * them, because the defect this guard exists to catch was a script that logged
 * a failure and still exited 0 — an exit code is only observable from outside.
 *
 * Each case builds a throwaway ROOT containing just the scripts under test and
 * their data files. Both scripts resolve ROOT relative to their own location,
 * so a copied script reads the fixture's data/ and never the repository's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, existsSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function makeRoot(scripts, dataFiles) {
  const root = mkdtempSync(resolve(tmpdir(), 'rcsd-audio-guard-'));
  mkdirSync(resolve(root, 'scripts/lib'), { recursive: true });
  mkdirSync(resolve(root, 'data'), { recursive: true });
  mkdirSync(resolve(root, 'artifacts/transcripts-aai'), { recursive: true });
  for (const s of scripts) copyFileSync(resolve(REPO, s), resolve(root, s));
  // Every script under test imports the shared retirement lookup.
  copyFileSync(resolve(REPO, 'scripts/lib/audio-retirement.mjs'), resolve(root, 'scripts/lib/audio-retirement.mjs'));
  for (const [name, value] of Object.entries(dataFiles)) {
    writeFileSync(resolve(root, 'data', name), `${JSON.stringify(value, null, 2)}\n`);
  }
  return root;
}

/** Run a script, returning { code, stdout, stderr } instead of throwing. */
function run(root, script) {
  try {
    const stdout = execFileSync('node', [resolve(root, script)], { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

const GUARD = 'scripts/check-pipeline-health.mjs';

test('health guard passes, and says so, when there is no audio record', () => {
  const root = makeRoot([GUARD], {});
  const { code, stdout } = run(root, GUARD);
  assert.equal(code, 0);
  // Silence would be indistinguishable from "checked and healthy".
  assert.match(stdout, /audio guard not evaluated/i);
});

test('health guard passes while a failure is below the streak threshold', () => {
  const root = makeRoot([GUARD], {
    'audio-health.json': {
      failureStreakThreshold: 2,
      failures: {
        abc123: { date: '2026-08-26', consecutiveFailedRuns: 1, firstFailedAt: 'T', error: '403' },
      },
    },
  });
  assert.equal(run(root, GUARD).code, 0);
});

test('health guard fails once a video has failed for the threshold run count', () => {
  const root = makeRoot([GUARD], {
    'audio-health.json': {
      failureStreakThreshold: 2,
      failures: {
        abc123: { date: '2026-08-26', consecutiveFailedRuns: 2, firstFailedAt: 'T', error: '403 Forbidden' },
      },
    },
  });
  const { code, stderr } = run(root, GUARD);
  assert.equal(code, 1);
  // The alert must name the meeting and the video, or it is not actionable.
  assert.match(stderr, /2026-08-26/);
  assert.match(stderr, /abc123/);
});

test('a translation guard failure does not mask an audio guard failure', () => {
  const root = makeRoot([GUARD], {
    'translation-health.json': { lastRun: { guardTripped: true, totalCost: 9, maxRunCost: 5 }, staleStuckRuns: 0 },
    'audio-health.json': {
      failureStreakThreshold: 2,
      failures: { abc123: { date: '2026-08-26', consecutiveFailedRuns: 3, firstFailedAt: 'T', error: '403' } },
    },
  });
  const { code, stderr } = run(root, GUARD);
  assert.equal(code, 1);
  assert.match(stderr, /Cost guard tripped/);
  assert.match(stderr, /2026-08-26/);
});

test('download-audio retires a video listed in audio-unavailable.json without calling yt-dlp', () => {
  const root = makeRoot(['scripts/download-audio.mjs', 'scripts/lib/yt-audio.mjs'], {
    'youtube-index.json': [{ id: 'goneVideo1', date: '2019-01-01', title: 'Deleted upload' }],
    'audio-unavailable.json': { videos: { goneVideo1: 'Removed by the uploader' } },
  });
  // PATH without yt-dlp: any attempt to fetch would fail loudly rather than
  // pass by accident, so a green result proves the skip really happened.
  const { code, stdout } = (() => {
    try {
      // process.execPath, not 'node': PATH is deliberately empty here.
      const stdout = execFileSync(process.execPath, [resolve(root, 'scripts/download-audio.mjs')], {
        cwd: root, encoding: 'utf-8', env: { ...process.env, PATH: '/nonexistent' },
      });
      return { code: 0, stdout };
    } catch (err) {
      return { code: err.status, stdout: err.stdout ?? '' };
    }
  })();
  assert.equal(code, 0);
  assert.match(stdout, /Removed by the uploader/);

  const health = JSON.parse(readFileSync(resolve(root, 'data/audio-health.json'), 'utf-8'));
  assert.deepEqual(health.failures, {}, 'a retired video must not count as a failure');
  assert.equal(health.lastRun.retired, 1);
  assert.equal(health.lastRun.attempted, 0);
});

test('download-audio writes a health record that clears a previous failure', () => {
  const root = makeRoot(['scripts/download-audio.mjs', 'scripts/lib/yt-audio.mjs'], {
    'youtube-index.json': [{ id: 'okVideo1', date: '2026-08-26', title: 'Board meeting' }],
    'audio-health.json': {
      failureStreakThreshold: 2,
      failures: { okVideo1: { date: '2026-08-26', consecutiveFailedRuns: 1, firstFailedAt: 'T', error: '403' } },
    },
  });
  // Pre-existing transcript => nothing to download => the run is healthy and
  // must drop the stale failure rather than carry the streak forward forever.
  writeFileSync(resolve(root, 'artifacts/transcripts-aai/okVideo1.json'), '{}');
  const { code } = run(root, 'scripts/download-audio.mjs');
  assert.equal(code, 0);
  const health = JSON.parse(readFileSync(resolve(root, 'data/audio-health.json'), 'utf-8'));
  assert.deepEqual(health.failures, {});
  assert.ok(existsSync(resolve(root, 'data/audio-health.json')));
});

test('health guard stays green when transcription recovered a failed download', () => {
  // The batch download can fail twice while the on-demand fetch inside
  // transcribe-assemblyai.mjs succeeds. The recorded streak is then stale, and
  // failing the run would assert the meeting has no transcript while the
  // transcript is on disk. The guard asserts the outcome, not the streak.
  const root = makeRoot([GUARD], {
    'audio-health.json': {
      failureStreakThreshold: 2,
      failures: {
        recovered1: { date: '2026-08-26', consecutiveFailedRuns: 2, firstFailedAt: 'T', error: '403' },
      },
    },
  });
  writeFileSync(resolve(root, 'artifacts/transcripts-aai/recovered1.json'), '{}');
  const { code, stdout } = run(root, GUARD);
  assert.equal(code, 0, stdout);
});

test('health guard ignores a stuck failure for a video that has been retired', () => {
  const root = makeRoot([GUARD], {
    'audio-health.json': {
      failureStreakThreshold: 2,
      failures: { goneVideo1: { date: '2019-01-01', consecutiveFailedRuns: 9, firstFailedAt: 'T', error: '404' } },
    },
    'audio-unavailable.json': { videos: { goneVideo1: 'Removed by the uploader' } },
  });
  assert.equal(run(root, GUARD).code, 0);
});

test('transcription queue skips a retired video instead of re-fetching it every run', () => {
  // The batch downloader is not the only fetcher: transcribe-assemblyai.mjs
  // downloads on demand for anything still missing. Retirement has to be
  // honoured in both, or a dead video is skipped in one step and then given the
  // full retry chain in the next.
  const root = makeRoot(['scripts/transcribe-assemblyai.mjs', 'scripts/lib/yt-audio.mjs'], {
    'meetings-data.json': { meetings: [{ date: '2019-01-01', youtube: 'goneVideo1', duration: '1h' }] },
    'audio-unavailable.json': { videos: { goneVideo1: 'Removed by the uploader' } },
  });
  // The script imports the assemblyai SDK; borrow the repo's install.
  symlinkSync(resolve(REPO, 'node_modules'), resolve(root, 'node_modules'));
  const { code, stdout } = (() => {
    try {
      // Empty PATH: reaching yt-dlp at all would fail, so a green run proves
      // no fetch was attempted.
      const out = execFileSync(process.execPath, [resolve(root, 'scripts/transcribe-assemblyai.mjs')], {
        cwd: root, encoding: 'utf-8',
        env: { ...process.env, PATH: '/nonexistent', ASSEMBLYAI_API_KEY: 'test-key-not-used' },
      });
      return { code: 0, stdout: out };
    } catch (err) {
      return { code: err.status, stdout: (err.stdout ?? '') + (err.stderr ?? '') };
    }
  })();
  assert.equal(code, 0, stdout);
  assert.match(stdout, /Removed by the uploader/);
  assert.match(stdout, /All meetings already transcribed|0 transcribed/);
});
