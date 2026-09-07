#!/usr/bin/env node
/**
 * Every agenda pull owes a theme triage: reading the new attachments by theme and
 * folding what is salient into the page that owns it (see CLAUDE.md, "Agenda Pull
 * → Theme Triage"). Pulling the PDFs puts them on the meeting page; it does not
 * update /district/budget/, the charter pages, or properties.json, and those are
 * hand-authored from a source snapshot, so they go stale silently.
 *
 * That rule lived only in prose and was missed for two consecutive meetings, so
 * this makes it visible: a meeting with attachments and no `data/triage/<date>.md`
 * is reported. The pipeline prints outstanding meetings in its run summary; the
 * test suite fails on them.
 *
 *   node scripts/check-triage.mjs            # exit 1 if any are outstanding
 *   node scripts/check-triage.mjs --quiet    # machine-readable, one date per line
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const MEMO_DIR = resolve(ROOT, 'data/board-memos');
const TRIAGE_DIR = resolve(ROOT, 'data/triage');

/**
 * Triage begins with the Aug 26 2026 meeting, the first one triaged. Earlier
 * meetings are not backfilled: the point is to catch the next pull, not to
 * manufacture 200 records after the fact.
 */
export const TRIAGE_FROM = '2026-08-26';

function attachmentCount(memo) {
  let n = 0;
  const walk = (items = []) => {
    for (const item of items) {
      n += (item.documents ?? item.attachments ?? []).length;
      walk(item.children);
    }
  };
  walk(memo.items);
  return n;
}

/** Meetings at or after TRIAGE_FROM that have attachments but no triage record. */
export function outstandingTriage() {
  if (!existsSync(MEMO_DIR)) return [];
  return readdirSync(MEMO_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((date) => date >= TRIAGE_FROM)
    .filter((date) => {
      let memo;
      try {
        memo = JSON.parse(readFileSync(resolve(MEMO_DIR, `${date}.json`), 'utf-8'));
      } catch {
        return false; // an unreadable memo is a different problem, reported elsewhere
      }
      if (attachmentCount(memo) === 0) return false;
      return !existsSync(resolve(TRIAGE_DIR, `${date}.md`));
    })
    .sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const quiet = process.argv.includes('--quiet');
  const outstanding = outstandingTriage();
  if (quiet) {
    outstanding.forEach((d) => console.log(d));
  } else if (outstanding.length === 0) {
    console.log('  Theme triage: up to date.');
  } else {
    console.log(`  Theme triage OUTSTANDING for ${outstanding.length} meeting(s): ${outstanding.join(', ')}`);
    console.log('  Read the new attachments by theme and route them to the owning page,');
    console.log('  then write data/triage/<date>.md. See CLAUDE.md, "Agenda Pull → Theme Triage".');
  }
  process.exit(outstanding.length === 0 ? 0 : 1);
}
