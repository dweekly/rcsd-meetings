#!/usr/bin/env node
/**
 * Fill the Spanish side of data/governance-calendar.json.
 *
 * `extract-governance-calendar.py` writes the English provisional-topic line for
 * each scheduled meeting and carries forward any Spanish already on file. This
 * translates whatever is still missing, so a re-extraction after the district
 * updates its Schedule only pays for the meetings whose topics actually changed.
 *
 * Spanish is not optional here: build-homepage.mjs, build-meetings-html.mjs and
 * build-ics.mjs all read `provisionalTopics[date].es`, and an entry without it
 * renders English text on a Spanish page.
 *
 *   node scripts/translate-governance-calendar.mjs           # translate what is missing
 *   node scripts/translate-governance-calendar.mjs --check    # exit 1 if any are missing
 *   node scripts/translate-governance-calendar.mjs --force    # retranslate everything
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import Anthropic from '@anthropic-ai/sdk';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CALENDAR = resolve(ROOT, 'data/governance-calendar.json');

// No date suffix on Claude model ids (claude-api skill). Matches the model the
// rest of the repo's translation scripts pin.
const MODEL = 'claude-sonnet-5';
// A meeting's topic line can run past 200 characters and Spanish runs longer than
// English, so a whole school year in one request overruns the output budget. It
// truncates mid-array, which is why the response is checked for truncation before
// it is parsed: a cut-off array has no closing bracket and would otherwise surface
// as a confusing "no JSON array" error.
const MAX_TOKENS = 8192;
const BATCH_SIZE = 8;

const SYSTEM = `You translate board-meeting agenda topics for a California school
district's public website, from English into Spanish.

Register: sixth-grade Californian Spanish, the way Redwood City families actually
speak. Colloquial, not literary. Prefer the borrowed English term where families
use it (LCAP, SPSA, charter, i-Ready, MTSS, SARC, dashboard) rather than inventing
a Spanish equivalent. Keep proper nouns, programme names, acronyms, budget-year
ranges (26/27) and figures exactly as given.

Each input is one meeting's topics joined by "; ". Preserve that structure: same
number of segments, same order, same separator.

Return only a JSON array of translated strings, one per input, no commentary.`;

function parseArgs() {
  const argv = process.argv.slice(2);
  return { check: argv.includes('--check'), force: argv.includes('--force') };
}

async function translate(client, batch) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(batch.map((b) => b.en), null, 0) }],
  });
  if (response.stop_reason === 'max_tokens') {
    throw new Error(`response hit max_tokens (${MAX_TOKENS}) and was truncated; `
      + `lower BATCH_SIZE (currently ${BATCH_SIZE})`);
  }
  const text = response.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`no JSON array in response: ${text.slice(0, 200)}`);
  const out = JSON.parse(match[0]);
  if (out.length !== batch.length) {
    throw new Error(`asked for ${batch.length} translations, got ${out.length}`);
  }
  return { translations: out, usage: response.usage, resolved: response.model };
}

async function main() {
  const { check, force } = parseArgs();
  const doc = JSON.parse(readFileSync(CALENDAR, 'utf-8'));
  const topics = doc.provisionalTopics ?? {};

  const missing = Object.entries(topics)
    .filter(([, v]) => v.en && (force || !v.es))
    .map(([date, v]) => ({ date, en: v.en }));

  if (check) {
    if (missing.length === 0) {
      console.log('  Spanish provisional topics: complete.');
      return 0;
    }
    console.error(`  ${missing.length} meeting(s) have no Spanish provisional topic:`);
    missing.forEach((m) => console.error(`    ${m.date}`));
    console.error('  Run: node scripts/translate-governance-calendar.mjs');
    return 1;
  }

  if (missing.length === 0) {
    console.log('  Nothing to translate.');
    return 0;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('  ANTHROPIC_API_KEY is not set; cannot translate.');
    return 1;
  }

  const client = new Anthropic();
  let inputTokens = 0;
  let outputTokens = 0;
  let resolvedModel = null;

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    const { translations, usage, resolved } = await translate(client, batch);
    batch.forEach((item, index) => { topics[item.date].es = translations[index]; });
    inputTokens += usage.input_tokens;
    outputTokens += usage.output_tokens;
    resolvedModel ??= resolved;
    console.log(`  translated ${batch.length} (${i + batch.length}/${missing.length})`);
  }

  doc._translation = {
    provider: 'anthropic',
    model: { requested: MODEL, resolved: resolvedModel },
    translated: new Date().toISOString().slice(0, 10),
    note: 'Machine translation of provisional agenda topics. The English Schedule of '
      + 'Agenda Items is the authoritative source.',
  };
  writeFileSync(CALENDAR, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`  tokens: ${inputTokens} in / ${outputTokens} out; model resolved to ${resolvedModel}`);
  console.log(`  wrote data/governance-calendar.json`);
  return 0;
}

process.exit(await main());
