#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  buildTitleBatchFingerprint,
  translateBatch,
} from './translate-policy-titles.mjs';
import {
  buildBodyTranslationPlan,
  translatePolicy,
} from './translate-policy-bodies.mjs';
import {
  buildSummaryFingerprint,
  summarizePolicy,
} from './generate-policy-summaries.mjs';
import { validateLlmInvocation } from './lib/provenance.mjs';
import { validateJsonSchema } from './lib/provenance-schema.mjs';

function assertValidInvocation(invocation) {
  const result = validateLlmInvocation(invocation);
  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
  const schemaResult = validateJsonSchema('llm', invocation);
  assert.equal(schemaResult.valid, true, JSON.stringify(schemaResult.errors, null, 2));
}

function response(text, { model = 'claude-sonnet-4-6', stopReason = 'end_turn' } = {}) {
  return {
    model,
    stop_reason: stopReason,
    content: [{ type: 'text', text }],
    usage: {
      input_tokens: 12,
      output_tokens: 7,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  };
}

function createClient(responses) {
  let cursor = 0;
  const next = async () => {
    if (cursor >= responses.length) throw new Error('fake client exhausted');
    const value = responses[cursor++];
    if (value instanceof Error) throw value;
    return value;
  };
  return {
    get calls() { return cursor; },
    messages: {
      create: next,
      stream() { return { finalMessage: next }; },
    },
  };
}

async function testTitleAttempts() {
  const items = [{ id: 'T0000', en: 'Philosophy' }];
  assert.equal(buildTitleBatchFingerprint(items), buildTitleBatchFingerprint(items));
  assert.notEqual(
    buildTitleBatchFingerprint(items),
    buildTitleBatchFingerprint([{ id: 'T0000', en: 'Goals' }])
  );

  const fake = createClient([
    response('{"translations":[]}'),
    response('{"translations":[{"id":"T0000","es":"Filosofía"}]}'),
  ]);
  const { translations, invocation } = await translateBatch(items, { apiClient: fake });
  assert.equal(translations.T0000, 'Filosofía');
  assert.equal(invocation.attempts.length, 2);
  assert.equal(invocation.attempts[0].outcome, 'rejected');
  assert.equal(invocation.attempts[1].outcome, 'succeeded');
  assert.equal(invocation.effectiveAttempt, 2);
  assert.match(invocation.outputHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(invocation.client.version, '0.104.1');
  assert.deepEqual(invocation.parameters.sent, { max_tokens: 4096, thinking: { type: 'disabled' } });
  assertValidInvocation(invocation);
}

async function testProviderFailureHistory() {
  const items = [{ id: 'T0000', en: 'Goals' }];
  const fake = createClient([
    new Error('synthetic provider failure'),
    response('{"translations":[{"id":"T0000","es":"Metas"}]}'),
  ]);
  const { invocation } = await translateBatch(items, { apiClient: fake });
  assert.equal(invocation.attempts[0].outcome, 'failed');
  assert.equal(invocation.attempts[0].validation.status, 'not-run');
  assert.equal(invocation.attempts[1].outcome, 'succeeded');
  assert.equal(invocation.effectiveAttempt, 2);
  assertValidInvocation(invocation);
}

async function testBodyAttempts() {
  const source = 'The Board requires safe schools.';
  const plan = buildBodyTranslationPlan(source, '0420.41-E PDF(1)-AR', 'Escuelas seguras');
  assert.equal(plan.invocations.length, 1);
  assert.match(plan.invocations[0].invocationId, /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
  assert.notEqual(
    plan.cacheFingerprint,
    buildBodyTranslationPlan(source, '0420.41-E PDF(1)-AR', 'Otro título').cacheFingerprint
  );

  const fake = createClient([
    response('Here is the translation: La Mesa Directiva exige escuelas seguras.'),
    response('La Mesa Directiva exige escuelas seguras.'),
  ]);
  const result = await translatePolicy(source, {
    policyKey: '0420.41-E PDF(1)-AR',
    titleEs: 'Escuelas seguras',
    apiClient: fake,
  });
  assert.equal(result.assembled, 'La Mesa Directiva exige escuelas seguras.');
  assert.equal(result.llmInvocations[0].attempts.length, 2);
  assert.equal(result.llmInvocations[0].attempts[0].outcome, 'rejected');
  assert.equal(result.llmInvocations[0].attempts[1].outcome, 'succeeded');
  assert.equal(result.llmInvocations[0].effectiveAttempt, 2);
  assertValidInvocation(result.llmInvocations[0]);
}

async function testChunkedBodyLineage() {
  const paragraph = 'La Mesa Directiva mantiene escuelas seguras. '.repeat(300).trim();
  const source = `${paragraph}\n\n${paragraph}`;
  const echoClient = {
    messages: {
      stream(request) {
        const prefix = 'Translate this board policy text to Spanish:\n\n';
        const translated = request.messages[0].content.slice(prefix.length);
        return { finalMessage: async () => response(translated) };
      },
    },
  };
  const result = await translatePolicy(source, {
    policyKey: '5144.1-AR',
    titleEs: 'Suspensión y expulsión',
    apiClient: echoClient,
  });
  assert.equal(result.chunkCount, 2);
  assert.equal(result.assembled, source);
  assert.equal(new Set(result.llmInvocations.map(inv => inv.invocationId)).size, 2);
  result.llmInvocations.forEach(assertValidInvocation);
}

async function testSummaryRepairPrompt() {
  const policy = {
    code: '0420.41-E PDF(1)',
    type: 'BP',
    title: 'Safe Schools',
    contentText: 'The Board requires every school to maintain a safe learning environment.',
  };
  assert.equal(buildSummaryFingerprint(policy), buildSummaryFingerprint(policy));
  assert.notEqual(
    buildSummaryFingerprint(policy),
    buildSummaryFingerprint({ ...policy, contentText: `${policy.contentText} Updated.` })
  );

  const fake = createClient([
    response(JSON.stringify({
      en: 'This policy requires safe schools.',
      es: 'Esta política exige escuelas seguras.',
    })),
    response(JSON.stringify({
      en: 'Requires every school to maintain a safe learning environment.',
      es: 'Exige que cada escuela mantenga un ambiente de aprendizaje seguro.',
    })),
  ]);
  const result = await summarizePolicy(policy, { apiClient: fake });
  assert.match(result.invocation.invocationId, /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
  assert.equal(result.invocation.attempts.length, 2);
  assert.equal(result.invocation.attempts[0].outcome, 'rejected');
  assert.equal(result.invocation.attempts[1].outcome, 'succeeded');
  assert.notEqual(
    result.invocation.attempts[0].promptHashes.user,
    result.invocation.attempts[1].promptHashes.user,
    'repair attempt must retain its distinct rendered prompt hash'
  );
  assert.equal(result.invocation.effectiveAttempt, 2);
  assertValidInvocation(result.invocation);
}

await testTitleAttempts();
await testProviderFailureHistory();
await testBodyAttempts();
await testChunkedBodyLineage();
await testSummaryRepairPrompt();
console.log('Policy LLM provenance tests passed.');
