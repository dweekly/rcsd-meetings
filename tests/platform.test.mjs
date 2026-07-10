import assert from 'node:assert/strict';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import test from 'node:test';

import {
  buildPlatformSite,
  validateActiveConfig,
  validateLocaleParity,
} from '../platform/build-site.mjs';
import { validateMeetingDataset } from '../platform/lib/validate-meetings.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const fixture = JSON.parse(await readFile(
  join(ROOT, 'tests/fixtures/platform/meetings.valid.json'),
  'utf8',
));

function clone(value = fixture) {
  return structuredClone(value);
}

async function fileSnapshot(outputDir, paths) {
  return Promise.all(paths.map(async (path) => [path, await readFile(join(outputDir, path), 'utf8')]));
}

async function platformTestDirectory(t, prefix) {
  await mkdir(join(ROOT, 'build'), { recursive: true });
  const directory = await mkdtemp(join(ROOT, 'build', `platform-test-${prefix}-`));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('meeting v0 preserves independent lifecycle states with dated evidence', () => {
  const result = validateMeetingDataset(fixture);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(
    ['occurrence', 'agenda', 'minutes', 'recording'].map((axis) => fixture.records[0][axis].state),
    ['held', 'revised', 'absent', 'expected'],
  );
});

test('meeting v0 rejects unknown shapes, invalid states, missing evidence, and bad source data', () => {
  const cases = [
    (value) => { value.records[0].inventedDecision = 'approved'; },
    (value) => { value.records[0].agenda.state = 'final'; },
    (value) => { delete value.records[0].minutes.evidence; },
    (value) => { value.records[0].recording.evidence[0].url = 'http://example.invalid/video'; },
    (value) => { value.records[0].occurrence.evidence[0].checkedAt = '2026-02-30T12:00:00Z'; },
    (value) => { value.records[0].agenda.evidence[0].sourceId = 'undeclared-source'; },
    (value) => { value.records[0] = null; },
    (value) => { value.records = {}; },
    (value) => { value._metadata.sources = {}; },
    (value) => { value._metadata.method.toolVersion = ''; },
  ];
  for (const mutate of cases) {
    const candidate = clone();
    mutate(candidate);
    assert.equal(validateMeetingDataset(candidate).valid, false);
  }
});

test('meeting v0 rejects duplicate IDs and district mismatches', () => {
  const duplicate = clone();
  duplicate.records.push(clone().records[0]);
  assert.ok(validateMeetingDataset(duplicate).errors.some((error) => error.keyword === 'uniqueRecordId'));

  const mismatch = clone();
  mismatch.records[0].districtId = 'ca.cde.district.9999999';
  assert.ok(validateMeetingDataset(mismatch).errors.some((error) => error.keyword === 'districtIdMatch'));

  const duplicateSource = clone();
  duplicateSource._metadata.sources.push(clone()._metadata.sources[0]);
  assert.ok(validateMeetingDataset(duplicateSource).errors.some((error) => error.keyword === 'uniqueSourceId'));

  const badTimezone = clone();
  badTimezone.records[0].timezone = 'Definitely/Not_A_Zone';
  assert.ok(validateMeetingDataset(badTimezone).errors.some((error) => error.keyword === 'timeZone'));

  const duplicateDiscrepancy = clone();
  const evidence = duplicateDiscrepancy.records[0].occurrence.evidence[0];
  const discrepancy = {
    id: 'meeting-time-conflict',
    field: 'startsAt',
    summary: 'Two official pages list different start times.',
    status: 'open',
    evidence: [evidence, { ...evidence, url: 'https://example.invalid/meetings/2026-01-14#other-time' }],
  };
  duplicateDiscrepancy.records[0].discrepancies = [discrepancy, clone(discrepancy)];
  assert.ok(validateMeetingDataset(duplicateDiscrepancy).errors.some((error) => error.keyword === 'uniqueDiscrepancyId'));
});

test('publication allowlist rejects traversal, duplicates, and undeclared fields', () => {
  for (const candidate of [
    { schemaVersion: '0.1.0', districtSlugs: ['../rcsd'] },
    { schemaVersion: '0.1.0', districtSlugs: ['rcsd', 'rcsd'] },
    { schemaVersion: '0.1.0', districtSlugs: [], publishEverything: true },
  ]) {
    assert.throws(() => validateActiveConfig(candidate));
  }
});

test('locale parity rejects a broken language switch', () => {
  assert.throws(() => validateLocaleParity([
    { route: 'en', otherLanguageRoute: 'missing', label: 'English' },
    { route: 'es', otherLanguageRoute: 'en', label: 'Español' },
  ]), /must link to another configured locale route/);
});

test('empty allowlist emits a deterministic bilingual no-index shell and no districts', async (t) => {
  const temporaryRoot = await platformTestDirectory(t, 'determinism');
  const options = {
    rootDir: ROOT,
    activeConfig: { schemaVersion: '0.1.0', districtSlugs: [] },
    publicBaseUrl: 'https://holding-name.pages.dev',
    generatedAt: '2026-07-09T18:00:00.000Z',
    gitCommit: 'a676d9564af4c8b30268399397860d55f8f85690',
  };

  const first = await buildPlatformSite({ ...options, outputDir: join(temporaryRoot, 'first') });
  const second = await buildPlatformSite({ ...options, outputDir: join(temporaryRoot, 'second') });
  const firstSnapshot = await fileSnapshot(first.outputDir, first.files);
  const secondSnapshot = await fileSnapshot(second.outputDir, second.files);
  assert.deepEqual(firstSnapshot.map(([, contents]) => contents), secondSnapshot.map(([, contents]) => contents));

  const output = new Map(firstSnapshot);
  const index = JSON.parse(output.get('api/v0/districts/index.json'));
  const release = JSON.parse(output.get('_meta/release.json'));
  assert.deepEqual(index.districts, []);
  assert.equal(release.districtCount, 0);
  assert.equal(release.publicBaseUrl, 'https://holding-name.pages.dev');
  assert.match(output.get('_headers'), /X-Robots-Tag: noindex/);
  assert.match(output.get('index.html'), /meta name="robots" content="noindex/);
  assert.match(output.get('en/index.html'), /School district information/);
  assert.match(output.get('es/index.html'), /Información de distritos escolares/);
  assert.match(output.get('en/index.html'), /\/assets\/site\.css/);
  assert.doesNotMatch(output.get('en/index.html'), /<style\b/);
  assert.ok(output.has('assets/site.css'));
  assert.ok(output.has('api/v0/schemas/meetings.schema.json'));

  const allOutput = firstSnapshot.map(([, contents]) => contents).join('\n');
  for (const unlisted of ['rcsd', 'san-mateo-foster-city-sd', 'ravenswood-city-sd', 'fresno-usd']) {
    assert.doesNotMatch(allOutput, new RegExp(unlisted));
  }
});

test('non-empty allowlists stay disabled until the complete publication gate exists', async (t) => {
  const temporaryRoot = await platformTestDirectory(t, 'gate');
  const common = {
    rootDir: ROOT,
    outputDir: join(temporaryRoot, 'site'),
    generatedAt: '2026-07-09T18:00:00.000Z',
    gitCommit: 'a676d956',
  };

  await assert.rejects(
    buildPlatformSite({
      ...common,
      activeConfig: { schemaVersion: '0.1.0', districtSlugs: ['missing-district'] },
    }),
    /publication is disabled/,
  );
  await assert.rejects(
    buildPlatformSite({
      ...common,
      activeConfig: { schemaVersion: '0.1.0', districtSlugs: ['rcsd'] },
    }),
    /publication is disabled/,
  );
});

test('builder refuses to replace RCSD production or arbitrary repository paths', async () => {
  const options = {
    rootDir: ROOT,
    activeConfig: { schemaVersion: '0.1.0', districtSlugs: [] },
    generatedAt: '2026-07-09T18:00:00.000Z',
    gitCommit: 'a676d956',
  };
  await assert.rejects(
    buildPlatformSite({ ...options, outputDir: join(ROOT, 'docs') }),
    /anything except build\/platform/,
  );
  await assert.rejects(
    buildPlatformSite({ ...options, outputDir: ROOT }),
    /anything except build\/platform/,
  );
});

test('builder refuses a symlinked test-output ancestor without touching its target', async (t) => {
  await mkdir(join(ROOT, 'build'), { recursive: true });
  const target = await mkdtemp(join(tmpdir(), 'district-data-lab-sentinel-'));
  const link = await mkdtemp(join(ROOT, 'build', 'platform-test-link-'));
  await rm(link, { recursive: true, force: true });
  await symlink(target, link, 'dir');
  t.after(async () => {
    await rm(link, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  });
  const sentinel = join(target, 'sentinel.txt');
  await writeFile(sentinel, 'do not delete', 'utf8');

  await assert.rejects(buildPlatformSite({
    rootDir: ROOT,
    outputDir: join(link, 'site'),
    activeConfig: { schemaVersion: '0.1.0', districtSlugs: [] },
    generatedAt: '2026-07-09T18:00:00.000Z',
    gitCommit: 'a676d956',
  }), /symlinked output ancestor/);
  assert.equal(await readFile(sentinel, 'utf8'), 'do not delete');
});

test('invalid configuration fails before replacing an existing build', async (t) => {
  const temporaryRoot = await platformTestDirectory(t, 'atomic');
  const outputDir = join(temporaryRoot, 'site');
  await buildPlatformSite({
    rootDir: ROOT,
    outputDir,
    activeConfig: { schemaVersion: '0.1.0', districtSlugs: [] },
    generatedAt: '2026-07-09T18:00:00.000Z',
    gitCommit: 'a676d956',
  });
  const receiptBefore = await readFile(join(outputDir, '_meta/release.json'), 'utf8');

  await assert.rejects(buildPlatformSite({
    rootDir: ROOT,
    outputDir,
    activeConfig: { schemaVersion: '0.1.0', districtSlugs: ['rcsd'] },
    generatedAt: '2026-07-10T18:00:00.000Z',
    gitCommit: 'a676d956',
  }));
  assert.equal(await readFile(join(outputDir, '_meta/release.json'), 'utf8'), receiptBefore);
});
