// The download path selects a format, then finds the file yt-dlp produced by
// probing a list of extensions. Those two lists are coupled: a selector that can
// yield a container missing from AUDIO_EXTENSIONS turns a successful download
// into a reported failure, with the finished file sitting on disk. These tests
// pin the coupling.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AUDIO_EXTENSIONS, FORMAT_CHAIN, cachedAudioPath } from '../scripts/lib/yt-audio.mjs';

// Containers each selector in FORMAT_CHAIN can hand back. `bestaudio/best` falls
// through to the progressive format 18 mux, which yt-dlp writes as .mp4.
const CONTAINERS_BY_SELECTOR = {
  'bestaudio': ['webm', 'm4a'],
  'bestaudio[ext=m4a]': ['m4a'],
  'bestaudio/best': ['webm', 'm4a', 'mp4'],
};

test('every container a format selector can produce is recognized', () => {
  for (const selector of FORMAT_CHAIN) {
    const containers = CONTAINERS_BY_SELECTOR[selector];
    assert.ok(containers, `FORMAT_CHAIN gained ${selector}; say which containers it yields`);
    for (const ext of containers) {
      assert.ok(AUDIO_EXTENSIONS.includes(ext),
        `${selector} can produce .${ext}, which AUDIO_EXTENSIONS does not list — ` +
        `a completed download would not be found and would report as failure`);
    }
  }
});

test('a finished progressive-fallback download is found rather than re-fetched', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'yt-audio-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  // What the last-resort selector leaves behind: format 18, an mp4.
  await writeFile(join(dir, 'abc123.mp4'), 'not really audio');

  assert.equal(cachedAudioPath('abc123', dir), join(dir, 'abc123.mp4'),
    'the fallback output must be discoverable, or downloadAudio re-fetches it every run');
});

test('probe order prefers the format the chain tries first', () => {
  // webm (opus) is what `bestaudio` yields and what the cached corpus holds, so a
  // reordering that put a fallback container first would silently change which
  // file an already-processed meeting resolves to.
  assert.equal(AUDIO_EXTENSIONS[0], 'webm');
  assert.equal(AUDIO_EXTENSIONS.at(-1), 'mp4', 'the last-resort container should probe last');
});
