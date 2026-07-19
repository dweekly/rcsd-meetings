#!/usr/bin/env node
/**
 * Generate compatibility-preserving provenance sidecars for board policies.
 * Existing policy payloads are never modified by this script.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import { relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  hashCanonicalJson,
  hashFile,
  sha256,
  sha256Hex,
  validateDatasetProvenance,
} from './lib/provenance.mjs';
import { validateJsonSchema } from './lib/provenance-schema.mjs';

const GENERATOR_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(GENERATOR_PATH, '../..');
const DATA = resolve(ROOT, 'data');
const EN_DIR = resolve(DATA, 'board-policies');
const ES_DIR = resolve(DATA, 'board-policies-es');
const EXHIBIT_DIR = resolve(ROOT, 'artifacts/board-policy-exhibits');
const OUT_DIR = resolve(DATA, 'provenance');
const DISTRICT_ID = 'ca.cde.district.4169005';
const SCHEMA_VERSION = '1.0.0';
const DATASET_SCHEMA = 'https://rcsd.info/schemas/provenance/v1/dataset-provenance.schema.json';
const SCANNED_EXCEPTION = '6174-E PDF(1)-AR';
const GENERATOR_DEPENDENCIES = [
  GENERATOR_PATH,
  resolve(ROOT, 'scripts/lib/provenance.mjs'),
  resolve(ROOT, 'scripts/lib/provenance-schema.mjs'),
  resolve(ROOT, 'schemas/provenance/v1/common.schema.json'),
  resolve(ROOT, 'schemas/provenance/v1/dataset-provenance.schema.json'),
  resolve(ROOT, 'schemas/provenance/v1/llm-invocation.schema.json'),
];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const repoPath = (path) => relative(ROOT, path).split('/').join('/');
const pointerToken = (value) => String(value).replace(/~/g, '~0').replace(/\//g, '~1');
const idToken = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function newestIso(values) {
  const valid = values.filter(Boolean).map((value) => new Date(value)).filter((date) => !Number.isNaN(date.valueOf()));
  return valid.length ? new Date(Math.max(...valid.map(Number))).toISOString() : new Date(0).toISOString();
}

function readPreviousManifest(filename) {
  const path = resolve(OUT_DIR, filename);
  if (!existsSync(path)) return null;
  try { return readJson(path); } catch { return null; }
}

function preserveCheckedAt(filename, manifest, checkedNow) {
  const previous = readPreviousManifest(filename);
  if (!previous?.quality?.checkedAt) return checkedNow;
  const withoutCheckedAt = (value) => {
    const clone = structuredClone(value);
    if (clone.quality) delete clone.quality.checkedAt;
    return clone;
  };
  return hashCanonicalJson(withoutCheckedAt(previous)) === hashCanonicalJson(withoutCheckedAt(manifest))
    ? previous.quality.checkedAt
    : checkedNow;
}

async function artifact(path) {
  return {
    path: repoPath(path),
    mediaType: path.endsWith('.pdf') ? 'application/pdf' : 'application/json',
    hash: await hashFile(path),
    bytes: statSync(path).size,
  };
}

function isoPolicyDate(value) {
  const match = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : undefined;
}

function invocationFromMetadata(metadata) {
  if (!metadata) return [];
  if (Array.isArray(metadata.llmInvocations)) return metadata.llmInvocations;
  if (metadata.llmInvocation) return [metadata.llmInvocation];
  return [];
}

function invocationId(invocation) {
  return invocation?.invocationId || invocation?.id || null;
}

function uniqueInvocations(invocations) {
  const byId = new Map();
  for (const invocation of invocations) {
    const id = invocationId(invocation);
    if (id && !byId.has(id)) byId.set(id, invocation);
  }
  return [...byId.values()];
}

function check(condition, message, failures) {
  if (!condition) failures.push(message);
}

async function main() {
  const indexPath = resolve(DATA, 'policies-index.json');
  const titlesPath = resolve(DATA, 'policy-titles-es.json');
  const summariesPath = resolve(DATA, 'policy-summaries.json');
  const index = readJson(indexPath);
  const titles = readJson(titlesPath);
  const summaries = readJson(summariesPath);
  const policies = index.policies || [];
  const failures = [];
  const checkedNow = new Date().toISOString();
  const generatorVersion = hashCanonicalJson(GENERATOR_DEPENDENCIES.map((path) => ({
    path: repoPath(path),
    hash: sha256(readFileSync(path)),
  })));

  let exhibitArtifacts = [];
  if (existsSync(EXHIBIT_DIR)) {
    exhibitArtifacts = await Promise.all(
      readdirSync(EXHIBIT_DIR)
        .filter((name) => name.endsWith('.pdf'))
        .sort()
        .map((filename) => artifact(resolve(EXHIBIT_DIR, filename))),
    );
  } else {
    const previous = readPreviousManifest('rcsd.board-policies.json');
    exhibitArtifacts = (previous?.artifacts || [])
      .filter((item) => item.path?.startsWith('artifacts/board-policy-exhibits/'));
    if (!exhibitArtifacts.length) {
      throw new Error(`Missing ${repoPath(EXHIBIT_DIR)} and no checked-in provenance snapshot hashes are available.`);
    }
  }
  const exhibitByPath = new Map(exhibitArtifacts.map((item) => [item.path, item]));
  const usedExhibitPaths = new Set();

  const enFiles = readdirSync(EN_DIR).filter((name) => name.endsWith('.json')).sort();
  const esFiles = readdirSync(ES_DIR).filter((name) => name.endsWith('.json')).sort();
  check(policies.length === 619, `Expected 619 catalog policies, found ${policies.length}`, failures);
  check(enFiles.length === 619, `Expected 619 English policy files, found ${enFiles.length}`, failures);
  check(esFiles.length === 618, `Expected 618 Spanish policy files, found ${esFiles.length}`, failures);
  check(Object.keys(summaries.summaries || {}).length === 618, `Expected 618 summaries, found ${Object.keys(summaries.summaries || {}).length}`, failures);
  check(Object.keys(titles.titles || {}).length === 619, `Expected exactly 619 Spanish title keys, found ${Object.keys(titles.titles || {}).length}`, failures);
  check(Object.keys(titles.sections || {}).length === (index.sections || []).length, `Expected exactly ${(index.sections || []).length} Spanish section keys, found ${Object.keys(titles.sections || {}).length}`, failures);

  const englishArtifacts = [await artifact(indexPath)];
  const translationArtifacts = [await artifact(titlesPath)];
  const summaryArtifacts = [await artifact(summariesPath)];
  const englishSources = [{
    sourceId: 'simbli-policy-catalog',
    title: 'RCSD Board Policy Manual',
    publisher: 'Redwood City School District',
    url: index._metadata?.source,
    acquiredAt: index._metadata?.scrapedAt,
  }];
  const englishLineage = [];
  const translationLineage = [];
  const summaryLineage = [];
  const translationInvocations = [...invocationFromMetadata(titles._metadata)];
  const summaryInvocations = [...invocationFromMetadata(summaries._metadata)];
  const englishDates = [index._metadata?.scrapedAt];
  const translationDates = [titles._metadata?.generatedAt];
  const summaryDates = [summaries._metadata?.generatedAt];

  for (let i = 0; i < policies.length; i++) {
    const policy = policies[i];
    const key = `${policy.code}-${policy.type}`;
    const filename = `${key}.json`;
    const enPath = resolve(EN_DIR, filename);
    check(existsSync(enPath), `Missing English policy ${filename}`, failures);
    if (!existsSync(enPath)) continue;

    const en = readJson(enPath);
    const enArtifact = await artifact(enPath);
    englishArtifacts.push(enArtifact);
    englishDates.push(en._metadata?.scrapedAt);
    const contentHash = `sha256:${sha256Hex(en.contentText || '')}`;
    const sourceId = `simbli-policy-${idToken(key)}`;
    const expectedExhibitPath = `artifacts/board-policy-exhibits/${key.replaceAll(' ', '-')}.pdf`;
    const snapshot = exhibitByPath.get(expectedExhibitPath);
    if (key.includes('E PDF(')) check(snapshot, `Missing source PDF snapshot for ${key}`, failures);
    if (snapshot) usedExhibitPaths.add(snapshot.path);
    englishSources.push({
      sourceId,
      title: `${policy.type} ${policy.code}: ${policy.title}`,
      publisher: 'Redwood City School District',
      url: en._metadata?.source,
      acquiredAt: en._metadata?.scrapedAt,
      effectiveAt: isoPolicyDate(policy.lastRevised),
      ...(snapshot ? { hash: snapshot.hash, snapshot } : {}),
    });
    englishLineage.push({
      outputArtifactPath: enArtifact.path,
      outputPointer: '/contentText',
      inputs: [{ sourceId, hash: snapshot?.hash || contentHash }],
    });

    const title = titles.titles?.[key];
    check(title?.es, `Missing Spanish title ${key}`, failures);
    if (title?.es) {
      const titleInvocationId = titles._metadata?.llmInvocationIds?.titles?.[key] || null;
      translationLineage.push({
        outputArtifactPath: repoPath(titlesPath),
        outputPointer: `/titles/${pointerToken(key)}/es`,
        inputs: [{
          datasetId: 'rcsd.board-policies',
          artifactPath: repoPath(indexPath),
          pointer: `/policies/${i}/title`,
          hash: `sha256:${sha256Hex(policy.title)}`,
        }],
        ...(titleInvocationId ? { llmInvocationId: titleInvocationId } : {}),
      });
    }

    const esPath = resolve(ES_DIR, filename);
    if (key === SCANNED_EXCEPTION) {
      check(!(en.contentText || '').trim(), `${SCANNED_EXCEPTION} must remain the declared no-text source exception`, failures);
      check(!existsSync(esPath), `${SCANNED_EXCEPTION} unexpectedly has a Spanish body; update the declared exception`, failures);
      check(!summaries.summaries?.[key], `${SCANNED_EXCEPTION} unexpectedly has a summary; update the declared exception`, failures);
      continue;
    }

    check((en.contentText || '').trim(), `${key} has no English content but is not the declared exception`, failures);
    check(existsSync(esPath), `Missing Spanish policy ${filename}`, failures);
    const summary = summaries.summaries?.[key];
    check(summary, `Missing summary ${key}`, failures);
    if (existsSync(esPath)) {
      const es = readJson(esPath);
      const esArtifact = await artifact(esPath);
      translationArtifacts.push(esArtifact);
      translationDates.push(es._metadata?.generatedAt);
      check(es._metadata?.sourceHash === contentHash.slice(7), `Stale Spanish source hash for ${key}`, failures);
      const invocations = invocationFromMetadata(es._metadata);
      translationInvocations.push(...invocations);
      const bodyLineage = {
        outputArtifactPath: esArtifact.path,
        outputPointer: '/contentTextEs',
        inputs: [{
          datasetId: 'rcsd.board-policies',
          artifactPath: enArtifact.path,
          pointer: '/contentText',
          hash: contentHash,
        }],
      };
      const bodyInvocationIds = Array.isArray(es._metadata?.llmInvocationIds)
        ? es._metadata.llmInvocationIds
        : invocations.map(invocationId).filter(Boolean);
      if (bodyInvocationIds.length) {
        for (const llmInvocationId of bodyInvocationIds) translationLineage.push({ ...bodyLineage, llmInvocationId });
      } else {
        translationLineage.push(bodyLineage);
      }
    }

    if (summary) {
      check(summary.sourceHash === contentHash.slice(7), `Stale summary source hash for ${key}`, failures);
      const invocations = invocationFromMetadata(summary);
      summaryInvocations.push(...invocations);
      const summaryInvocationId = summaries._metadata?.llmInvocationIds?.[key]
        || invocationId(invocations[0]);
      for (const language of ['en', 'es']) {
        summaryLineage.push({
          outputArtifactPath: repoPath(summariesPath),
          outputPointer: `/summaries/${pointerToken(key)}/${language}`,
          inputs: [{
            datasetId: 'rcsd.board-policies',
            artifactPath: enArtifact.path,
            pointer: '/contentText',
            hash: contentHash,
          }],
          ...(summaryInvocationId ? { llmInvocationId: summaryInvocationId } : {}),
        });
      }
    }
  }

  for (const exhibit of exhibitArtifacts) {
    check(usedExhibitPaths.has(exhibit.path), `Board-policy exhibit does not resolve to a catalog source: ${exhibit.path}`, failures);
  }

  for (let i = 0; i < (index.sections || []).length; i++) {
    const section = index.sections[i];
    const translated = titles.sections?.[section.code];
    check(translated?.es, `Missing Spanish section title ${section.code}`, failures);
    if (!translated?.es) continue;
    const sectionInvocationId = titles._metadata?.llmInvocationIds?.sections?.[section.code] || null;
    translationLineage.push({
      outputArtifactPath: repoPath(titlesPath),
      outputPointer: `/sections/${pointerToken(section.code)}/es`,
      inputs: [{
        datasetId: 'rcsd.board-policies',
        artifactPath: repoPath(indexPath),
        pointer: `/sections/${i}/name`,
        hash: `sha256:${sha256Hex(section.name)}`,
      }],
      ...(sectionInvocationId ? { llmInvocationId: sectionInvocationId } : {}),
    });
  }

  englishArtifacts.push(...exhibitArtifacts);

  if (failures.length) {
    throw new Error(`Policy provenance invariants failed:\n${failures.map((failure) => `  - ${failure}`).join('\n')}`);
  }

  const englishGeneratedAt = newestIso(englishDates);
  const translationGeneratedAt = newestIso(translationDates);
  const summaryGeneratedAt = newestIso(summaryDates);
  const legacyLlmException = {
    code: 'legacy-llm-invocation-incomplete',
    message: 'Cached outputs created before invocation provenance was introduced retain model and source hashes but not every request parameter. Re-running the instrumented generators upgrades them.',
  };

  const translationMissingInvocations = translationLineage.filter((record) => !record.llmInvocationId).length;
  const summaryMissingInvocations = summaryLineage.filter((record) => !record.llmInvocationId).length;
  const policyArtifactSetHash = hashCanonicalJson(englishArtifacts);
  const generator = { script: repoPath(GENERATOR_PATH), version: generatorVersion };
  const manifests = [
    {
      filename: 'rcsd.board-policies.json',
      value: {
        $schema: DATASET_SCHEMA,
        schemaVersion: SCHEMA_VERSION,
        datasetId: 'rcsd.board-policies',
        districtId: DISTRICT_ID,
        kind: 'source-mirror',
        artifacts: englishArtifacts,
        authority: { status: 'unofficial', officialLanguage: 'en-US' },
        sources: englishSources,
        lineage: {
          generatedAt: englishGeneratedAt,
          generator,
          inputs: [],
        },
        quality: {
          state: 'partial',
          checkedAt: checkedNow,
          exceptions: [
            {
              code: 'upstream-html-not-snapshotted',
              message: 'Simbli source URLs and acquisition times are retained, but the upstream HTML responses were not archived byte-for-byte. Record input hashes for non-PDF policies cover normalized extracted text, not the original HTTP response bytes.',
            },
            {
              code: 'source-text-unavailable',
              message: `${SCANNED_EXCEPTION} is a scanned PDF exhibit with no extractable source text.`,
              artifactPath: `artifacts/board-policy-exhibits/${SCANNED_EXCEPTION.replaceAll(' ', '-')}.pdf`,
            },
          ],
        },
        recordLineage: englishLineage,
      },
    },
    {
      filename: 'rcsd.board-policies-es.json',
      value: {
        $schema: DATASET_SCHEMA,
        schemaVersion: SCHEMA_VERSION,
        datasetId: 'rcsd.board-policies-es',
        districtId: DISTRICT_ID,
        kind: 'translation',
        artifacts: translationArtifacts,
        authority: { status: 'derived', officialLanguage: 'en-US' },
        sources: [],
        lineage: {
          generatedAt: translationGeneratedAt,
          generator,
          inputs: [{ datasetId: 'rcsd.board-policies', hash: policyArtifactSetHash }],
        },
        quality: { state: 'partial', checkedAt: checkedNow, exceptions: [
          ...(translationMissingInvocations ? [{ ...legacyLlmException, message: `${legacyLlmException.message} ${translationMissingInvocations} translation lineage entries still lack an invocation ID.` }] : []),
          {
          code: 'declared-source-gap',
          message: `${SCANNED_EXCEPTION} has no Spanish body because the English source contains no extractable text.`,
          },
        ] },
        llmInvocations: uniqueInvocations(translationInvocations),
        recordLineage: translationLineage,
      },
    },
    {
      filename: 'rcsd.board-policy-summaries.json',
      value: {
        $schema: DATASET_SCHEMA,
        schemaVersion: SCHEMA_VERSION,
        datasetId: 'rcsd.board-policy-summaries',
        districtId: DISTRICT_ID,
        kind: 'derived',
        artifacts: summaryArtifacts,
        authority: { status: 'derived', officialLanguage: 'en-US' },
        sources: [],
        lineage: {
          generatedAt: summaryGeneratedAt,
          generator,
          inputs: [{ datasetId: 'rcsd.board-policies', hash: policyArtifactSetHash }],
        },
        quality: { state: 'partial', checkedAt: checkedNow, exceptions: [
          ...(summaryMissingInvocations ? [{ ...legacyLlmException, message: `${legacyLlmException.message} ${summaryMissingInvocations} summary lineage entries still lack an invocation ID.` }] : []),
          {
          code: 'declared-source-gap',
          message: `${SCANNED_EXCEPTION} has no summary because the source contains no extractable text.`,
          },
        ] },
        llmInvocations: uniqueInvocations(summaryInvocations),
        recordLineage: summaryLineage,
      },
    },
  ];

  mkdirSync(OUT_DIR, { recursive: true });
  for (const { filename, value } of manifests) {
    value.quality.checkedAt = preserveCheckedAt(filename, value, checkedNow);
    const schemaValidation = validateJsonSchema('dataset', value);
    if (!schemaValidation.valid) {
      throw new Error(`${filename} does not conform to the published JSON Schema:\n${schemaValidation.errors.map((error) => `  - ${error.path || '/'}: ${error.message}`).join('\n')}`);
    }
    const validation = validateDatasetProvenance(value);
    if (!validation.valid) {
      throw new Error(`${filename} does not conform to the provenance contract:\n${validation.errors.map((error) => `  - ${error.path || '/'}: ${error.message}`).join('\n')}`);
    }
    writeFileSync(resolve(OUT_DIR, filename), `${JSON.stringify(value, null, 2)}\n`);
    console.log(`Wrote ${repoPath(resolve(OUT_DIR, filename))}`);
  }
  console.log(`Validated ${policies.length} English policies, ${esFiles.length} Spanish bodies, and ${Object.keys(summaries.summaries).length} bilingual summaries.`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
