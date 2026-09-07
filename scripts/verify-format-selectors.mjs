#!/usr/bin/env node
/**
 * Resolve every selector in FORMAT_CHAIN against a synthetic YouTube format list,
 * offline, using the installed yt-dlp. No network, no real video.
 *
 * Why this exists: yt-dlp's `/` operator chooses on format AVAILABILITY, not on
 * download failure. `bestaudio/best` therefore resolves to the audio-only stream
 * whenever that stream is merely advertised — which is exactly the state the
 * fallback chain exists to escape, since a 403 on download does not make the
 * format unavailable to the selector. Reading the docs does not surface this;
 * running the selector does.
 *
 *   node scripts/verify-format-selectors.mjs
 *
 * Exits non-zero if two selectors in the chain resolve to the same format, which
 * means one attempt in the chain is dead weight.
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { FORMAT_CHAIN } from './lib/yt-audio.mjs';

/** The three formats a YouTube board-meeting recording advertises. */
const FORMATS = [
  { format_id: '251', ext: 'webm', acodec: 'opus', vcodec: 'none', abr: 103, url: 'http://x/251', protocol: 'https' },
  { format_id: '140', ext: 'm4a', acodec: 'mp4a.40.2', vcodec: 'none', abr: 129, url: 'http://x/140', protocol: 'https' },
  { format_id: '18', ext: 'mp4', acodec: 'mp4a.40.2', vcodec: 'avc1', abr: 96, height: 360, url: 'http://x/18', protocol: 'https' },
];

export function resolveSelectors(chain = FORMAT_CHAIN) {
  const dir = mkdtempSync(join(tmpdir(), 'fmt-sel-'));
  const infoPath = join(dir, 'info.json');
  writeFileSync(infoPath, JSON.stringify({
    id: 'TEST', title: 't', extractor: 'youtube', extractor_key: 'Youtube',
    webpage_url: 'https://www.youtube.com/watch?v=TEST', _type: 'video', formats: FORMATS,
  }));

  return chain.map((selector) => {
    const out = execFileSync('yt-dlp',
      ['--load-info-json', infoPath, '-f', selector, '--simulate', '--print', 'format_id'],
      { encoding: 'utf-8' });
    return { selector, formatId: out.trim().split('\n').pop() };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const resolved = resolveSelectors();
  for (const { selector, formatId } of resolved) {
    console.log(`  ${selector.padEnd(22)} -> format ${formatId}`);
  }
  const ids = resolved.map((r) => r.formatId);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) {
    console.error(`\nFAIL: format(s) ${[...new Set(dupes)].join(', ')} selected more than once — `
      + 'one attempt in the chain repeats another and cannot recover anything new.');
    process.exit(1);
  }
  console.log('\nOK: every selector in the chain reaches a distinct format.');
}
