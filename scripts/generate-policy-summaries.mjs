#!/usr/bin/env node
/**
 * Generate one-sentence summaries (English AND Spanish) for every board
 * policy, for the redesigned /policies/ + /politicas/ index pages.
 *
 * Input:  data/board-policies/*.json (from scrape-board-policies.mjs)
 * Output: data/policy-summaries.json
 *   {
 *     _metadata: { source, method, model, generatedAt, note },
 *     summaries: {
 *       "0100-BP": {
 *         title: "Philosophy",          // English title at generation time
 *         en: "Requires the Board to ...",
 *         es: "Exige que la Mesa Directiva ...",
 *         sourceHash: "<sha256 of full contentText>"
 *       },
 *       ...
 *     }
 *   }
 *
 * One API request per policy returns BOTH languages as structured JSON,
 * so the two summaries are guaranteed to describe the same substance.
 *
 * Idempotent: entries are reused only when sourceHash and the full LLM cache
 * fingerprint (model, SDK, parameters, prompts, schema, locale, safety, and
 * processing settings) match. Legacy entries without invocation provenance
 * are upgraded on the next deliberate run. Use --force to regenerate
 * everything. Policies with empty contentText (scanned PDF exhibits with no
 * extracted text) are skipped with a warning — summarizing without source
 * text would be guessing.
 *
 * Each summary is validated (non-empty, single sentence, length cap,
 * Spanish actually Spanish, no "This policy..." opener); one retry with
 * the validation errors fed back, then skip-with-warning.
 *
 * Requires ANTHROPIC_API_KEY (.env).
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, readdirSync, openSync, closeSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import {
  buildLlmCacheFingerprint,
  getInstalledPackageVersion,
  hashCanonicalJson,
  PROVENANCE_SCHEMA_VERSION,
  sha256,
  sha256Hex,
  validateLlmInvocation,
} from './lib/provenance.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const POLICIES_DIR = resolve(ROOT, 'data', 'board-policies');
const OUTPUT_PATH = resolve(ROOT, 'data', 'policy-summaries.json');
const LOCK_PATH = resolve(ROOT, 'tmp', 'generate-policy-summaries.lock');
const SDK_VERSION = getInstalledPackageVersion('@anthropic-ai/sdk', import.meta.url);

const FORCE = process.argv.includes('--force');

// Task spec for this dataset names Sonnet explicitly; Claude model ids have
// no date suffix (claude-api skill, models table cached 2026-05-26).
const MODEL = 'claude-sonnet-5';
// Pricing per million tokens for claude-sonnet-5, from the claude-api skill's
// model table (cached 2026-06-24): $3 input / $15 output standard. Intro
// pricing ($2/$10 through 2026-08-31) is deliberately not encoded; cost
// estimates use standard rates.
const INPUT_USD_PER_MTOK = 3.0;
const OUTPUT_USD_PER_MTOK = 15.0;
// Two one-sentence summaries — 1024 tokens is generous headroom.
const MAX_TOKENS = 1024;
// 6 parallel requests: fast enough for ~600 policies without brushing
// against per-minute rate limits.
const CONCURRENCY = 6;
// Cost/quality tradeoff: a one-sentence summary doesn't need the whole
// legal text. Policies open with their purpose and core requirements, so
// the first ~8,000 chars (~2,000 tokens) carry the substance; the tail is
// procedure detail and boilerplate. 92 of 619 policies exceed this cap.
const CONTENT_CHAR_LIMIT = 8000;
// Ask the model for <=160 chars (fits the index-page card design);
// validation rejects only past 220 so near-misses don't burn retries.
const TARGET_CHARS = 160;
const HARD_CHAR_LIMIT = 220;
// Write partial results to disk every N completions so an interrupted run
// resumes from the cache instead of starting over.
const CHECKPOINT_EVERY = 50;

const SYSTEM_PROMPT = `You write one-sentence summaries of school board policy documents for the Redwood City School District (a TK-8 public school district in Redwood City, California), in BOTH English and Spanish.

Audience: a busy parent reading at a sixth-grade level. Each summary answers one question: what does this policy actually do or require?

Rules for BOTH languages:
- Exactly ONE sentence, at most ${TARGET_CHARS} characters. No second sentence, no stacked clauses chained with semicolons.
- Start with the substance — usually a verb. NEVER open with "This policy...", "Esta política...", "The district...", or a restatement of the title.
  Good EN: "Requires the Board to adopt long-term district goals with measurable benchmarks."
  Good ES: "Exige que la Mesa Directiva adopte metas de largo plazo con estándares medibles."
- Be concrete and plain: say who must do what. No legal boilerplate, no "pursuant to", no Education Code section numbers.
- Avoid abbreviations written with periods (write "United States", not "U.S.") so the sentence contains exactly one period, at the end.
- BP (Board Policy) states what the Board requires or commits to; AR (Administrative Regulation) spells out how staff carry it out — reflect that in the verb you choose.

Spanish register:
- Colloquial Californian/Mexican Spanish at a sixth-grade level — the way district staff actually talk with families, not literary Spanish.
- "Board" is "la Mesa Directiva". Keep "Charter" as "Charter". Prefer borrowed terms families actually use over formal equivalents.
- Use the tú form if a sentence addresses the reader directly (most summaries won't address anyone).
- The Spanish summary must carry the same substance as the English one, written as natural Spanish — not word-for-word translated English.

Return ONLY the requested JSON object with "en" and "es".`;

// Structured-output schema: guarantees parseable JSON from the model.
// (Sentence-shape / length / language validation still happens client-side.)
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    en: { type: 'string', description: 'One-sentence English summary' },
    es: { type: 'string', description: 'One-sentence Spanish summary' },
  },
  required: ['en', 'es'],
  additionalProperties: false,
};

const API_REVISION = '2023-06-01';
const SYSTEM_TEMPLATE_ID = 'policy-summary-system-v1';
const USER_TEMPLATE_ID = 'policy-summary-user-v1';
const USER_TEMPLATE = `Summarize this policy in one sentence each in English and Spanish.

Code: {{code}}
Type: {{type}} ({{typeLabel}})
Title: {{title}}

Policy text:
{{contentText}}{{validationFeedback}}`;
const OUTPUT_SCHEMA_ID = 'policy-bilingual-summary-v1';
const GENERATION_PARAMETERS = {
  sent: { max_tokens: MAX_TOKENS, thinking: { type: 'disabled' } },
  providerDefaults: 'unknown',
  unsupported: ['seed'],
};
const SAFETY_SETTINGS = { settings: {}, providerDefaults: 'unknown' };
const PROMPT_HASHES = {
  systemTemplateId: SYSTEM_TEMPLATE_ID,
  systemTemplateHash: sha256(SYSTEM_PROMPT),
  renderedSystemHash: sha256(SYSTEM_PROMPT),
  userTemplateId: USER_TEMPLATE_ID,
  userTemplateHash: sha256(USER_TEMPLATE),
};
const OUTPUT_CONTRACT = {
  schemaId: OUTPUT_SCHEMA_ID,
  schemaHash: hashCanonicalJson({
    modelOutputSchema: OUTPUT_SCHEMA,
    contentSelection: { firstCharacters: CONTENT_CHAR_LIMIT, truncationMarker: '\n[... text truncated ...]' },
    validation: {
      maximumCharacters: HARD_CHAR_LIMIT,
      oneSentence: true,
      fillerOpenersRejected: true,
      spanishHeuristic: 'accent-or-common-stopword-v1',
    },
    retryPolicy: { maximumAttempts: 2, strategy: 'validation-feedback-repair-v1' },
  }),
  toolSchemas: [],
};

let client;
const getClient = () => (client ||= new Anthropic());

const usageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const runningCostUsd = () =>
  (usageTotals.input * INPUT_USD_PER_MTOK + usageTotals.output * OUTPUT_USD_PER_MTOK) / 1e6;

// Crude single-language Spanish check: an accented/inverted-punctuation char
// OR a common Spanish stopword. Cheap, but reliably rejects English output.
const SPANISH_HINT_RE = /[áéíóúñüÁÉÍÓÚÑÜ¿¡]|\b(el|la|los|las|que|de|del|para|con|por|una?|se|sus?|debe[n]?|cada|cuando|escuelas?|distrito)\b/i;

/**
 * Validate one summary string. Returns a list of problems (empty = valid).
 */
function validateSummary(text, lang) {
  const problems = [];
  const t = (text || '').trim();
  if (t.length === 0) {
    problems.push(`${lang}: empty`);
    return problems;
  }
  if (t.length > HARD_CHAR_LIMIT) {
    problems.push(`${lang}: ${t.length} chars (max ${HARD_CHAR_LIMIT})`);
  }
  // One sentence: the only period allowed is the final character. A period
  // followed by more content means a second sentence (or a dotted
  // abbreviation, which the prompt also bans).
  if (/\.\s*\S/.test(t)) {
    problems.push(`${lang}: contains a mid-string period (must be one sentence)`);
  }
  if (lang === 'en' && /^(this policy|this regulation|the policy)\b/i.test(t)) {
    problems.push('en: opens with "This policy..." style filler');
  }
  if (lang === 'es' && /^(esta política|esta norma|este reglamento|la política)\b/i.test(t)) {
    problems.push('es: opens with "Esta política..." style filler');
  }
  if (lang === 'es' && !SPANISH_HINT_RE.test(t)) {
    problems.push('es: does not look like Spanish');
  }
  return problems;
}

function summarySourceWindow(policy) {
  return policy.contentText.length > CONTENT_CHAR_LIMIT
    ? policy.contentText.slice(0, CONTENT_CHAR_LIMIT) + '\n[... text truncated ...]'
    : policy.contentText;
}

function summaryPrompt(policy, priorProblems = []) {
  const truncated = policy.contentText.length > CONTENT_CHAR_LIMIT
    ? policy.contentText.slice(0, CONTENT_CHAR_LIMIT) + '\n[... text truncated ...]'
    : policy.contentText;
  const typeLabel = policy.type === 'BP' ? 'Board Policy' : 'Administrative Regulation';
  let validationFeedback = '';
  if (priorProblems.length > 0) {
    validationFeedback = `\n\nYour previous answer failed validation: ${priorProblems.join('; ')}. ` +
      `Fix those problems — one sentence per language, under ${TARGET_CHARS} characters, ` +
      `single trailing period, no dotted abbreviations, no "This policy..." opener.`;
  }
  return USER_TEMPLATE
    .replace('{{code}}', policy.code)
    .replace('{{type}}', policy.type)
    .replace('{{typeLabel}}', typeLabel)
    .replace('{{title}}', policy.title)
    .replace('{{contentText}}', truncated)
    .replace('{{validationFeedback}}', validationFeedback);
}

function summaryInputs(policy) {
  const key = policyIdSegment(policy);
  return [
    {
      datasetId: `rcsd.board-policy.${key}`,
      pointer: '/contentText',
      hash: sha256(policy.contentText),
    },
    {
      datasetId: `rcsd.board-policy.${key}.summary-window`,
      hash: sha256(summarySourceWindow(policy)),
    },
  ];
}

function policyIdSegment(policy) {
  return `${policy.code}-${policy.type}`
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildSummaryFingerprint(policy) {
  return buildLlmCacheFingerprint({
    purpose: 'summarization',
    provider: 'anthropic',
    model: { requested: MODEL, resolved: null },
    endpoint: { api: 'messages', revision: API_REVISION },
    client: { name: '@anthropic-ai/sdk', version: SDK_VERSION },
    parameters: GENERATION_PARAMETERS,
    prompts: { ...PROMPT_HASHES, renderedUserHash: sha256(summaryPrompt(policy)) },
    outputContract: OUTPUT_CONTRACT,
    inputs: summaryInputs(policy),
    localization: { sourceLocale: 'en-US', targetLocale: 'mul', glossaryHash: null },
    safety: SAFETY_SETTINGS,
    processing: {
      contentCharacterLimit: CONTENT_CHAR_LIMIT,
      retryLimit: 2,
      retryStrategy: 'validation-feedback-repair-v1',
    },
  });
}

function invocationForSummary(policy) {
  const cacheFingerprint = buildSummaryFingerprint(policy);
  return {
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    invocationId: `policy-summary-${policyIdSegment(policy)}-${cacheFingerprint.replace(/^sha256:/, '').slice(0, 16)}`,
    purpose: 'summarization',
    provider: 'anthropic',
    model: { requested: MODEL, resolved: null },
    endpoint: { api: 'messages', revision: API_REVISION },
    client: { name: '@anthropic-ai/sdk', version: SDK_VERSION },
    parameters: GENERATION_PARAMETERS,
    prompts: { ...PROMPT_HASHES, renderedUserHash: sha256(summaryPrompt(policy)) },
    outputContract: OUTPUT_CONTRACT,
    inputs: summaryInputs(policy),
    localization: { sourceLocale: 'en-US', targetLocale: 'mul', glossaryHash: null },
    safety: SAFETY_SETTINGS,
    processing: {
      contentCharacterLimit: CONTENT_CHAR_LIMIT,
      retryLimit: 2,
      retryStrategy: 'validation-feedback-repair-v1',
    },
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

function addUsage(usage) {
  usageTotals.input += usage.inputTokens || 0;
  usageTotals.output += usage.outputTokens || 0;
  usageTotals.cacheRead += usage.cacheReadInputTokens || 0;
  usageTotals.cacheWrite += usage.cacheCreationInputTokens || 0;
}

function estimatedCost(usage) {
  return {
    amount: ((usage.inputTokens || 0) * INPUT_USD_PER_MTOK +
      (usage.outputTokens || 0) * OUTPUT_USD_PER_MTOK) / 1e6,
    currency: 'USD',
  };
}

/** One policy invocation, retaining a rejected draft and its repair pass. */
export async function summarizePolicy(policy, { apiClient = getClient() } = {}) {
  const invocation = invocationForSummary(policy);
  let priorProblems = [];

  for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber++) {
    const prompt = summaryPrompt(policy, priorProblems);
    const startedAt = new Date().toISOString();
    let response;
    try {
      response = await apiClient.messages.create({
        model: MODEL,
        // Disable Sonnet 5's default adaptive thinking — one-sentence
        // summaries don't need billed reasoning tokens.
        thinking: { type: 'disabled' },
        max_tokens: MAX_TOKENS,
        // No cache_control: the system prompt is below the model's cacheable minimum.
        system: SYSTEM_PROMPT,
        output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
        messages: [{ role: 'user', content: prompt }],
      });
    } catch (err) {
      invocation.attempts.push({
        attempt: attemptNumber,
        startedAt,
        completedAt: new Date().toISOString(),
        model: { requested: MODEL, resolved: null },
        promptHashes: { system: sha256(SYSTEM_PROMPT), user: sha256(prompt) },
        outcome: 'failed',
        validation: { status: 'not-run', errors: [] },
        finishReason: null,
      });
      if (attemptNumber === 2) {
        err.llmInvocation = invocation;
        throw err;
      }
      console.warn(`  ${policy.code}-${policy.type}: request failed, retrying...`);
      continue;
    }

    const usage = responseUsage(response);
    addUsage(usage);

    const text = response.content.find((b) => b.type === 'text')?.text || '';
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* validation handles it */ }

    const problems = parsed
      ? [...validateSummary(parsed.en, 'en'), ...validateSummary(parsed.es, 'es')]
      : ['response was not parseable JSON'];
    const valid = problems.length === 0;
    invocation.attempts.push({
      attempt: attemptNumber,
      startedAt,
      completedAt: new Date().toISOString(),
      model: { requested: MODEL, resolved: response.model && response.model !== MODEL ? response.model : null },
      promptHashes: { system: sha256(SYSTEM_PROMPT), user: sha256(prompt) },
      outcome: valid ? 'succeeded' : 'rejected',
      validation: { status: valid ? 'passed' : 'failed', errors: problems },
      finishReason: response.stop_reason || null,
      responseHash: sha256(text),
      usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      estimatedCost: estimatedCost(usage),
    });

    if (!valid) {
      if (attemptNumber === 2) {
        const err = new Error(problems.join('; '));
        err.llmInvocation = invocation;
        throw err;
      }
      priorProblems = problems;
      console.warn(`  ${policy.code}-${policy.type}: validation failed (${problems.join('; ')}), retrying...`);
      continue;
    }

    const result = { en: parsed.en.trim(), es: parsed.es.trim() };
    invocation.effectiveAttempt = attemptNumber;
    invocation.outputHash = hashCanonicalJson(result);
    return { ...result, invocation };
  }

  throw new Error('Unreachable policy summary retry state.');
}

function loadPolicies() {
  return readdirSync(POLICIES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const p = JSON.parse(readFileSync(resolve(POLICIES_DIR, f), 'utf-8'));
      return {
        code: p.code,
        title: p.title,
        type: p.type,
        contentText: (p.contentText || '').trim(),
      };
    })
    .sort((a, b) => `${a.code}-${a.type}`.localeCompare(`${b.code}-${b.type}`, undefined, { numeric: true }));
}

function writeOutput(summaries, cacheFingerprints, invocationsByKey) {
  const output = {
    _metadata: {
      source: 'data/board-policies/*.json (scraped from https://simbli.eboardsolutions.com/Policy/PolicyListing.aspx?S=36030397 by scrape-board-policies.mjs)',
      method: `AI-generated one-sentence summaries via the Claude API (scripts/generate-policy-summaries.mjs); one request per policy returning English and Spanish together as structured JSON; policy text truncated to the first ${CONTENT_CHAR_LIMIT} chars as a cost/quality tradeoff; sourceHash is the sha256 of the full (untruncated) contentText for cache invalidation`,
      model: MODEL,
      generatedAt: new Date().toISOString(),
      note: 'Machine-generated summaries for the policy index pages. They simplify and may omit nuance; the full policy text on Simbli is authoritative. Spanish summaries are AI-generated, not official district translations.',
      cacheFingerprints: Object.fromEntries(
        Object.entries(cacheFingerprints).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      ),
      llmInvocationIds: Object.fromEntries(
        [...invocationsByKey.entries()]
          .filter(([key]) => Object.hasOwn(summaries, key))
          .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
          .map(([key, invocation]) => [key, invocation.invocationId])
      ),
      llmInvocations: [...invocationsByKey.values()]
        .sort((a, b) => a.invocationId.localeCompare(b.invocationId, undefined, { numeric: true })),
    },
    summaries: Object.fromEntries(
      Object.entries(summaries).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    ),
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set. Add it to .env or export it.');
  }
  // Single-instance lock: two concurrent runs would checkpoint-overwrite each
  // other's output (each only knows its own results). O_EXCL create fails if
  // the lock exists; a stale lock (crashed run) must be removed by hand.
  let lockFd;
  try {
    lockFd = openSync(LOCK_PATH, 'wx');
  } catch (err) {
    if (err.code === 'EEXIST') {
      throw new Error(`Another run appears active (${LOCK_PATH} exists). ` +
        'If no other generate-policy-summaries.mjs process is running, delete the lock file and retry.');
    }
    throw err;
  }
  const releaseLock = () => {
    try { closeSync(lockFd); unlinkSync(LOCK_PATH); } catch { /* already gone */ }
  };
  process.on('exit', releaseLock);
  process.on('SIGINT', () => { releaseLock(); process.exit(130); });
  process.on('SIGTERM', () => { releaseLock(); process.exit(143); });

  const policies = loadPolicies();

  let previous = { _metadata: {}, summaries: {} };
  if (!FORCE && existsSync(OUTPUT_PATH)) {
    previous = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
  }

  const summaries = {};
  const cacheFingerprints = {};
  const invocationsByKey = new Map();
  const previousFingerprints = previous._metadata?.cacheFingerprints || {};
  const previousInvocations = new Map(
    (previous._metadata?.llmInvocations || [])
      .filter(inv => validateLlmInvocation(inv).valid)
      .map(inv => [inv.cacheFingerprint, inv])
  );
  const pending = [];
  const skippedEmpty = [];

  for (const pol of policies) {
    const key = `${pol.code}-${pol.type}`;
    if (pol.contentText.length === 0) {
      skippedEmpty.push(key);
      continue;
    }
    const hash = sha256Hex(pol.contentText);
    const fingerprint = buildSummaryFingerprint(pol);
    const cached = previous.summaries?.[key];
    const cachedInvocation = previousInvocations.get(fingerprint);
    if (cached && cached.sourceHash === hash && cached.en && cached.es &&
        previousFingerprints[key] === fingerprint && cachedInvocation) {
      summaries[key] = { title: pol.title, en: cached.en, es: cached.es, sourceHash: hash };
      cacheFingerprints[key] = fingerprint;
      invocationsByKey.set(key, cachedInvocation);
    } else {
      pending.push({ ...pol, key, hash, fingerprint });
    }
  }

  console.log(`Policies: ${policies.length}. Cached: ${Object.keys(summaries).length}. ` +
    `To generate: ${pending.length}. No extractable text (skipped): ${skippedEmpty.length}.`);
  for (const key of skippedEmpty) {
    console.warn(`  Skipping ${key}: contentText is empty (scanned PDF exhibit) — no summary generated.`);
  }

  const failed = [];
  let done = 0;

  // Fixed-size worker pool: CONCURRENCY workers pull from a shared cursor.
  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= pending.length) return;
      const pol = pending[idx];
      try {
        const { en, es, invocation } = await summarizePolicy(pol);
        summaries[pol.key] = { title: pol.title, en, es, sourceHash: pol.hash };
        cacheFingerprints[pol.key] = pol.fingerprint;
        invocationsByKey.set(pol.key, invocation);
      } catch (err) {
        failed.push(pol.key);
        console.warn(`  SKIPPED ${pol.key} after retry: ${err.message}`);
      }
      done++;
      if (done % CHECKPOINT_EVERY === 0) {
        writeOutput(summaries, cacheFingerprints, invocationsByKey); // checkpoint so an interrupted run resumes
        console.log(`  [${done}/${pending.length}] ${usageTotals.input} in / ${usageTotals.output} out tokens ≈ $${runningCostUsd().toFixed(2)} (checkpointed)`);
      } else if (done % 10 === 0) {
        console.log(`  [${done}/${pending.length}] ${usageTotals.input} in / ${usageTotals.output} out tokens ≈ $${runningCostUsd().toFixed(2)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));

  writeOutput(summaries, cacheFingerprints, invocationsByKey);

  console.log(`\nWrote ${Object.keys(summaries).length} summaries to ${OUTPUT_PATH}`);
  console.log(`Generated: ${pending.length - failed.length}, cached: ${Object.keys(summaries).length - (pending.length - failed.length)}, ` +
    `failed: ${failed.length}${failed.length ? ` (${failed.join(', ')})` : ''}, no-text: ${skippedEmpty.length}`);
  console.log(`Token usage: ${usageTotals.input} in (${usageTotals.cacheRead} cache-read, ${usageTotals.cacheWrite} cache-write), ` +
    `${usageTotals.output} out ≈ $${runningCostUsd().toFixed(4)} (${MODEL} at $${INPUT_USD_PER_MTOK}/$${OUTPUT_USD_PER_MTOK} per MTok)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Summary generation failed:', err.message);
    process.exit(1);
  });
}
