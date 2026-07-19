#!/usr/bin/env node
/**
 * Deterministic post-transcription normalization of known ASR confusables.
 *
 * Every rule was verified against the July 2026 full-corpus backfill by
 * reading each match in context (see TRANSCRIPTION-BACKFILL.md): these are
 * mis-hearings of district-specific names/terms, never legitimate words.
 * Ambiguous candidates (e.g. "MTS", which is usually MTSS but once appears as
 * "MTS superintendent") are deliberately excluded.
 *
 * Applies to text, utterances[].text, and word tokens (both the top-level
 * words[] array and utterances[].words[]). Bigram rules only rewrite a word
 * token when the preceding token matches, so a real "Ms. Lee" stays intact.
 * Adds a _normalization provenance block to each modified transcript.
 *
 * Usage:
 *   node scripts/normalize-transcripts.mjs --dry-run   # report counts only
 *   node scripts/normalize-transcripts.mjs --apply     # rewrite in place
 */
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = resolve(ROOT, 'artifacts/transcripts-aai');
const apply = process.argv.includes('--apply');
if (!apply && !process.argv.includes('--dry-run')) {
  console.error('Pass --dry-run or --apply');
  process.exit(1);
}

const RULES_VERSION = 1;

// Single-token rules: [wrong token regex, replacement]
const TOKEN_RULES = [
  [/^McAvoy(['’]?s?[.,?!]?)$/, 'MacAvoy$1'], // Trustee Alisa MacAvoy
  [/^LCP(['’]?s?[.,?!]?)$/, 'LCAP$1'], // Local Control and Accountability Plan
  [/^Weekley(['’]?s?[.,?!]?)$/, 'Weekly$1'], // Trustee David Weekly
  [/^CASPP?(['’]?s?[.,?!]?)$/, 'CAASPP$1'], // state assessment, spoken "cass-p"
  [/^LPAC(['’]?s?[.,?!]?)$/, 'ELPAC$1'], // English Language Proficiency Assessments
];

// Bigram rules: rewrite the second token only when preceded by the first.
const BIGRAM_RULES = [
  ['Trustee', /^Lee(['’]?s?[.,?!]?)$/, 'Li$1'], // Trustee David Li
  ['Trustee', /^Wheatley(['’]?s?[.,?!]?)$/, 'Weekly$1'], // Trustee David Weekly
];

// The same rules expressed over running text (for text / utterances[].text).
const TEXT_RULES = [
  [/\bMcAvoy\b/g, 'MacAvoy'],
  [/\bLCP\b/g, 'LCAP'],
  [/\bWeekley\b/g, 'Weekly'],
  [/\bCASPP?\b/g, 'CAASPP'],
  [/\bLPAC\b/g, 'ELPAC'],
  [/\bTrustee Lee\b/g, 'Trustee Li'],
  [/\bTrustee Wheatley\b/g, 'Trustee Weekly'],
];

function fixText(s, counts) {
  let out = s;
  for (const [pat, rep] of TEXT_RULES) {
    out = out.replace(pat, (m) => {
      counts[pat.source] = (counts[pat.source] || 0) + 1;
      return m.replace(new RegExp(pat.source), rep);
    });
  }
  return out;
}

function fixWordArray(words, counts) {
  if (!Array.isArray(words)) return;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    for (const [pat, rep] of TOKEN_RULES) {
      if (pat.test(w.text)) {
        w.text = w.text.replace(pat, rep);
        counts[`token:${pat.source}`] = (counts[`token:${pat.source}`] || 0) + 1;
      }
    }
    for (const [prev, pat, rep] of BIGRAM_RULES) {
      if (i > 0 && words[i - 1].text.replace(/[.,?!]/g, '') === prev && pat.test(w.text)) {
        w.text = w.text.replace(pat, rep);
        counts[`bigram:${prev} ${pat.source}`] = (counts[`bigram:${prev} ${pat.source}`] || 0) + 1;
      }
    }
  }
}

const totals = {};
let touched = 0;
for (const file of readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json'))) {
  const path = resolve(CACHE_DIR, file);
  const t = JSON.parse(readFileSync(path, 'utf-8'));
  const counts = {};
  t.text = fixText(t.text || '', counts);
  for (const u of t.utterances || []) u.text = fixText(u.text, counts);
  fixWordArray(t.words, counts);
  for (const u of t.utterances || []) fixWordArray(u.words, counts);
  const n = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!n) continue;
  touched++;
  for (const [k, v] of Object.entries(counts)) totals[k] = (totals[k] || 0) + v;
  if (apply) {
    t._normalization = { rulesVersion: RULES_VERSION, appliedAt: new Date().toISOString(), counts };
    writeFileSync(path, JSON.stringify(t, null, 2));
  }
}

console.log(`${apply ? 'APPLIED' : 'DRY RUN'} — ${touched} transcripts affected`);
for (const [k, v] of Object.entries(totals).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
