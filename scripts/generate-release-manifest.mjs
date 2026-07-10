#!/usr/bin/env node
/**
 * Build a content-addressed candidate release for provenance-migrated outputs.
 *
 * This script performs no network writes. Every included file is derived from
 * the policy catalog, validated provenance sidecars, or the fixed v1 contract
 * file set—never from an open-ended directory crawl.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import { execFileSync } from 'child_process';
import { extname, relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import {
  assertAcyclicLineage,
  hashCanonicalJson,
  hashFile,
  resolveJsonPointer,
  sha256,
  validateDatasetProvenance,
  validateReleaseManifest,
} from './lib/provenance.mjs';
import { policySlug } from './lib/policy-slug.mjs';
import { validateJsonSchema } from './lib/provenance-schema.mjs';
import { computeReleaseId } from './lib/release.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const OUT_DIR = resolve(ROOT, 'tmp/releases');
const args = new Set(process.argv.slice(2));
const requireCleanSource = args.has('--require-clean-source');
const slash = (value) => value.split(sep).join('/');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const POLICY_MANIFEST_PATHS = [
  'data/provenance/rcsd.board-policies.json',
  'data/provenance/rcsd.board-policies-es.json',
  'data/provenance/rcsd.board-policy-summaries.json',
];
const CONTRACT_FILES = [
  'claim.schema.json',
  'common.schema.json',
  'dataset-provenance.schema.json',
  'district-source-manifest.schema.json',
  'llm-invocation.schema.json',
  'release-manifest.schema.json',
];

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function dirtyPaths() {
  const status = execFileSync(
    'git',
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (!status) return [];
  const entries = status.split('\0').filter(Boolean);
  const paths = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const state = entry.slice(0, 2);
    paths.push(entry.slice(3));
    // In porcelain -z mode, rename/copy source paths are emitted as the next
    // NUL-delimited field. Keep both paths so neither side can evade the gate.
    if (/[RC]/.test(state) && entries[index + 1]) paths.push(entries[++index]);
  }
  return paths;
}

function forbiddenDirtyPaths(paths, releaseSourcePaths) {
  return paths.filter((path) => {
    if (path.startsWith('docs/') || path.startsWith('tmp/') || path.startsWith('sources/')) return false;
    if (path.startsWith('data/') || path.startsWith('artifacts/')) return releaseSourcePaths.has(path);
    return true;
  });
}

function mediaType(path) {
  return ({
    '.json': 'application/json',
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.pdf': 'application/pdf',
  })[extname(path).toLowerCase()] || null;
}

function datasetIdFor(sourcePath) {
  if (sourcePath.startsWith('docs/schemas/')) return 'rcsd.provenance-contract';
  if (sourcePath.includes('board-policies-es') || sourcePath.endsWith('policy-titles-es.json') || sourcePath.includes('politicas/')) {
    return 'rcsd.board-policies-es';
  }
  if (sourcePath.includes('policy-summar')) return 'rcsd.board-policy-summaries';
  return 'rcsd.board-policies';
}

function languageFor(sourcePath) {
  if (sourcePath.startsWith('docs/schemas/')) return 'en-US';
  if (sourcePath === 'docs/styles/policy-provenance.css') return 'mul';
  if (sourcePath.includes('board-policies-es') || sourcePath.endsWith('policy-titles-es.json') || sourcePath.includes('politicas/')) return 'es-US';
  if (sourcePath.includes('policy-summar')) return 'mul';
  return 'en-US';
}

function publicationClassFor(sourcePath) {
  if (sourcePath === 'data/policies-index.json') return 'public-source-record';
  if (/^data\/board-policies\/[^/]+\.json$/.test(sourcePath)) return 'public-source-record';
  if (/^artifacts\/board-policy-exhibits\/[^/]+\.pdf$/.test(sourcePath)) return 'public-source-record';
  return 'public-derived-record';
}

function r2StablePath(sourcePath) {
  if (sourcePath.startsWith('data/')) {
    const suffix = sourcePath.slice('data/'.length);
    return `json/${suffix}`;
  }
  if (sourcePath.startsWith('artifacts/')) {
    return sourcePath.slice('artifacts/'.length);
  }
  throw new Error(`No R2 routing rule for ${sourcePath}`);
}

async function describe(sourcePath, channel, publicPath = null) {
  const absolute = resolve(ROOT, sourcePath);
  if (!existsSync(absolute)) throw new Error(`Release input does not exist: ${sourcePath}`);
  const type = mediaType(sourcePath);
  if (!type) throw new Error(`Release input has no allowlisted media type: ${sourcePath}`);
  const stablePath = channel === 'r2' ? r2StablePath(sourcePath) : publicPath;
  return {
    sourcePath,
    channel,
    path: stablePath,
    mediaType: type,
    bytes: statSync(absolute).size,
    hash: await hashFile(absolute),
    datasetId: datasetIdFor(sourcePath),
    language: languageFor(sourcePath),
    publicationClass: publicationClassFor(sourcePath),
  };
}

function validationError(label, errors) {
  return new Error(`${label}:\n${errors.map((error) => `  ${error.path || '/'}: ${error.message}`).join('\n')}`);
}

function pointedHash(value) {
  return typeof value === 'string' ? sha256(value) : hashCanonicalJson(value);
}

async function validateSidecars(manifests) {
  const jsonCache = new Map();
  const loadArtifact = (artifactPath) => {
    if (!jsonCache.has(artifactPath)) jsonCache.set(artifactPath, readJson(resolve(ROOT, artifactPath)));
    return jsonCache.get(artifactPath);
  };

  for (const manifest of manifests) {
    const schemaResult = validateJsonSchema('dataset', manifest);
    if (!schemaResult.valid) throw validationError(`Dataset JSON Schema failed for ${manifest.datasetId}`, schemaResult.errors);
    const result = validateDatasetProvenance(manifest);
    if (!result.valid) throw validationError(`Invalid dataset provenance ${manifest.datasetId}`, result.errors);
    for (const artifact of manifest.artifacts || [manifest.artifact]) {
      const absolute = resolve(ROOT, artifact.path);
      if (!existsSync(absolute)) throw new Error(`Provenance artifact is unavailable: ${artifact.path}`);
      const actual = await hashFile(absolute);
      if (actual !== artifact.hash) throw new Error(`Stale provenance artifact hash: ${artifact.path}`);
      if (statSync(absolute).size !== artifact.bytes) throw new Error(`Stale provenance artifact byte count: ${artifact.path}`);
    }
    for (const record of manifest.recordLineage || []) {
      const output = loadArtifact(record.outputArtifactPath);
      resolveJsonPointer(output, record.outputPointer);
      for (const input of record.inputs || []) {
        if (!input.artifactPath || input.sourceId) continue;
        const inputDocument = loadArtifact(input.artifactPath);
        const value = input.pointer === undefined ? inputDocument : resolveJsonPointer(inputDocument, input.pointer);
        if (pointedHash(value) !== input.hash) {
          throw new Error(`Record-lineage input hash mismatch: ${input.artifactPath}${input.pointer || ''}`);
        }
      }
    }
  }
  assertAcyclicLineage(manifests);
}

function pageFiles(policies) {
  const files = [
    ['docs/policies-index.json', 'policies-index.json'],
    ['docs/policies/index.html', 'policies/index.html'],
    ['docs/politicas/index.html', 'politicas/index.html'],
    ['docs/styles/policy-provenance.css', 'styles/policy-provenance.css'],
  ];
  for (const policy of policies) {
    const key = `${policy.code}-${policy.type}`;
    const slug = policySlug(policy.code, policy.type);
    files.push(
      [`docs/board-policies/${key}.json`, `board-policies/${key}.json`],
      [`docs/policies/${slug}/index.html`, `policies/${slug}/index.html`],
      [`docs/politicas/${slug}/index.html`, `politicas/${slug}/index.html`],
    );
    const esDataPath = `data/board-policies-es/${key}.json`;
    if (existsSync(resolve(ROOT, esDataPath))) {
      files.push([`docs/board-policies-es/${key}.json`, `board-policies-es/${key}.json`]);
    }
  }
  for (const filename of CONTRACT_FILES) {
    files.push([`docs/schemas/provenance/v1/${filename}`, `schemas/provenance/v1/${filename}`]);
  }
  return files;
}

function walkFiles(directory) {
  if (!existsSync(resolve(ROOT, directory))) return [];
  const files = [];
  for (const entry of readdirSync(resolve(ROOT, directory), { withFileTypes: true })) {
    const child = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...walkFiles(child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

function assertGovernedPagesAllowlist(files) {
  const expected = new Set(files.map(([sourcePath]) => sourcePath));
  const governedRoots = [
    'docs/policies',
    'docs/politicas',
    'docs/board-policies',
    'docs/board-policies-es',
    'docs/schemas/provenance/v1',
  ];
  const governedFiles = ['docs/styles/policy-provenance.css'];
  const actual = new Set([
    ...governedRoots.flatMap(walkFiles),
    ...governedFiles.filter((path) => existsSync(resolve(ROOT, path))),
  ]);
  const extras = [...actual].filter((path) => !expected.has(path)).sort();
  const missing = [...expected]
    .filter((path) => path !== 'docs/policies-index.json' && !actual.has(path))
    .sort();
  if (extras.length || missing.length) {
    throw new Error([
      'Governed Pages directories do not match the release allowlist.',
      ...extras.map((path) => `  unexpected: ${path}`),
      ...missing.map((path) => `  missing: ${path}`),
    ].join('\n'));
  }
}

async function assertCanonicalPageMirrors(files) {
  const mirrors = [];
  for (const [pagePath] of files) {
    if (pagePath === 'docs/policies-index.json') {
      mirrors.push([pagePath, 'data/policies-index.json']);
    } else if (pagePath.startsWith('docs/board-policies/')) {
      mirrors.push([pagePath, pagePath.replace(/^docs\//, 'data/')]);
    } else if (pagePath.startsWith('docs/board-policies-es/')) {
      mirrors.push([pagePath, pagePath.replace(/^docs\//, 'data/')]);
    } else if (pagePath.startsWith('docs/schemas/provenance/v1/')) {
      mirrors.push([pagePath, pagePath.replace(/^docs\//, '')]);
    }
  }
  for (const [pagePath, canonicalPath] of mirrors) {
    if (!existsSync(resolve(ROOT, canonicalPath))) {
      throw new Error(`Canonical Pages source is missing: ${canonicalPath}`);
    }
    const [pageHash, canonicalHash] = await Promise.all([
      hashFile(resolve(ROOT, pagePath)),
      hashFile(resolve(ROOT, canonicalPath)),
    ]);
    if (pageHash !== canonicalHash) {
      throw new Error(`Published mirror drift: ${pagePath} does not match ${canonicalPath}`);
    }
  }
}

async function main() {
  const manifests = POLICY_MANIFEST_PATHS.map((path) => readJson(resolve(ROOT, path)));
  await validateSidecars(manifests);

  const index = readJson(resolve(ROOT, 'data/policies-index.json'));
  const policies = index.policies || [];
  const enCount = policies.length;
  const esCount = policies.filter((policy) => existsSync(resolve(ROOT, `data/board-policies-es/${policy.code}-${policy.type}.json`))).length;
  const summaryCount = Object.keys(readJson(resolve(ROOT, 'data/policy-summaries.json')).summaries || {}).length;
  if (enCount !== 619 || esCount !== 618 || summaryCount !== 618) {
    throw new Error(`Policy parity failed: ${enCount} English, ${esCount} Spanish, ${summaryCount} summaries`);
  }

  const pages = pageFiles(policies);
  assertGovernedPagesAllowlist(pages);
  await assertCanonicalPageMirrors(pages);

  // R2 inputs come from the validated provenance allowlist plus the sidecars
  // themselves. The set is explicit and duplicate paths collapse safely.
  const r2Sources = new Set(POLICY_MANIFEST_PATHS);
  for (const manifest of manifests) {
    for (const artifact of manifest.artifacts || [manifest.artifact]) r2Sources.add(artifact.path);
  }
  const releaseSourcePaths = new Set(r2Sources);
  for (const [sourcePath] of pages) releaseSourcePaths.add(sourcePath);

  const forbidden = forbiddenDirtyPaths(dirtyPaths(), releaseSourcePaths);
  if (requireCleanSource && forbidden.length) {
    throw new Error(`Refusing production release from dirty source inputs/code:\n${forbidden.map((path) => `  ${path}`).join('\n')}`);
  }

  const artifacts = [];
  for (const sourcePath of [...r2Sources].sort()) artifacts.push(await describe(sourcePath, 'r2'));
  for (const [sourcePath, publicPath] of pages) artifacts.push(await describe(sourcePath, 'pages', publicPath));
  artifacts.sort((a, b) => `${a.channel}:${a.path}`.localeCompare(`${b.channel}:${b.path}`));
  const releaseIdentity = {
    schemaVersion: '1.0.0',
    districtIds: ['ca.cde.district.4169005'],
    artifacts,
  };
  const releaseId = computeReleaseId(releaseIdentity);
  for (const artifact of artifacts) {
    if (artifact.channel === 'r2') artifact.immutablePath = `releases/${releaseId}/${artifact.path}`;
  }

  const sourceCommit = git('rev-parse', 'HEAD');
  const generatedAt = new Date().toISOString();

  const manifest = {
    $schema: 'https://rcsd.info/schemas/provenance/v1/release-manifest.schema.json',
    schemaVersion: '1.0.0',
    releaseId,
    districtIds: ['ca.cde.district.4169005'],
    generatedAt,
    gitCommit: sourceCommit,
    status: 'candidate',
    artifacts,
    qualityGates: [
      { name: 'dataset-provenance-schema', status: 'passed' },
      { name: 'artifact-bytes-and-hashes', status: 'passed' },
      { name: 'record-lineage-pointers-and-input-hashes', status: 'passed' },
      { name: 'dataset-lineage-acyclic', status: 'passed' },
      { name: 'policy-language-parity', status: 'passed', details: '619 English; 618 Spanish and summary records; one declared scanned source exception.' },
      { name: 'public-contract-schemas', status: 'passed' },
      { name: 'source-tree-clean', status: forbidden.length ? 'waived' : 'passed', details: forbidden.length ? `Development build; dirty release inputs/code: ${forbidden.join(', ')}` : undefined },
      { name: 'remote-r2-bytes', status: 'waived', details: 'Candidate only; upload-release --stage replaces this gate after remote byte verification.' },
      { name: 'stable-r2-bytes', status: 'waived', details: 'Candidate only; stage refreshes and verifies compatibility keys before Pages is deployed.' },
      { name: 'pages-deployed', status: 'waived', details: 'Candidate only; current.json is promoted only after the Pages deployment succeeds.' },
      { name: 'manifest-coverage', status: 'waived', details: 'The release contract currently covers board policies only; legacy families retain the filtered legacy uploader until migrated.' },
    ],
  };

  const validation = validateReleaseManifest(manifest);
  const schemaValidation = validateJsonSchema('release', manifest);
  if (!schemaValidation.valid) throw validationError('Release JSON Schema failed', schemaValidation.errors);
  if (!validation.valid) throw validationError('Invalid release manifest', validation.errors);

  mkdirSync(OUT_DIR, { recursive: true });
  const immutablePath = resolve(OUT_DIR, `${releaseId}.json`);
  const currentPath = resolve(OUT_DIR, 'current.json');
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(immutablePath, body);
  writeFileSync(currentPath, body);
  console.log(`Release ${releaseId}: ${artifacts.length} explicit artifacts (${artifacts.filter((item) => item.channel === 'r2').length} R2, ${artifacts.filter((item) => item.channel === 'pages').length} Pages)`);
  console.log(`Wrote ${slash(relative(ROOT, immutablePath))} and ${slash(relative(ROOT, currentPath))}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
