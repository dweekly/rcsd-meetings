#!/usr/bin/env node
// Run the eval corpus through the PRODUCTION answer path: bundles src/agent.ts +
// src/prompts.ts with esbuild and calls generateReply() exactly as the worker
// does (same model, MCP connector, sanitization) — everything except Twilio
// delivery and KV context (each question runs as a fresh first contact).
//
//   node eval/run-eval.mjs [--only 27,63] [--concurrency 6]
//
// Writes eval/results/latest.json (gitignored). Judge with judge-eval.mjs.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUESTIONS } from './questions.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'results');
mkdirSync(OUT_DIR, { recursive: true });

function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const env = readFileSync(join(__dirname, '..', '..', '..', '.env'), 'utf8');
  const m = env.match(/^ANTHROPIC_API_KEY=(.+)$/m);
  if (m) return m[1].trim();
  throw new Error('ANTHROPIC_API_KEY not found');
}

// Bundle the worker's own modules so the eval can never drift from production.
const bundle = join(OUT_DIR, '.worker-bundle.mjs');
execFileSync(
  'npx',
  ['esbuild', '--bundle', '--format=esm', `--outfile=${bundle}`,
   join(__dirname, '..', 'src', 'eval-entry.ts')],
  { cwd: join(__dirname, '..'), stdio: 'pipe' },
);
const { generateReply, promptsForLine, EN_LINE, ES_LINE } = await import(bundle);

const args = process.argv.slice(2);
const onlyArg = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const only = onlyArg ? new Set(onlyArg.split(',').map(Number)) : null;
const concurrency = args.includes('--concurrency')
  ? parseInt(args[args.indexOf('--concurrency') + 1], 10) : 6;

const todo = QUESTIONS.filter((q) => !only || only.has(q.id));
const key = apiKey();
const results = [];
let done = 0;

async function runOne(q) {
  const lineNumber = q.line === 'es' ? ES_LINE : EN_LINE;
  const { system, disclosure } = promptsForLine(lineNumber);
  const t0 = Date.now();
  try {
    const reply = await generateReply(key, system, [{ role: 'user', content: q.q }]);
    return { ...q, reply: disclosure + reply, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ...q, reply: null, error: String(err), latencyMs: Date.now() - t0 };
  }
}

const queue = [...todo];
await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const q = queue.shift();
      const r = await runOne(q);
      results.push(r);
      done++;
      console.log(`[${done}/${todo.length}] #${r.id} ${r.error ? 'ERROR' : r.latencyMs + 'ms'} (${r.category})`);
    }
  }),
);

results.sort((a, b) => a.id - b.id);
const out = { ranAt: new Date().toISOString(), count: results.length, results };
writeFileSync(join(OUT_DIR, 'latest.json'), JSON.stringify(out, null, 2));
const errors = results.filter((r) => r.error).length;
const avg = Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length);
console.log(`\nDone: ${results.length} answers, ${errors} errors, avg ${avg}ms → eval/results/latest.json`);
