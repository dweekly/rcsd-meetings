#!/usr/bin/env node
/**
 * Assert pipeline health guards — final workflow step (after upload/commit/
 * deploy, so a failure alerts WITHOUT discarding the run's paid API work).
 *
 * Reads data/translation-health.json, written by translate-transcripts.mjs
 * each full run, and exits non-zero when:
 *   - the per-run cost guard tripped (spend hit MAX_RUN_COST), or
 *   - the stale-refresh backlog has not shrunk for staleStuckThreshold
 *     consecutive saturated-cap runs (the Aug 2026 poisoned-cache failure
 *     mode: work completes and is paid for, then reads as stale again next
 *     run — see pipeline.yml and ROADMAP.md).
 *
 * A red scheduled run triggers GitHub's workflow-failure notification, which
 * is the alert channel. The condition re-fails on every run (including
 * --quick runs, which don't rewrite the file) until a healthy full run
 * clears it — that persistence is intentional.
 *
 * Usage: node scripts/check-pipeline-health.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HEALTH_PATH = resolve(ROOT, 'data/translation-health.json');

if (!existsSync(HEALTH_PATH)) {
  console.log('No translation health record yet — passing (first run or translation never executed).');
  process.exit(0);
}

const health = JSON.parse(readFileSync(HEALTH_PATH, 'utf-8'));
const { lastRun = {}, staleStuckRuns = 0, staleStuckThreshold = 4 } = health;
const problems = [];

if (lastRun.guardTripped) {
  problems.push(`Cost guard tripped: translate run spent $${lastRun.totalCost} (ceiling $${lastRun.maxRunCost}) at ${lastRun.generatedAt}. Investigate before the next scheduled run re-spends.`);
}
if (staleStuckRuns >= staleStuckThreshold) {
  problems.push(`Stale backlog stuck: ${staleStuckRuns} consecutive saturated-cap runs without staleDeferred shrinking (last: ${lastRun.staleQueued} queued / ${lastRun.staleDeferred} deferred). Completed translations are likely being lost — check the R2 restore/upload path (see the Aug 2026 incident in pipeline.yml).`);
}

if (problems.length > 0) {
  console.error('PIPELINE HEALTH GUARD FAILED:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`Pipeline health OK (last translate run: ${lastRun.translated} translated, $${lastRun.totalCost}, ${lastRun.staleDeferred} deferred; stuck streak ${staleStuckRuns}/${staleStuckThreshold}).`);
