#!/usr/bin/env node
/**
 * Download and process CDE (California Department of Education) bulk data files
 * for Redwood City School District schools.
 *
 * Downloads tab-delimited TXT files from CDE, caches them in artifacts/cde/,
 * filters to RCSD schools (county 41, district 69005), and writes per-dataset
 * JSON to data/cde/.
 *
 * Usage:
 *   node scripts/pull-cde-data.mjs                          # all datasets
 *   node scripts/pull-cde-data.mjs --dataset absenteeism    # single dataset
 *   node scripts/pull-cde-data.mjs --force                  # re-download cached files
 *   node scripts/pull-cde-data.mjs --force --dataset ltel   # re-download + process one
 *   node scripts/pull-cde-data.mjs --dataset staff-ratios --year 2025-26
 *                                                          # ingest a NEWER year than
 *                                                          # the one in CDE_DATA_YEARS,
 *                                                          # which you then bump
 *
 * Data sources:
 *   - Chronic Absenteeism: https://www.cde.ca.gov/ds/ad/filesabd.asp
 *   - Staff Ethnicity/Race: https://www.cde.ca.gov/ds/ad/filessp.asp
 *   - Staff Experience: https://www.cde.ca.gov/ds/ad/filessp.asp
 *   - Long-Term English Learners: https://dq.cde.ca.gov/dataquest/longtermel/
 *   - Staff Ratios: https://www.cde.ca.gov/ds/ad/filessp.asp
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync} from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CDE_DATA_YEARS } from './lib/school-year.mjs';
import { datasetFor, CDE_DATASET_NAMES } from './lib/cde-datasets.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CACHE_DIR = resolve(ROOT, 'artifacts/cde');
const OUTPUT_DIR = resolve(ROOT, 'data/cde');
const SCHOOLS_PATH = resolve(ROOT, 'data/schools.json');

// RCSD identifiers in CDE files
const COUNTY_CODE = '41';
const DISTRICT_CODE = '69005';

const DATASETS = Object.fromEntries(
  CDE_DATASET_NAMES.map((name) => [name, datasetFor(name, CDE_DATA_YEARS[name])]),
);

// ---------------------------------------------------------------------------
// Column name maps for each CDE file format
//
// CDE files use human-readable column headers with spaces. These maps
// translate from the actual headers (verified against downloaded files)
// to short keys used internally.
// ---------------------------------------------------------------------------

// Shared columns across absenteeism and staff files (space-separated headers)
const COL = {
  // Common columns (absenteeism, staff-ethnicity, staff-experience, staff-ratios)
  aggLevel:     'Aggregate Level',
  countyCode:   'County Code',
  districtCode: 'District Code',
  schoolCode:   'School Code',
  schoolName:   'School Name',
  charter:      'Charter School',
  dass:         'DASS',

  // Staff-specific
  staffType:    'Staff Type',
  gradeSpan:    'School Grade Span',
  staffGender:  'Staff Gender',

  // Absenteeism
  reportCat:    'Reporting Category',
  absEnrolled:  'ChronicAbsenteeismEligibleCumulativeEnrollment',
  absCount:     'ChronicAbsenteeismCount',
  absRate:      'ChronicAbsenteeismRate',

  // Staff ethnicity (race columns)
  totalStaff:   'Total Staff',
  africanAm:    'African American',
  amIndian:     'American Indian or Alaska Native',
  asian:        'Asian',
  filipino:     'Filipino',
  hispanicLat:  'Hispanic or Latino',
  pacIslander:  'Pacific Islander',
  white:        'White',
  twoOrMore:    'Two or More Races',
  notReported:  'Not Reported',

  // Staff experience
  totalStaffCount: 'Total Staff Count',
  avgYrsTotal:  'Average Total Years Experience',
  avgYrsDist:   'Average District Years Experience',
  experienced:  'Experienced',
  inexperienced:'Inexperienced',
  firstYear:    'First Year',
  secondYear:   'Second Year',

  // Staff ratios (use SCREAMING_SNAKE column names from the actual file)
  totalEnrN:    'TOTAL_ENR_N',
  tchFteN:      'TCH_FTE_N',
  admFteN:      'ADM_FTE_N',
  psvFteN:      'PSV_FTE_N',
  stuTchRatio:  'STU_TCH_RATIO',
  stuAdmRatio:  'STU_ADM_RATIO',
  stuPsvRatio:  'STU_PSV_RATIO',
};

// LTEL file uses different naming (no spaces, camelCase)
const LTEL_COL = {
  aggLevel:     'AggLevel',
  countyCode:   'CountyCode',
  districtCode: 'DistrictCode',
  schoolCode:   'SchoolCode',
  gender:       'Gender',
  totalEnroll:  'TotalEnrollment',
  el:           'EL',
  rfep:         'RFEP',
  ar:           'AR',
  ltel:         'LTEL',
  el4plus:      'EL4+',
  el03y:        'EL03Y',
  el45y:        'EL45Y',
  el6plusY:     'EL6+Y',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a map from 7-digit school code to slug, using schools.json CDS codes.
 * CDS code format: CCDDDDDSSSSSSS (2-digit county + 5-digit district + 7-digit school)
 */
function buildSchoolCodeMap() {
  const schoolsData = JSON.parse(readFileSync(SCHOOLS_PATH, 'utf-8'));
  const map = {};
  for (const school of schoolsData.schools) {
    if (!school.cdsCode) continue;
    // Extract last 7 digits as the school code
    const schoolCode = school.cdsCode.slice(7);
    map[schoolCode] = school.slug;
  }
  return map;
}

/**
 * Parse a tab-delimited string into an array of objects.
 * Handles quoted fields (fields wrapped in double quotes may contain tabs/newlines).
 * Returns { headers: string[], rows: object[] }.
 */
function parseTSV(text) {
  // Normalize line endings
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Split into lines, handling quoted fields that may contain newlines
  const lines = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '"') {
      // Check for escaped quote (doubled)
      if (inQuotes && i + 1 < normalized.length && normalized[i + 1] === '"') {
        current += '"';
        i++; // skip the second quote
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
    } else if (ch === '\n' && !inQuotes) {
      if (current.trim()) lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);

  if (lines.length === 0) return { headers: [], rows: [] };

  // Parse header row
  const headers = splitTSVLine(lines[0]);

  // Parse data rows
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = splitTSVLine(lines[i]);
    if (fields.length === 0) continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = j < fields.length ? fields[j] : '';
    }
    rows.push(obj);
  }

  return { headers, rows };
}

/** Split a single TSV line on tabs, stripping surrounding quotes from fields. */
function splitTSVLine(line) {
  return line.split('\t').map(field => {
    let f = field.trim();
    if (f.startsWith('"') && f.endsWith('"')) {
      f = f.slice(1, -1).replace(/""/g, '"');
    }
    return f;
  });
}

/**
 * Parse a numeric string from CDE data.
 * Returns null for empty strings, "*" (privacy-suppressed), or non-numeric values.
 */
function parseNum(val) {
  if (val === undefined || val === null || val === '' || val === '*') return null;
  const trimmed = String(val).trim();
  if (trimmed === '' || trimmed === '*') return null;
  const n = Number(trimmed);
  return Number.isNaN(n) ? null : n;
}

/**
 * Safely get a trimmed field value from a row. Handles trailing whitespace that
 * sometimes appears in CDE data (e.g. "No " with trailing space).
 */
function field(row, key) {
  const v = row[key];
  return v !== undefined ? String(v).trim() : '';
}

/**
 * Download a file from a URL, following redirects.
 * Returns the response body as text.
 */
async function downloadFile(url) {
  console.log(`  Downloading: ${url}`);
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      // Some CDE endpoints check for a browser-like user agent
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) rcsd.info data pipeline',
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
  }
  return response.text();
}

/**
 * Ensure a cached copy of a dataset file exists, downloading if needed.
 * Returns the file contents as a string.
 */
async function ensureCached(dataset, force) {
  const cachePath = resolve(CACHE_DIR, dataset.cacheFile);
  mkdirSync(CACHE_DIR, { recursive: true });

  if (!force && existsSync(cachePath)) {
    console.log(`  Using cached: ${cachePath}`);
    return readFileSync(cachePath, 'utf-8');
  }

  const text = await downloadFile(dataset.url);
  writeFileSync(cachePath, text, 'utf-8');
  const sizeKB = (Buffer.byteLength(text, 'utf-8') / 1024).toFixed(0);
  console.log(`  Saved ${sizeKB} KB to ${cachePath}`);
  return text;
}

/**
 * Write a processed JSON output file with standard metadata.
 */
function writeOutput(dataset, datasetName, data) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = resolve(OUTPUT_DIR, dataset.outputFile);

  const output = {
    _metadata: {
      description: dataset.description,
      source: dataset.url,
      dataYear: dataset.year,
      downloadDate: new Date().toISOString().slice(0, 10),
      fileStructure: dataset.fileStructure,
      pipeline: `scripts/pull-cde-data.mjs --dataset ${datasetName} --year ${dataset.year}`,
    },
    ...data,
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf-8');
  const keys = Object.keys(data);
  console.log(`  Wrote ${outputPath} (${keys.length} entries: ${keys.join(', ')})`);
}

/**
 * Resolve a school code to a slug, trying zero-padded variants.
 * Returns the slug or null if unknown.
 */
function resolveSlug(code, schoolCodeMap) {
  const trimmed = String(code).trim();
  if (schoolCodeMap[trimmed]) return schoolCodeMap[trimmed];
  // Try zero-padded to 7 digits
  const padded = trimmed.padStart(7, '0');
  if (schoolCodeMap[padded]) return schoolCodeMap[padded];
  return null;
}

// ---------------------------------------------------------------------------
// Per-dataset processors
// ---------------------------------------------------------------------------

/**
 * Process chronic absenteeism data.
 *
 * Actual file columns (verified from chronicabsenteeism25-v2.txt):
 *   Academic Year, Aggregate Level, County Code, District Code, School Code,
 *   County Name, District Name, School Name, Charter School, DASS,
 *   Reporting Category, ChronicAbsenteeismEligibleCumulativeEnrollment,
 *   ChronicAbsenteeismCount, ChronicAbsenteeismRate
 *
 * School-level rows have Charter School = "Yes" or "No" (not "All").
 * District-level aggregates have Charter School = "All", DASS = "All".
 * We take all school-level rows matching our county/district (excluding charters).
 */
function processAbsenteeism(rows, schoolCodeMap) {
  // School-level: take RCSD schools, exclude charters (Charter School = "No")
  const filtered = rows.filter(r =>
    field(r, COL.aggLevel) === 'S' &&
    field(r, COL.countyCode) === COUNTY_CODE &&
    field(r, COL.districtCode) === DISTRICT_CODE &&
    field(r, COL.charter) === 'No'
  );

  console.log(`  Filtered to ${filtered.length} RCSD school-level rows (non-charter)`);

  // District-level aggregate rows (Charter="All", DASS="All")
  const districtRows = rows.filter(r =>
    field(r, COL.aggLevel) === 'D' &&
    field(r, COL.countyCode) === COUNTY_CODE &&
    field(r, COL.districtCode) === DISTRICT_CODE &&
    field(r, COL.charter) === 'All' &&
    field(r, COL.dass) === 'All'
  );

  const result = {};

  // Process district aggregate
  if (districtRows.length > 0) {
    result.district = {};
    for (const row of districtRows) {
      const category = field(row, COL.reportCat) || 'unknown';
      result.district[category] = {
        enrolled: parseNum(row[COL.absEnrolled]),
        count: parseNum(row[COL.absCount]),
        rate: parseNum(row[COL.absRate]),
      };
    }
  }

  // Group school rows by school code
  const bySchool = {};
  for (const row of filtered) {
    const code = field(row, COL.schoolCode);
    if (!bySchool[code]) bySchool[code] = [];
    bySchool[code].push(row);
  }

  for (const [code, schoolRows] of Object.entries(bySchool)) {
    const slug = resolveSlug(code, schoolCodeMap);
    if (!slug) {
      console.warn(`  Warning: unknown school code ${code} (${schoolRows[0]?.[COL.schoolName]})`);
      continue;
    }
    result[slug] = {};
    for (const row of schoolRows) {
      const category = field(row, COL.reportCat) || 'unknown';
      result[slug][category] = {
        enrolled: parseNum(row[COL.absEnrolled]),
        count: parseNum(row[COL.absCount]),
        rate: parseNum(row[COL.absRate]),
      };
    }
  }

  return result;
}

/**
 * Process staff ethnicity/race data.
 *
 * Actual file columns (verified from stre2425.txt):
 *   Academic Year, Aggregate Level, County Code, District Code, School Code,
 *   County Name, District Name, School Name, Charter School, DASS,
 *   Staff Type, School Grade Span, Staff Gender,
 *   Total Staff, African American, American Indian or Alaska Native, Asian,
 *   Filipino, Hispanic or Latino, Pacific Islander, White,
 *   Two or More Races, Not Reported
 *
 * Staff files use "ALL"/"N"/"Y" (not "All"/"No"/"Yes").
 * Filter: school-level, TCH (teachers), ALL grade spans, ALL genders, ALL charter, ALL DASS.
 */
function processStaffEthnicity(rows, schoolCodeMap) {
  // School-level: filter to teachers (TCH), all genders combined (ALL).
  // At school level, Charter/DASS/GradeSpan are specific values (N/Y, GS_K6, etc),
  // not "ALL". "ALL" aggregates only appear at district level.
  const filtered = rows.filter(r =>
    field(r, COL.aggLevel) === 'S' &&
    field(r, COL.countyCode) === COUNTY_CODE &&
    field(r, COL.districtCode) === DISTRICT_CODE &&
    field(r, COL.staffType) === 'TCH' &&
    field(r, COL.staffGender) === 'ALL' &&
    field(r, COL.charter) === 'N'
  );

  console.log(`  Filtered to ${filtered.length} RCSD rows (school level, teachers, gender=ALL, non-charter)`);

  // District aggregate: uses "ALL" for charter/DASS/span at D level
  const districtRows = rows.filter(r =>
    field(r, COL.aggLevel) === 'D' &&
    field(r, COL.countyCode) === COUNTY_CODE &&
    field(r, COL.districtCode) === DISTRICT_CODE &&
    field(r, COL.staffType) === 'TCH' &&
    field(r, COL.gradeSpan) === 'ALL' &&
    field(r, COL.staffGender) === 'ALL' &&
    field(r, COL.charter) === 'ALL' &&
    field(r, COL.dass) === 'ALL'
  );

  const result = {};

  function buildEthnicityObj(row) {
    return {
      total: parseNum(row[COL.totalStaff]),
      africanAmerican: parseNum(row[COL.africanAm]),
      americanIndian: parseNum(row[COL.amIndian]),
      asian: parseNum(row[COL.asian]),
      filipino: parseNum(row[COL.filipino]),
      hispanicLatino: parseNum(row[COL.hispanicLat]),
      pacificIslander: parseNum(row[COL.pacIslander]),
      white: parseNum(row[COL.white]),
      twoOrMore: parseNum(row[COL.twoOrMore]),
      notReported: parseNum(row[COL.notReported]),
    };
  }

  if (districtRows.length > 0) {
    result.district = buildEthnicityObj(districtRows[0]);
  }

  for (const row of filtered) {
    const slug = resolveSlug(field(row, COL.schoolCode), schoolCodeMap);
    if (!slug) {
      console.warn(`  Warning: unknown school code ${field(row, COL.schoolCode)} (${row[COL.schoolName]})`);
      continue;
    }
    result[slug] = buildEthnicityObj(row);
  }

  return result;
}

/**
 * Process staff experience data.
 *
 * Actual file columns (verified from stex2425.txt):
 *   Academic Year, Aggregate Level, County Code, District Code, School Code,
 *   County Name, District Name, School Name, Charter School, DASS,
 *   Staff Type, School Grade Span, Staff Gender,
 *   Total Staff Count, Average Total Years Experience,
 *   Average District Years Experience, Experienced, Inexperienced,
 *   First Year, Second Year
 *
 * Same filter logic as staff-ethnicity.
 */
function processStaffExperience(rows, schoolCodeMap) {
  // School-level: teachers, gender=ALL. No Charter/DASS/Span filter at school level.
  const filtered = rows.filter(r =>
    field(r, COL.aggLevel) === 'S' &&
    field(r, COL.countyCode) === COUNTY_CODE &&
    field(r, COL.districtCode) === DISTRICT_CODE &&
    field(r, COL.staffType) === 'TCH' &&
    field(r, COL.staffGender) === 'ALL' &&
    field(r, COL.charter) === 'N'
  );

  console.log(`  Filtered to ${filtered.length} RCSD rows (school level, teachers, gender=ALL, non-charter)`);

  // District aggregate
  const districtRows = rows.filter(r =>
    field(r, COL.aggLevel) === 'D' &&
    field(r, COL.countyCode) === COUNTY_CODE &&
    field(r, COL.districtCode) === DISTRICT_CODE &&
    field(r, COL.staffType) === 'TCH' &&
    field(r, COL.gradeSpan) === 'ALL' &&
    field(r, COL.staffGender) === 'ALL' &&
    field(r, COL.charter) === 'ALL' &&
    field(r, COL.dass) === 'ALL'
  );

  const result = {};

  function buildExperienceObj(row) {
    return {
      total: parseNum(row[COL.totalStaffCount]),
      avgYearsTotal: parseNum(row[COL.avgYrsTotal]),
      avgYearsDistrict: parseNum(row[COL.avgYrsDist]),
      experienced: parseNum(row[COL.experienced]),
      inexperienced: parseNum(row[COL.inexperienced]),
      firstYear: parseNum(row[COL.firstYear]),
      secondYear: parseNum(row[COL.secondYear]),
    };
  }

  if (districtRows.length > 0) {
    result.district = buildExperienceObj(districtRows[0]);
  }

  for (const row of filtered) {
    const slug = resolveSlug(field(row, COL.schoolCode), schoolCodeMap);
    if (!slug) {
      console.warn(`  Warning: unknown school code ${field(row, COL.schoolCode)} (${row[COL.schoolName]})`);
      continue;
    }
    result[slug] = buildExperienceObj(row);
  }

  return result;
}

/**
 * Process Long-Term English Learner (LTEL) data.
 *
 * Actual file columns (verified from ltel-2024-25.txt):
 *   AcademicYear, CountyCode, DistrictCode, SchoolCode, CountyName,
 *   DistrictName, SchoolName, Charter, AggLevel, Grade, Gender,
 *   EO, IFEP, EL, RFEP, TBD, TotalEnrollment, AR, LTEL,
 *   EL4+, EL03Y, EL45Y, EL6+Y, Total-EE
 *
 * Note: One row per school x grade x gender, where Gender is ALL, F, or M and
 * the ALL row already equals F + M (verified in ltel-2024-25.txt; there is no
 * all-grades aggregate row — grades run TK-08 individually). So school/district
 * totals must sum ONLY the Gender=ALL rows across grades; summing every row
 * double-counts (this bug shipped doubled counts until 2026-06-10).
 */
function processLTEL(rows, schoolCodeMap) {
  if (rows.length === 0) {
    console.warn('  No LTEL rows found');
    return {};
  }

  const L = LTEL_COL;

  // Filter to school-level RCSD rows. Gender=ALL only: the ALL row already
  // aggregates F + M for each grade, so including F/M rows double-counts.
  const filtered = rows.filter(r =>
    field(r, L.aggLevel) === 'S' &&
    field(r, L.countyCode) === COUNTY_CODE &&
    field(r, L.districtCode) === DISTRICT_CODE &&
    field(r, L.gender) === 'ALL'
  );

  console.log(`  Filtered to ${filtered.length} RCSD school-level rows (Gender=ALL)`);

  // District-level rows (same Gender=ALL rule)
  const districtFiltered = rows.filter(r =>
    field(r, L.aggLevel) === 'D' &&
    field(r, L.countyCode) === COUNTY_CODE &&
    field(r, L.districtCode) === DISTRICT_CODE &&
    field(r, L.gender) === 'ALL'
  );

  const result = {};

  // Sum numeric fields across all grade x gender rows for a set of rows
  function sumRows(rowSet) {
    const sums = {
      totalEnrollment: 0,
      el: 0,
      rfep: 0,
      atRisk: 0,
      ltel: 0,
      el4plus: 0,
      el03y: 0,
      el45y: 0,
      el6plusY: 0,
    };

    for (const row of rowSet) {
      const add = (key, col) => {
        const val = parseNum(row[col]);
        if (val !== null) sums[key] += val;
      };
      add('totalEnrollment', L.totalEnroll);
      add('el', L.el);
      add('rfep', L.rfep);
      add('atRisk', L.ar);
      add('ltel', L.ltel);
      add('el4plus', L.el4plus);
      add('el03y', L.el03y);
      add('el45y', L.el45y);
      add('el6plusY', L.el6plusY);
    }

    return sums;
  }

  // District aggregate
  if (districtFiltered.length > 0) {
    result.district = sumRows(districtFiltered);
  }

  // Group school rows by school code
  const bySchool = {};
  for (const row of filtered) {
    const code = field(row, L.schoolCode);
    if (!bySchool[code]) bySchool[code] = [];
    bySchool[code].push(row);
  }

  for (const [code, schoolRows] of Object.entries(bySchool)) {
    const slug = resolveSlug(code, schoolCodeMap);
    if (!slug) {
      console.warn(`  Warning: unknown school code ${code} in LTEL data`);
      continue;
    }
    result[slug] = sumRows(schoolRows);
  }

  return result;
}

/**
 * Process staff ratios data.
 *
 * Actual file columns (verified from strat2425.txt):
 *   Academic Year, Aggregate Level, County Code, District Code, School Code,
 *   County Name, District Name, School Name, Charter School, DASS,
 *   School Grade Span, TOTAL_ENR_N, TCH_FTE_N, ADM_FTE_N, PSV_FTE_N,
 *   OTH_FTE_N, STU_TCH_RATIO, STU_ADM_RATIO, STU_PSV_RATIO, STU_OTH_RATIO
 *
 * Staff files use "ALL"/"N"/"Y" for charter/DASS/grade span.
 * Filter: school-level, ALL grade spans, ALL charter, ALL DASS.
 */
function processStaffRatios(rows, schoolCodeMap) {
  // School-level: no GradeSpan/Charter/DASS filter (those are specific values at S level)
  const filtered = rows.filter(r =>
    field(r, COL.aggLevel) === 'S' &&
    field(r, COL.countyCode) === COUNTY_CODE &&
    field(r, COL.districtCode) === DISTRICT_CODE &&
    field(r, COL.charter) === 'N'
  );

  console.log(`  Filtered to ${filtered.length} RCSD rows (school level, non-charter)`);

  // District aggregate uses "ALL" for span/charter/DASS
  const districtRows = rows.filter(r =>
    field(r, COL.aggLevel) === 'D' &&
    field(r, COL.countyCode) === COUNTY_CODE &&
    field(r, COL.districtCode) === DISTRICT_CODE &&
    field(r, COL.gradeSpan) === 'ALL' &&
    field(r, COL.charter) === 'ALL' &&
    field(r, COL.dass) === 'ALL'
  );

  const result = {};

  function buildRatioObj(row) {
    return {
      enrollment: parseNum(row[COL.totalEnrN]),
      teacherFTE: parseNum(row[COL.tchFteN]),
      adminFTE: parseNum(row[COL.admFteN]),
      pupilServicesFTE: parseNum(row[COL.psvFteN]),
      studentTeacherRatio: parseNum(row[COL.stuTchRatio]),
      studentAdminRatio: parseNum(row[COL.stuAdmRatio]),
      studentPupilServicesRatio: parseNum(row[COL.stuPsvRatio]),
    };
  }

  if (districtRows.length > 0) {
    result.district = buildRatioObj(districtRows[0]);
  }

  for (const row of filtered) {
    const slug = resolveSlug(field(row, COL.schoolCode), schoolCodeMap);
    if (!slug) {
      console.warn(`  Warning: unknown school code ${field(row, COL.schoolCode)} (${row[COL.schoolName]})`);
      continue;
    }
    result[slug] = buildRatioObj(row);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const PROCESSORS = {
  'absenteeism': processAbsenteeism,
  'staff-ethnicity': processStaffEthnicity,
  'staff-experience': processStaffExperience,
  'ltel': processLTEL,
  'staff-ratios': processStaffRatios,
};

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const datasetIdx = args.indexOf('--dataset');
  const singleDataset = datasetIdx !== -1 ? args[datasetIdx + 1] : null;
  // --year is what makes an annual refresh possible at all. Without it this
  // script could only ever re-fetch the year already recorded in
  // CDE_DATA_YEARS, so "pull the new release, then bump the constant" had no
  // first step: the pull would fetch the OLD year and write the OLD filename.
  const yearIdx = args.indexOf('--year');
  const targetYear = yearIdx !== -1 ? args[yearIdx + 1] : null;

  if (singleDataset && !CDE_DATASET_NAMES.includes(singleDataset)) {
    console.error(`Unknown dataset: ${singleDataset}`);
    console.error(`Valid datasets: ${CDE_DATASET_NAMES.join(', ')}`);
    process.exit(1);
  }
  if (targetYear && !/^\d{4}-\d{2}$/.test(targetYear)) {
    console.error(`--year must look like 2025-26, got: ${targetYear}`);
    process.exit(1);
  }
  if (targetYear && !singleDataset) {
    // CDE releases the five datasets separately, so a blanket --year would
    // request years that do not exist for some of them.
    console.error('--year requires --dataset: CDE publishes each dataset on its own schedule.');
    process.exit(1);
  }

  // Build school code -> slug map
  const schoolCodeMap = buildSchoolCodeMap();
  const slugCount = Object.keys(schoolCodeMap).length;
  console.log(`Loaded ${slugCount} school code mappings from schools.json`);

  const datasetsToProcess = singleDataset
    ? { [singleDataset]: targetYear ? datasetFor(singleDataset, targetYear) : DATASETS[singleDataset] }
    : DATASETS;

  if (targetYear) {
    console.log(
      `Pulling ${singleDataset} for ${targetYear} (currently ingested: ${CDE_DATA_YEARS[singleDataset]}).\n`
      + `After this succeeds, set CDE_DATA_YEARS['${singleDataset}'] = '${targetYear}' in `
      + 'scripts/lib/school-year.mjs, rebuild, and confirm the numbers moved.',
    );
  }

  // A failed ingest must not exit 0: CDE sits behind bot protection that blocks
  // downloads for stretches, and a caller (or an operator following the annual
  // refresh steps) cannot otherwise tell a completed ingest from one that wrote
  // nothing at all.
  const failed = [];

  for (const [name, dataset] of Object.entries(datasetsToProcess)) {
    console.log(`\n=== ${name} (${dataset.year}) ===`);

    // Download / cache
    let text;
    try {
      text = await ensureCached(dataset, force);
    } catch (err) {
      console.error(`  Download failed: ${err.message}`);
      failed.push(name);
      continue;
    }

    // Parse TSV
    const { headers, rows } = parseTSV(text);
    console.log(`  Parsed ${rows.length} total rows, ${headers.length} columns`);
    // A header-only body is how DataQuest says "that year has no data" — it
    // answers HTTP 200 for ANY year, so this is a successful download of
    // nothing. Writing it would produce a metadata-only JSON that reads like a
    // completed ingest and lets an operator bump CDE_DATA_YEARS onto empty data.
    if (rows.length === 0) {
      console.error(
        `  No data rows for ${name} ${dataset.year} — the source returned headers only, `
        + 'which means that year is not published yet.',
      );
      // Discard the cached body. It is a valid HTTP 200 as far as ensureCached
      // is concerned, so keeping it would poison every later attempt: once the
      // year IS published, the next run would "use cached", find zero rows
      // again, and fail without ever asking the server. Retrying must not need
      // --force to escape a cache that was never data.
      const stalePath = resolve(CACHE_DIR, dataset.cacheFile);
      if (existsSync(stalePath)) {
        unlinkSync(stalePath);
        console.error(`  Discarded empty cached response ${stalePath}`);
      }
      failed.push(`${name} (${dataset.year}: no rows)`);
      continue;
    }
    if (headers.length > 0) {
      console.log(`  Columns: ${headers.slice(0, 8).join(', ')}${headers.length > 8 ? ', ...' : ''}`);
    }

    // Process
    const processor = PROCESSORS[name];
    const data = processor(rows, schoolCodeMap);

    // Write output
    writeOutput(dataset, name, data);
  }

  if (failed.length) {
    console.error(
      `\nFAILED to ingest ${failed.length} dataset(s): ${failed.join(', ')}.\n`
      + '  Nothing was written for them. CDE is behind bot protection that blocks\n'
      + '  downloads for stretches — wait and retry before concluding the release\n'
      + '  is unavailable. See docs/ANNUAL-REFRESH.md.',
    );
    process.exit(1);
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
