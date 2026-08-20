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
 * Decide whether a CDE year is actually published, from the status AND the
 * start of the body.
 *
 * Status alone is not enough, and assuming it was would have failed the build
 * for no reason. CDE serves its bulk .txt files from a static path that 404s a
 * year it does not have, but DataQuest serves LTEL from
 * `lteldnld.aspx?year=…`, which answers **HTTP 200 for any year you ask for** —
 * verified 2026-08-20, where 2030-31 returned 200 with a 190-byte
 * header-only body while 2024-25 returned 27 MB. Reading that as "published"
 * would have reported LTEL as two release cycles behind and failed the build.
 *
 * So a year counts as published only when the response carries at least one row
 * beneath the header. Anything ambiguous is `'unknown'` and reports nothing:
 * CDE also sits behind Radware bot protection that answers 303/403 under load,
 * and "I could not tell" must not read as either answer.
 *
 * @param status HTTP status.
 * @param bodySample First few KB of the body, or null if it could not be read.
 */
export function classifyAvailability(status, bodySample = null) {
  if (status === 404) return false;
  if (status !== 200 && status !== 206) return 'unknown';
  if (bodySample == null) return 'unknown';
  return hasDataRows(bodySample);
}

/**
 * True when a tab-delimited sample has content beyond its header line. A
 * header-only response is CDE/DataQuest's way of saying "that year has no
 * data", not an error.
 */
export function hasDataRows(sample) {
  const lines = String(sample).split(/\r?\n/).filter((l) => l.trim() !== '');
  return lines.length > 1;
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
