#!/usr/bin/env node
/**
 * Assert that what rcsd.info publishes still matches what its sources say.
 *
 * Reads data/freshness.json (written by scripts/verify-live-facts.mjs) and
 * compares each observation against the value the site actually publishes in
 * data/schools.json / data/trustees.json. Exits non-zero when they diverge.
 *
 * Companion to check-pipeline-health.mjs and runs in the same final workflow
 * slot, for the same reason: a red scheduled run triggers GitHub's
 * workflow-failure notification, which is the alert channel, and failing last
 * means the alert never discards the run's paid API work.
 *
 * The failure mode this exists for: principals and the superintendency rotate
 * on a school-year boundary, but the files holding them are hand-edited. Four
 * of twelve principals and the superintendent were stale in production on
 * 2026-08-19 — Kennedy's for an unknown length of time — because nothing ever
 * compared them to their source. A checklist would not have caught it; nothing
 * prompts anyone to open a checklist.
 *
 * Deliberately compares against the DATA files, not the rendered HTML, and
 * deliberately does not duplicate the published names into freshness.json:
 * one definition per fact. data/schools.json stays the single place a
 * principal's name is written.
 *
 * Usage: node scripts/check-freshness.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sameName, nameKey } from './lib/person-name.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FRESHNESS_PATH = resolve(ROOT, 'data/freshness.json');
const SCHOOLS_PATH = resolve(ROOT, 'data/schools.json');
const TRUSTEES_PATH = resolve(ROOT, 'data/trustees.json');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

if (!existsSync(FRESHNESS_PATH)) {
  console.log('No freshness record yet — passing (first run, or the probe has never completed).');
  process.exit(0);
}

const freshness = JSON.parse(readFileSync(FRESHNESS_PATH, 'utf-8'));
const schools = JSON.parse(readFileSync(SCHOOLS_PATH, 'utf-8')).schools;
const trustees = JSON.parse(readFileSync(TRUSTEES_PATH, 'utf-8'));

const { observations = [], lastRun = {}, maxObservationAgeDays = 7 } = freshness;
const problems = [];
// ADVISORY findings are printed but do NOT fail the build. The cabinet /
// director roster on the district page churns (people are added, retitled, and
// dropped between board actions) and the page is not a complete roster of
// record. Making every roster nuance red would train the operator to ignore a
// red run, which would destroy the value of the fatal checks. Principals and
// the sitting superintendent are single-valued, unambiguous, and rarely change
// — those stay fatal.
const advisories = [];

// --- Is the probe itself still running? ------------------------------------
// A probe that quietly stopped would otherwise read as "no drift found".
if (!lastRun.probedAt) {
  problems.push('data/freshness.json has no lastRun.probedAt — the probe has never completed a run.');
} else {
  const ageDays = (Date.now() - Date.parse(lastRun.probedAt)) / MS_PER_DAY;
  if (Number.isNaN(ageDays)) {
    problems.push(`data/freshness.json lastRun.probedAt is unparseable: ${lastRun.probedAt}`);
  } else if (ageDays > maxObservationAgeDays) {
    problems.push(
      `Freshness observations are ${ageDays.toFixed(1)} days old (ceiling ${maxObservationAgeDays}); `
      + `last probed ${lastRun.probedAt}. The probe step is not running — nothing is being checked.`,
    );
  }
}
for (const failure of lastRun.failures ?? []) {
  problems.push(`Source could not be probed: ${failure}`);
}
if (observations.length === 0) {
  problems.push('data/freshness.json contains no observations — nothing was checked.');
}

// --- Do the published values still match the sources? ----------------------
for (const obs of observations) {
  if (obs.kind === 'principal') {
    const school = schools.find(s => s.slug === obs.slug);
    if (!school) {
      problems.push(`Observation ${obs.id} references slug "${obs.slug}", which is not in data/schools.json.`);
      continue;
    }
    if (!sameName(school.principal, obs.observed)) {
      problems.push(
        `${obs.slug} principal drifted — data/schools.json says "${school.principal}", `
        + `${obs.source} says "${obs.observed}".`,
      );
    }
  } else if (obs.kind === 'superintendent') {
    const current = trustees.superintendent?.current;
    if (!current) {
      problems.push('data/trustees.json has no superintendent.current, but the district page names one.');
      continue;
    }
    if (!sameName(current.name, obs.observed)) {
      problems.push(
        `Superintendent drifted — data/trustees.json says "${current.name}", `
        + `${obs.source} says "${obs.observed}".`,
      );
    }
    // An `incoming` record that has passed its start date means the transition
    // completed and was never flipped — exactly the Baker/Rubalcaba failure.
    const incoming = trustees.superintendent?.incoming;
    if (incoming && sameName(incoming.name, obs.observed)) {
      problems.push(
        `Superintendent transition never flipped — "${incoming.name}" is still recorded as `
        + `\`incoming\` in data/trustees.json but ${obs.source} names them as sitting superintendent. `
        + 'Move them to `current`, retire the outgoing record, and re-check the parallel roster in '
        + 'scripts/extract-chapter-markers.mjs.',
      );
    }
  } else if (obs.kind === 'cabinet') {
    // Advisory, not fatal — see ADVISORY note below.
    const published = [...(trustees.cabinet ?? []), ...(trustees.directors ?? [])];
    const liveKeys = new Map(obs.observed.map(p => [nameKey(p.name), p]));
    const pubKeys = new Map(published.map(p => [nameKey(p.name), p]));

    for (const [key, live] of liveKeys) {
      const pub = pubKeys.get(key);
      if (!pub) {
        advisories.push(`cabinet: "${live.name} | ${live.title}" is listed on ${obs.source} but absent from data/trustees.json.`);
      } else if (pub.titleEn.trim() !== live.title.trim()) {
        advisories.push(`cabinet: ${live.name} retitled — data says "${pub.titleEn}", ${obs.source} says "${live.title}".`);
      }
    }
    for (const [key, pub] of pubKeys) {
      if (!liveKeys.has(key)) {
        advisories.push(`cabinet: "${pub.name} | ${pub.titleEn}" is in data/trustees.json but no longer listed on ${obs.source}.`);
      }
    }
  } else {
    problems.push(`Observation ${obs.id} has unknown kind "${obs.kind}" — check-freshness.mjs needs updating.`);
  }
}

if (advisories.length > 0) {
  console.log('Freshness advisories (not build-failing):\n- ' + advisories.join('\n- '));
}

if (problems.length > 0) {
  console.error('FRESHNESS GUARD FAILED:\n- ' + problems.join('\n- '));
  console.error('\nFix the data (not this guard), then re-run: node scripts/verify-live-facts.mjs');
  console.error('See docs/ANNUAL-REFRESH.md for the refresh procedure.');
  process.exit(1);
}

console.log(`Freshness OK (${observations.length} observations, ${advisories.length} advisories, probed ${lastRun.probedAt}).`);
