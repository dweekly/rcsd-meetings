import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { hashFile } from '../scripts/lib/provenance.mjs';
import { computeReleaseId } from '../scripts/lib/release.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const UPLOADER = resolve(ROOT, 'scripts/upload-release.mjs');
const FAKE_RCLONE = resolve(ROOT, 'tests/helpers/fake-rclone.mjs');

function gates() {
  return [
    'dataset-provenance-schema',
    'artifact-bytes-and-hashes',
    'record-lineage-pointers-and-input-hashes',
    'dataset-lineage-acyclic',
    'policy-language-parity',
    'public-contract-schemas',
    'source-tree-clean',
  ].map((name) => ({ name, status: 'passed' })).concat([
    { name: 'remote-r2-bytes', status: 'waived', details: 'Candidate.' },
    { name: 'stable-r2-bytes', status: 'waived', details: 'Candidate.' },
    { name: 'pages-deployed', status: 'waived', details: 'Candidate.' },
  ]);
}

async function candidate(datasetId = 'rcsd.board-policies') {
  const dataPath = 'data/policies-index.json';
  const pagePath = 'docs/policies-index.json';
  const dataHash = await hashFile(resolve(ROOT, dataPath));
  const pageHash = await hashFile(resolve(ROOT, pagePath));
  const manifest = {
    $schema: 'https://rcsd.info/schemas/provenance/v1/release-manifest.schema.json',
    schemaVersion: '1.0.0',
    releaseId: 'pending',
    districtIds: ['ca.cde.district.4169005'],
    generatedAt: '2026-07-09T12:00:00.000Z',
    gitCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    status: 'candidate',
    artifacts: [
      {
        channel: 'r2',
        sourcePath: dataPath,
        path: 'json/policies-index.json',
        mediaType: 'application/json',
        hash: dataHash,
        bytes: readFileSync(resolve(ROOT, dataPath)).length,
        datasetId,
        language: 'en-US',
        publicationClass: datasetId === 'rcsd.board-policies' ? 'public-source-record' : 'public-derived-record',
      },
      {
        channel: 'pages',
        sourcePath: pagePath,
        path: 'policies-index.json',
        mediaType: 'application/json',
        hash: pageHash,
        bytes: readFileSync(resolve(ROOT, pagePath)).length,
        datasetId,
        language: 'en-US',
        publicationClass: 'public-derived-record',
      },
    ],
    qualityGates: gates(),
  };
  manifest.releaseId = computeReleaseId(manifest);
  manifest.artifacts[0].immutablePath = `releases/${manifest.releaseId}/json/policies-index.json`;
  return manifest;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function runUploader(manifestPath, bucket, args, extraEnv = {}) {
  return execFileSync(process.execPath, [UPLOADER, manifestPath, ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      RELEASE_BUCKET: bucket,
      RCLONE_BIN: FAKE_RCLONE,
      ...extraEnv,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function receipt(path, releaseId) {
  writeJson(path, {
    schemaVersion: '1.0.0',
    releaseId,
    status: 'passed',
    deployedAt: '2026-07-09T12:05:00.000Z',
    outputHash: 'sha256:test',
  });
}

test('release state machine is content-addressed, recoverable, write-once, and base-guarded', async () => {
  const temp = mkdtempSync(resolve(tmpdir(), 'rcsd-release-test-'));
  const bucket = resolve(temp, 'bucket');
  const manifestPath = resolve(temp, 'current.json');
  const pagesReceipt = resolve(temp, 'pages.json');
  try {
    const first = await candidate();
    writeJson(manifestPath, first);

    runUploader(manifestPath, bucket, ['--plan-only']);

    const tampered = structuredClone(first);
    tampered.releaseId = 'policy-000000000000000000000000';
    tampered.artifacts[0].immutablePath = `releases/${tampered.releaseId}/json/policies-index.json`;
    writeJson(manifestPath, tampered);
    assert.throws(
      () => runUploader(manifestPath, bucket, ['--plan-only']),
      /content identity mismatch/,
    );

    writeJson(manifestPath, first);
    const failedCandidateMarker = resolve(temp, 'failed-candidate-once');
    assert.throws(() => runUploader(
      manifestPath,
      bucket,
      ['--stage'],
      {
        FAKE_RCLONE_FAIL_COMMAND: 'copyto',
        FAKE_RCLONE_FAIL_PATH_SUFFIX: `/json/releases/candidates/${first.releaseId}.json`,
        FAKE_RCLONE_FAIL_MARKER: failedCandidateMarker,
      },
    ));
    assert.equal(existsSync(resolve(bucket, `releases/${first.releaseId}/json/policies-index.json`)), true);
    assert.equal(existsSync(resolve(bucket, `json/releases/candidates/${first.releaseId}.json`)), false);

    // A fresh-run retry sees different local/remote mtimes. --checksum makes
    // rclone's immutable comparison honor the manifest's byte identity.
    runUploader(manifestPath, bucket, ['--stage']);
    const stagedFirst = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(stagedFirst.status, 'candidate');
    assert.equal(stagedFirst.qualityGates.find((item) => item.name === 'remote-r2-bytes').status, 'passed');
    assert.equal(stagedFirst.qualityGates.find((item) => item.name === 'stable-r2-bytes').status, 'passed');
    assert.equal(existsSync(resolve(bucket, 'json/releases/current.json')), false);
    assert.equal(existsSync(resolve(bucket, 'json/policies-index.json')), true);
    assert.equal(existsSync(resolve(bucket, `json/releases/candidates/${first.releaseId}.json`)), true);

    receipt(pagesReceipt, first.releaseId);
    runUploader(manifestPath, bucket, ['--promote', `--pages-receipt=${pagesReceipt}`]);
    const publishedFirstPath = resolve(bucket, `json/releases/${first.releaseId}.json`);
    const firstPublishedBytes = readFileSync(publishedFirstPath, 'utf8');
    assert.equal(JSON.parse(firstPublishedBytes).status, 'published');

    // Same-current retries verify immutable bytes and repair stable keys while
    // leaving the write-once publication receipt byte-identical.
    unlinkSync(resolve(bucket, 'json/policies-index.json'));
    runUploader(manifestPath, bucket, ['--promote', `--pages-receipt=${pagesReceipt}`]);
    assert.equal(existsSync(resolve(bucket, 'json/policies-index.json')), true);
    assert.equal(readFileSync(publishedFirstPath, 'utf8'), firstPublishedBytes);

    // A scheduled run with unchanged governed content still needs a checked
    // candidate locally so an unrelated Pages build can proceed.
    writeJson(manifestPath, first);
    runUploader(manifestPath, bucket, ['--stage']);
    const unchangedCandidate = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(unchangedCandidate.status, 'candidate');
    assert.equal(unchangedCandidate.qualityGates.find((item) => item.name === 'stable-r2-bytes').status, 'passed');

    // A second release is staged from the first. Fail only the current-pointer
    // put: retry must recover the remote candidate/final receipt and preserve
    // its original publishedAt and bytes.
    const second = await candidate('rcsd.board-policy-summaries');
    writeJson(manifestPath, second);
    runUploader(manifestPath, bucket, ['--stage']);
    const stagedSecond = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(stagedSecond.previousReleaseId, first.releaseId);
    receipt(pagesReceipt, second.releaseId);
    const failMarker = resolve(temp, 'failed-current-once');
    assert.throws(() => runUploader(
      manifestPath,
      bucket,
      ['--promote', `--pages-receipt=${pagesReceipt}`],
      {
        FAKE_RCLONE_FAIL_COMMAND: 'copyto',
        FAKE_RCLONE_FAIL_PATH_SUFFIX: '/json/releases/current.json',
        FAKE_RCLONE_FAIL_MARKER: failMarker,
      },
    ));
    const secondPublishedPath = resolve(bucket, `json/releases/${second.releaseId}.json`);
    const secondPublishedBytes = readFileSync(secondPublishedPath, 'utf8');
    assert.equal(JSON.parse(readFileSync(resolve(bucket, 'json/releases/current.json'))).releaseId, first.releaseId);
    runUploader(manifestPath, bucket, ['--promote', `--pages-receipt=${pagesReceipt}`]);
    assert.equal(readFileSync(secondPublishedPath, 'utf8'), secondPublishedBytes);
    assert.equal(JSON.parse(readFileSync(resolve(bucket, 'json/releases/current.json'))).releaseId, second.releaseId);

    // A historical content ID is write-once and cannot be restaged as an
    // implicit rollback when another release is current.
    const historical = structuredClone(first);
    historical.status = 'candidate';
    delete historical.publishedAt;
    for (const name of ['remote-r2-bytes', 'stable-r2-bytes', 'pages-deployed']) {
      const item = historical.qualityGates.find((entry) => entry.name === name);
      item.status = 'waived';
      item.details = 'Candidate.';
    }
    writeJson(manifestPath, historical);
    assert.throws(
      () => runUploader(manifestPath, bucket, ['--stage']),
      /published previously|implicitly roll it back/,
    );

    // A competing current-pointer update after staging invalidates the base
    // receipt and blocks promotion.
    const third = await candidate('rcsd.board-policies-es');
    writeJson(manifestPath, third);
    runUploader(manifestPath, bucket, ['--stage']);
    copyFileSync(publishedFirstPath, resolve(bucket, 'json/releases/current.json'));
    receipt(pagesReceipt, third.releaseId);
    assert.throws(
      () => runUploader(manifestPath, bucket, ['--promote', `--pages-receipt=${pagesReceipt}`]),
      /candidate was staged from.*current is now/s,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('bootstrap treats a never-published current pointer as absent but refuses corrupt ones', async () => {
  const temp = mkdtempSync(resolve(tmpdir(), 'rcsd-release-bootstrap-test-'));
  const bucket = resolve(temp, 'bucket');
  const manifestPath = resolve(temp, 'current.json');
  const pagesReceipt = resolve(temp, 'pages.json');
  const currentPointer = resolve(bucket, 'json/releases/current.json');
  try {
    // First-ever scheduled run: nothing exists in the bucket. On R2, `rclone
    // cat` of the missing current.json exits 0 with empty output (the July
    // 2026 pipeline failure) — staging and promotion must still bootstrap.
    const first = await candidate();
    writeJson(manifestPath, first);
    runUploader(manifestPath, bucket, ['--stage']);
    receipt(pagesReceipt, first.releaseId);
    runUploader(manifestPath, bucket, ['--promote', `--pages-receipt=${pagesReceipt}`]);
    assert.equal(JSON.parse(readFileSync(currentPointer, 'utf8')).releaseId, first.releaseId);

    // An existing-but-unparseable pointer is corruption, not absence.
    const second = await candidate('rcsd.board-policy-summaries');
    writeJson(manifestPath, second);
    writeFileSync(currentPointer, '{"releaseId": trunca');
    assert.throws(
      () => runUploader(manifestPath, bucket, ['--stage']),
      /exists but is not valid JSON/,
    );

    // So is a zero-byte object: the key exists, so empty bytes must refuse
    // rather than be mistaken for the bootstrap case.
    writeFileSync(currentPointer, '');
    assert.throws(
      () => runUploader(manifestPath, bucket, ['--stage']),
      /exists but is not valid JSON/,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
