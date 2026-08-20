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
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { nameKey, sameName, displayName, decodeEntities } from '../scripts/lib/person-name.mjs';

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
