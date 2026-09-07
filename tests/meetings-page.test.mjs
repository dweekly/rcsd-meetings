// The meetings index decides which school year opens by default, and shows what a
// future meeting will cover before its agenda posts. Both were previously written
// as literals that quietly went stale: the open-year check named 2025-26 and
// 2024-25, so the roll into 2026-27 left the current year collapsed while two past
// years were permanently expanded, and the planned topics existed only in a title
// attribute, which a touch device never shows.
//
// These read the builder source rather than its output, because the built pages are
// deliberately not committed on a branch — the rot being guarded against is in the
// source, and it is what a future edit would reintroduce.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { currentSchoolYear } from '../scripts/lib/school-year.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const builder = readFileSync(resolve(ROOT, 'scripts/build-meetings-html.mjs'), 'utf-8');

test('the open school year is derived, not written out', () => {
  const line = builder.split('\n').find((l) => l.includes('const expanded ='));
  assert.ok(line, 'could not find the school-year expansion decision');
  assert.match(line, /CURRENT_SY_KEY/,
    'the open year must come from the shared current-school-year definition');
  assert.doesNotMatch(line, /['"]\d{6}['"]/,
    'the open year is hardcoded again; it will be wrong on the next August roll-over');

  const key = builder.split('\n').find((l) => l.includes('const CURRENT_SY_KEY'));
  assert.match(key, /currentSchoolYear\(\)/,
    'CURRENT_SY_KEY must come from scripts/lib/school-year.mjs');
});

test('the derived key matches the section ids the page builds', () => {
  // Sections are keyed '202627'; currentSchoolYear() returns '2026-27'. A change to
  // either format silently stops matching, which is a no-op that opens nothing.
  const key = currentSchoolYear().replace(/(\d{4})-(\d{2})/, '$1$2');
  assert.match(key, /^\d{6}$/, `derived section key is not six digits: ${key}`);
});

test('every school year is the same collapsible control', () => {
  // Previously the expanded years rendered as plain <section>, so the current year
  // could not be collapsed at all while older ones could.
  assert.doesNotMatch(builder, /return `<section class="section" id="\$\{id\}">/,
    'renderSchoolYear still has a non-collapsible branch');
  assert.match(builder, /<details class="section section-collapsible" id="\$\{id\}"\$\{collapsed \? '' : ' open'\}>/,
    'school-year sections must all be <details>, with only the default-open one carrying open');
});

test('planned topics are rendered, not hidden in a tooltip', () => {
  const cell = builder.slice(builder.indexOf('const topics = govCalTopics[dateStr]'));
  const block = cell.slice(0, cell.indexOf('}).join('));
  assert.match(block, /cal-cell-topics/,
    'the calendar cell must render its topics as text');
  assert.doesNotMatch(block, /title="\$\{escapeHtml\(topicText\)\}"/,
    'topics are back in a title attribute, which is unreachable on a touch device');
});

test('a meeting with no planned topics still says so in both languages', () => {
  const cell = builder.slice(builder.indexOf('const topics = govCalTopics[dateStr]'));
  const block = cell.slice(0, cell.indexOf('}).join('));
  assert.match(block, /L\.lang === 'es'/,
    'the empty-topics fallback must be bilingual, not English on the Spanish page');
});
