/**
 * One definition per year-scoped fact.
 *
 * Before this file, the school year was written out as a literal in a dozen
 * places — five CDE filenames, the SARC directory, the SPSA directory, an SSC
 * year list, page titles, source notes — and each had to be found and changed by
 * hand. They drifted: `build-schools.mjs` cited "2022-23 SARC" for per-pupil
 * expenditure while its own header comment said 2024-25.
 *
 * Every constant here records what it means, where its value comes from, and
 * what tells you it is time to change it. Do not add a bare year to this file.
 *
 * IMPORTANT: these constants describe **the data we have ingested**, not the
 * newest data that exists. Bumping a year here without ingesting the matching
 * files makes the build fail (by design — see loadYearScopedJson below). The
 * CDE availability probe in verify-live-facts.mjs is what tells you a newer
 * year has been published.
 */

import { readFileSync, existsSync } from 'fs';

/**
 * The school year currently in session, used for page titles and "current year"
 * copy. RCSD's year runs mid-August to early June, so the rollover is keyed to
 * August: on/after Aug 1, the year that starts in this calendar year.
 *
 * Derived rather than hardcoded because it is the one value that is knowable
 * from the date alone — everything else below depends on an external
 * publication and must be set by hand.
 */
export function currentSchoolYear(now = new Date()) {
  const y = now.getFullYear();
  const startYear = now.getMonth() >= 7 ? y : y - 1;  // getMonth() 7 = August
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * CDE bulk data, per dataset, because CDE does NOT release them together.
 * Verified against CDE 2026-08-19: the three staff files had published 2025-26
 * while chronic absenteeism had not (its 2025-26 URL returned 404). Staff files
 * land in the fall; absenteeism and LTEL lag further.
 *
 * The year here is the year INGESTED into data/cde/. To move it: run
 * `node scripts/pull-cde-data.mjs --dataset <name> --year <new-year>`, confirm
 * the output, then bump this entry. See docs/ANNUAL-REFRESH.md.
 */
export const CDE_DATA_YEARS = {
  absenteeism: '2024-25',
  ltel: '2024-25',
  'staff-ethnicity': '2024-25',
  'staff-experience': '2024-25',
  'staff-ratios': '2024-25',
};

/**
 * School Accountability Report Cards. Published each February for the PRIOR
 * school year, so the 2024-25 SARC reports on 2023-24 outcomes — the SARC year
 * and the year of the data inside it are deliberately different, and pages
 * should say which they mean.
 */
export const SARC_YEAR = '2024-25';

/** Single Plan for Student Achievement, board-approved each fall. */
export const SPSA_YEAR = '2025-26';

/**
 * School Site Council rosters, kept per year rather than replaced: an SSC roster
 * is a point-in-time record of who approved a given SPSA, so old years stay
 * meaningful and legitimately name people who have since moved on. Append, do
 * not replace.
 */
export const SSC_YEARS = ['2023-24', '2024-25', '2025-26'];

/**
 * LCAP (Local Control and Accountability Plan), adopted each June.
 *
 * Separate from SPSA_YEAR even when the two currently read the same, because
 * they are adopted on different schedules by different bodies. Collapsing
 * independent facts onto one constant is the same defect as writing the year
 * out by hand — it just fails less visibly.
 */
export const LCAP_YEAR = '2025-26';

/**
 * The year of the per-school Board of Trustees data presentations that supply
 * i-Ready growth figures (see scripts/extract-ireadyu-growth.mjs). Schools
 * present on a rolling schedule through the spring, so this moves when those
 * presentations are re-extracted — NOT when the SPSA or LCAP year moves.
 */
export const IREADY_YEAR = '2025-26';

/**
 * California School Dashboard reporting year, used in caschooldashboard.org
 * report URLs. Released each December.
 */
export const CA_DASHBOARD_YEAR = '2024';

/** Path to an ingested CDE dataset for the year we actually hold. */
export function cdeDatasetPath(rootDir, dataset) {
  const year = CDE_DATA_YEARS[dataset];
  if (!year) {
    throw new Error(
      `Unknown CDE dataset "${dataset}". Known: ${Object.keys(CDE_DATA_YEARS).join(', ')}. `
      + 'Add it to CDE_DATA_YEARS in scripts/lib/school-year.mjs.',
    );
  }
  return `${rootDir}/data/cde/${dataset}-${year}.json`;
}

/**
 * Read a year-scoped dataset, failing LOUDLY when it is not there.
 *
 * The pattern this replaces was `try { ...readFileSync... } catch { return {} }`
 * around each of the five CDE files. A renamed file — which is exactly what a
 * year bump does — made every school page render without absenteeism, LTEL, and
 * staffing data. No error, no failing test, no visible gap: the sections simply
 * did not appear. The same shape cost this project 36 SARC links on the district
 * page in August 2026.
 *
 * An empty dataset is a legitimate state ONLY if you say so explicitly, via
 * `optional: true`, and then it is logged rather than silent.
 */
export function loadYearScopedJson(path, { what, optional = false } = {}) {
  if (!existsSync(path)) {
    const msg =
      `Missing ${what ?? 'dataset'}: ${path}\n`
      + '  This is almost always a school-year bump that changed the filename without an ingest.\n'
      + '  Run the matching pull/extract script, or correct the year in scripts/lib/school-year.mjs.\n'
      + '  See docs/ANNUAL-REFRESH.md.';
    if (optional) {
      console.warn(`  WARNING: ${msg}`);
      return {};
    }
    throw new Error(msg);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    // Malformed JSON is never an acceptable silent empty — that would render a
    // page that looks complete and is not.
    throw new Error(`${what ?? 'Dataset'} at ${path} is not valid JSON: ${err.message}`);
  }
}

/** The school year before `year`: "2024-25" -> "2023-24". */
export function priorSchoolYear(year) {
  const start = Number(year.slice(0, 4));
  return `${start - 1}-${String(start % 100).padStart(2, '0')}`;
}
