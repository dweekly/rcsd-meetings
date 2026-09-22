// A meeting summary written from the transcript says what the board decided; one
// written from the agenda can only say what was listed. Both generators write the
// same files, so these tests pin the rules that stop the weaker one overwriting
// the stronger, and that stop either from writing a key nothing reads.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { getSummaryKey, lookupSummary } from '../scripts/lib/meeting-summary-key.mjs';
import {
  readProvenance, isTranscriptDerived, matchesRecordedSummary, summaryHash, PROVENANCE_FILENAME,
} from '../scripts/lib/summary-provenance.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf-8'));

test('a meeting is keyed by date, and by slug only when a date holds two meetings', () => {
  const soloDate = [{ date: '2026-09-23', slug: '2026-09-23-regular' }];
  assert.equal(getSummaryKey(soloDate[0], soloDate), '2026-09-23');

  const sharedDate = [
    { date: '2020-04-01', slug: '2020-04-01-board-meeting' },
    { date: '2020-04-01', slug: '2020-04-01-board-meeting-2' },
  ];
  assert.equal(getSummaryKey(sharedDate[0], sharedDate), '2020-04-01-board-meeting');
  assert.equal(getSummaryKey(sharedDate[1], sharedDate), '2020-04-01-board-meeting-2');
});

test('a summary is found whether it was stored under the date or the slug', () => {
  const meetings = [{ date: '2026-09-23', slug: '2026-09-23-regular' }];
  assert.equal(lookupSummary({ '2026-09-23': 'by date' }, meetings[0], meetings), 'by date');
  assert.equal(lookupSummary({ '2026-09-23-regular': 'by slug' }, meetings[0], meetings), 'by slug');
  assert.equal(lookupSummary({}, meetings[0], meetings), undefined);
});

test('a transcript-derived summary is protected from the agenda generator', () => {
  const provenance = {
    '2026-09-09': { source: 'transcript', model: 'claude-sonnet-4-6' },
    '2026-09-23': { source: 'agenda', model: 'claude-haiku-4-5-20251001' },
  };
  assert.equal(isTranscriptDerived(provenance, '2026-09-09'), true);
  assert.equal(isTranscriptDerived(provenance, '2026-09-23'), false,
    'an agenda-derived summary may be regenerated from the agenda');
  assert.equal(isTranscriptDerived(provenance, '2025-01-01'), false,
    'a hand-written summary has no record and is left to the explicit-date path');
  assert.equal(isTranscriptDerived({}, '2026-09-09'), false);
  assert.equal(isTranscriptDerived(undefined, '2026-09-09'), false,
    'a missing provenance file must not throw — it is absent before the first run');
});

test('the agenda generator refuses to refresh a transcript-derived summary', () => {
  // The guard is the reason the nightly pipeline cannot walk this work back to
  // agenda prose, so assert it is actually wired into the refresh path.
  const src = readFileSync(resolve(ROOT, 'scripts/generate-meeting-summaries.mjs'), 'utf-8');
  assert.match(src, /isTranscriptDerived\(provenance, key\)/,
    'generate-meeting-summaries.mjs must consult provenance before deleting a summary');
  const guardBeforeDelete = src.indexOf('isTranscriptDerived(provenance, key)') < src.indexOf('delete enSummaries[key]');
  assert.ok(guardBeforeDelete, 'the guard must run before the delete, not after it');
});

test('every recorded summary provenance points at a summary that exists', () => {
  if (!existsSync(resolve(ROOT, PROVENANCE_FILENAME))) return; // nothing generated yet
  const provenance = readProvenance(ROOT);
  const en = read('data/meeting-summaries.json');
  const es = read('data/meeting-summaries-es.json');

  const orphanedEn = Object.keys(provenance).filter((k) => !(k in en));
  const orphanedEs = Object.keys(provenance).filter((k) => !(k in es));
  assert.deepEqual(orphanedEn, [], 'provenance records a summary that does not exist in English');
  assert.deepEqual(orphanedEs, [], 'a Spanish summary is missing for a generated meeting');
});

test('every transcript-derived summary names the transcript it came from', () => {
  if (!existsSync(resolve(ROOT, PROVENANCE_FILENAME))) return;
  const provenance = readProvenance(ROOT);
  for (const [key, record] of Object.entries(provenance)) {
    if (record.source !== 'transcript') continue;
    assert.ok(record.transcriptKey, `${key}: transcript-derived but names no transcript`);
    assert.ok(record.model, `${key}: no model recorded — provenance must say what wrote it`);
    assert.match(record.model, /^claude-[a-z0-9-]+$/,
      `${key}: model id should carry no date suffix`);
    assert.match(record.generatedAt, /^\d{4}-\d{2}-\d{2}$/, `${key}: no generation date`);
  }
});

test('a bulk range run cannot overwrite a summary this script did not write', () => {
  // A summary with text but no provenance record is hand-written: it cites board
  // packet figures that nobody says aloud, so a transcript cannot reproduce them
  // and regenerating one loses published detail. --range must not be able to
  // reach those; only naming the date outright may.
  const src = readFileSync(resolve(ROOT, 'scripts/generate-transcript-summaries.mjs'), 'utf-8');
  assert.match(src, /enSummaries\[key\] && !provenance\[key\] && !namedExplicitly/,
    'the generator must protect summaries it did not write');
  assert.match(src, /namedExplicitly\s*=\s*targetDates\.includes/,
    'naming a date explicitly is the documented override');
});

test('the hand-written summaries are still intact', () => {
  // These cite figures that appear nowhere in their transcripts ($14.3M on
  // 2025-08-19, $6.4M and $2.29M on 2026-02-04). A regeneration that silently
  // replaced them would read as a normal diff, so assert the detail is present.
  const en = read('data/meeting-summaries.json');
  const expected = {
    '2025-08-19': /\$14\.3M/,
    '2026-02-04': /\$6\.4M/,
    '2025-10-08': /\$89\.5M/,
    '2025-11-19': /4-0/,
  };
  for (const [date, pattern] of Object.entries(expected)) {
    assert.match(en[date] ?? '', pattern,
      `${date}: hand-written detail is gone — a generator overwrote a summary it should not have`);
  }
});

test('a summary is re-generated when either language has drifted from its record', () => {
  // The English and Spanish files are restored from git independently, so English
  // matching its record says nothing about Spanish. Checking only English would
  // skip a meeting whose Spanish had reverted, permanently.
  const en = 'The Board approved a substitute classified management position.';
  const es = 'La Junta aprobó un puesto administrativo clasificado sustituto.';
  const provenance = {
    '2026-09-09': {
      source: 'transcript',
      enHash: summaryHash(en),
      esHash: summaryHash(es),
    },
  };

  assert.equal(matchesRecordedSummary(provenance, '2026-09-09', en, es), true,
    'both languages match the record — nothing to do');
  assert.equal(matchesRecordedSummary(provenance, '2026-09-09', en, 'texto viejo'), false,
    'stale Spanish must trigger a regeneration even when English is current');
  assert.equal(matchesRecordedSummary(provenance, '2026-09-09', 'stale english', es), false,
    'and the same the other way round');
  assert.equal(matchesRecordedSummary(provenance, '2026-09-09', en, undefined), false,
    'a missing Spanish summary is drift, not a match');
});

test('a record written before hashing is trusted on its flag', () => {
  const legacy = { '2025-01-01': { source: 'transcript' } };
  assert.equal(matchesRecordedSummary(legacy, '2025-01-01', 'anything', 'cualquiera'), true,
    'older records carry no hashes and must not be regenerated needlessly');
});

test('every transcript-derived record fingerprints both languages', () => {
  if (!existsSync(resolve(ROOT, PROVENANCE_FILENAME))) return;
  const provenance = readProvenance(ROOT);
  const en = read('data/meeting-summaries.json');
  const es = read('data/meeting-summaries-es.json');
  for (const [key, record] of Object.entries(provenance)) {
    if (record.source !== 'transcript' || !record.enHash) continue;
    assert.equal(record.enHash, summaryHash(en[key]), `${key}: English summary does not match its record`);
    assert.ok(record.esHash, `${key}: no Spanish fingerprint — bilingual parity is not optional here`);
    assert.equal(record.esHash, summaryHash(es[key]), `${key}: Spanish summary does not match its record`);
  }
});
