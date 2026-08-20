#!/usr/bin/env node
/**
 * Probe authoritative RCSD sources for facts the site publishes but nothing
 * re-checks, and record what they currently say into data/freshness.json.
 *
 * This script only OBSERVES. It never edits data/schools.json or
 * data/trustees.json, and it never decides whether an observation is a
 * problem — that is scripts/check-freshness.mjs, which compares these
 * observations against the published data files and fails the build on drift.
 * Keeping the two apart means the observation record is still written (and
 * committed) on a run where the guard goes red.
 *
 * Why this exists: principals and the superintendency rotate on a school-year
 * boundary, but data/schools.json and data/trustees.json are hand-edited and
 * carry only a single lastUpdated. On 2026-08-19 a first run of this probe
 * found FOUR of twelve principals stale (Kennedy, Henry Ford, McKinley, and
 * Roosevelt) and the superintendent still recorded as Dr. Baker seven weeks
 * after his retirement. Nothing in the build had noticed.
 *
 * Sources
 *   Principals     https://{school host}/our-school/meet-our-school-leadership
 *                  Server-rendered Finalsite pages. Each person is one
 *                  `<h2>Name | Title</h2>`; verified against all 12 school
 *                  hosts on 2026-08-19, every one HTTP 200.
 *   Superintendent https://www.rcsdk8.net/our-programs-and-services/our-superintendent
 *
 * Usage:
 *   node scripts/verify-live-facts.mjs           # probe everything, write record
 *   node scripts/verify-live-facts.mjs --dry-run # probe, print, write nothing
 *
 * Exit status is 0 whenever probing itself succeeded, EVEN IF the values drift
 * — drift is the guard's call, not this script's. A source that cannot be
 * probed at all (404, network failure, markup no longer matching) is a
 * different thing: it exits 1 and names the URL, because a check that silently
 * stops checking is the exact failure this whole mechanism exists to prevent.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { decodeEntities, displayName } from './lib/person-name.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHOOLS_PATH = resolve(ROOT, 'data/schools.json');
const FRESHNESS_PATH = resolve(ROOT, 'data/freshness.json');

const DRY_RUN = process.argv.includes('--dry-run');

/** Path appended to each school's website to reach its leadership listing. */
const LEADERSHIP_PATH = '/our-school/meet-our-school-leadership';
/** District page naming the sitting superintendent. */
const SUPERINTENDENT_URL =
  'https://www.rcsdk8.net/our-programs-and-services/our-superintendent';

/** Per-request ceiling. Twelve schools are probed sequentially. */
const FETCH_TIMEOUT_MS = 30_000;
/** Retries per URL for transient network/5xx failures, then give up loudly. */
const FETCH_RETRIES = 2;

async function fetchText(url) {
  let lastErr;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'user-agent': 'rcsd.info freshness probe (+https://rcsd.info)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`${url}: ${lastErr.message}`);
}

/**
 * Pull `<h2>Name | Title</h2>` pairs out of a Finalsite leadership page.
 * Returns [] when the markup no longer matches, which the caller treats as a
 * probe failure rather than "this school has no principal".
 */
function parseLeadership(html) {
  return [...html.matchAll(/<h2[^>]*>([\s\S]{0,600}?)<\/h2>/g)]
    // A heading may contain more than the byline: several cabinet entries wrap
    // a "Meet Mr. X" link inside the same <h2>, which flattening the whole
    // heading would append to the person's title. So split the heading into
    // its text nodes and take the one that actually carries the "Name | Title"
    // separator, rather than concatenating everything.
    .map(m => {
      const segments = m[1]
        .split(/<[^>]+>/)
        .map(t => decodeEntities(t).replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      return segments.find(t => t.includes('|'))
        // Fall back to the flattened heading when the separator straddles
        // markup, so a restructured page still parses rather than vanishing.
        ?? decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    })
    .filter(t => t.includes('|'))
    .map(t => {
      const idx = t.indexOf('|');
      return { name: t.slice(0, idx).trim(), title: t.slice(idx + 1).trim() };
    })
    .filter(p => p.name && p.title);
}

/** The one person whose title is exactly "Principal" (not Assistant/Vice). */
function pickPrincipal(people) {
  return people.find(p => /^principal$/i.test(p.title)) || null;
}

/**
 * The Office of the Superintendent page uses the SAME `<h2>Name | Title</h2>`
 * construction as the school leadership pages, and lists the superintendent
 * followed by the cabinet and directors. So it reuses parseLeadership rather
 * than pattern-matching prose.
 *
 * An earlier draft here scanned tag-stripped page text for a name adjacent to
 * the word "Superintendent". It matched "Trustees Meeting Calendar" out of the
 * nav — a confident, entirely wrong answer. Structural extraction from a known
 * element beats regexing flattened text; if the structure goes away, that is a
 * loud probe failure rather than a plausible-looking wrong name.
 */
function pickSuperintendent(people) {
  return people.find(p => /^superintendent$/i.test(p.title)) || null;
}

const observations = [];
const failures = [];

// --- Principals -------------------------------------------------------------
const schools = JSON.parse(readFileSync(SCHOOLS_PATH, 'utf-8')).schools;
for (const school of schools) {
  const url = `${school.website}${LEADERSHIP_PATH}`;
  try {
    const people = parseLeadership(await fetchText(url));
    if (people.length === 0) {
      throw new Error('no "Name | Title" headings found — page markup changed');
    }
    const principal = pickPrincipal(people);
    if (!principal) {
      throw new Error(`no one titled "Principal" among: ${people.map(p => p.title).join(', ')}`);
    }
    observations.push({
      id: `principal:${school.slug}`,
      kind: 'principal',
      slug: school.slug,
      observed: displayName(principal.name),
      observedRaw: principal.name,
      source: url,
    });
    console.log(`  ${school.slug.padEnd(16)} ${displayName(principal.name)}`);
  } catch (err) {
    failures.push(`principal:${school.slug} — ${err.message}`);
    console.error(`  ${school.slug.padEnd(16)} PROBE FAILED: ${err.message}`);
  }
}

// --- Superintendent and cabinet ---------------------------------------------
try {
  const people = parseLeadership(await fetchText(SUPERINTENDENT_URL));
  if (people.length === 0) {
    throw new Error('no "Name | Title" headings found — page markup changed');
  }
  const supt = pickSuperintendent(people);
  if (!supt) {
    throw new Error(`no one titled exactly "Superintendent" among ${people.length} listed people`);
  }
  observations.push({
    id: 'superintendent:current',
    kind: 'superintendent',
    observed: displayName(supt.name),
    observedRaw: supt.name,
    source: SUPERINTENDENT_URL,
  });
  console.log(`  ${'superintendent'.padEnd(16)} ${displayName(supt.name)}`);

  // Everyone else on the page is the cabinet / director roster. Recorded as a
  // single roster observation because the district page does not distinguish
  // cabinet from directors the way data/trustees.json does.
  const roster = people
    .filter(p => p !== supt)
    .map(p => ({ name: displayName(p.name), title: p.title }));
  observations.push({
    id: 'cabinet:roster',
    kind: 'cabinet',
    observed: roster,
    source: SUPERINTENDENT_URL,
  });
  console.log(`  ${'cabinet'.padEnd(16)} ${roster.length} people listed`);
} catch (err) {
  failures.push(`superintendent:current — ${err.message}`);
  console.error(`  ${'superintendent'.padEnd(16)} PROBE FAILED: ${err.message}`);
}

// --- Record -----------------------------------------------------------------
const prior = existsSync(FRESHNESS_PATH)
  ? JSON.parse(readFileSync(FRESHNESS_PATH, 'utf-8'))
  : {};

const record = {
  _metadata: {
    description:
      'Observations of RCSD-authoritative sources for facts the site publishes. '
      + 'Written by scripts/verify-live-facts.mjs; asserted by scripts/check-freshness.mjs. '
      + 'This file records what the sources SAY, never what the site should say — '
      + 'the published values live in data/schools.json and data/trustees.json.',
    writer: 'scripts/verify-live-facts.mjs',
    asserter: 'scripts/check-freshness.mjs',
  },
  // How stale an observation may be before the guard complains that probing
  // itself has stopped happening. The pipeline runs twice daily, so a week of
  // silence means the probe step is broken, not merely unlucky.
  maxObservationAgeDays: prior.maxObservationAgeDays ?? 7,
  lastRun: {
    probedAt: new Date().toISOString(),
    probed: observations.length,
    failed: failures.length,
    failures,
  },
  observations,
};

if (DRY_RUN) {
  console.log('\n--dry-run: not writing data/freshness.json');
} else {
  writeFileSync(FRESHNESS_PATH, JSON.stringify(record, null, 2) + '\n');
  console.log(`\nWrote ${FRESHNESS_PATH} (${observations.length} observations, ${failures.length} failures).`);
}

if (failures.length > 0) {
  console.error(`\nPROBE FAILED for ${failures.length} source(s) — a source that cannot be read is not a source that agrees.`);
  process.exit(1);
}
