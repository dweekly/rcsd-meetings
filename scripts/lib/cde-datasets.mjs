/**
 * CDE bulk-download URL derivation, kept separate from the puller so other
 * scripts (the freshness probe) can ask "what would next year's URL be?"
 * without importing a module that starts downloading on load.
 */

/**
 * CDE encodes the school year directly in each filename, so every dataset needs
 * its URL, cache filename, and output filename rebuilt when the year moves. The
 * year itself lives in scripts/lib/school-year.mjs (CDE_DATA_YEARS), per dataset
 * because CDE does NOT release them together — verified 2026-08-19, when the
 * three staff files had published 2025-26 and chronic absenteeism had not.
 *
 * Year encodings, from the observed URLs:
 *   staff files  "2024-25" -> "2425"     (both years, 2 digits each)
 *   absenteeism  "2024-25" -> "25"       (end year only, plus a "-v2" revision
 *                                         suffix CDE has used since 2023-24)
 *   LTEL         "2024-25" -> "2024-25"  (query parameter, verbatim)
 */
const yearPair = (year) => year.replace('-', '').slice(2);   // 2024-25 -> 2425
const yearEnd = (year) => year.slice(-2);                     // 2024-25 -> 25

const DATASET_SPECS = {
  'absenteeism': {
    file: (y) => `chronicabsenteeism${yearEnd(y)}-v2.txt`,
    base: 'https://www3.cde.ca.gov/demo-downloads/attendance/',
    description: 'Chronic absenteeism rates by school and student group',
    fileStructure: 'https://www.cde.ca.gov/ds/ad/fsabd.asp',
  },
  'staff-ethnicity': {
    file: (y) => `stre${yearPair(y)}.txt`,
    base: 'https://www3.cde.ca.gov/demo-downloads/staff/',
    description: 'Staff ethnicity/race counts by school (teachers)',
    fileStructure: 'https://www.cde.ca.gov/ds/ad/fsspre.asp',
  },
  'staff-experience': {
    file: (y) => `stex${yearPair(y)}.txt`,
    base: 'https://www3.cde.ca.gov/demo-downloads/staff/',
    description: 'Staff experience levels by school (teachers)',
    fileStructure: 'https://www.cde.ca.gov/ds/ad/fsspex.asp',
  },
  'staff-ratios': {
    file: (y) => `strat${yearPair(y)}.txt`,
    base: 'https://www3.cde.ca.gov/demo-downloads/staff/',
    description: 'Student-to-staff ratios by school',
    fileStructure: 'https://www.cde.ca.gov/ds/ad/fssprat.asp',
  },
  'ltel': {
    // DataQuest serves this from a query parameter rather than a filename.
    file: (y) => `ltel-${y}.txt`,
    url: (y) => `https://dq.cde.ca.gov/dataquest/longtermel/lteldnld.aspx?year=${y}`,
    description: 'Long-term English learner counts by school',
    fileStructure: 'https://dq.cde.ca.gov/dataquest/longtermel/',
  },
};

/** Build the concrete dataset config for a given year. */
export function datasetFor(name, year) {
  const spec = DATASET_SPECS[name];
  if (!spec) throw new Error(`Unknown CDE dataset "${name}"`);
  const file = spec.file(year);
  return {
    url: spec.url ? spec.url(year) : spec.base + file,
    cacheFile: file,
    outputFile: `${name}-${year}.json`,
    year,
    description: spec.description,
    fileStructure: spec.fileStructure,
  };
}


/** Dataset names this project ingests. */
export const CDE_DATASET_NAMES = Object.keys(DATASET_SPECS);

/**
 * The school year after `year`. CDE years are contiguous, so this is just +1 on
 * both halves: "2024-25" -> "2025-26".
 */
export function nextSchoolYear(year) {
  const start = Number(year.slice(0, 4));
  return `${start + 1}-${String((start + 2) % 100).padStart(2, '0')}`;
}

/**
 * Map an HTTP status from a CDE bulk-download URL to whether that year exists.
 *
 * Deliberately asymmetric. CDE sits behind Radware bot protection that answers
 * 303 (and sometimes 403) once you have made a few requests — observed
 * 2026-08-19/20 from a single workstation, against both fetch and curl. Reading
 * "I was blocked" as "no newer data" would hide a real annual refresh; reading
 * it as "newer data exists" would raise an alarm nobody can act on. So only a
 * 200/206 counts as published and only a 404 counts as absent; everything else
 * is `'unknown'` and reports nothing.
 */
export function classifyAvailability(status) {
  if (status === 200 || status === 206) return true;
  if (status === 404) return false;
  return 'unknown';
}

/**
 * How many release cycles behind we are, given which candidate years came back
 * as published. Used to decide advisory vs. build-failing: a year that has just
 * dropped is a nudge, but being two cycles behind means a whole annual refresh
 * was missed, which is the thing this project exists to stop.
 */
export function cyclesBehind(availabilityByYear) {
  return Object.values(availabilityByYear).filter((v) => v === true).length;
}
