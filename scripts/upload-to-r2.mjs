#!/usr/bin/env node
/**
 * Upload local files to Cloudflare R2 bucket for public archival hosting.
 *
 * Default mode uses `rclone copy` (additive-only, never deletes remote files).
 * Use --sync for a full mirror that also removes remote files not present locally.
 *
 * Usage:
 *   node scripts/upload-to-r2.mjs              # copy new/changed files only
 *   node scripts/upload-to-r2.mjs --dry-run    # show what would be uploaded
 *   node scripts/upload-to-r2.mjs --sync       # full mirror (deletes stale remote files)
 *
 * Requires: rclone configured with an "r2" remote that has read+write+list
 * permissions on the rcsd-meetings bucket.
 *
 * Setup: brew install rclone && rclone config
 *   - Type: s3, Provider: Cloudflare
 *   - Create an R2 API token with "Object Read & Write" permission
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { readdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ARTIFACTS_DIR = resolve(ROOT, 'artifacts');
const DATA_DIR = resolve(ROOT, 'data');
const BUCKET = 'r2:rcsd-meetings';

const dryRun = process.argv.includes('--dry-run');
const fullSync = process.argv.includes('--sync');
const verb = fullSync ? 'sync' : 'copy';

function run(label, args) {
  if (dryRun) args.push('--dry-run');
  args.push('--s3-no-check-bucket');
  console.log(`\n${label}`);
  try {
    execFileSync('rclone', args, { stdio: 'inherit', timeout: 600_000 });
  } catch (err) {
    process.exit(err.status || 1);
  }
}

// Safety guard: step 1 copies the artifacts/ root to the PUBLIC bucket root, so any
// loose file sitting directly in artifacts/ gets published at https://data.rcsd.info/<file>.
// Only subdirectories (json/, audio/, og/, transcripts-*/, etc.) are intended to ship.
// A stray top-level file is almost always a scratch/working file (email draft, repro,
// notes) that does NOT belong on a public CDN — refuse to upload until it's moved out.
// Non-public scratch files belong in tmp/ (gitignored, never synced). See CLAUDE.md.
const strayFiles = readdirSync(ARTIFACTS_DIR, { withFileTypes: true })
  .filter((d) => d.isFile())
  .map((d) => d.name);
if (strayFiles.length > 0) {
  console.error(`\nRefusing to upload: ${strayFiles.length} loose file(s) at artifacts/ root would be published to the public bucket:`);
  for (const f of strayFiles) console.error(`  artifacts/${f}`);
  console.error(`\nMove non-public scratch files to tmp/ (gitignored), or into the correct artifacts/ subdirectory, then re-run.`);
  process.exit(1);
}

// 1. Artifacts → bucket root (exclude json/ and transcripts-slim/ which are managed separately)
run(`${verb} artifacts → ${BUCKET}`, [
  verb,
  ARTIFACTS_DIR,
  BUCKET,
  '--exclude', 'json/**',
  '--exclude', 'transcripts-slim/**',
  // Board-policy exhibits are provenance-migrated and publish only through
  // upload-release.mjs after immutable upload + hash verification.
  '--exclude', 'board-policy-exhibits/**',
  // Scratch/discard dirs must never publish (this one briefly did; the live
  // tmp-may13-discards/ prefix is deleted at deploy).
  '--exclude', 'tmp-*/**',
  '--progress',
  '--stats-one-line',
  '-v',
]);

// 1a. Slim transcripts → transcripts/ (mapped custom name)
run(`${verb} transcripts-slim → ${BUCKET}/transcripts`, [
  verb,
  resolve(ARTIFACTS_DIR, 'transcripts-slim'),
  `${BUCKET}/transcripts`,
  '--progress',
  '--stats-one-line',
  '-v',
]);

// 2. data/**/*.json → json/ prefix (exclude local-only caches)
run(`${verb} data → ${BUCKET}/json`, [
  verb,
  DATA_DIR,
  `${BUCKET}/json`,
  '--filter', '- llm-timestamp-cache/**',
  // Migrated policy data must never advance through the unverified legacy
  // path. upload-release.mjs owns these stable keys.
  '--filter', '- provenance/**',
  '--filter', '- board-policies/**',
  '--filter', '- board-policies-es/**',
  '--filter', '- policies-index.json',
  '--filter', '- policy-titles-es.json',
  '--filter', '- policy-summaries.json',
  '--filter', '+ warrants/*.json',
  '--filter', '+ *.json',
  '--filter', '- *',
  '--progress',
  '--stats-one-line',
  '-v',
]);
