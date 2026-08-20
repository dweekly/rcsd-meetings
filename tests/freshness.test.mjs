/**
 * Tests for the freshness guard.
 *
 * These drive check-freshness.mjs through its real entry point — the CLI, with
 * a fixture ROOT — rather than importing pieces of it. The bug class this whole
 * mechanism exists to catch (a check that quietly stops checking) is invisible
 * to a unit test of the comparison helper: the helper can be perfect while the
 * script exits 0 because it read nothing.
 *
 * Fixtures only. Nothing here touches the network; the probe is exercised
 * against saved markup, not against rcsdk8.net.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { nameKey, sameName, displayName, decodeEntities } from '../scripts/lib/person-name.mjs';
import { classifyAvailability, cyclesBehind, nextSchoolYear, datasetFor, hasDataRows } from '../scripts/lib/cde-datasets.mjs';
import { currentSchoolYear, loadYearScopedJson, cdeDatasetPath } from '../scripts/lib/school-year.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = resolve(ROOT, 'scripts/check-freshness.mjs');

/**
 * Build a throwaway repo root holding just the three files the guard reads,
 * and run the guard against it. Returns { code, stdout, stderr }.
 */
function runGuard({ freshness, schools, trustees }) {
  const dir = mkdtempSync(join(tmpdir(), 'freshness-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true });
  writeFileSync(join(dir, 'data/freshness.json'), JSON.stringify(freshness, null, 2));
  writeFileSync(join(dir, 'data/schools.json'), JSON.stringify(schools, null, 2));
  writeFileSync(join(dir, 'data/trustees.json'), JSON.stringify(trustees, null, 2));
  cpSync(GUARD, join(dir, 'scripts/check-freshness.mjs'));
  cpSync(resolve(ROOT, 'scripts/lib/person-name.mjs'), join(dir, 'scripts/lib/person-name.mjs'));
  cpSync(resolve(ROOT, 'scripts/lib/cde-datasets.mjs'), join(dir, 'scripts/lib/cde-datasets.mjs'));
  try {
    const stdout = execFileSync(process.execPath, [join(dir, 'scripts/check-freshness.mjs')], {
      encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

const NOW = () => new Date().toISOString();

const baseSchools = { schools: [{ slug: 'kennedy', principal: 'Dr. Rangel Fernández' }] };
const baseTrustees = {
  superintendent: { current: { name: 'Dr. Christian J. Rubalcaba' } },
  cabinet: [], directors: [],
};
const baseFreshness = (overrides = {}) => ({
  maxObservationAgeDays: 7,
  lastRun: { probedAt: NOW(), probed: 2, failed: 0, failures: [] },
  observations: [
    { id: 'principal:kennedy', kind: 'principal', slug: 'kennedy', observed: 'Dr. Rangel Fernández', source: 'https://example.test/a' },
    { id: 'superintendent:current', kind: 'superintendent', observed: 'Dr. Christian J. Rubalcaba', source: 'https://example.test/b' },
  ],
  ...overrides,
});

test('passes when published values match the observed sources', () => {
  const r = runGuard({ freshness: baseFreshness(), schools: baseSchools, trustees: baseTrustees });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Freshness OK/);
});

test('fails when a principal in schools.json no longer matches the school site', () => {
  const schools = { schools: [{ slug: 'kennedy', principal: 'Chandra Leonardo' }] };
  const r = runGuard({ freshness: baseFreshness(), schools, trustees: baseTrustees });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /kennedy principal drifted/);
  assert.match(r.stderr, /Chandra Leonardo/);
  assert.match(r.stderr, /Dr\. Rangel Fernández/);
});

test('fails when the sitting superintendent no longer matches the district page', () => {
  const trustees = { ...baseTrustees, superintendent: { current: { name: 'Dr. John R. Baker, Ed.D.' } } };
  const r = runGuard({ freshness: baseFreshness(), schools: baseSchools, trustees });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Superintendent drifted/);
});

test('fails when a completed transition was never flipped out of `incoming`', () => {
  // The exact Baker/Rubalcaba shape: the site kept rendering "the district is
  // in a superintendent transition" because nobody moved the record.
  const trustees = {
    ...baseTrustees,
    superintendent: {
      current: { name: 'Dr. John R. Baker, Ed.D.' },
      incoming: { name: 'Dr. Christian J. Rubalcaba' },
    },
  };
  const r = runGuard({ freshness: baseFreshness(), schools: baseSchools, trustees });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /transition never flipped/);
});

test('fails when the probe could not read a source', () => {
  // A source that cannot be read is not a source that agrees.
  const freshness = baseFreshness({
    lastRun: { probedAt: NOW(), probed: 1, failed: 1, failures: ['principal:taft — HTTP 404'] },
  });
  const r = runGuard({ freshness, schools: baseSchools, trustees: baseTrustees });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Source could not be probed.*taft/s);
});

test('fails when observations have gone stale, i.e. the probe stopped running', () => {
  const old = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const freshness = baseFreshness({ lastRun: { probedAt: old, probed: 2, failed: 0, failures: [] } });
  const r = runGuard({ freshness, schools: baseSchools, trustees: baseTrustees });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /observations are .* days old/);
});

test('fails when the record contains no observations at all', () => {
  const r = runGuard({ freshness: baseFreshness({ observations: [] }), schools: baseSchools, trustees: baseTrustees });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no observations/);
});

test('fails on an observation kind it does not understand rather than ignoring it', () => {
  // Adding a probe without teaching the guard about it must not read as "clean".
  const freshness = baseFreshness();
  freshness.observations.push({ id: 'x', kind: 'enrollment', observed: 1, source: 'https://example.test/c' });
  const r = runGuard({ freshness, schools: baseSchools, trustees: baseTrustees });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /unknown kind "enrollment"/);
});

test('cabinet roster drift is reported but does not fail the build', () => {
  const freshness = baseFreshness();
  freshness.observations.push({
    id: 'cabinet:roster', kind: 'cabinet', source: 'https://example.test/d',
    observed: [{ name: 'Tina Mercer', title: 'Executive Director of Special Education' }],
  });
  const r = runGuard({ freshness, schools: baseSchools, trustees: baseTrustees });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /advisor/i);
  assert.match(r.stdout, /Tina Mercer/);
});

test('a missing freshness record passes, so a first run is not a failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'freshness-empty-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true });
  writeFileSync(join(dir, 'data/schools.json'), JSON.stringify(baseSchools));
  writeFileSync(join(dir, 'data/trustees.json'), JSON.stringify(baseTrustees));
  cpSync(GUARD, join(dir, 'scripts/check-freshness.mjs'));
  cpSync(resolve(ROOT, 'scripts/lib/person-name.mjs'), join(dir, 'scripts/lib/person-name.mjs'));
  cpSync(resolve(ROOT, 'scripts/lib/cde-datasets.mjs'), join(dir, 'scripts/lib/cde-datasets.mjs'));
  const out = execFileSync(process.execPath, [join(dir, 'scripts/check-freshness.mjs')], { encoding: 'utf-8' });
  assert.match(out, /No freshness record yet/);
});

// --- name normalization -----------------------------------------------------

test('courtesy titles do not read as a changed person, but a real change does', () => {
  assert.ok(sameName('Ms. Melissa Bowdoin', 'Melissa Bowdoin'));
  assert.ok(sameName('Mrs. Joanne Ongoco', 'Joanne Ongoco'));
  assert.ok(!sameName('Dr. Luis Arreola', 'Nick Fanourgiakis'));
});

test('an earned doctorate is kept, since it is part of the published name', () => {
  assert.ok(!sameName('Dr. Rangel Fernández', 'Rangel Fernández'));
  assert.equal(displayName('Dr. Rangel Fernández'), 'Dr. Rangel Fernández');
  assert.equal(displayName('Ms. Melissa Bowdoin'), 'Melissa Bowdoin');
});

test('post-nominal credentials do not read as a changed person', () => {
  // The district writes the same person both ways on different pages.
  assert.ok(sameName('Wendy Kelly, MPA, MA', 'Wendy Kelly'));
  assert.ok(sameName('Dr. John R. Baker, Ed.D.', 'Dr. John R. Baker'));
});

test('accents fold for comparison but survive in the display form', () => {
  assert.equal(nameKey('Lupe Guzmán'), nameKey('Lupe Guzman'));
  assert.equal(displayName('Lupe Guzm&aacute;n'), 'Lupe Guzmán');
  assert.equal(decodeEntities('Jos&eacute; Luna'), 'José Luna');
});

// --- CDE year staleness ------------------------------------------------------

const HEADER = 'AcademicYear\tCountyCode\tSchoolName';
const WITH_ROWS = `${HEADER}\n2025-26\t41\tKennedy Middle\n2025-26\t41\tTaft`;

test('a blocked probe decides nothing, in either direction', () => {
  // CDE's bot protection answers 303/403 under load. Treating that as "nothing
  // new" would hide a real refresh; treating it as "something new" would nag.
  assert.equal(classifyAvailability(303), 'unknown');
  assert.equal(classifyAvailability(403), 'unknown');
  assert.equal(classifyAvailability(500), 'unknown');
  assert.equal(classifyAvailability(404), false);
  // 200 with an unreadable body is not evidence either.
  assert.equal(classifyAvailability(200, null), 'unknown');
});

test('a 200 carrying only a header is NOT a published year', () => {
  // DataQuest serves LTEL from a query parameter and answers 200 for ANY year:
  // verified 2026-08-20, 2030-31 returned 200 with a 190-byte header-only body
  // while 2024-25 returned 27 MB. Trusting the status alone would have reported
  // LTEL two cycles behind and failed the build for nothing.
  assert.equal(classifyAvailability(200, HEADER), false);
  assert.equal(classifyAvailability(200, `${HEADER}\n`), false);
  assert.equal(classifyAvailability(200, WITH_ROWS), true);
  assert.equal(classifyAvailability(206, WITH_ROWS), true);

  assert.equal(hasDataRows(HEADER), false);
  assert.equal(hasDataRows(WITH_ROWS), true);
  assert.equal(hasDataRows(''), false);
});

test('one cycle behind advises; two cycles behind fails the build', () => {
  const freshness = baseFreshness();
  freshness.observations.push({
    id: 'cde-year:staff-ratios', kind: 'cde-year', dataset: 'staff-ratios',
    ingestedYear: '2024-25', availability: { '2025-26': true, '2026-27': false },
    source: 'https://example.test/cde',
  });
  const one = runGuard({ freshness, schools: baseSchools, trustees: baseTrustees });
  assert.equal(one.code, 0, one.stderr);
  assert.match(one.stdout, /staff-ratios/);

  freshness.observations.at(-1).availability = { '2025-26': true, '2026-27': true };
  const two = runGuard({ freshness, schools: baseSchools, trustees: baseTrustees });
  assert.equal(two.code, 1);
  assert.match(two.stderr, /2 release cycles behind/);
  assert.match(two.stderr, /pull-cde-data\.mjs --dataset staff-ratios/);
});

test('a blocked CDE probe neither advises nor fails', () => {
  const freshness = baseFreshness();
  freshness.observations.push({
    id: 'cde-year:ltel', kind: 'cde-year', dataset: 'ltel',
    ingestedYear: '2024-25', availability: { '2025-26': 'unknown' },
    source: 'https://example.test/cde',
  });
  const r = runGuard({ freshness, schools: baseSchools, trustees: baseTrustees });
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /ltel/);
});

// --- year-scoped constants ---------------------------------------------------

test('CDE URLs are derived correctly for each year encoding', () => {
  // Verified against the live URLs on 2026-08-19.
  assert.equal(datasetFor('staff-ethnicity', '2024-25').url,
    'https://www3.cde.ca.gov/demo-downloads/staff/stre2425.txt');
  assert.equal(datasetFor('staff-ethnicity', '2025-26').url,
    'https://www3.cde.ca.gov/demo-downloads/staff/stre2526.txt');
  assert.equal(datasetFor('absenteeism', '2024-25').url,
    'https://www3.cde.ca.gov/demo-downloads/attendance/chronicabsenteeism25-v2.txt');
  assert.equal(datasetFor('ltel', '2024-25').url,
    'https://dq.cde.ca.gov/dataquest/longtermel/lteldnld.aspx?year=2024-25');
  assert.equal(datasetFor('staff-ratios', '2025-26').outputFile, 'staff-ratios-2025-26.json');
});

test('school years roll over in August, not January', () => {
  assert.equal(nextSchoolYear('2024-25'), '2025-26');
  assert.equal(nextSchoolYear('2099-00'), '2100-01');  // century rollover
  assert.equal(currentSchoolYear(new Date('2026-07-31T12:00:00Z')), '2025-26');
  assert.equal(currentSchoolYear(new Date('2026-08-01T12:00:00Z')), '2026-27');
  assert.equal(currentSchoolYear(new Date('2027-01-15T12:00:00Z')), '2026-27');
});

test('a missing year-scoped dataset throws instead of yielding empty data', () => {
  // The whole point: a year bump renames a file, and the old code returned {}
  // so pages rendered without the data and nothing failed.
  assert.throws(
    () => loadYearScopedJson('/nonexistent/cde/absenteeism-2099-00.json', { what: 'CDE absenteeism' }),
    /Missing CDE absenteeism/,
  );
  assert.match(cdeDatasetPath('/repo', 'absenteeism'), /\/repo\/data\/cde\/absenteeism-\d{4}-\d{2}\.json/);
});

test('year-scoped labels and paths are derived, not written out again', () => {
  // Per the "replace a stale fact, never annotate beside it" rule: once a year
  // moves into school-year.mjs, a literal copy left behind in a label or a path
  // is a second source of truth that will silently disagree. This greps for the
  // retired values so a reintroduced literal fails rather than drifts.
  const buildSchools = readFileSync(resolve(ROOT, 'scripts/build-schools.mjs'), 'utf-8');

  for (const key of ['cdeAbsenteeismNote', 'cdeLtelSource', 'cdeStaffDiversityNote', 'cdeStaffSource']) {
    // Each label exists twice (EN + ES) and both must interpolate their year.
    const lines = buildSchools.split('\n').filter(l => l.trimStart().startsWith(`${key}:`));
    assert.equal(lines.length, 2, `expected EN+ES definitions of ${key}`);
    for (const line of lines) {
      assert.match(line, /\$\{CDE_DATA_YEARS/, `${key} must derive its year from CDE_DATA_YEARS`);
      assert.doesNotMatch(line, /\b20\d{2}-\d{2}\b/, `${key} still hardcodes a school year`);
    }
  }

  // Dataset file paths and document URLs must not carry literal years either.
  assert.doesNotMatch(buildSchools, /data\/cde\/[a-z-]+-20\d{2}-\d{2}\.json/,
    'CDE dataset paths must come from cdeDatasetPath()');
  assert.doesNotMatch(buildSchools, /documents\/(sarc|spsa)\/20\d{2}-\d{2}\//,
    'SARC/SPSA document URLs must come from SARC_YEAR / SPSA_YEAR');
});

test('extractor provenance reports the year it actually used', () => {
  // sarc-summary.json once hardcoded "2024-25 SARCs (covering 2023-24 data)",
  // which would have kept claiming 2024-25 after a bump.
  const sarc = readFileSync(resolve(ROOT, 'scripts/extract-sarc.mjs'), 'utf-8');
  assert.doesNotMatch(sarc, /source: '20\d{2}-\d{2} SARCs/, 'SARC provenance must be derived');
  assert.match(sarc, /\$\{SARC_YEAR_ARG\} SARCs/);

  const spsa = readFileSync(resolve(ROOT, 'scripts/extract-spsa-budgets.mjs'), 'utf-8');
  assert.doesNotMatch(spsa, /artifacts\/documents\/spsa\/20\d{2}-\d{2}\//,
    'SPSA provenance path must be derived from SPSA_YEAR');
});

test('a bumped year invalidates an extraction cache instead of reusing it', () => {
  // The caches are keyed by slug with no year in the path, so a bumped year
  // would otherwise hit last year's file and republish it as if fresh.
  const spsa = readFileSync(resolve(ROOT, 'scripts/extract-spsa-budgets.mjs'), 'utf-8');
  assert.match(spsa, /cached\.schoolYear === SPSA_YEAR/);
  const sarc = readFileSync(resolve(ROOT, 'scripts/extract-sarc.mjs'), 'utf-8');
  assert.match(sarc, /cached\.sarcYear === SARC_YEAR_ARG/);
});

test('the CDE puller can target a year other than the ingested one', () => {
  // Without --year the documented "pull, then bump" sequence had no first step:
  // the pull would re-fetch the year already recorded.
  const puller = readFileSync(resolve(ROOT, 'scripts/pull-cde-data.mjs'), 'utf-8');
  assert.match(puller, /--year/);
  assert.match(puller, /datasetFor\(singleDataset, targetYear\)/);
});
