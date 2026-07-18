#!/usr/bin/env node
/**
 * Translate meeting transcripts from English to plain Californian Spanish.
 *
 * For each slim transcript, sends all utterances to Claude Sonnet for
 * translation, preserving the exact structure (start, end, speaker).
 * Translated text replaces English text; everything else stays the same.
 *
 * Output: artifacts/transcripts-slim/{date}-es.json (cached locally)
 *       → R2 transcripts/{date}-es.json (when --upload is passed)
 *
 * Usage:
 *   node scripts/translate-transcripts.mjs                    # all untranslated
 *   node scripts/translate-transcripts.mjs --date 2026-02-26  # single meeting
 *   node scripts/translate-transcripts.mjs --force            # retranslate all
 *   node scripts/translate-transcripts.mjs --upload           # generate + upload to R2
 *
 * Requires ANTHROPIC_API_KEY in environment.
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SLIM_DIR = resolve(ROOT, 'artifacts/transcripts-slim');

// Identity of the translation *input*: the EN utterance texts. Stored in each
// ES file as _sourceHash so a changed EN transcript invalidates its
// translation; ES files without the field (pre-July-2026) count as stale.
function sourceHash(en) {
  return createHash('sha256').update(JSON.stringify((en.utterances || []).map(u => u.text))).digest('hex').slice(0, 16);
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const doUpload = args.includes('--upload');
const dateFilter = args.includes('--date') ? args[args.indexOf('--date') + 1] : null;
// Cap per-run refreshes of translations whose EN source changed, so a
// corpus-wide re-transcription (July 2026 Universal-3.5 Pro backfill) spreads
// its translation cost across nightly runs instead of one giant API bill.
// Brand-new meetings are never capped.
const maxRefresh = args.includes('--max-refresh') ? parseInt(args[args.indexOf('--max-refresh') + 1], 10) : 25;

const client = new Anthropic();

/**
 * Validation gate: refuse to write or upload a Spanish transcript whose
 * utterance texts aren't all non-empty strings (and, when enUtteranceCount is
 * given, whose utterance count doesn't match the EN source). Model-format
 * drift once wrote {"i","t"} objects into utterance.text on 22 published
 * files, which the transcript viewer renders as "Error al cargar la
 * transcripción." Throws with the offending indices; never write on failure.
 *
 * Pass enUtteranceCount only when es was built from that exact EN source:
 * historic published translations predate EN re-slims (93 of 163 cached
 * -es.json files have a small count drift vs today's EN) yet render fine,
 * since the viewer never pairs EN/ES rows by index.
 */
function assertValidTranslation(es, enUtteranceCount, label) {
  if (!es || !Array.isArray(es.utterances)) {
    throw new Error(`${label}: missing utterances array`);
  }
  if (enUtteranceCount !== null && es.utterances.length !== enUtteranceCount) {
    throw new Error(`${label}: ${es.utterances.length} utterances but EN source has ${enUtteranceCount}`);
  }
  const bad = [];
  es.utterances.forEach((u, i) => {
    if (typeof u.text !== 'string' || u.text.trim() === '') bad.push(i);
  });
  if (bad.length > 0) {
    const shown = bad.slice(0, 20).join(', ');
    throw new Error(`${label}: non-string or empty text at ${bad.length} indices [${shown}${bad.length > 20 ? ', …' : ''}]`);
  }
}

const SYSTEM_PROMPT = `You are a professional translator specializing in plain, accessible Spanish for California communities. You translate English board meeting transcripts into Spanish.

STYLE GUIDELINES:
- Write at a sixth-grade reading level
- Use natural Californian Spanish — the kind spoken by families in Redwood City
- Prefer common borrowed English terms over formal literary Spanish (e.g., "budget" not "presupuesto general", "email" not "correo electrónico", "staff" is fine)
- Keep it conversational, matching the speaker's register (formal for superintendent, casual for parents)
- District jargon stays in English with natural integration: LCAP, SPSA, SARC, CAASPP, IEP, PBIS, MTSS, TK
- School names stay in English: Roosevelt, Hoover, Adelante Selby, McKinley, etc.
- Personal names stay exactly as-is
- "Board" = "Junta" or "Mesa Directiva", "Superintendent" = "Superintendente", "Trustee" = "Miembro de la Junta"
- "Roll call" = "Pasar lista", "Public comment" = "Comentario público"
- Dollar amounts, dates, and numbers stay in their original format

TASK:
You will receive a JSON array of utterances. Each has an index number and English text.
Return a JSON array of the SAME length with the Spanish translation for each utterance, in the same order.
Return ONLY the JSON array, no markdown fences or explanation.

Example input:
[{"i":0,"t":"Good evening, everyone. Let's call the meeting to order."},{"i":1,"t":"Here."}]

Example output:
["Buenas noches a todos. Vamos a iniciar la reunión.","Presente."]`;

async function translateMeeting(date) {
  const enPath = resolve(SLIM_DIR, `${date}.json`);
  const esPath = resolve(SLIM_DIR, `${date}-es.json`);

  if (!existsSync(enPath)) return null;
  const en = JSON.parse(readFileSync(enPath, 'utf-8'));
  if (!en.utterances || en.utterances.length === 0) return 'empty';
  const enHash = sourceHash(en);
  if (!force && existsSync(esPath)) {
    try {
      if (JSON.parse(readFileSync(esPath, 'utf-8'))._sourceHash === enHash) return 'cached';
    } catch { /* unreadable ES: retranslate */ }
  }

  // Build compact input: just index + text
  const input = en.utterances.map((u, i) => ({ i, t: u.text }));
  const inputJson = JSON.stringify(input);

  // For very long transcripts, split into batches
  const MAX_CHARS = 30000; // Translate in medium-sized batches (~30k chars) to optimize speed and stay within output limits
  const batches = [];
  let currentBatch = [];
  let currentSize = 0;

  for (const item of input) {
    const itemSize = JSON.stringify(item).length;
    if (currentSize + itemSize > MAX_CHARS && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }
    currentBatch.push(item);
    currentSize += itemSize;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  const allTranslations = [];
  let totalInput = 0, totalOutput = 0;

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const batchJson = JSON.stringify(batch);

    // Use streaming to handle long requests
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 65536,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: batchJson }],
    });

    const response = await stream.finalMessage();
    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;

    const text = response.content[0].text;
    let translations;
    try {
      // Extract JSON array from response
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('No JSON array in response');
      translations = JSON.parse(match[0]);
    } catch (err) {
      // Try to repair truncated JSON
      let repaired = text;
      const arrMatch = repaired.match(/\[[\s\S]*/);
      if (arrMatch) {
        repaired = arrMatch[0];
        // Remove trailing incomplete string
        repaired = repaired.replace(/,\s*"[^"]*$/, '');
        if (!repaired.endsWith(']')) repaired += ']';
        try {
          translations = JSON.parse(repaired);
        } catch {
          console.error(`  Batch ${b + 1}/${batches.length} FAILED: ${err.message}`);
          // Fill with original English as fallback
          translations = batch.map(item => item.t);
        }
      } else {
        translations = batch.map(item => item.t);
      }
    }

    // The model is asked for a bare string array but sometimes echoes the
    // indexed input format ([{"i":N,"t":"…"}]) instead — un-unwrapped, those
    // objects landed in utterance.text and corrupted 22 published -es.json
    // files through May 2026. Unwrap positionally: observed model output
    // preserves order even when its echoed "i" values drift (+1/+3 offsets in
    // the 2020-08-26 run), so position — not the echoed index — is
    // authoritative. Anything unusable falls back to the English source text,
    // which is valid (just untranslated) rather than corrupt.
    if (translations.length !== batch.length) {
      console.warn(`  ${date} batch ${b + 1}/${batches.length}: model returned ${translations.length} items for ${batch.length} inputs`);
    }
    const fallbackIndices = [];
    let indexDrift = 0;
    const cleanTranslations = batch.map((item, idx) => {
      const val = translations[idx];
      if (typeof val === 'string' && val.trim() !== '') return val;
      if (val !== null && typeof val === 'object') {
        if (typeof val.i === 'number' && val.i !== item.i) indexDrift++;
        const t = [val.t, val.text, val.translation].find(v => typeof v === 'string' && v.trim() !== '');
        if (t !== undefined) return t;
      }
      fallbackIndices.push(item.i);
      return item.t;
    });
    if (indexDrift > 0) {
      console.warn(`  ${date} batch ${b + 1}/${batches.length}: echoed indices drifted on ${indexDrift} items (unwrapped positionally)`);
    }
    if (fallbackIndices.length > 0) {
      const shown = fallbackIndices.slice(0, 10).join(', ');
      console.warn(`  ${date} batch ${b + 1}/${batches.length}: fell back to English for ${fallbackIndices.length} utterances at [${shown}${fallbackIndices.length > 10 ? ', …' : ''}]`);
    }

    allTranslations.push(...cleanTranslations);

    if (batches.length > 1) {
      process.stdout.write(`  batch ${b + 1}/${batches.length} `);
    }
  }

  // Build Spanish transcript with same structure
  const es = {
    ...en,
    lang: 'es',
    translatedFrom: 'en',
    _sourceHash: enHash,
    utterances: en.utterances.map((u, i) => ({
      ...u,
      text: allTranslations[i] || u.text,
    })),
  };

  assertValidTranslation(es, en.utterances.length, `${date}-es`);
  writeFileSync(esPath, JSON.stringify(es));

  const cost = (totalInput * 3 + totalOutput * 15) / 1_000_000;
  return { utterances: en.utterances.length, inputTokens: totalInput, outputTokens: totalOutput, cost };
}

// ---- Main ----

async function checkAndRestoreTranslation(date) {
  const enPath = resolve(SLIM_DIR, `${date}.json`);
  const esPath = resolve(SLIM_DIR, `${date}-es.json`);

  // Ensure SLIM_DIR exists
  if (!existsSync(SLIM_DIR)) {
    mkdirSync(SLIM_DIR, { recursive: true });
  }

  // 1. Try to restore English slim transcript if missing locally
  if (!existsSync(enPath)) {
    try {
      const url = `https://data.rcsd.info/transcripts/${date}.json`;
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        const parsed = JSON.parse(text);
        if (parsed.utterances && parsed.utterances.length > 0) {
          writeFileSync(enPath, JSON.stringify(parsed, null, 2));
          console.log(`  [Cache Restore] Restored English slim transcript for ${date} from CDN`);
        }
      }
    } catch (err) {
      console.warn(`  [Cache Restore] Failed to check English CDN cache for ${date}: ${err.message}`);
    }
  }

  // 2. Try to restore Spanish slim transcript if missing locally
  if (!force && !existsSync(esPath)) {
    try {
      const url = `https://data.rcsd.info/transcripts/${date}-es.json`;
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        const parsed = JSON.parse(text);
        if (parsed.utterances && parsed.utterances.length > 0) {
          // Gate the restore: a corrupt published file must not re-seed the
          // local cache. Count is not checked (see assertValidTranslation).
          assertValidTranslation(parsed, null, `${date}-es (CDN restore)`);
          writeFileSync(esPath, JSON.stringify(parsed, null, 2));
          console.log(`  [Cache Restore] Restored Spanish slim transcript for ${date} from CDN`);
          // no early return: fall through to the hash check below, so a
          // restored translation of a since-changed EN source reads as stale
        }
      }
    } catch (err) {
      console.warn(`  [Cache Restore] Failed to check Spanish CDN cache for ${date}: ${err.message}`);
    }
  }

  if (force || !existsSync(esPath)) return false;
  try {
    const en = JSON.parse(readFileSync(enPath, 'utf-8'));
    const es = JSON.parse(readFileSync(esPath, 'utf-8'));
    return es._sourceHash === sourceHash(en) ? 'cached' : 'stale';
  } catch {
    return 'stale';
  }
}

async function main() {
  // Transcript keys that should have translations: board dates (meetings-data.json) plus
  // committee transcriptKeys (<id>-<date>) from data/committees/*.json. Keys feed straight
  // into translateMeeting() since it builds <key>.json / <key>-es.json paths.
  let dbDates = [];
  try {
    const dataPath = resolve(ROOT, 'data/meetings-data.json');
    if (existsSync(dataPath)) {
      const data = JSON.parse(readFileSync(dataPath, 'utf-8'));
      dbDates = (data.meetings || data)
        .filter(m => m.youtube && m.hasTranscript)
        .map(m => m.date);
    }
  } catch (err) {
    console.warn(`  [Cache Restore] Failed to read meetings-data.json: ${err.message}`);
  }

  const committeesDir = resolve(ROOT, 'data/committees');
  if (existsSync(committeesDir)) {
    for (const file of readdirSync(committeesDir).filter(f => f.endsWith('.json'))) {
      try {
        const c = JSON.parse(readFileSync(resolve(committeesDir, file), 'utf-8'));
        for (const m of c.meetings || []) {
          if (m.youtube && m.hasTranscript && m.transcriptKey) dbDates.push(m.transcriptKey);
        }
      } catch { /* skip unreadable committee file */ }
    }
  }

  // Match board keys (2026-04-30.json) and committee keys (cboc-2026-04-30.json), excluding -es.
  const localFiles = existsSync(SLIM_DIR)
    ? readdirSync(SLIM_DIR)
        .filter(f => f.match(/^(?:[a-z][a-z0-9-]*-)?\d{4}-\d{2}-\d{2}\.json$/) && !f.includes('-es'))
        .map(f => f.replace('.json', ''))
    : [];

  const files = Array.from(new Set([...dbDates, ...localFiles])).sort();

  const toProcess = dateFilter ? files.filter(d => d === dateFilter) : files;
  let translated = 0, cached = 0, errors = 0;
  let totalCost = 0;

  // Filter to uncached; stale refreshes (EN source changed under an existing
  // translation) are capped per run via --max-refresh.
  const needsWork = [];
  let staleQueued = 0;
  let staleDeferred = 0;
  for (const date of toProcess) {
    const state = await checkAndRestoreTranslation(date);
    if (state === 'cached') {
      cached++;
      continue;
    }
    const enPath = resolve(SLIM_DIR, `${date}.json`);
    if (!existsSync(enPath)) continue;
    if (state === 'stale') {
      if (staleQueued >= maxRefresh) {
        staleDeferred++;
        continue;
      }
      staleQueued++;
    }
    needsWork.push(date);
  }

  console.log(`${needsWork.length} to translate (${staleQueued} stale refreshes queued, ${staleDeferred} deferred to later runs, ${cached} cached, ${toProcess.length} total)`);

  // Process in parallel batches of CONCURRENCY
  const CONCURRENCY = 10;
  for (let i = 0; i < needsWork.length; i += CONCURRENCY) {
    const batch = needsWork.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(date => translateMeeting(date)));

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const date = batch[j];
      if (r.status === 'rejected') {
        console.error(`${date}: ERROR ${r.reason?.message || r.reason}`);
        errors++;
        continue;
      }
      const result = r.value;
      if (result === 'cached') { cached++; continue; }
      if (result === null || result === 'empty') continue;
      if (typeof result === 'object') {
        translated++;
        totalCost += result.cost;
        console.log(`${date}: ${result.utterances} utt ($${result.cost.toFixed(3)})`);
      }
    }
    console.log(`  [${Math.min(i + CONCURRENCY, needsWork.length)}/${needsWork.length}] $${totalCost.toFixed(2)} so far`);
  }

  console.log(`\nDone: ${translated} translated, ${cached} cached, ${errors} errors`);
  console.log(`Total cost: $${totalCost.toFixed(2)}`);

  // Upload if requested
  if (doUpload) {
    let uploaded = 0;
    for (const date of toProcess) {
      const esPath = resolve(SLIM_DIR, `${date}-es.json`);
      if (!existsSync(esPath)) continue;
      // Never publish a corrupt file, even from a stale cache.
      try {
        assertValidTranslation(JSON.parse(readFileSync(esPath, 'utf-8')), null, `${date}-es (upload)`);
      } catch (err) {
        console.error(`  Upload BLOCKED for ${date}: ${err.message}`);
        errors++;
        continue;
      }
      try {
        execFileSync('npx', [
          'wrangler', 'r2', 'object', 'put',
          `rcsd-meetings/transcripts/${date}-es.json`,
          '--file', esPath,
          '--content-type', 'application/json',
          '--remote',
        ], { cwd: ROOT, timeout: 30000 });
        uploaded++;
      } catch (err) {
        console.error(`  Upload failed for ${date}: ${err.message}`);
      }
    }
    console.log(`Uploaded ${uploaded} Spanish transcripts to R2`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
