#!/usr/bin/env node
/**
 * Extract budget summary data from SPSA PDFs.
 *
 * Each SPSA PDF has a "Budget Summary" page with a breakdown of funding
 * by source (Title I, District, PTO/PTA, Measure U, Prop 28, etc.).
 * Extracts these into structured JSON to replace hardcoded values.
 *
 * Usage:
 *   node scripts/extract-spsa-budgets.mjs                    # all schools
 *   node scripts/extract-spsa-budgets.mjs --school orion     # single school
 *   node scripts/extract-spsa-budgets.mjs --force            # re-extract
 *
 * Requires ANTHROPIC_API_KEY in environment.
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SPSA_YEAR } from './lib/school-year.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SPSA_DIR = resolve(ROOT, `artifacts/documents/spsa/${SPSA_YEAR}`);
const CACHE_DIR = resolve(ROOT, 'data/spsa-budget-cache');
const OUTPUT_PATH = resolve(ROOT, 'data/spsa-budgets.json');

const SCHOOL_SLUGS = [
  'adelante-selby', 'clifford', 'garfield', 'henry-ford',
  'hoover', 'kennedy', 'mckinley-mit', 'north-star',
  'orion', 'roosevelt', 'roy-cloud', 'taft',
];

const EXTRACTION_PROMPT = `Extract the Budget Summary data from this SPSA PDF.

Look for the "Budget Summary" section near the end of the document. It contains:
1. A top-level budget summary table with "Total Funds Budgeted for Strategies to Meet the Goals in the SPSA"
2. An "Other Federal, State, and Local Funds" section with line items and allocations

Return ONLY valid JSON (no markdown fences, no commentary):

{
  "school": "<full school name from PDF>",
  "schoolYear": "<e.g. 2025-26>",
  "consolidatedAppFunds": <number or 0, from "Total Funds Provided to the School Through the Consolidated Application">,
  "csiFunds": <number or 0, from "Total Federal Funds Provided to the School from the LEA for CSI">,
  "totalBudgeted": <number, from "Total Funds Budgeted for Strategies to Meet the Goals in the SPSA">,
  "federalPrograms": [
    { "name": "<program name>", "amount": <number> }
  ],
  "stateLocalPrograms": [
    { "name": "<program name>", "amount": <number> }
  ]
}

Important:
- Extract exact dollar amounts as numbers (no $ signs, no commas)
- Include ALL line items from both federal and state/local tables
- If a table is empty, use an empty array []
- The "Total Funds Budgeted" number should equal the sum of all line items`;

const client = new Anthropic();

async function extractBudget(slug) {
  const pdfPath = resolve(SPSA_DIR, `${slug}.pdf`);
  if (!existsSync(pdfPath)) {
    console.error(`  PDF not found: ${pdfPath}`);
    return null;
  }

  const pdfBase64 = readFileSync(pdfPath).toString('base64');
  const pdfSizeKB = (Buffer.byteLength(pdfBase64, 'base64') / 1024).toFixed(0);
  console.log(`  Reading ${slug}.pdf (${pdfSizeKB} KB)...`);

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
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

  let json;
  try {
    const cleaned = text.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');
    json = JSON.parse(cleaned);
  } catch (e) {
    console.error(`  Failed to parse JSON for ${slug}: ${e.message}`);
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(resolve(CACHE_DIR, `${slug}.raw.txt`), text, 'utf-8');
    return null;
  }

  // Validate
  if (!json.totalBudgeted) {
    console.warn(`  Warning: no totalBudgeted for ${slug}`);
  }

  return json;
}

// Map extracted line items to our funding categories
function categorizeFunding(data) {
  let titleI = 0;
  let district = 0;
  let ptoPta = 0;
  let measureU = 0;
  let prop28 = 0;
  let other = 0;

  const allItems = [...(data.federalPrograms || []), ...(data.stateLocalPrograms || [])];

  for (const item of allItems) {
    const name = (item.name || '').toLowerCase();
    const amt = item.amount || 0;
    if (amt === 0) continue;

    if (name.includes('title i') || name.includes('title 1')) {
      titleI += amt;
    } else if (name.includes('parent teacher') || name.includes('pta') || name.includes('pto') || name.includes('ptso') || name.includes('pfc')) {
      ptoPta += amt;
    } else if (name.includes('measure u') || name.includes('parcel tax')) {
      measureU += amt;
    } else if (name.includes('prop') && name.includes('28')) {
      prop28 += amt;
    } else if (name.includes('district') || name.includes('atsi') || name.includes('d100') || name.includes('site improvement') || name.includes('site formula')) {
      district += amt;
    } else {
      // Catch-all: district-adjacent funds
      district += amt;
    }
  }

  return {
    spsaTotal: Math.round(data.totalBudgeted || 0),
    titleI: Math.round(titleI),
    district: Math.round(district),
    ptoPta: Math.round(ptoPta),
    measureU: Math.round(measureU),
    prop28: Math.round(prop28),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const forceFlag = args.includes('--force');
  const schoolIdx = args.indexOf('--school');
  const singleSchool = schoolIdx !== -1 ? args[schoolIdx + 1] : null;

  if (singleSchool && !SCHOOL_SLUGS.includes(singleSchool)) {
    console.error(`Unknown school slug: ${singleSchool}`);
    process.exit(1);
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  const slugsToProcess = singleSchool ? [singleSchool] : SCHOOL_SLUGS;

  const results = {};

  for (const slug of slugsToProcess) {
    const cachePath = resolve(CACHE_DIR, `${slug}.json`);

    if (!forceFlag && existsSync(cachePath)) {
      // The cache filename has no year in it, so after SPSA_YEAR is bumped the
      // prior year's extraction still matches this path. Without this check the
      // annual refresh would silently republish last year's budgets and report
      // success. Compare the year the record says it holds.
      const cached = JSON.parse(readFileSync(cachePath, 'utf-8'));
      if (cached.schoolYear === SPSA_YEAR) {
        console.log(`[${slug}] Cached, skipping (use --force to re-extract)`);
        results[slug] = cached;
        continue;
      }
      console.log(`[${slug}] Cache holds ${cached.schoolYear}, need ${SPSA_YEAR} — re-extracting`);
    }

    console.log(`[${slug}] Extracting SPSA budget...`);
    const data = await extractBudget(slug);
    if (data) {
      writeFileSync(cachePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
      results[slug] = data;
    }
  }

  // Load any cached results we didn't process this run — but ONLY if they are
  // for the year we are publishing. Without the year check, a refresh where the
  // new PDFs are missing or extraction fails would fall through to here, reload
  // last year's records, and publish them under _metadata.schoolYear of the NEW
  // year: a completed-looking run whose contents are the previous year's.
  const staleSlugs = [];
  if (!singleSchool) {
    for (const slug of SCHOOL_SLUGS) {
      if (!results[slug]) {
        const cachePath = resolve(CACHE_DIR, `${slug}.json`);
        if (!existsSync(cachePath)) continue;
        const cached = JSON.parse(readFileSync(cachePath, 'utf-8'));
        if (cached.schoolYear === SPSA_YEAR) results[slug] = cached;
        else staleSlugs.push(`${slug} (has ${cached.schoolYear})`);
      }
    }
  }
  if (staleSlugs.length) {
    console.error(
      `\nFAILED: no ${SPSA_YEAR} SPSA budget for ${staleSlugs.length} school(s): ${staleSlugs.join(', ')}.\n`
      + `  Refusing to publish a ${SPSA_YEAR} dataset containing prior-year records.\n`
      + `  Stage the ${SPSA_YEAR} PDFs in artifacts/documents/spsa/${SPSA_YEAR}/ and re-run.`,
    );
    process.exit(1);
  }

  // Build output with categorized funding
  const output = {
    _metadata: {
      description: `SPSA budget summaries extracted from ${SPSA_YEAR} SPSA PDFs`,
      source: `Budget Summary pages in artifacts/documents/spsa/${SPSA_YEAR}/`,
      schoolYear: SPSA_YEAR,
      extractionMethod: 'Claude Haiku via document content block API',
      lastUpdated: new Date().toISOString().slice(0, 10),
    },
  };

  console.log('\n=== CATEGORIZED FUNDING COMPARISON ===\n');
  console.log('School'.padEnd(18), 'Total'.padStart(10), 'Title I'.padStart(10), 'District'.padStart(10), 'PTO/PTA'.padStart(10), 'Measure U'.padStart(10), 'Prop 28'.padStart(10));
  console.log('-'.repeat(88));

  for (const slug of SCHOOL_SLUGS) {
    if (!results[slug]) continue;
    const cat = categorizeFunding(results[slug]);
    output[slug] = { raw: results[slug], categorized: cat };

    console.log(
      slug.padEnd(18),
      `$${(cat.spsaTotal/1000).toFixed(0)}K`.padStart(10),
      `$${(cat.titleI/1000).toFixed(0)}K`.padStart(10),
      `$${(cat.district/1000).toFixed(0)}K`.padStart(10),
      `$${(cat.ptoPta/1000).toFixed(0)}K`.padStart(10),
      `$${(cat.measureU/1000).toFixed(0)}K`.padStart(10),
      `$${(cat.prop28/1000).toFixed(0)}K`.padStart(10),
    );
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf-8');
  console.log(`\nWrote ${OUTPUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
