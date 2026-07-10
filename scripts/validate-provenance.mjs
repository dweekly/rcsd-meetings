#!/usr/bin/env node
/** Validate v1 provenance documents against JSON Schema and domain invariants. */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  assertAcyclicLineage,
  hashCanonicalJson,
  hashFile,
  resolveJsonPointer,
  sha256,
  validateClaim,
  validateDatasetProvenance,
  validateDistrictSourceManifest,
  validateLlmInvocation,
  validateReleaseManifest,
} from './lib/provenance.mjs';
import { validateJsonSchema } from './lib/provenance-schema.mjs';

const validators = new Map([
  ['dataset-provenance.schema.json', ['dataset', validateDatasetProvenance]],
  ['claim.schema.json', ['claim', validateClaim]],
  ['llm-invocation.schema.json', ['llm', validateLlmInvocation]],
  ['district-source-manifest.schema.json', ['district', validateDistrictSourceManifest]],
  ['release-manifest.schema.json', ['release', validateReleaseManifest]],
]);

function inferRegistration(document) {
  if (typeof document.$schema === 'string') return validators.get(basename(document.$schema));
  if (document.datasetId && document.lineage && document.quality) return validators.get('dataset-provenance.schema.json');
  if (document.claimId && document.outputPointer) return validators.get('claim.schema.json');
  if (document.invocationId && document.attempts) return validators.get('llm-invocation.schema.json');
  if (document.manifestId && document.district && document.sourceRegimes) return validators.get('district-source-manifest.schema.json');
  if (document.releaseId && document.artifacts && document.qualityGates) return validators.get('release-manifest.schema.json');
  return undefined;
}

function jsonFilesUnder(path) {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return path.endsWith('.json') ? [path] : [];
  return readdirSync(path, { withFileTypes: true })
    .flatMap((entry) => jsonFilesUnder(join(path, entry.name)))
    .sort();
}

function defaultFiles() {
  const files = [
    ...jsonFilesUnder('data/provenance'),
    ...jsonFilesUnder('data/releases'),
  ];
  if (existsSync('districts')) {
    for (const entry of readdirSync('districts', { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = join('districts', entry.name, 'manifest.json');
      if (existsSync(manifest)) files.push(manifest);
    }
  }
  return [...new Set(files)].sort();
}

const rawArgs = process.argv.slice(2);
const metadataOnly = rawArgs.includes('--metadata-only');
const requested = rawArgs.filter((arg) => arg !== '--metadata-only');
if (requested.includes('--help') || requested.includes('-h')) {
  console.log('Usage: node scripts/validate-provenance.mjs [--metadata-only] [file-or-directory ...]');
  console.log('With no arguments, validates data/provenance, data/releases, and districts/*/manifest.json.');
  process.exit(0);
}

const files = requested.length
  ? [...new Set(requested.flatMap((path) => jsonFilesUnder(path)))].sort()
  : defaultFiles();

if (files.length === 0) {
  console.error('No provenance JSON files found.');
  process.exit(1);
}

let failures = 0;
const datasets = [];
const jsonCache = new Map();
const loadJson = (path) => {
  if (!jsonCache.has(path)) jsonCache.set(path, JSON.parse(readFileSync(path, 'utf8')));
  return jsonCache.get(path);
};

async function verifyDatasetFiles(document) {
  const errors = [];
  const artifacts = document.artifacts || (document.artifact ? [document.artifact] : []);
  for (const artifact of artifacts) {
    if (!existsSync(artifact.path)) {
      errors.push(`${artifact.path}: file is unavailable`);
      continue;
    }
    const actualHash = await hashFile(artifact.path);
    if (actualHash !== artifact.hash) errors.push(`${artifact.path}: hash mismatch`);
    if (statSync(artifact.path).size !== artifact.bytes) errors.push(`${artifact.path}: byte count mismatch`);
  }
  for (const record of document.recordLineage || []) {
    if (!existsSync(record.outputArtifactPath)) {
      errors.push(`${record.outputArtifactPath}: output artifact is unavailable`);
      continue;
    }
    try { resolveJsonPointer(loadJson(record.outputArtifactPath), record.outputPointer); }
    catch (error) { errors.push(`${record.outputArtifactPath}${record.outputPointer}: ${error.message}`); }
    for (const input of record.inputs || []) {
      if (!input.artifactPath || input.sourceId || !existsSync(input.artifactPath)) continue;
      try {
        const documentValue = loadJson(input.artifactPath);
        const value = input.pointer === undefined ? documentValue : resolveJsonPointer(documentValue, input.pointer);
        const actual = typeof value === 'string' ? sha256(value) : hashCanonicalJson(value);
        if (actual !== input.hash) errors.push(`${input.artifactPath}${input.pointer || ''}: lineage hash mismatch`);
      } catch (error) {
        errors.push(`${input.artifactPath}${input.pointer || ''}: ${error.message}`);
      }
    }
  }
  return errors;
}

for (const file of files) {
  let document;
  try {
    document = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${file}: invalid JSON: ${error.message}`);
    continue;
  }

  const registration = inferRegistration(document);
  if (!registration) {
    failures += 1;
    console.error(`FAIL ${file}: missing or unsupported $schema`);
    continue;
  }
  const [kind, validate] = registration;
  const schemaResult = validateJsonSchema(kind, document);
  if (!schemaResult.valid) {
    failures += 1;
    console.error(`FAIL ${file} (${kind} JSON Schema)`);
    schemaResult.errors.forEach((error) => console.error(`  ${error.path || '/'}: ${error.message}`));
    continue;
  }
  const result = validate(document);
  if (!result.valid) {
    failures += 1;
    console.error(`FAIL ${file} (${kind})`);
    result.errors.forEach((error) => console.error(`  ${error.path || '/'}: ${error.message}`));
    continue;
  }
  if (kind === 'dataset' && !metadataOnly) {
    const fileErrors = await verifyDatasetFiles(document);
    if (fileErrors.length) {
      failures += 1;
      console.error(`FAIL ${file} (artifact/lineage verification)`);
      fileErrors.forEach((error) => console.error(`  ${error}`));
      continue;
    }
  }
  if (kind === 'dataset') datasets.push(document);
  console.log(`PASS ${file} (${kind})`);
}

try {
  assertAcyclicLineage(datasets);
} catch (error) {
  failures += 1;
  console.error(`FAIL dataset lineage: ${error.message}`);
}

if (failures) {
  console.error(`\n${failures} provenance validation failure${failures === 1 ? '' : 's'}.`);
  process.exit(1);
}
console.log(`\nValidated ${files.length} provenance document${files.length === 1 ? '' : 's'} from ${resolve('.')}.`);
