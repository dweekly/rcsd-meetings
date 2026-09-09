/**
 * One definition of "this video will never be fetched again".
 *
 * Three places need it and must agree: the batch downloader
 * (download-audio.mjs), the on-demand downloader inside
 * transcribe-assemblyai.mjs, and the post-deploy guard
 * (check-pipeline-health.mjs). When only the batch downloader honoured the
 * list, a retired video was skipped there and then fetched anyway by the
 * transcription step — nine attempts per run, forever.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

/**
 * @param {string} root Repository root
 * @returns {Record<string, string>} videoId -> reason it was retired
 */
export function loadRetiredVideos(root) {
  const path = resolve(root, 'data/audio-unavailable.json');
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf-8')).videos ?? {};
}
