#!/usr/bin/env node
/**
 * Upload local artifacts to Cloudflare R2 bucket for public archival hosting.
 *
 * Recursively walks artifacts/ and uploads each file to the rcsd-meetings
 * R2 bucket using wrangler CLI. Preserves directory structure as R2 keys.
 *
 * Directories: agendas/, minutes/, transcripts/, documents/{spsa,budget,lcap,sarc}/
 *
 * Usage: node scripts/upload-to-r2.mjs [--dry-run]
 *
 * Requires: wrangler CLI authenticated with Cloudflare account.
 */

import { readdirSync, statSync } from 'fs';
import { resolve, dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ARTIFACTS_DIR = resolve(ROOT, 'artifacts');
const BUCKET = 'rcsd-meetings';

const dryRun = process.argv.includes('--dry-run');

let uploaded = 0;
let skipped = 0;
let errors = 0;

function walkDir(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries.sort()) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walkDir(fullPath);
    } else if (stat.isFile()) {
      uploadFile(fullPath, stat);
    }
  }
}

function uploadFile(localPath, stat) {
  const r2Key = relative(ARTIFACTS_DIR, localPath);
  const sizeKB = Math.round(stat.size / 1024);

  if (dryRun) {
    console.log(`  [dry-run] ${r2Key} (${sizeKB}KB)`);
    skipped++;
    return;
  }

  try {
    execFileSync('wrangler', [
      'r2', 'object', 'put',
      `${BUCKET}/${r2Key}`,
      '--file', localPath,
      '--remote',
    ], { encoding: 'utf-8', timeout: 120_000, stdio: 'pipe' });
    console.log(`  ${r2Key} (${sizeKB}KB)`);
    uploaded++;
  } catch (err) {
    console.error(`  FAIL ${r2Key}: ${err.message?.slice(0, 100)}`);
    errors++;
  }
}

console.log(`Uploading artifacts to R2 bucket: ${BUCKET}`);
console.log(`Source: ${ARTIFACTS_DIR}\n`);
walkDir(ARTIFACTS_DIR);
console.log(`\nDone: ${uploaded} uploaded, ${skipped} skipped, ${errors} errors`);
