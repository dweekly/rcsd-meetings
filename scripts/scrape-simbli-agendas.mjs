#!/usr/bin/env node
/**
 * Scrape full structured agendas from Simbli meeting pages.
 * Uses Chrome DevTools MCP (via fetch) to navigate to each meeting page
 * and extract the agenda HTML from the DOM.
 *
 * For now, this is a MANUAL-ASSIST script: it outputs the Simbli meeting URLs
 * that need scraping. The actual scraping will be done interactively via Chrome
 * DevTools MCP since Simbli uses Incapsula/hCaptcha bot protection.
 *
 * Usage: node scripts/scrape-simbli-agendas.mjs
 *
 * Input: data/meetings-data.json (for Simbli meeting list)
 * Output: data/simbli-scraped.json
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const dataPath = resolve(ROOT, 'data/meetings-data.json');
const outPath = resolve(ROOT, 'data/simbli-scraped.json');

if (!existsSync(dataPath)) {
  console.error('meetings-data.json not found. Run build-meetings.mjs first.');
  process.exit(1);
}

const data = JSON.parse(readFileSync(dataPath, 'utf-8'));
const simbliMeetings = data.meetings.filter(m => m.source === 'simbli');

console.log(`Found ${simbliMeetings.length} Simbli meetings\n`);

// Load existing scraped data if available (for incremental scraping)
let existing = {};
if (existsSync(outPath)) {
  try {
    const prev = JSON.parse(readFileSync(outPath, 'utf-8'));
    existing = Object.fromEntries(prev.map(m => [m.date, m]));
    console.log(`Loaded ${Object.keys(existing).length} previously scraped meetings\n`);
  } catch { /* ignore */ }
}

// List meetings that need scraping
const needsScraping = simbliMeetings.filter(m => !existing[m.date]);

if (needsScraping.length === 0) {
  console.log('All Simbli meetings already scraped!');
  process.exit(0);
}

console.log(`${needsScraping.length} meetings need scraping:\n`);
for (const m of needsScraping) {
  console.log(`  ${m.date} ${m.type} (MID ${m.mid})`);
  console.log(`    ${m.simbli}`);
  console.log(`    Items so far: ${m.items.length}`);
  console.log();
}

console.log(`\nTo scrape these meetings interactively, use Chrome DevTools MCP:`);
console.log(`  1. Open Chrome and navigate to a Simbli meeting URL`);
console.log(`  2. Use the MCP snapshot tool to extract the agenda`);
console.log(`  3. Save results to ${outPath}`);
console.log(`\nAlternatively, run with --from-transcripts to extract agenda items from YouTube transcripts.`);

// If --from-transcripts flag, try to extract from transcripts
if (process.argv.includes('--from-transcripts')) {
  console.log('\n--- Extracting from transcripts not yet implemented ---');
  console.log('For now, using existing hand-curated items from meetings-data.json');

  // Save existing items as-is (they're already in meetings-data.json)
  const output = simbliMeetings.map(m => ({
    date: m.date,
    type: m.type,
    mid: m.mid,
    items: m.items,
    source: 'hand-curated'
  }));

  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Wrote ${output.length} meetings to ${outPath}`);
}
