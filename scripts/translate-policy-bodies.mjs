#!/usr/bin/env node
/**
 * Translate board policy BODY TEXT (contentText) to Spanish via the
 * Claude API, for the /politicas/ interactive browser.
 *
 * Input:  data/board-policies/{code}-{type}.json (from scrape-board-policies.mjs)
 *         data/policy-titles-es.json             (from translate-policy-titles.mjs)
 * Output: data/board-policies-es/{code}-{type}.json — one file per policy,
 *         mirroring the data/board-policies/ filenames:
 *   {
 *     code, type,
 *     titleEs,         // from policy-titles-es.json, for consistency
 *     contentTextEs,   // the translated body
 *     _metadata: { model, generatedAt, method, sourceFile, sourceHash, note }
 *   }
 *
 * Footnotes / legal citations and crossRefs are NOT translated — statute
 * names and code strings stay as-is (the prompt also pins citation strings
 * embedded in the body text verbatim).
 *
 * One policy per API request (bodies are long; batching policies into one
 * request risks truncation and cross-contamination). Policies over
 * CHUNK_THRESHOLD_CHARS are split into chunks at paragraph boundaries and
 * reassembled with their original separators, byte-exact.
 *
 * Idempotent: a policy is skipped when its ES file exists, sourceHash is
 * current, and its complete LLM/output cache fingerprint matches. Legacy
 * cache entries without invocation provenance are upgraded on the next
 * deliberate run. Use --force to retranslate everything. Partial output is
 * fine — the site falls back to English for any policy without an ES file.
 *
 * Flags: --force        retranslate even when the cache is fresh
 *        --limit N      only process the first N pending policies (testing)
 *
 * Requires ANTHROPIC_API_KEY (.env).
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
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
const INPUT_DIR = resolve(ROOT, 'data', 'board-policies');
const OUTPUT_DIR = resolve(ROOT, 'data', 'board-policies-es');
const TITLES_PATH = resolve(ROOT, 'data', 'policy-titles-es.json');
const SDK_VERSION = getInstalledPackageVersion('@anthropic-ai/sdk', import.meta.url);

const FORCE = process.argv.includes('--force');
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1], 10) : Infinity;

// Task spec for this dataset names Sonnet explicitly; Claude model ids have
// no date suffix (claude-api skill, models table cached 2026-05-26).
const MODEL = 'claude-sonnet-4-6';
// Pricing per million tokens for claude-sonnet-4-6, from the claude-api
// skill's model table (cached 2026-05-26): $3 input / $15 output.
const INPUT_USD_PER_MTOK = 3.0;
const OUTPUT_USD_PER_MTOK = 15.0;

// Bodies over this size are split at paragraph boundaries and translated in
// multiple requests. 20KB English ≈ ~5K tokens in and ~7K tokens out
// (Spanish runs ~10-25% longer), comfortably under MAX_TOKENS. This is more
// conservative than the task spec's 30KB trigger; only a handful of the 619
// policies exceed it (the largest, 5144.1-AR, is 51KB → 3 chunks).
const MAX_CHUNK_CHARS = 20000;
// Output ceiling per request. The largest unchunked body (~30KB ≈ 7.5K
// tokens) translates to well under this; streaming avoids HTTP timeouts at
// this size (claude-api skill: stream anything that may run long).
const MAX_TOKENS = 32000;
// Six requests in flight at once (task spec). Single-threaded JS, so the
// shared usage/cost counters need no locking.
const CONCURRENCY = 6;

// Validation bounds (task spec): translated length must be 0.5x-2.0x the
// source, paragraph count within ±30%, and the text must not open with
// translator meta-commentary.
const LEN_RATIO_MIN = 0.5;
const LEN_RATIO_MAX = 2.0;
const PARA_RATIO_TOLERANCE = 0.3;
const META_COMMENTARY_RE =
  /^(here (is|are)|here's|i('ve| have) translated|sure[,!]|certainly|aqu[ií] (est[aá]|tienes)|esta es la traducci[oó]n|a continuaci[oó]n,? (se presenta|la traducci[oó]n))/i;

const SYSTEM_PROMPT = `You translate the body text of school board policy documents for the Redwood City School District (a TK-8 public district in Redwood City, California) from English to Spanish.

Audience: Spanish-speaking families in Redwood City, California. Use plain, natural Spanish as spoken in California / Mexico (es-MX). These are legal policy documents, so accuracy comes first: translate faithfully and plainly — do not simplify, summarize, embellish, or editorialize.

Rules:
- Translate the COMPLETE text. Never summarize, condense, or skip passages.
- Preserve the document structure exactly: keep every paragraph break where the original has one, and keep list markers, numbering, and lettering schemes unchanged ((a), (b), 1., 2., A., i., "- " bullets, etc.).
- Keep legal citation strings VERBATIM in English, exactly as written: e.g. "Education Code 35160", "20 USC 6312", "5 CCR 4622", "Government Code 54950", court case names, and bill numbers. Do not translate the names of codes, statutes, or regulations.
- Keep proper nouns, program names, and law names recognizable (e.g. "Williams", "Title IX", "Brown Act", "ESEA"). Keep "Charter" as "Charter" — that is what local families call these schools.
- "Board" here is the school board: use "Mesa Directiva" when it appears. "Superintendent" is "Superintendente".
- Prefer terms California districts actually use with families (e.g. "Asistencia escolar" for attendance, "Quejas" for complaints, "Procedimientos uniformes de quejas" for Uniform Complaint Procedures).
- Output ONLY the translated text. No preamble, no notes, no meta-commentary, no markdown fences.`;

const API_REVISION = '2023-06-01';
const SYSTEM_TEMPLATE_ID = 'policy-body-translation-system-v1';
const USER_TEMPLATE_ID = 'policy-body-translation-user-v1';
const USER_TEMPLATE = 'Translate this board policy text to Spanish:\n\n{{contentText}}';
const OUTPUT_SCHEMA_ID = 'policy-body-translation-text-v1';
const GENERATION_PARAMETERS = {
  sent: { max_tokens: MAX_TOKENS, stream: true },
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
    type: 'plain-text',
    completeness: 'complete-source-text',
    chunking: { maximumCharacters: MAX_CHUNK_CHARS, boundary: 'blank-line-v1' },
    reassembly: 'restore-held-paragraph-separators-v1',
    validation: {
      lengthRatio: [LEN_RATIO_MIN, LEN_RATIO_MAX],
      paragraphRatioTolerance: PARA_RATIO_TOLERANCE,
      metaCommentaryPattern: META_COMMENTARY_RE.source,
    },
    retryPolicy: { maximumAttempts: 2, strategy: 'whole-policy' },
  }),
  toolSchemas: [],
};

let client;
const getClient = () => (client ||= new Anthropic());

const usageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function runningCost() {
  return (usageTotals.input * INPUT_USD_PER_MTOK + usageTotals.output * OUTPUT_USD_PER_MTOK) / 1e6;
}

function paragraphCount(text) {
  return text.split(/\n{2,}/).filter(p => p.trim().length > 0).length;
}

/**
 * Split text into chunks at paragraph boundaries, remembering the separator
 * that followed each chunk so reassembly reproduces the original layout
 * byte-exactly: chunks.map((c, i) => translated[i] + c.sep).join('').
 * A single paragraph larger than maxChars stays whole (still far below
 * MAX_TOKENS); no such paragraph exists in the current corpus.
 */
function splitIntoChunks(text, maxChars) {
  if (text.length <= maxChars) return [{ text, sep: '' }];
  const parts = text.split(/(\n{2,})/); // [para, sep, para, sep, ..., para]
  const units = [];
  for (let i = 0; i < parts.length; i += 2) {
    units.push({ para: parts[i], sep: parts[i + 1] || '' });
  }
  const groups = [];
  let cur = [];
  let curLen = 0;
  for (const u of units) {
    if (curLen > 0 && curLen + u.para.length > maxChars) {
      groups.push(cur);
      cur = [];
      curLen = 0;
    }
    cur.push(u);
    curLen += u.para.length + u.sep.length;
  }
  if (cur.length > 0) groups.push(cur);
  return groups.map(g => ({
    // Trailing separator is held out of the request (models trim trailing
    // whitespace) and restored at reassembly.
    text: g.map((u, i) => (i === g.length - 1 ? u.para : u.para + u.sep)).join(''),
    sep: g[g.length - 1].sep,
  }));
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

function policyIdSegment(policyKey) {
  return policyKey
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function chunkInputRecords(source, chunk, policyKey, chunkIndex) {
  const normalizedKey = policyIdSegment(policyKey);
  return [
    {
      datasetId: `rcsd.board-policy.${normalizedKey}`,
      pointer: '/contentText',
      hash: sha256(source),
    },
    {
      datasetId: `rcsd.board-policy.${normalizedKey}.translation-chunk-${chunkIndex + 1}`,
      hash: sha256(chunk.text),
    },
  ];
}

function invocationForChunk(source, chunk, policyKey, chunkIndex) {
  const userPrompt = USER_TEMPLATE.replace('{{contentText}}', chunk.text);
  const fingerprintFields = {
    purpose: 'translation',
    provider: 'anthropic',
    model: { requested: MODEL, resolved: null },
    endpoint: { api: 'messages', revision: API_REVISION },
    client: { name: '@anthropic-ai/sdk', version: SDK_VERSION },
    parameters: GENERATION_PARAMETERS,
    prompts: { ...PROMPT_HASHES, renderedUserHash: sha256(userPrompt) },
    outputContract: OUTPUT_CONTRACT,
    inputs: chunkInputRecords(source, chunk, policyKey, chunkIndex),
    localization: { sourceLocale: 'en-US', targetLocale: 'es-MX', glossaryHash: null },
    safety: SAFETY_SETTINGS,
    processing: {
      maximumChunkCharacters: MAX_CHUNK_CHARS,
      chunkBoundary: 'blank-line-v1',
      reassembly: 'restore-held-paragraph-separators-v1',
      retryLimit: 2,
      retryStrategy: 'whole-policy',
    },
  };
  const cacheFingerprint = buildLlmCacheFingerprint(fingerprintFields);
  return {
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    invocationId: `policy-body-${policyIdSegment(policyKey)}-chunk-${chunkIndex + 1}-${cacheFingerprint.replace(/^sha256:/, '').slice(0, 16)}`,
    ...fingerprintFields,
    model: { requested: MODEL, resolved: null },
    attempts: [],
    effectiveAttempt: null,
    outputHash: null,
    cacheFingerprint,
  };
}

export function buildBodyTranslationPlan(source, policyKey, titleEs = null) {
  const chunks = splitIntoChunks(source, MAX_CHUNK_CHARS);
  const invocations = chunks.map((chunk, index) =>
    invocationForChunk(source, chunk, policyKey, index));
  const cacheFingerprint = hashCanonicalJson({
    fingerprintVersion: 'policy-body-output-v1',
    titleEsHash: titleEs === null ? null : sha256(titleEs),
    chunkFingerprints: invocations.map(inv => inv.cacheFingerprint),
    separators: chunks.map(chunk => sha256(chunk.sep)),
  });
  return { chunks, invocations, cacheFingerprint };
}

async function callChunk(chunk, invocation, apiClient) {
  const attemptNumber = invocation.attempts.length + 1;
  const userPrompt = USER_TEMPLATE.replace('{{contentText}}', chunk.text);
  const startedAt = new Date().toISOString();
  let response;
  try {
    // Streaming keeps long responses clear of SDK HTTP timeouts.
    const stream = apiClient.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
    response = await stream.finalMessage();
  } catch (err) {
    invocation.attempts.push({
      attempt: attemptNumber,
      startedAt,
      completedAt: new Date().toISOString(),
      model: { requested: MODEL, resolved: null },
      promptHashes: { system: sha256(SYSTEM_PROMPT), user: sha256(userPrompt) },
      outcome: 'failed',
      validation: { status: 'not-run', errors: [] },
      finishReason: null,
    });
    throw err;
  }

  const usage = responseUsage(response);
  addUsage(usage);
  const out = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
  const errors = [];
  if (response.stop_reason !== 'end_turn') {
    errors.push(`unexpected stop_reason "${response.stop_reason}"`);
  }
  if (!out.trim()) errors.push('empty translation');
  const attempt = {
    attempt: attemptNumber,
    startedAt,
    completedAt: new Date().toISOString(),
    model: { requested: MODEL, resolved: response.model && response.model !== MODEL ? response.model : null },
    promptHashes: { system: sha256(SYSTEM_PROMPT), user: sha256(userPrompt) },
    outcome: errors.length ? 'rejected' : 'succeeded',
    validation: { status: errors.length ? 'failed' : 'not-run', errors },
    finishReason: response.stop_reason || null,
    responseHash: sha256(out),
    usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
    estimatedCost: estimatedCost(usage),
  };
  invocation.attempts.push(attempt);
  if (errors.length) throw new Error(errors.join('; '));
  return { text: out.trim(), attempt };
}

/** Validate the assembled translation against the English source. */
function validateTranslation(source, translated) {
  if (!translated.trim()) return 'empty output';
  const ratio = translated.length / source.length;
  if (ratio < LEN_RATIO_MIN || ratio > LEN_RATIO_MAX) {
    return `length ratio ${ratio.toFixed(2)} outside ${LEN_RATIO_MIN}-${LEN_RATIO_MAX}`;
  }
  const srcParas = paragraphCount(source);
  const outParas = paragraphCount(translated);
  const lo = Math.floor(srcParas * (1 - PARA_RATIO_TOLERANCE));
  const hi = Math.ceil(srcParas * (1 + PARA_RATIO_TOLERANCE));
  if (outParas < lo || outParas > hi) {
    return `paragraph count ${outParas} outside ±30% of source ${srcParas} (${lo}-${hi})`;
  }
  if (META_COMMENTARY_RE.test(translated.trimStart())) {
    return 'starts with translator meta-commentary';
  }
  return null;
}

export async function translatePolicy(source, {
  policyKey = 'unknown',
  titleEs = null,
  apiClient = getClient(),
} = {}) {
  const plan = buildBodyTranslationPlan(source, policyKey, titleEs);
  let lastError;

  for (let policyAttempt = 1; policyAttempt <= 2; policyAttempt++) {
    const translated = [];
    const attemptRecords = [];
    try {
      for (let i = 0; i < plan.chunks.length; i++) {
        const result = await callChunk(plan.chunks[i], plan.invocations[i], apiClient);
        translated.push(result.text);
        attemptRecords.push(result.attempt);
      }
    } catch (err) {
      lastError = err;
      for (const record of attemptRecords) {
        record.outcome = 'rejected';
        record.validation = {
          status: 'failed',
          errors: ['whole-policy attempt abandoned after another chunk failed'],
        };
      }
      if (policyAttempt === 1) continue;
      err.llmInvocations = plan.invocations;
      throw err;
    }

    const assembled = translated.map((text, i) => text + plan.chunks[i].sep).join('');
    const problem = validateTranslation(source, assembled);
    for (let i = 0; i < attemptRecords.length; i++) {
      const record = attemptRecords[i];
      record.outcome = problem ? 'rejected' : 'succeeded';
      record.validation = { status: problem ? 'failed' : 'passed', errors: problem ? [problem] : [] };
      if (!problem) {
        plan.invocations[i].effectiveAttempt = record.attempt;
        plan.invocations[i].outputHash = sha256(translated[i]);
      }
    }
    if (problem) {
      lastError = new Error(problem);
      if (policyAttempt === 1) continue;
      lastError.llmInvocations = plan.invocations;
      throw lastError;
    }

    return {
      assembled,
      chunkCount: plan.chunks.length,
      llmInvocations: plan.invocations,
      cacheFingerprint: plan.cacheFingerprint,
    };
  }

  throw lastError || new Error('Unreachable policy translation retry state.');
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set. Add it to .env or export it.');
  }
  const titlesData = JSON.parse(readFileSync(TITLES_PATH, 'utf-8'));
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const files = readdirSync(INPUT_DIR).filter(f => f.endsWith('.json')).sort();
  console.log(`Found ${files.length} policy files in data/board-policies/.`);

  const pending = [];
  let cached = 0;
  let emptySources = 0;

  for (const file of files) {
    const policy = JSON.parse(readFileSync(resolve(INPUT_DIR, file), 'utf-8'));
    const source = policy.contentText || '';
    if (!source.trim()) {
      console.warn(`  Skipping ${file}: empty contentText (nothing to translate; site falls back to English).`);
      emptySources++;
      continue;
    }
    const hash = sha256Hex(source);
    const key = file.replace(/\.json$/, '');
    const titleEs = titlesData.titles?.[key]?.es ?? null;
    const expectedPlan = buildBodyTranslationPlan(source, key, titleEs);
    const cacheFingerprint = expectedPlan.cacheFingerprint;
    const outPath = resolve(OUTPUT_DIR, file);
    if (!FORCE && existsSync(outPath)) {
      const prev = JSON.parse(readFileSync(outPath, 'utf-8'));
      const previousInvocations = prev._metadata?.llmInvocations;
      if (prev._metadata?.sourceHash === hash &&
          prev._metadata?.cacheFingerprint === cacheFingerprint &&
          Array.isArray(previousInvocations) &&
          previousInvocations.length === expectedPlan.invocations.length &&
          previousInvocations.every((invocation, index) =>
            validateLlmInvocation(invocation).valid &&
            invocation.cacheFingerprint === expectedPlan.invocations[index].cacheFingerprint)) {
        cached++;
        continue;
      }
    }
    pending.push({ file, policy, source, hash, titleEs, cacheFingerprint, outPath });
  }

  const work = pending.slice(0, LIMIT);
  console.log(`Cached (source unchanged): ${cached}. Empty sources: ${emptySources}. To translate: ${work.length}${Number.isFinite(LIMIT) ? ` (of ${pending.length} pending, --limit ${LIMIT})` : ''}.`);

  let done = 0;
  let written = 0;
  const failures = [];
  let next = 0;

  async function worker() {
    while (next < work.length) {
      const job = work[next++];
      const { file, policy, source, hash, titleEs, cacheFingerprint, outPath } = job;
      const key = file.replace(/\.json$/, '');
      if (titleEs === null) {
        console.warn(`  ${key}: no Spanish title in policy-titles-es.json; titleEs will be null.`);
      }

      let result = null;
      let lastError = null;
      // translatePolicy retains both attempts and retries once internally so
      // a successful repair publishes the complete attempt history.
      try {
        result = await translatePolicy(source, { policyKey: key, titleEs });
      } catch (err) {
        lastError = err.message;
      }

      done++;
      if (!result) {
        failures.push({ key, reason: lastError });
        console.warn(`  ${key}: FAILED after retry (${lastError}) — skipped.`);
        continue;
      }

      const output = {
        code: policy.code,
        type: policy.type,
        titleEs,
        contentTextEs: result.assembled,
        _metadata: {
          model: MODEL,
          generatedAt: new Date().toISOString(),
          method: `AI translation of contentText via the Claude API (scripts/translate-policy-bodies.mjs); one policy per request, bodies over ${MAX_CHUNK_CHARS / 1000}KB split at paragraph boundaries into ${result.chunkCount > 1 ? result.chunkCount + ' chunks' : 'chunks'} and reassembled; validated for length, paragraph structure, and meta-commentary`,
          sourceFile: `data/board-policies/${file}`,
          sourceHash: hash,
          cacheFingerprint,
          llmInvocationIds: result.llmInvocations.map(invocation => invocation.invocationId),
          llmInvocations: result.llmInvocations,
          note: 'Machine translation. The English Simbli version is authoritative.',
        },
      };
      writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
      written++;
      console.log(`  [${done}/${work.length}] ${key} (${source.length} chars${result.chunkCount > 1 ? `, ${result.chunkCount} chunks` : ''}) — running cost $${runningCost().toFixed(2)}`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log('\n=== Summary ===');
  console.log(`Written: ${written}. Cached: ${cached}. Empty sources skipped: ${emptySources}. Failures: ${failures.length}.`);
  for (const f of failures) console.log(`  FAILED ${f.key}: ${f.reason}`);
  const cost = runningCost();
  console.log(`Token usage: ${usageTotals.input} in (${usageTotals.cacheRead} cache-read, ${usageTotals.cacheWrite} cache-write), ${usageTotals.output} out ≈ $${cost.toFixed(2)} (${MODEL} at $${INPUT_USD_PER_MTOK}/$${OUTPUT_USD_PER_MTOK} per MTok)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('Translation failed:', err.message);
    process.exit(1);
  });
}
