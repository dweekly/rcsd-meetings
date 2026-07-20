#!/usr/bin/env node
/** Deploy docs/ and persist a release-bound receipt for promotion. */

import { spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getInstalledPackageVersion, sha256 } from './lib/provenance.mjs';
import { assertReleaseId } from './lib/release.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const manifestPath = resolve(ROOT, 'tmp/releases/current.json');
const receiptPath = resolve(ROOT, 'tmp/releases/pages-deployment.json');
const projectArg = process.argv.find((arg) => arg.startsWith('--project-name='));
const projectName = projectArg?.slice('--project-name='.length) || 'rcsd-meetings';

if (!existsSync(manifestPath)) throw new Error('Generate and stage a release before deploying Pages.');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assertReleaseId(manifest);
if (manifest.status !== 'candidate') throw new Error('Pages deployment requires a staged candidate manifest.');
for (const name of ['remote-r2-bytes', 'stable-r2-bytes']) {
  const gate = manifest.qualityGates?.find((item) => item.name === name);
  if (gate?.status !== 'passed') throw new Error(`Pages deployment requires a passed ${name} gate.`);
}

const startedAt = new Date().toISOString();
// --branch=main explicitly: without it wrangler infers the branch from the
// checkout, and on the CI runner that inference has produced preview-only
// deployments — production (rcsd.info) sat frozen at a ~July 10 build while
// previews accumulated (caught 2026-07-19: the June 24 meeting page had its
// transcript on the preview URL but not on production).
const command = ['wrangler', 'pages', 'deploy', 'docs', `--project-name=${projectName}`, '--branch=main'];
const child = spawn('npx', command, {
  cwd: ROOT,
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => {
  output += chunk;
  process.stdout.write(chunk);
});
child.stderr.on('data', (chunk) => {
  output += chunk;
  process.stderr.write(chunk);
});

const exitCode = await new Promise((accept, reject) => {
  child.on('error', reject);
  child.on('close', accept);
});
if (exitCode !== 0) throw new Error(`Wrangler Pages deploy failed with exit code ${exitCode}.`);

const deploymentUrl = output.match(/https:\/\/[^\s\x1b]+\.pages\.dev\/?/i)?.[0];
const ciRunUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : undefined;
const receipt = {
  schemaVersion: '1.0.0',
  releaseId: manifest.releaseId,
  status: 'passed',
  provider: 'cloudflare-pages',
  projectName,
  client: { name: 'wrangler', version: getInstalledPackageVersion('wrangler', import.meta.url) },
  startedAt,
  deployedAt: new Date().toISOString(),
  command: `npx ${command.join(' ')}`,
  outputHash: sha256(output),
  ...(deploymentUrl ? { deploymentUrl } : {}),
  ...(ciRunUrl ? { ciRunUrl } : {}),
};
mkdirSync(dirname(receiptPath), { recursive: true });
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`\nRecorded Pages deployment receipt for ${manifest.releaseId}.`);
