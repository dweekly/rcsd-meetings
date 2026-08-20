#!/usr/bin/env node
/**
 * Extract structured data from SARC (School Accountability Report Card) PDFs.
 *
 * For each of the 12 RCSD schools, reads the 2024-25 SARC PDF, sends it to
 * Claude Haiku via the document content block API, and writes per-school JSON
 * to data/sarc/{slug}.json. Also generates data/sarc-summary.json with key
 * cross-school comparison fields.
 *
 * Usage: node scripts/extract-sarc.mjs [--school slug] [--force]
 *
 * Requires ANTHROPIC_API_KEY in environment.
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SARC_YEAR } from './lib/school-year.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
// SARC source PDFs. Default is the in-repo artifacts location; the historical
// out-of-repo staging path (a sibling nanoclaw checkout) is still honoured as a
// fallback so an existing operator setup keeps working, and either can be
// overridden with --pdf-dir. Year comes from SARC_YEAR — bumping it there is
// the whole February refresh for this script.
const SARC_YEAR_ARG = process.argv.includes('--year')
  ? process.argv[process.argv.indexOf('--year') + 1]
  : SARC_YEAR;
const SARC_PDF_DIR = (() => {
  const i = process.argv.indexOf('--pdf-dir');
  if (i !== -1) return resolve(process.cwd(), process.argv[i + 1]);
  const inRepo = resolve(ROOT, `artifacts/documents/sarc/${SARC_YEAR_ARG}/english`);
  if (existsSync(inRepo)) return inRepo;
  const legacy = resolve(ROOT, `../../nanoclaw/groups/main/rcsd/sarc/${SARC_YEAR_ARG}/english`);
  if (existsSync(legacy)) {
    console.warn(`  Using legacy out-of-repo SARC staging dir: ${legacy}`);
    return legacy;
  }
  throw new Error(
    `No SARC PDFs for ${SARC_YEAR_ARG}. Looked in:\n    ${inRepo}\n    ${legacy}\n`
    + '  Stage the PDFs, pass --pdf-dir <path>, or check SARC_YEAR in scripts/lib/school-year.mjs.',
  );
})();
const OUTPUT_DIR = resolve(ROOT, 'data/sarc');

// All 12 RCSD school slugs — PDF filenames match slugs exactly
const SCHOOL_SLUGS = [
  'adelante-selby', 'clifford', 'garfield', 'henry-ford',
  'hoover', 'kennedy', 'mckinley-mit', 'north-star',
  'orion', 'roosevelt', 'roy-cloud', 'taft',
];

const EXTRACTION_PROMPT = `Extract ALL data from this SARC (School Accountability Report Card) PDF into the exact JSON schema below. Be thorough — include every section, every student group, every year of data shown.

Return ONLY valid JSON (no markdown fences, no commentary). Use null for fields that are not reported or not applicable. Use 0 only when the document explicitly states zero.

All percentage fields (*Pct) are 0–100 floats, not 0–1.

{
  "school": "<full school name>",
  "cdsCode": "<County-District-School code, 14 digits>",
  "fiscalYear": "<fiscal year for expenditure data, e.g. 2022-23>",
  "dataYear": "<school year for enrollment/academic data, e.g. 2023-24>",

  "contact": {
    "principal": "<name>",
    "email": "<email>",
    "phone": "<phone>",
    "address": "<full address>",
    "website": "<url or null>",
    "gradeSpan": "<e.g. K-8>",
    "district": "Redwood City School District",
    "county": "San Mateo"
  },

  "description": "<school description / mission statement text>",

  "enrollment": {
    "total": <number>,
    "byGrade": { "K": <n>, "1": <n>, ... }
  },

  "demographics": {
    "female": <pct>, "male": <pct>,
    "americanIndian": <pct>, "asian": <pct>, "black": <pct>,
    "filipino": <pct>, "hispanicLatino": <pct>, "pacificIslander": <pct>,
    "white": <pct>, "twoOrMoreRaces": <pct>,
    "englishLearners": <pct>,
    "socioeconomicallyDisadvantaged": <pct>,
    "studentsWithDisabilities": <pct>,
    "fosterYouth": <pct>,
    "homeless": <pct>,
    "migrant": <pct>
  },

  "teachers": [
    {
      "year": "<e.g. 2022-23>",
      "totalFTE": <number>,
      "fullyCredentialedPct": <pct>,
      "withoutFullCredentialPct": <pct>,
      "teachingOutsideSubjectPct": <pct>,
      "misassignedTeachersOfELPct": <pct>,
      "misassignedOtherPct": <pct>,
      "totalMisassignedOrVacantPct": <pct>
    }
  ],

  "textbooks": {
    "sufficientForAll": <boolean>,
    "bySubject": [
      { "subject": "<name>", "adopted": "<year>", "publisher": "<name>", "sufficient": <boolean> }
    ]
  },

  "facilities": {
    "inspectionDate": "<YYYY-MM-DD>",
    "overallRating": "<Exemplary|Good|Fair|Poor>",
    "systems": [
      { "system": "<name>", "status": "<Good|Fair|Poor>", "deficiencyFound": <boolean>, "note": "<description or null>" }
    ]
  },

  "caaspp": {
    "ela": [
      { "group": "<student group name>", "tested": <number>, "metExceededPct": <pct>, "exceededPct": <pct or null> }
    ],
    "math": [
      { "group": "<student group name>", "tested": <number>, "metExceededPct": <pct>, "exceededPct": <pct or null> }
    ],
    "science": [
      { "group": "<student group name>", "tested": <number>, "metExceededPct": <pct>, "exceededPct": <pct or null> }
    ]
  },

  "physicalFitness": [
    { "grade": <5 or 7>, "fourOfSixPct": <pct>, "fiveOfSixPct": <pct>, "sixOfSixPct": <pct> }
  ],

  "chronicAbsenteeism": [
    { "group": "<student group name>", "enrolled": <number>, "absentPct": <pct> }
  ],

  "suspensions": {
    "byYear": [
      { "year": "<e.g. 2022-23>", "suspensionRate": <pct>, "expulsionRate": <pct> }
    ],
    "byGroup": [
      { "group": "<student group name>", "suspensionRate": <pct> }
    ]
  },

  "classSize": [
    {
      "year": "<e.g. 2022-23>",
      "byGrade": { "K": <avg>, "1": <avg>, ... },
      "distribution": [
        { "grade": "<K, 1, 2, ...>", "1-20": <count>, "21-32": <count>, "33+": <count> }
      ]
    }
  ],

  "supportStaff": {
    "counselorAcademic": <FTE or null>,
    "counselorGuidance": <FTE or null>,
    "librarian": <FTE or null>,
    "psychologist": <FTE or null>,
    "socialWorker": <FTE or null>,
    "nurse": <FTE or null>,
    "speechPathologist": <FTE or null>,
    "resourceSpecialistNonTeaching": <FTE or null>,
    "other": <FTE or null>
  },

  "expenditures": {
    "schoolSite": {
      "totalPerPupil": <number>,
      "restrictedPerPupil": <number>,
      "unrestrictedPerPupil": <number>,
      "avgTeacherSalary": <number>
    },
    "district": {
      "unrestrictedPerPupil": <number>,
      "avgTeacherSalary": <number>
    },
    "state": {
      "unrestrictedPerPupil": <number>,
      "avgTeacherSalary": <number>
    },
    "pctDiffFromDistrict": { "unrestricted": <pct>, "teacherSalary": <pct> },
    "pctDiffFromState": { "unrestricted": <pct>, "teacherSalary": <pct> }
  },

  "servicesFunded": ["<program name>", ...],

  "salaries": {
    "beginningTeacher": <number>,
    "midRangeTeacher": <number>,
    "highestTeacher": <number>,
    "avgPrincipalElementary": <number>,
    "avgPrincipalMiddle": <number>,
    "superintendent": <number>,
    "pctBudgetTeacherSalaries": <number>,
    "pctBudgetAdminSalaries": <number>
  },

  "professionalDevelopment": {
    "daysPerYear": [<year1>, <year2>, <year3>],
    "focusAreas": ["<area>", ...]
  }
}`;

const client = new Anthropic();

async function extractSchool(slug) {
  const pdfPath = resolve(SARC_PDF_DIR, `${slug}.pdf`);
  if (!existsSync(pdfPath)) {
    console.error(`  PDF not found: ${pdfPath}`);
    return null;
  }

  const outputPath = resolve(OUTPUT_DIR, `${slug}.json`);

  const pdfBase64 = readFileSync(pdfPath).toString('base64');
  const pdfSizeKB = (Buffer.byteLength(pdfBase64, 'base64') / 1024).toFixed(0);
  console.log(`  Reading ${slug}.pdf (${pdfSizeKB} KB)...`);

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16384,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
        },
        { type: 'text', text: EXTRACTION_PROMPT },
      ],
    }],
  });

  const text = response.content[0].text;
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const cost = (inputTokens * 0.8 + outputTokens * 4) / 1_000_000;
  console.log(`  Tokens: ${inputTokens} in / ${outputTokens} out ($${cost.toFixed(4)})`);

  // Parse JSON — strip markdown fences if present
  let json;
  try {
    const cleaned = text.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');
    json = JSON.parse(cleaned);
  } catch (e) {
    console.error(`  Failed to parse JSON for ${slug}: ${e.message}`);
    // Write raw response for debugging
    writeFileSync(resolve(OUTPUT_DIR, `${slug}.raw.txt`), text, 'utf-8');
    return null;
  }

  // Basic validation
  const issues = [];
  if (!json.enrollment?.total || json.enrollment.total < 50) issues.push('enrollment total looks wrong');
  if (!json.expenditures?.schoolSite?.totalPerPupil) issues.push('missing expenditure data');
  if (!json.contact?.principal) issues.push('missing principal');
  if (issues.length) {
    console.warn(`  Warnings for ${slug}: ${issues.join('; ')}`);
  }

  writeFileSync(outputPath, JSON.stringify(json, null, 2) + '\n', 'utf-8');
  console.log(`  Wrote ${outputPath}`);
  return json;
}

async function main() {
  const args = process.argv.slice(2);
  const forceFlag = args.includes('--force');
  const schoolIdx = args.indexOf('--school');
  const singleSchool = schoolIdx !== -1 ? args[schoolIdx + 1] : null;

  if (singleSchool && !SCHOOL_SLUGS.includes(singleSchool)) {
    console.error(`Unknown school slug: ${singleSchool}`);
    console.error(`Valid slugs: ${SCHOOL_SLUGS.join(', ')}`);
    process.exit(1);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const slugsToProcess = singleSchool ? [singleSchool] : SCHOOL_SLUGS;
  const results = {};
  let totalCost = 0;

  for (const slug of slugsToProcess) {
    const outputPath = resolve(OUTPUT_DIR, `${slug}.json`);
    if (!forceFlag && existsSync(outputPath)) {
      console.log(`[${slug}] Already extracted, skipping (use --force to re-extract)`);
      results[slug] = JSON.parse(readFileSync(outputPath, 'utf-8'));
      continue;
    }

    console.log(`[${slug}] Extracting SARC data...`);
    const data = await extractSchool(slug);
    if (data) {
      results[slug] = data;
    }
  }

  // If processing all schools, also load any previously extracted ones for the summary
  if (!singleSchool) {
    for (const slug of SCHOOL_SLUGS) {
      if (!results[slug]) {
        const path = resolve(OUTPUT_DIR, `${slug}.json`);
        if (existsSync(path)) {
          results[slug] = JSON.parse(readFileSync(path, 'utf-8'));
        }
      }
    }
  }

  // Generate summary
  const summarySchools = SCHOOL_SLUGS
    .filter(slug => results[slug])
    .map(slug => {
      const d = results[slug];
      return {
        slug,
        school: d.school,
        enrollment: d.enrollment?.total ?? null,
        demographics: {
          hispanicLatino: d.demographics?.hispanicLatino ?? null,
          white: d.demographics?.white ?? null,
          englishLearners: d.demographics?.englishLearners ?? null,
          socioeconomicallyDisadvantaged: d.demographics?.socioeconomicallyDisadvantaged ?? null,
        },
        expenditures: d.expenditures ?? null,
        caaspp: {
          elaAllStudents: d.caaspp?.ela?.find(g => g.group === 'All Students') ?? null,
          mathAllStudents: d.caaspp?.math?.find(g => g.group === 'All Students') ?? null,
        },
      };
    });

  const summary = {
    generated: new Date().toISOString().slice(0, 10),
    source: '2024-25 SARCs (covering 2023-24 data)',
    schools: summarySchools,
  };

  const summaryPath = resolve(OUTPUT_DIR, 'sarc-summary.json');
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf-8');
  console.log(`\nWrote summary: ${summaryPath}`);
  console.log(`Extracted ${Object.keys(results).length} / ${SCHOOL_SLUGS.length} schools`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
