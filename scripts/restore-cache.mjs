#!/usr/bin/env node
/**
 * Restore transcripts and transcription caches from Cloudflare R2.
 * This prevents redundant (and expensive) AssemblyAI transcription and 
 * Anthropic translation calls when running the pipeline on a clean workspace.
 *
 * Usage:
 *   node scripts/restore-cache.mjs
 */

import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BUCKET = 'r2:rcsd-meetings';

function runRclone(args) {
  try {
    execFileSync('rclone', args, { stdio: 'inherit', cwd: ROOT, timeout: 600_000 });
    return true;
  } catch (err) {
    console.error(`rclone failed with args: ${args.join(' ')}`);
    console.error(err.message);
    return false;
  }
}

console.log('Restoring cache from Cloudflare R2 to avoid duplicate transcription/translation costs...');

// Ensure directories exist
mkdirSync(resolve(ROOT, 'artifacts/transcripts-aai'), { recursive: true });
mkdirSync(resolve(ROOT, 'artifacts/transcripts-slim'), { recursive: true });

// Check if rclone is available
try {
  execFileSync('rclone', ['--version'], { stdio: 'ignore' });
} catch (err) {
  console.warn('WARNING: rclone is not installed or not in PATH. Skipping bulk cache restoration.');
  console.warn('Pipeline scripts will fall back to dynamically downloading missing cache files from the public CDN.');
  process.exit(0);
}

// 1. Restore transcripts-aai. --ignore-existing: only fetch files the
// workspace is missing — a transcript already present locally (a same-run
// re-transcription, or one staged via the workflow's operator inbox) is newer
// than R2 and must not be clobbered by this restore. A plain copy here
// silently reverted the July 2026 full-corpus backfill twice.
console.log('\nSyncing transcripts-aai (AssemblyAI raw transcripts cache) from R2...');
const ok1 = runRclone([
  'copy',
  `${BUCKET}/transcripts-aai`,
  resolve(ROOT, 'artifacts/transcripts-aai'),
  '--ignore-existing',
  '--s3-no-check-bucket',
  '--progress',
  '--stats-one-line',
  '-v'
]);

// 2. Restore transcripts-slim (slim EN + ES transcripts). --ignore-existing
// for the same reason as transcripts-aai above: files already in the
// workspace (operator slim-inbox ingest, or regenerated earlier this run)
// are newer than R2 and must not be clobbered — a plain copy here silently
// re-clobbered the salvaged full-corpus ES translations on 2026-07-19 and
// triggered a duplicate paid re-translation.
console.log('\nSyncing transcripts-slim (slim English & Spanish transcripts) from R2...');
const ok2 = runRclone([
  'copy',
  `${BUCKET}/transcripts`,
  resolve(ROOT, 'artifacts/transcripts-slim'),
  '--ignore-existing',
  '--s3-no-check-bucket',
  '--include', '*.json',
  '--progress',
  '--stats-one-line',
  '-v'
]);

if (ok1 && ok2) {
  console.log('\nCache successfully restored from R2!');
} else {
  console.warn('\nSome cache files could not be restored. The pipeline may re-run some tasks.');
}
