#!/usr/bin/env node
/**
 * Upload local artifacts to Cloudflare R2 bucket for public archival hosting.
 *
 * Iterates artifacts/{agendas,minutes,transcripts}/ and uploads each file
 * to the rcsd-meetings R2 bucket using wrangler CLI.
 *
 * Usage: node scripts/upload-to-r2.mjs [--dry-run]
 *
 * Requires: wrangler CLI authenticated with Cloudflare account.
 */

import { readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ARTIFACTS_DIR = resolve(ROOT, 'artifacts');
const BUCKET = 'rcsd-meetings';

const dryRun = process.argv.includes('--dry-run');

const DIRS = ['agendas', 'minutes', 'transcripts'];

let uploaded = 0;
let skipped = 0;
let errors = 0;

for (const dir of DIRS) {
  const fullDir = join(ARTIFACTS_DIR, dir);
  let files;
  try {
    files = readdirSync(fullDir);
  } catch {
    console.log(`Skipping ${dir}/ (not found)`);
    continue;
  }

  console.log(`\n${dir}/: ${files.length} files`);

  for (const file of files.sort()) {
    const localPath = join(fullDir, file);
    const stat = statSync(localPath);
    if (!stat.isFile()) continue;

    const r2Key = `${dir}/${file}`;
    const sizeKB = Math.round(stat.size / 1024);

    if (dryRun) {
      console.log(`  [dry-run] ${r2Key} (${sizeKB}KB)`);
      skipped++;
      continue;
    }

    try {
      execFileSync('wrangler', [
        'r2', 'object', 'put',
        `${BUCKET}/${r2Key}`,
        '--file', localPath,
      ], { encoding: 'utf-8', timeout: 60_000, stdio: 'pipe' });
      console.log(`  ${r2Key} (${sizeKB}KB)`);
      uploaded++;
    } catch (err) {
      console.error(`  FAIL ${r2Key}: ${err.message?.slice(0, 100)}`);
      errors++;
    }
  }
}

console.log(`\nDone: ${uploaded} uploaded, ${skipped} skipped, ${errors} errors`);
