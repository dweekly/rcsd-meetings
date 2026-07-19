#!/usr/bin/env node
/**
 * Translate board policy TITLES (and section names) to Spanish via the
 * Claude API, for the /politicas/ interactive browser.
 *
 * Input:  data/policies-index.json (from scrape-board-policies.mjs)
 * Output: data/policy-titles-es.json
 *   {
 *     _metadata: { source, method, model, generatedAt, note },
 *     sections:  { "0000": { en, es }, ... },   // keyed by section code
 *     titles:    { "0100-BP": { en, es }, ... } // keyed by `${code}-${type}`
 *   }
 *
 * Idempotent: deterministic batches are reused only when their source titles
 * and full LLM cache fingerprint (model, SDK, parameters, prompts, schema,
 * locale, safety, and processing settings) match. Legacy cache entries without
 * invocation provenance are upgraded on the next deliberate run. Use --force
 * to retranslate everything.
 *
 * Duplicate English titles (e.g. "Dress And Grooming" appears under four
 * codes) are translated once and fanned out, so wording stays consistent.
 *
 * Requires ANTHROPIC_API_KEY (.env).
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import {
  buildLlmCacheFingerprint,
  getInstalledPackageVersion,
  hashCanonicalJson,
  PROVENANCE_SCHEMA_VERSION,
  sha256,
  validateLlmInvocation,
} from './lib/provenance.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const INDEX_PATH = resolve(ROOT, 'data', 'policies-index.json');
const OUTPUT_PATH = resolve(ROOT, 'data', 'policy-titles-es.json');
const SDK_VERSION = getInstalledPackageVersion('@anthropic-ai/sdk', import.meta.url);

const FORCE = process.argv.includes('--force');

// Task spec for this dataset names Sonnet explicitly; Claude model ids have
// no date suffix (claude-api skill, models table cached 2026-05-26).
const MODEL = 'claude-sonnet-4-6';
// Titles are short; 50/request keeps each response well under max_tokens
// while amortizing the (cached) system prompt.
const BATCH_SIZE = 50;
const MAX_TOKENS = 4096;
// Pricing per million tokens for claude-sonnet-4-6, from the claude-api
// skill's model table (cached 2026-05-26): $3 input / $15 output.
const INPUT_USD_PER_MTOK = 3.0;
const OUTPUT_USD_PER_MTOK = 15.0;

const SYSTEM_PROMPT = `You translate the titles of school board policy documents for the Redwood City School District (a TK-8 public district in Redwood City, California) from English to Spanish.

Audience: Spanish-speaking families in Redwood City, California. The site's register is plain, colloquial Californian Spanish — but these are legal document names, so accuracy comes first; a formal-ish title is fine.

Rules:
- Translate the meaning precisely. Do not summarize, expand, or editorialize.
- Use standard Spanish capitalization: capitalize the first word and proper nouns only.
- Keep proper nouns, program names, and law names recognizable (e.g. "Williams", "Title IX", "Brown Act"). Keep "Charter" as "Charter" — that is what local families call these schools.
- "Board" here is the school board: use "Mesa Directiva" when it appears.
- Prefer terms California districts actually use with families (e.g. "Asistencia escolar" for attendance, "Quejas" for complaints).
- "Uniform Complaint Procedures" is California's UCP, where "uniform" means standardized — translate as "Procedimientos uniformes de quejas", never as clothing uniforms. Apply the same reading to other "Uniform ... Procedures" titles.
- Return ONLY the translations in the requested JSON structure, one entry per input id, same ids.`;

// Structured-output schema: guarantees parseable JSON from the model.
// (Count/id validation still happens client-side per batch.)
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          es: { type: 'string' },
        },
        required: ['id', 'es'],
        additionalProperties: false,
      },
    },
  },
  required: ['translations'],
  additionalProperties: false,
};

const API_REVISION = '2023-06-01';
const SYSTEM_TEMPLATE_ID = 'policy-title-translation-system-v1';
const USER_TEMPLATE_ID = 'policy-title-translation-user-v1';
const USER_TEMPLATE = 'Translate these policy titles to Spanish:\n{{itemsJson}}';
const OUTPUT_SCHEMA_ID = 'policy-title-translations-v1';
const GENERATION_PARAMETERS = {
  sent: { max_tokens: MAX_TOKENS },
  providerDefaults: 'unknown',
  unsupported: ['seed'],
};
const SAFETY_SETTINGS = { settings: {}, providerDefaults: 'unknown' };

let client;
const getClient = () => (client ||= new Anthropic());

const usageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const promptHashes = {
  systemTemplateId: SYSTEM_TEMPLATE_ID,
  systemTemplateHash: sha256(SYSTEM_PROMPT),
  renderedSystemHash: sha256(SYSTEM_PROMPT),
  userTemplateId: USER_TEMPLATE_ID,
  userTemplateHash: sha256(USER_TEMPLATE),
};

const OUTPUT_CONTRACT_SPEC = {
  modelOutputSchema: OUTPUT_SCHEMA,
  clientValidation: {
    exactRequestedIdSet: true,
    exactlyOnce: true,
    nonEmptySpanish: true,
  },
  batching: { maximumItems: BATCH_SIZE, ordering: 'policy-index-first-occurrence-v1' },
  retryPolicy: { maximumAttempts: 2, strategy: 'same-request' },
};
const outputContract = {
  schemaId: OUTPUT_SCHEMA_ID,
  schemaHash: hashCanonicalJson(OUTPUT_CONTRACT_SPEC),
  toolSchemas: [],
};

function titleBatchInputs(items) {
  return items.map((item) => ({
    datasetId: `rcsd.policy-index.title-batch-input.${item.id.toLowerCase()}`,
    hash: hashCanonicalJson(item),
  }));
}

export function buildTitleBatchFingerprint(items) {
  const userPrompt = USER_TEMPLATE.replace('{{itemsJson}}', JSON.stringify(items, null, 1));
  return buildLlmCacheFingerprint({
    purpose: 'translation',
    provider: 'anthropic',
    model: { requested: MODEL, resolved: null },
    endpoint: { api: 'messages', revision: API_REVISION },
    client: { name: '@anthropic-ai/sdk', version: SDK_VERSION },
    parameters: GENERATION_PARAMETERS,
    prompts: { ...promptHashes, renderedUserHash: sha256(userPrompt) },
    outputContract,
    inputs: titleBatchInputs(items),
    localization: { sourceLocale: 'en-US', targetLocale: 'es-MX', glossaryHash: null },
    safety: SAFETY_SETTINGS,
    processing: { batchSize: BATCH_SIZE, retryLimit: 2, validation: 'exact-id-set-v1' },
  });
}

function invocationForTitleBatch(items) {
  const cacheFingerprint = buildTitleBatchFingerprint(items);
  const userPrompt = USER_TEMPLATE.replace('{{itemsJson}}', JSON.stringify(items, null, 1));
  return {
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    invocationId: `policy-title-batch-${(items[0]?.id || 'empty').toLowerCase()}-${cacheFingerprint.replace(/^sha256:/, '').slice(0, 16)}`,
    purpose: 'translation',
    provider: 'anthropic',
    model: { requested: MODEL, resolved: null },
    endpoint: { api: 'messages', revision: API_REVISION },
    client: { name: '@anthropic-ai/sdk', version: SDK_VERSION },
    parameters: GENERATION_PARAMETERS,
    prompts: { ...promptHashes, renderedUserHash: sha256(userPrompt) },
    outputContract,
    inputs: titleBatchInputs(items),
    localization: { sourceLocale: 'en-US', targetLocale: 'es-MX', glossaryHash: null },
    safety: SAFETY_SETTINGS,
    processing: { batchSize: BATCH_SIZE, retryLimit: 2, validation: 'exact-id-set-v1' },
    attempts: [],
    effectiveAttempt: null,
    outputHash: null,
    cacheFingerprint,
  };
}

function responseUsage(response) {
  return {
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    cacheReadInputTokens: response.usage?.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: response.usage?.cache_creation_input_tokens ?? 0,
  };
}

function estimatedCost(usage) {
  return {
    amount: ((usage.inputTokens || 0) * INPUT_USD_PER_MTOK +
      (usage.outputTokens || 0) * OUTPUT_USD_PER_MTOK) / 1e6,
    currency: 'USD',
  };
}

function addUsage(usage) {
  usageTotals.input += usage.inputTokens || 0;
  usageTotals.output += usage.outputTokens || 0;
  usageTotals.cacheRead += usage.cacheReadInputTokens || 0;
  usageTotals.cacheWrite += usage.cacheCreationInputTokens || 0;
}

/** Translate one deterministic title batch and retain every API attempt. */
export async function translateBatch(items, { apiClient = getClient() } = {}) {
  const invocation = invocationForTitleBatch(items);
  const userPrompt = USER_TEMPLATE.replace('{{itemsJson}}', JSON.stringify(items, null, 1));

  for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber++) {
    const startedAt = new Date().toISOString();
    let response;
    try {
      response = await apiClient.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // No cache_control: the prompt prefix is below the model's cacheable minimum.
        system: SYSTEM_PROMPT,
        output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
        messages: [{ role: 'user', content: userPrompt }],
      });
    } catch (err) {
      invocation.attempts.push({
        attempt: attemptNumber,
        startedAt,
        completedAt: new Date().toISOString(),
        model: { requested: MODEL, resolved: null },
        promptHashes: { system: sha256(SYSTEM_PROMPT), user: sha256(userPrompt) },
        outcome: 'failed',
        finishReason: null,
        validation: { status: 'not-run', errors: [] },
      });
      if (attemptNumber === 2) {
        err.llmInvocation = invocation;
        throw err;
      }
      console.warn(`  Batch request failed (attempt ${attemptNumber}), retrying...`);
      continue;
    }

    const usage = responseUsage(response);
    addUsage(usage);
    const text = response.content.find(b => b.type === 'text')?.text || '';
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* validation reports this below */ }

    const wanted = new Set(items.map(it => it.id));
    const got = parsed?.translations || [];
    const valid =
      got.length === items.length &&
      got.every(t => wanted.has(t.id) && typeof t.es === 'string' && t.es.trim().length > 0) &&
      new Set(got.map(t => t.id)).size === got.length;
    const problems = valid
      ? []
      : [`wanted ${items.length} unique requested ids; received ${got.length} valid-looking entries`];

    invocation.attempts.push({
      attempt: attemptNumber,
      startedAt,
      completedAt: new Date().toISOString(),
      model: { requested: MODEL, resolved: response.model && response.model !== MODEL ? response.model : null },
      promptHashes: { system: sha256(SYSTEM_PROMPT), user: sha256(userPrompt) },
      outcome: valid ? 'succeeded' : 'rejected',
      finishReason: response.stop_reason || null,
      validation: { status: valid ? 'passed' : 'failed', errors: problems },
      usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      estimatedCost: estimatedCost(usage),
      responseHash: sha256(text),
    });

    if (!valid) {
      if (attemptNumber === 2) {
        const err = new Error(`Batch failed validation twice (wanted ${items.length}, got ${got.length}).`);
        err.llmInvocation = invocation;
        throw err;
      }
      console.warn(`  Batch validation failed (attempt ${attemptNumber}), retrying...`);
      continue;
    }

    const translations = Object.fromEntries(got.map(t => [t.id, t.es.trim()]));
    invocation.effectiveAttempt = attemptNumber;
    invocation.outputHash = hashCanonicalJson(translations);
    return { translations, invocation };
  }

  throw new Error('Unreachable title translation retry state.');
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set. Add it to .env or export it.');
  }
  const index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
  const sections = index.sections || [];
  const policies = index.policies || [];

  // Build every unique source string first, not only cache misses. Stable
  // whole-corpus batches make the full ordered model context part of each
  // output's fingerprint; changing one title invalidates its affected batch.
  const slotsByEn = new Map();
  const addSlot = (en, slot) => {
    if (!slotsByEn.has(en)) slotsByEn.set(en, []);
    slotsByEn.get(en).push(slot);
  };
  for (const sec of sections) addSlot(sec.name, { kind: 'section', key: sec.code });
  for (const pol of policies) addSlot(pol.title, { kind: 'title', key: `${pol.code}-${pol.type}` });

  let previous = { _metadata: {}, sections: {}, titles: {} };
  if (!FORCE && existsSync(OUTPUT_PATH)) {
    previous = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
  }

  const outSections = {};
  const outTitles = {};
  const cacheFingerprints = { sections: {}, titles: {} };
  const llmInvocationIds = { sections: {}, titles: {} };
  const priorFingerprints = previous._metadata?.cacheFingerprints || { sections: {}, titles: {} };
  const priorInvocations = new Map(
    (previous._metadata?.llmInvocations || [])
      .filter(inv => validateLlmInvocation(inv).valid)
      .map(inv => [inv.cacheFingerprint, inv])
  );
  const activeInvocations = [];

  const uniqueEn = [...slotsByEn.keys()];
  const items = uniqueEn.map((en, i) => ({ id: `T${String(i).padStart(4, '0')}`, en }));
  console.log(`Sections: ${sections.length}, policies: ${policies.length}.`);
  console.log(`${uniqueEn.length} unique strings cover ${[...slotsByEn.values()].reduce((n, s) => n + s.length, 0)} entries.`);

  let translatedBatchCount = 0;
  let cachedBatchCount = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const fingerprint = buildTitleBatchFingerprint(batch);
    const previousInvocation = priorInvocations.get(fingerprint);
    const reusable = !FORCE && Boolean(previousInvocation) && batch.every((item) =>
      slotsByEn.get(item.en).every((slot) => {
        const entry = slot.kind === 'section'
          ? previous.sections?.[slot.key]
          : previous.titles?.[slot.key];
        const storedFingerprint = slot.kind === 'section'
          ? priorFingerprints.sections?.[slot.key]
          : priorFingerprints.titles?.[slot.key];
        return entry?.en === item.en && entry?.es && storedFingerprint === fingerprint;
      })
    );

    let translations;
    let batchInvocation;
    if (reusable) {
      cachedBatchCount++;
      activeInvocations.push(previousInvocation);
      batchInvocation = previousInvocation;
      translations = Object.fromEntries(batch.map((item) => {
        const firstSlot = slotsByEn.get(item.en)[0];
        const entry = firstSlot.kind === 'section'
          ? previous.sections[firstSlot.key]
          : previous.titles[firstSlot.key];
        return [item.id, entry.es];
      }));
    } else {
      translatedBatchCount++;
      console.log(`Translating batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(items.length / BATCH_SIZE)} (${batch.length} titles)...`);
      const result = await translateBatch(batch);
      translations = result.translations;
      activeInvocations.push(result.invocation);
      batchInvocation = result.invocation;
    }

    for (const item of batch) {
      const es = translations[item.id];
      for (const slot of slotsByEn.get(item.en)) {
        const entry = { en: item.en, es };
        if (slot.kind === 'section') {
          outSections[slot.key] = entry;
          cacheFingerprints.sections[slot.key] = fingerprint;
          llmInvocationIds.sections[slot.key] = batchInvocation.invocationId;
        } else {
          outTitles[slot.key] = entry;
          cacheFingerprints.titles[slot.key] = fingerprint;
          llmInvocationIds.titles[slot.key] = batchInvocation.invocationId;
        }
      }
    }
  }

  // Sanity: every section and policy in the index must now be covered.
  const missing = [
    ...sections.filter(s => !outSections[s.code]).map(s => `section ${s.code}`),
    ...policies.filter(p => !outTitles[`${p.code}-${p.type}`]).map(p => `${p.code}-${p.type}`),
  ];
  if (missing.length > 0) {
    throw new Error(`Missing translations after run: ${missing.slice(0, 10).join(', ')}`);
  }

  const output = {
    _metadata: {
      source: 'data/policies-index.json (scraped from https://simbli.eboardsolutions.com/Policy/PolicyListing.aspx?S=36030397)',
      method: `AI translation of policy titles and section names via the Claude API (scripts/translate-policy-titles.mjs); batched ${BATCH_SIZE}/request with structured JSON output; duplicate English titles translated once for consistency`,
      model: MODEL,
      generatedAt: new Date().toISOString(),
      note: 'Machine-generated Spanish translations of official English policy titles. Titles only — policy body text is not translated. May contain errors; the English titles and Simbli are authoritative.',
      cacheFingerprints,
      llmInvocationIds,
      llmInvocations: activeInvocations,
    },
    sections: Object.fromEntries(Object.entries(outSections).sort(([a], [b]) => a.localeCompare(b))),
    titles: Object.fromEntries(Object.entries(outTitles).sort(([a], [b]) =>
      a.localeCompare(b, undefined, { numeric: true }))),
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`Wrote ${Object.keys(outTitles).length} titles + ${Object.keys(outSections).length} sections to ${OUTPUT_PATH}`);
  console.log(`Batches: ${cachedBatchCount} cached, ${translatedBatchCount} generated.`);

  const cost = (usageTotals.input * INPUT_USD_PER_MTOK + usageTotals.output * OUTPUT_USD_PER_MTOK) / 1e6;
  console.log(`Token usage: ${usageTotals.input} in (${usageTotals.cacheRead} cache-read, ${usageTotals.cacheWrite} cache-write), ${usageTotals.output} out ≈ $${cost.toFixed(4)} (${MODEL} at $${INPUT_USD_PER_MTOK}/$${OUTPUT_USD_PER_MTOK} per MTok)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('Translation failed:', err.message);
    process.exit(1);
  });
}
