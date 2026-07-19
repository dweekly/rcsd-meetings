import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';

import {
  JsonPointerError,
  LineageCycleError,
  assertAcyclicLineage,
  buildLlmCacheFingerprint,
  canonicalJson,
  findLineageCycles,
  getInstalledPackageVersion,
  hasJsonPointer,
  hashCanonicalJson,
  hashFile,
  parseJsonPointer,
  resolveJsonPointer,
  sha256,
  sha256Hex,
  validateClaim,
  validateDatasetProvenance,
  validateDistrictSourceManifest,
  validateLlmInvocation,
  validateReleaseManifest,
} from '../scripts/lib/provenance.mjs';
import { validateJsonSchema } from '../scripts/lib/provenance-schema.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const FIXTURES = join(ROOT, 'tests/fixtures/provenance');
const SCHEMAS = join(ROOT, 'schemas/provenance/v1');

function fixture(name) {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.valid.json`), 'utf8'));
}

function clone(value) {
  return structuredClone(value);
}

test('all five public v1 schemas parse and local references resolve', () => {
  const expected = [
    'claim.schema.json',
    'dataset-provenance.schema.json',
    'district-source-manifest.schema.json',
    'llm-invocation.schema.json',
    'release-manifest.schema.json',
  ];
  const files = readdirSync(SCHEMAS).filter((file) => file.endsWith('.schema.json')).sort();
  assert.deepEqual(files.filter((file) => file !== 'common.schema.json'), expected);

  for (const file of files) {
    const schema = JSON.parse(readFileSync(join(SCHEMAS, file), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.$id, `https://rcsd.info/schemas/provenance/v1/${file}`);
    const refs = [];
    JSON.stringify(schema, (key, value) => {
      if (key === '$ref' && typeof value === 'string') refs.push(value);
      return value;
    });
    for (const ref of refs) {
      if (ref.startsWith('#') || /^https?:/.test(ref)) continue;
      const referencedFile = ref.split('#', 1)[0];
      assert.ok(existsSync(join(dirname(join(SCHEMAS, file)), referencedFile)), `${file}: unresolved ${ref}`);
    }
  }
});

test('all valid fixtures pass real Draft 2020-12 schema validation', () => {
  const cases = [
    ['dataset', 'dataset'],
    ['claim', 'claim'],
    ['llm', 'llm-invocation'],
    ['district', 'district'],
    ['release', 'release'],
  ];
  for (const [kind, name] of cases) {
    const result = validateJsonSchema(kind, fixture(name));
    assert.equal(result.valid, true, `${kind}: ${JSON.stringify(result.errors)}`);
  }
});

test('public schemas reject undeclared properties instead of silently publishing them', () => {
  const cases = [
    ['dataset', 'dataset'],
    ['claim', 'claim'],
    ['llm', 'llm-invocation'],
    ['district', 'district'],
    ['release', 'release'],
  ];
  for (const [kind, name] of cases) {
    const value = fixture(name);
    value.unreviewedPrivateData = 'must not pass a public contract';
    const result = validateJsonSchema(kind, value);
    assert.equal(result.valid, false, `${kind} unexpectedly accepted an additional property`);
    assert.ok(result.errors.some((error) => error.keyword === 'additionalProperties'));
  }

  const invocation = fixture('llm-invocation');
  invocation.attempts[0].rawProviderResponse = { secret: true };
  const nested = validateJsonSchema('llm', invocation);
  assert.equal(nested.valid, false);
  assert.ok(nested.errors.some((error) => (
    error.keyword === 'additionalProperties' && error.path === '/attempts/0'
  )));
});

test('published releases require a valid publishedAt timestamp', () => {
  const candidate = fixture('release');
  assert.equal(validateJsonSchema('release', candidate).valid, true);

  const published = clone(candidate);
  published.status = 'published';
  const missing = validateJsonSchema('release', published);
  assert.equal(missing.valid, false);
  assert.ok(missing.errors.some((error) => (
    error.keyword === 'required' && error.message.includes('publishedAt')
  )));
  assert.ok(validateReleaseManifest(published).errors.some((error) => error.path === '/publishedAt'));

  published.publishedAt = '2026-07-09T12:01:00Z';
  assert.equal(validateJsonSchema('release', published).valid, true);
  assert.equal(validateReleaseManifest(published).valid, true);

  published.publishedAt = 'not-a-date';
  assert.ok(validateJsonSchema('release', published).errors.some((error) => error.keyword === 'format'));
});

test('canonicalJson is stable across key insertion order and rejects lossy values', () => {
  const first = { z: 1, a: { d: true, c: ['x', null, -0] } };
  const second = { a: { c: ['x', null, 0], d: true }, z: 1 };
  assert.equal(canonicalJson(first), '{"a":{"c":["x",null,0],"d":true},"z":1}');
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(hashCanonicalJson(first), hashCanonicalJson(second));
  assert.throws(() => canonicalJson({ missing: undefined }), /Cannot canonicalize undefined/);
  assert.throws(() => canonicalJson({ value: Infinity }), /non-finite/);
  assert.throws(() => canonicalJson(new Date()), /non-plain object/);
  assert.throws(() => canonicalJson(new Array(1)), /sparse array/);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic), /cyclic data/);
});

test('hash helpers produce standard SHA-256 digests and stream files', async () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256('abc'), 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const path = join(FIXTURES, 'claim.valid.json');
  assert.equal(await hashFile(path), sha256(readFileSync(path)));
});

test('installed SDK version is resolved from the runtime package, not a semver range', () => {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(
    getInstalledPackageVersion('@anthropic-ai/sdk'),
    lock.packages['node_modules/@anthropic-ai/sdk'].version,
  );
});

test('JSON Pointer supports escaped tokens and URI fragments', () => {
  const document = { 'a/b': { '~key': ['zero', { '€': 42 }] } };
  assert.deepEqual(parseJsonPointer('/a~1b/~0key/1/%E2%82%AC'), ['a/b', '~key', '1', '%E2%82%AC']);
  assert.equal(resolveJsonPointer(document, '/a~1b/~0key/1/€'), 42);
  assert.equal(resolveJsonPointer(document, '#/a~1b/~0key/1/%E2%82%AC'), 42);
  assert.equal(resolveJsonPointer(document, ''), document);
  assert.equal(hasJsonPointer(document, '/a~1b/~0key/2'), false);
  assert.throws(() => resolveJsonPointer({}, '/toString'), JsonPointerError);
  assert.throws(() => resolveJsonPointer(['x'], '/00'), JsonPointerError);
  assert.throws(() => parseJsonPointer('/bad~2escape'), JsonPointerError);
});

test('lineage cycle checks report closed cycle paths and allow external leaves', () => {
  const acyclic = [
    { datasetId: 'a', lineage: { inputs: [{ datasetId: 'external' }] } },
    { datasetId: 'b', lineage: { inputs: [{ datasetId: 'a' }] } },
  ];
  assert.deepEqual(findLineageCycles(acyclic), []);
  assert.doesNotThrow(() => assertAcyclicLineage(acyclic));

  const cyclic = [
    { datasetId: 'a', lineage: { inputs: [{ datasetId: 'b' }] } },
    { datasetId: 'b', lineage: { inputs: [{ datasetId: 'c' }] } },
    { datasetId: 'c', lineage: { inputs: [{ datasetId: 'a' }] } },
  ];
  assert.deepEqual(findLineageCycles(cyclic), [['a', 'b', 'c', 'a']]);
  assert.throws(() => assertAcyclicLineage(cyclic), LineageCycleError);
});

test('LLM cache fingerprint covers behavior but ignores execution results', () => {
  const invocation = fixture('llm-invocation');
  assert.equal(buildLlmCacheFingerprint(invocation), invocation.cacheFingerprint);

  const laterExecution = clone(invocation);
  laterExecution.attempts[0].startedAt = '2026-07-10T12:00:00Z';
  laterExecution.outputHash = sha256('a different response');
  laterExecution.cacheFingerprint = sha256('ignored field');
  assert.equal(buildLlmCacheFingerprint(laterExecution), invocation.cacheFingerprint);

  for (const mutate of [
    (value) => { value.model.resolved = 'example-model-v1-20260702'; },
    (value) => { value.parameters.sent.temperature = 0.2; },
    (value) => { value.prompts.userTemplateHash = sha256('new prompt'); },
    (value) => { value.inputs[0].hash = sha256('new input'); },
    (value) => { value.localization.targetLocale = 'es-US'; },
    (value) => { value.processing.chunking = 'paragraphs'; },
  ]) {
    const changed = clone(invocation);
    mutate(changed);
    assert.notEqual(buildLlmCacheFingerprint(changed), invocation.cacheFingerprint);
  }
});

test('each valid provenance fixture passes its domain validator', () => {
  const cases = [
    ['dataset', validateDatasetProvenance],
    ['claim', validateClaim],
    ['llm-invocation', validateLlmInvocation],
    ['district', validateDistrictSourceManifest],
    ['release', validateReleaseManifest],
  ];
  for (const [name, validate] of cases) {
    const result = validate(fixture(name));
    assert.equal(result.valid, true, `${name}: ${JSON.stringify(result.errors)}`);
  }
});

test('dataset validation resolves family artifact, source, and invocation references', () => {
  const manifest = fixture('dataset');
  manifest.quality = { state: 'partial', exceptions: [] };
  assert.equal(validateDatasetProvenance(manifest).valid, false);

  const badArtifact = fixture('dataset');
  badArtifact.recordLineage[0].outputArtifactPath = 'data/not-declared.json';
  assert.ok(validateDatasetProvenance(badArtifact).errors.some((error) => error.path.endsWith('/outputArtifactPath')));

  const badSource = fixture('dataset');
  badSource.recordLineage[0].inputs[0].sourceId = 'unknown-source';
  assert.ok(validateDatasetProvenance(badSource).errors.some((error) => error.path.endsWith('/sourceId')));

  const badSourceHash = fixture('dataset');
  badSourceHash.recordLineage[0].inputs[0].hash = sha256('not the referenced source');
  assert.ok(validateDatasetProvenance(badSourceHash).errors.some((error) => error.path.endsWith('/inputs/0/hash')));

  const badSnapshotHash = fixture('dataset');
  badSnapshotHash.sources[0].snapshot = {
    path: 'artifacts/source.pdf',
    mediaType: 'application/pdf',
    hash: sha256('different snapshot'),
  };
  assert.ok(validateDatasetProvenance(badSnapshotHash).errors.some((error) => error.path.endsWith('/sources/0/hash')));
});

test('LLM, claim, district, and release validators enforce cross-field safety rules', () => {
  const llm = fixture('llm-invocation');
  llm.parameters.sent.max_tokens += 1;
  assert.ok(validateLlmInvocation(llm).errors.some((error) => error.path === '/cacheFingerprint'));

  const impossibleDate = fixture('llm-invocation');
  impossibleDate.attempts[0].startedAt = '2026-02-30T12:00:00Z';
  assert.ok(validateLlmInvocation(impossibleDate).errors.some((error) => error.path.endsWith('/startedAt')));

  const claim = fixture('claim');
  delete claim.derivation;
  assert.ok(validateClaim(claim).errors.some((error) => error.path === '/derivation'));

  const district = fixture('district');
  district.sourceRegimes[0].sourceIds = ['missing-source'];
  assert.ok(validateDistrictSourceManifest(district).errors.some((error) => error.path.endsWith('/sourceIds/0')));

  const release = fixture('release');
  release.status = 'published';
  release.qualityGates[0].status = 'failed';
  release.artifacts[1].path = release.artifacts[0].path;
  const result = validateReleaseManifest(release);
  assert.ok(result.errors.some((error) => error.path === '/qualityGates'));
  assert.ok(result.errors.some((error) => error.path.endsWith('/path')));
});

test('all checked-in district manifests satisfy the same public contract', () => {
  const districtRoot = join(ROOT, 'districts');
  const paths = readdirSync(districtRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(districtRoot, entry.name, 'manifest.json'))
    .filter(existsSync);
  assert.ok(paths.length >= 4);
  for (const path of paths) {
    const result = validateDistrictSourceManifest(JSON.parse(readFileSync(path, 'utf8')));
    assert.equal(result.valid, true, `${basename(dirname(path))}: ${JSON.stringify(result.errors)}`);
  }
});
