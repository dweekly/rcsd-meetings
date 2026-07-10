#!/usr/bin/env node
/**
 * Stage or promote a manifest-driven R2 release.
 *
 *   --stage     write-once immutable bytes, verify them, refresh compatible
 *               stable keys, and publish a durable candidate receipt
 *   --promote   recover the candidate receipt, verify the Pages receipt and
 *               remote bytes, then publish the immutable manifest/current
 *   --plan-only validate the complete local plan without network access
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  hashCanonicalJson,
  hashFile,
  validateReleaseManifest,
} from './lib/provenance.mjs';
import { validateJsonSchema } from './lib/provenance-schema.mjs';
import {
  assertReleaseId,
  sameReleaseContent,
} from './lib/release.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const manifestArg = process.argv.find((arg) => !arg.startsWith('--') && arg.endsWith('.json'));
const receiptArg = process.argv.find((arg) => arg.startsWith('--pages-receipt='));
const manifestPath = resolve(ROOT, manifestArg || 'tmp/releases/current.json');
const pagesReceiptPath = resolve(ROOT, receiptArg?.slice('--pages-receipt='.length) || 'tmp/releases/pages-deployment.json');
const dryRun = process.argv.includes('--dry-run');
const planOnly = process.argv.includes('--plan-only');
const stage = process.argv.includes('--stage');
const promote = process.argv.includes('--promote');
const allowDirty = process.argv.includes('--allow-dirty-release');
const BUCKET = process.env.RELEASE_BUCKET || 'r2:rcsd-meetings';
const RCLONE = process.env.RCLONE_BIN || 'rclone';

function run(label, args, { capture = false } = {}) {
  const actual = dryRun ? [...args, '--dry-run'] : args;
  console.log(`\n${label}`);
  return execFileSync(RCLONE, [...actual, '--s3-no-check-bucket'], {
    cwd: ROOT,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: capture ? 'utf8' : undefined,
    timeout: 30 * 60_000,
  });
}

function validationError(label, errors) {
  return new Error(`${label}:\n${errors.map((error) => `${error.path || '/'}: ${error.message}`).join('\n')}`);
}

function validateManifest(manifest, label = 'Invalid release manifest') {
  const schemaResult = validateJsonSchema('release', manifest);
  if (!schemaResult.valid) throw validationError(`${label} (JSON Schema)`, schemaResult.errors);
  const result = validateReleaseManifest(manifest);
  if (!result.valid) throw validationError(label, result.errors);
  assertReleaseId(manifest);
}

function writeList(name, paths) {
  const path = resolve(ROOT, `tmp/releases/${name}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${paths.join('\n')}\n`);
  return path;
}

function gate(manifest, name) {
  return manifest.qualityGates.find((item) => item.name === name);
}

function setGate(manifest, name, status, details) {
  const item = gate(manifest, name);
  if (!item) throw new Error(`Release manifest is missing required gate: ${name}`);
  item.status = status;
  if (details) item.details = details;
  else delete item.details;
}

function enforceLocalProductionGates(manifest) {
  const clean = gate(manifest, 'source-tree-clean');
  if (clean?.status !== 'passed' && !allowDirty) {
    throw new Error('Refusing release with a waived/failed source-tree-clean gate. Regenerate with --require-clean-source or pass the explicit --allow-dirty-release escape hatch.');
  }
  for (const name of [
    'dataset-provenance-schema',
    'artifact-bytes-and-hashes',
    'record-lineage-pointers-and-input-hashes',
    'dataset-lineage-acyclic',
    'policy-language-parity',
    'public-contract-schemas',
  ]) {
    if (gate(manifest, name)?.status !== 'passed') throw new Error(`Required release gate is not passed: ${name}`);
  }
}

function expectedRoute(entry, releaseId) {
  if (entry.channel === 'pages') {
    if (!entry.sourcePath.startsWith('docs/')) throw new Error(`Pages source must live under docs/: ${entry.sourcePath}`);
    return { path: entry.sourcePath.slice('docs/'.length), immutablePath: undefined };
  }
  if (entry.sourcePath.startsWith('data/')) {
    const path = `json/${entry.sourcePath.slice('data/'.length)}`;
    return { path, immutablePath: `releases/${releaseId}/${path}` };
  }
  if (entry.sourcePath.startsWith('artifacts/')) {
    const path = entry.sourcePath.slice('artifacts/'.length);
    return { path, immutablePath: `releases/${releaseId}/${path}` };
  }
  throw new Error(`R2 source has no routing rule: ${entry.sourcePath}`);
}

function validateRouting(entries, releaseId) {
  for (const entry of entries) {
    const expected = expectedRoute(entry, releaseId);
    if (entry.path !== expected.path || entry.immutablePath !== expected.immutablePath) {
      throw new Error(`Manifest routing mismatch for ${entry.sourcePath}: expected ${expected.path} / ${expected.immutablePath || '(Pages)'}, got ${entry.path} / ${entry.immutablePath || '(none)'}`);
    }
  }
}

async function verifyLocal(entries) {
  for (const entry of entries) {
    const path = resolve(ROOT, entry.sourcePath);
    if (!existsSync(path)) throw new Error(`Manifest input disappeared: ${entry.sourcePath}`);
    const actual = await hashFile(path);
    if (actual !== entry.hash) {
      throw new Error(`Manifest input changed after generation: ${entry.sourcePath}\nexpected ${entry.hash}\nactual   ${actual}`);
    }
  }
}

function fileGroups(entries) {
  return {
    dataFiles: entries.filter((entry) => entry.sourcePath.startsWith('data/')).map((entry) => entry.sourcePath.slice('data/'.length)),
    artifactFiles: entries.filter((entry) => entry.sourcePath.startsWith('artifacts/')).map((entry) => entry.sourcePath.slice('artifacts/'.length)),
  };
}

function missingRemote(error) {
  const message = [error?.message, error?.stdout, error?.stderr].filter(Boolean).join('\n');
  return /(?:object|directory|file)?\s*not found|does not exist|no such file/i.test(message);
}

function readRemoteJson(remotePath, { optional = false, label = remotePath } = {}) {
  if (dryRun) return null;
  let body;
  try {
    body = run(`Read ${label}`, ['cat', remotePath], { capture: true });
  } catch (error) {
    if (optional && missingRemote(error)) return null;
    throw new Error(`Unable to read ${label}: ${error?.stderr || error.message}`, { cause: error });
  }
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`${label} is not valid JSON; refusing to treat it as absent.`, { cause: error });
  }
}

function validatePublished(manifest, label) {
  validateManifest(manifest, `${label} is invalid`);
  validateRouting(manifest.artifacts, manifest.releaseId);
  if (manifest.status !== 'published') throw new Error(`${label} is not in published state.`);
  for (const name of ['remote-r2-bytes', 'stable-r2-bytes', 'pages-deployed']) {
    if (gate(manifest, name)?.status !== 'passed') throw new Error(`${label} does not have a passed ${name} gate.`);
  }
}

function persistManifest(manifest) {
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  const immutableLocal = resolve(ROOT, `tmp/releases/${manifest.releaseId}.json`);
  mkdirSync(dirname(immutableLocal), { recursive: true });
  writeFileSync(immutableLocal, body);
  writeFileSync(manifestPath, body);
  return immutableLocal;
}

function remoteCheck(remoteBase, artifactFiles, dataList, artifactList) {
  run('Verify immutable policy JSON', ['check', resolve(ROOT, 'data'), `${remoteBase}/json`, '--files-from-raw', dataList, '--download', '--one-way']);
  if (artifactFiles.length) {
    run('Verify immutable policy artifacts', ['check', resolve(ROOT, 'artifacts'), remoteBase, '--files-from-raw', artifactList, '--download', '--one-way']);
  }
}

function stableCheck(artifactFiles, dataList, artifactList) {
  run('Verify stable policy JSON', ['check', resolve(ROOT, 'data'), `${BUCKET}/json`, '--files-from-raw', dataList, '--download', '--one-way']);
  if (artifactFiles.length) {
    run('Verify stable policy artifacts', ['check', resolve(ROOT, 'artifacts'), BUCKET, '--files-from-raw', artifactList, '--download', '--one-way']);
  }
}

function refreshStable(remoteBase, artifactFiles, dataList, artifactList) {
  run('Refresh stable policy JSON URLs', ['copy', `${remoteBase}/json`, `${BUCKET}/json`, '--files-from-raw', dataList]);
  if (artifactFiles.length) {
    run('Refresh stable policy artifact URLs', ['copy', remoteBase, BUCKET, '--files-from-raw', artifactList]);
  }
  if (!dryRun) stableCheck(artifactFiles, dataList, artifactList);
}

function assertSameContent(left, right, label) {
  if (!sameReleaseContent(left, right)) throw new Error(`${label} reuses ${left.releaseId} with different release content.`);
}

function assertSameReceipt(left, right, label) {
  if (hashCanonicalJson(left) !== hashCanonicalJson(right)) throw new Error(`${label} differs from the immutable published manifest.`);
}

function assertExpectedBase(candidate, current, phase) {
  const expected = candidate.previousReleaseId || null;
  const actual = current?.releaseId || null;
  if (expected !== actual) {
    throw new Error(`Refusing ${phase}: candidate was staged from ${expected || '(no current release)'}, but current is now ${actual || '(missing)'}. Restage and redeploy Pages before promoting.`);
  }
}

function readPagesReceipt(releaseId) {
  if (!existsSync(pagesReceiptPath)) {
    throw new Error(`Cannot promote without a Pages deployment receipt: ${pagesReceiptPath}`);
  }
  const receipt = JSON.parse(readFileSync(pagesReceiptPath, 'utf8'));
  if (receipt.releaseId !== releaseId || receipt.status !== 'passed' || !receipt.deployedAt) {
    throw new Error(`Pages deployment receipt does not prove a successful deploy for ${releaseId}.`);
  }
  return receipt;
}

function pagesReceiptDetails(receipt) {
  const proof = receipt.deploymentUrl || receipt.ciRunUrl || receipt.outputHash;
  return `Cloudflare Pages deploy completed at ${receipt.deployedAt}; receipt ${proof}.`;
}

async function main() {
  if (!planOnly && Number(stage) + Number(promote) !== 1) {
    throw new Error('Choose exactly one publication phase: --stage or --promote (or use --plan-only).');
  }

  const local = JSON.parse(readFileSync(manifestPath, 'utf8'));
  validateManifest(local);
  validateRouting(local.artifacts, local.releaseId);
  enforceLocalProductionGates(local);
  await verifyLocal(local.artifacts);

  const localEntries = local.artifacts.filter((entry) => entry.channel === 'r2');
  const { dataFiles, artifactFiles } = fileGroups(localEntries);
  const dataList = writeList(`${local.releaseId}-data.txt`, dataFiles);
  const artifactList = writeList(`${local.releaseId}-artifacts.txt`, artifactFiles);
  const remoteBase = `${BUCKET}/releases/${local.releaseId}`;
  const candidateRemotePath = `${BUCKET}/json/releases/candidates/${local.releaseId}.json`;
  const immutableManifestRemotePath = `${BUCKET}/json/releases/${local.releaseId}.json`;
  const currentRemotePath = `${BUCKET}/json/releases/current.json`;

  if (planOnly) {
    if (local.status !== 'candidate') throw new Error('A new local release plan must be in candidate state.');
    console.log(`Release ${local.releaseId} is locally valid: ${dataFiles.length} data files, ${artifactFiles.length} artifact files, ${local.artifacts.filter((entry) => entry.channel === 'pages').length} Pages files.`);
    console.log('Plan only: no network calls were made.');
    return;
  }

  if (stage && local.status !== 'candidate') throw new Error('Stage accepts only a candidate manifest.');
  if (promote && !['candidate', 'published'].includes(local.status)) {
    throw new Error('Promote accepts a staged candidate or a local published receipt from an interrupted prior promotion.');
  }

  let current = readRemoteJson(currentRemotePath, { optional: true, label: 'current published release' });
  if (current) validatePublished(current, 'Current release');

  // An unchanged release is still fully checked and its stable compatibility
  // keys are repaired from immutable bytes. Only manifest rewrites are skipped.
  if (current?.releaseId === local.releaseId) {
    assertSameContent(local, current, 'Current release');
    const immutable = readRemoteJson(immutableManifestRemotePath, { label: 'immutable published release' });
    validatePublished(immutable, 'Immutable release');
    assertSameReceipt(current, immutable, 'Current release');
    remoteCheck(remoteBase, artifactFiles, dataList, artifactList);
    refreshStable(remoteBase, artifactFiles, dataList, artifactList);
    if (stage) {
      const checkedCandidate = structuredClone(local);
      checkedCandidate.previousReleaseId = current.releaseId;
      setGate(checkedCandidate, 'remote-r2-bytes', 'passed', `Re-verified already-current immutable bytes at ${new Date().toISOString()}.`);
      setGate(checkedCandidate, 'stable-r2-bytes', 'passed', `Repaired and verified already-current compatibility keys at ${new Date().toISOString()}.`);
      validateManifest(checkedCandidate, 'Checked unchanged candidate is invalid');
      persistManifest(checkedCandidate);
    } else {
      persistManifest(immutable);
    }
    console.log(`\nRelease ${local.releaseId} is already current; immutable bytes were verified and stable keys repaired without rewriting either manifest.`);
    return;
  }

  if (stage) {
    const existingImmutable = readRemoteJson(immutableManifestRemotePath, { optional: true, label: 'existing immutable release' });
    if (existingImmutable) {
      validatePublished(existingImmutable, 'Existing immutable release');
      assertSameContent(local, existingImmutable, 'Existing immutable release');
      throw new Error(`Release ${local.releaseId} was published previously and is not current; refusing to overwrite or implicitly roll it back.`);
    }

    const candidate = structuredClone(local);
    if (current) candidate.previousReleaseId = current.releaseId;
    else delete candidate.previousReleaseId;
    run('Upload write-once immutable policy JSON', ['copy', resolve(ROOT, 'data'), `${remoteBase}/json`, '--files-from-raw', dataList, '--immutable', '--checksum']);
    if (artifactFiles.length) {
      run('Upload write-once immutable policy artifacts', ['copy', resolve(ROOT, 'artifacts'), remoteBase, '--files-from-raw', artifactList, '--immutable', '--checksum']);
    }
    if (!dryRun) {
      remoteCheck(remoteBase, artifactFiles, dataList, artifactList);
      setGate(candidate, 'remote-r2-bytes', 'passed', `Verified immutable bytes at ${new Date().toISOString()}.`);
      refreshStable(remoteBase, artifactFiles, dataList, artifactList);
      setGate(candidate, 'stable-r2-bytes', 'passed', `Refreshed and verified compatibility keys before the Pages deploy at ${new Date().toISOString()}.`);
    }
    validateManifest(candidate, 'Staged candidate state is invalid');
    const candidatePath = persistManifest(candidate);
    run('Publish durable candidate receipt', ['copyto', candidatePath, candidateRemotePath]);
    console.log(`\nStaged release ${candidate.releaseId}; immutable and stable bytes are verified, while current.json remains unchanged.`);
    return;
  }

  const candidate = dryRun
    ? local
    : readRemoteJson(candidateRemotePath, { label: 'staged candidate receipt' });
  validateManifest(candidate, 'Staged candidate receipt is invalid');
  validateRouting(candidate.artifacts, candidate.releaseId);
  if (candidate.status !== 'candidate') throw new Error('The durable staged receipt is not in candidate state.');
  assertSameContent(local, candidate, 'Local and staged candidate');
  enforceLocalProductionGates(candidate);
  for (const name of ['remote-r2-bytes', 'stable-r2-bytes']) {
    if (gate(candidate, name)?.status !== 'passed' && !dryRun) throw new Error(`Cannot promote without a passed ${name} gate in the staged receipt.`);
  }
  assertExpectedBase(candidate, current, 'promotion');
  remoteCheck(remoteBase, artifactFiles, dataList, artifactList);
  refreshStable(remoteBase, artifactFiles, dataList, artifactList);

  let published = readRemoteJson(immutableManifestRemotePath, { optional: true, label: 'existing immutable release' });
  if (published) {
    validatePublished(published, 'Existing immutable release');
    assertSameContent(candidate, published, 'Existing immutable release');
  } else {
    const receipt = dryRun
      ? { releaseId: candidate.releaseId, status: 'passed', deployedAt: new Date().toISOString(), outputHash: 'dry-run' }
      : readPagesReceipt(candidate.releaseId);
    published = structuredClone(candidate);
    published.status = 'published';
    published.publishedAt = new Date().toISOString();
    setGate(published, 'pages-deployed', 'passed', pagesReceiptDetails(receipt));
    validatePublished(published, 'New published release');

    // Recheck the base immediately before the write-once publication. This is
    // a compare-before-write guard; rclone/R2 does not expose a portable CAS.
    current = readRemoteJson(currentRemotePath, { optional: true, label: 'current release before publication' });
    if (current) validatePublished(current, 'Current release before publication');
    assertExpectedBase(candidate, current, 'publication');
    const localPublishedPath = persistManifest(published);
    run('Publish write-once immutable release manifest', ['copyto', localPublishedPath, immutableManifestRemotePath, '--immutable', '--checksum']);
    if (!dryRun) {
      const remotePublished = readRemoteJson(immutableManifestRemotePath, { label: 'new immutable release' });
      validatePublished(remotePublished, 'New immutable release');
      assertSameContent(candidate, remotePublished, 'New immutable release');
      published = remotePublished;
    }
  }

  current = readRemoteJson(currentRemotePath, { optional: true, label: 'current release before pointer update' });
  if (current) validatePublished(current, 'Current release before pointer update');
  assertExpectedBase(candidate, current, 'current-pointer update');
  run('Publish current release pointer last', ['copyto', immutableManifestRemotePath, currentRemotePath]);
  if (!dryRun) {
    const promoted = readRemoteJson(currentRemotePath, { label: 'promoted current release' });
    validatePublished(promoted, 'Promoted current release');
    assertSameReceipt(published, promoted, 'Promoted current release');
    persistManifest(promoted);
  }
  console.log(`\nPublished release ${candidate.releaseId}${dryRun ? ' (dry run)' : ''}.`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
