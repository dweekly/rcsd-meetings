#!/usr/bin/env node
/**
 * Extract School Site Council (SSC) membership from SPSA PDFs.
 *
 * Each SPSA PDF contains a "School Site Council Membership" page with:
 * - Composition counts (principal, teachers, staff, parents)
 * - Member names and roles
 * - SSC chairperson and adoption date (on the attestation page)
 *
 * Sends each PDF to Claude Haiku via the document content block API and
 * writes structured JSON. Caches per-school-year results to avoid re-calling.
 *
 * Usage:
 *   node scripts/extract-ssc-membership.mjs                    # all schools, all years
 *   node scripts/extract-ssc-membership.mjs --school orion     # single school, all years
 *   node scripts/extract-ssc-membership.mjs --year 2025-26     # all schools, single year
 *   node scripts/extract-ssc-membership.mjs --force            # re-extract even if cached
 *
 * Requires ANTHROPIC_API_KEY in environment.
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SSC_YEARS } from './lib/school-year.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SPSA_DIR = resolve(ROOT, 'artifacts/documents/spsa');
const CACHE_DIR = resolve(ROOT, 'data/ssc-cache');
const OUTPUT_PATH = resolve(ROOT, 'data/ssc-membership.json');

const SCHOOL_SLUGS = [
  'adelante-selby', 'clifford', 'garfield', 'henry-ford',
  'hoover', 'kennedy', 'mckinley-mit', 'north-star',
  'orion', 'roosevelt', 'roy-cloud', 'taft',
];

const YEARS = SSC_YEARS;

const EXTRACTION_PROMPT = `Extract the School Site Council (SSC) membership data from this SPSA PDF.

Look for the "School Site Council Membership" section, which contains:
1. A composition summary (e.g. "1 School Principal, 4 Classroom Teachers, 2 Other School Staff, 6 Parent or Community Members")
2. A table of member names and roles
3. On the "Recommendations and Assurances" page: the SSC Chairperson name and the date the SPSA was adopted

Return ONLY valid JSON (no markdown fences, no commentary):

{
  "school": "<full school name from PDF footer/header>",
  "schoolYear": "<e.g. 2025-26, from the School Year field on page 1>",
  "composition": {
    "principal": <number, usually 1>,
    "classroomTeachers": <number>,
    "otherStaff": <number>,
    "parentCommunity": <number>
  },
  "members": [
    {
      "name": "<full name exactly as written>",
      "role": "<one of: principal, classroomTeacher, otherStaff, parentCommunity>"
    }
  ],
  "chairperson": "<name of SSC Chairperson from the Recommendations and Assurances attestation, or null if not found>",
  "adoptionDate": "<ISO date (YYYY-MM-DD) when the SPSA was adopted by the SSC, from the attestation page, or null>"
}

Role mapping:
- "Principal" → "principal"
- "Classroom Teacher" → "classroomTeacher"
- "Other School Staff" → "otherStaff"
- "Parent or Community Member" → "parentCommunity"

Important:
- Extract ALL members listed in the table — do not skip any
- Preserve exact name spelling from the PDF
- The chairperson is identified on the attestation/assurances page, NOT the membership table
- If the SSC membership section is not found, return null for all fields except school and schoolYear`;

const client = new Anthropic();

async function extractSSC(slug, year) {
  const pdfPath = resolve(SPSA_DIR, year, `${slug}.pdf`);
  if (!existsSync(pdfPath)) {
    console.error(`  PDF not found: ${pdfPath}`);
    return null;
  }

  const pdfBase64 = readFileSync(pdfPath).toString('base64');
  const pdfSizeKB = (Buffer.byteLength(pdfBase64, 'base64') / 1024).toFixed(0);
  console.log(`  Reading ${slug}.pdf ${year} (${pdfSizeKB} KB)...`);

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
  // Haiku 4.5 pricing: $0.80/M input, $4/M output
  const cost = (inputTokens * 0.8 + outputTokens * 4) / 1_000_000;
  console.log(`  Tokens: ${inputTokens} in / ${outputTokens} out ($${cost.toFixed(4)})`);

  let json;
  try {
    const cleaned = text.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');
    json = JSON.parse(cleaned);
  } catch (e) {
    console.error(`  Failed to parse JSON for ${slug} ${year}: ${e.message}`);
    const rawPath = resolve(CACHE_DIR, year, `${slug}.raw.txt`);
    mkdirSync(dirname(rawPath), { recursive: true });
    writeFileSync(rawPath, text, 'utf-8');
    console.error(`  Raw response saved to ${rawPath}`);
    return null;
  }

  // Basic validation
  const issues = [];
  if (!json.members || json.members.length === 0) issues.push('no members found');
  if (!json.composition) issues.push('no composition data');
  if (json.members) {
    const validRoles = ['principal', 'classroomTeacher', 'otherStaff', 'parentCommunity'];
    const badRoles = json.members.filter(m => !validRoles.includes(m.role));
    if (badRoles.length) issues.push(`invalid roles: ${badRoles.map(m => m.role).join(', ')}`);
  }
  if (issues.length) {
    console.warn(`  Warnings for ${slug} ${year}: ${issues.join('; ')}`);
  }

  return json;
}

async function main() {
  const args = process.argv.slice(2);
  const forceFlag = args.includes('--force');
  const schoolIdx = args.indexOf('--school');
  const singleSchool = schoolIdx !== -1 ? args[schoolIdx + 1] : null;
  const yearIdx = args.indexOf('--year');
  const singleYear = yearIdx !== -1 ? args[yearIdx + 1] : null;

  if (singleSchool && !SCHOOL_SLUGS.includes(singleSchool)) {
    console.error(`Unknown school slug: ${singleSchool}`);
    console.error(`Valid slugs: ${SCHOOL_SLUGS.join(', ')}`);
    process.exit(1);
  }

  if (singleYear && !YEARS.includes(singleYear)) {
    console.error(`Unknown year: ${singleYear}`);
    console.error(`Valid years: ${YEARS.join(', ')}`);
    process.exit(1);
  }

  const slugsToProcess = singleSchool ? [singleSchool] : SCHOOL_SLUGS;
  const yearsToProcess = singleYear ? [singleYear] : YEARS;

  // Build consolidated result — start from existing file if present
  let consolidated = {};
  if (existsSync(OUTPUT_PATH)) {
    consolidated = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
  }

  let totalCost = 0;
  let extracted = 0;
  let skipped = 0;

  for (const slug of slugsToProcess) {
    for (const year of yearsToProcess) {
      const cachePath = resolve(CACHE_DIR, year, `${slug}.json`);
      mkdirSync(dirname(cachePath), { recursive: true });

      // Check cache
      if (!forceFlag && existsSync(cachePath)) {
        console.log(`[${slug} ${year}] Cached, skipping (use --force to re-extract)`);
        const cached = JSON.parse(readFileSync(cachePath, 'utf-8'));
        if (!consolidated[slug]) consolidated[slug] = {};
        consolidated[slug][year] = cached;
        skipped++;
        continue;
      }

      // Check PDF exists
      const pdfPath = resolve(SPSA_DIR, year, `${slug}.pdf`);
      if (!existsSync(pdfPath)) {
        console.log(`[${slug} ${year}] No PDF found, skipping`);
        skipped++;
        continue;
      }

      console.log(`[${slug} ${year}] Extracting SSC membership...`);
      const data = await extractSSC(slug, year);
      if (data) {
        // Cache the result
        writeFileSync(cachePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');

        // Add to consolidated (strip school/schoolYear from per-year entry — redundant with keys)
        if (!consolidated[slug]) consolidated[slug] = {};
        consolidated[slug][year] = data;
        extracted++;
      }
    }
  }

  // Write consolidated output with metadata
  const output = {
    _metadata: {
      description: 'School Site Council membership extracted from SPSA PDFs',
      source: 'SPSA documents at artifacts/documents/spsa/',
      extractionMethod: 'Claude Haiku via document content block API',
      lastUpdated: new Date().toISOString().slice(0, 10),
    },
  };

  // Add schools in slug order
  for (const slug of SCHOOL_SLUGS) {
    if (consolidated[slug]) {
      output[slug] = consolidated[slug];
    }
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf-8');
  console.log(`\nWrote ${OUTPUT_PATH}`);
  console.log(`Extracted: ${extracted}, Skipped: ${skipped}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
