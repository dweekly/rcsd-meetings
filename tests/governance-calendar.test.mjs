// data/governance-calendar.json is what the site shows for a meeting that has no
// formal agenda yet — on the homepage, the meeting calendar and the ICS feed. It is
// extracted from the district's Schedule of Agenda Items, a document that marks its
// own edits: additions in red, deletions struck through. Publishing a struck row
// would tell families a meeting will cover something the district has removed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = new URL('..', import.meta.url).pathname;
const doc = JSON.parse(readFileSync(resolve(ROOT, 'data/governance-calendar.json'), 'utf8'));
const topics = doc.provisionalTopics ?? {};

test('every provisional topic carries both languages', () => {
  // build-homepage.mjs and build-ics.mjs read `.es` directly; an entry without it
  // renders English on a Spanish page, which the project treats as a bug.
  const missing = Object.entries(topics)
    .filter(([, v]) => !v.en?.trim() || !v.es?.trim())
    .map(([date]) => date);
  assert.deepEqual(missing, [],
    `these dates lack en or es: ${missing.join(', ')} — run scripts/translate-governance-calendar.mjs`);
});

test('the English and Spanish lines list the same number of topics', () => {
  // Topics are joined with "; ". A translation that merges or drops a segment is
  // silently showing Spanish readers a different agenda.
  const skewed = Object.entries(topics)
    .filter(([, v]) => v.en.split(';').length !== v.es.split(';').length)
    .map(([date]) => date);
  assert.deepEqual(skewed, [], `segment counts differ between languages on: ${skewed.join(', ')}`);
});

test('rows struck through in the Schedule are not published as planned topics', () => {
  // Both known deletions in the 2026-27 Schedule, confirmed against the rendered
  // pages: "Communications Update" struck from Sept 9 2026, and "Parent Engagement
  // Report" struck from Dec 9 2026 (it moved to May 26 2027, where it is a red
  // addition and must still be present).
  assert.ok(doc._droppedStruckRows >= 2,
    `expected the extractor to report the struck rows it dropped, got ${doc._droppedStruckRows}`);

  assert.doesNotMatch(topics['2026-09-09']?.en ?? '', /Communications Update/i,
    'Sept 9 2026 is publishing a topic the district struck from the Schedule');
  assert.doesNotMatch(topics['2026-12-09']?.en ?? '', /Parent Engagement/i,
    'Dec 9 2026 is publishing a topic the district struck from the Schedule');
  assert.match(topics['2027-05-26']?.en ?? '', /Parent Engagement/i,
    'May 26 2027 should keep Parent Engagement Report — it is a red addition, not a deletion');
});

test('dates are ISO and provenance names its source document', () => {
  for (const date of Object.keys(topics)) {
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/, `not an ISO date: ${date}`);
  }
  for (const field of ['_source', '_sourceUrl', '_generated', '_method']) {
    assert.ok(doc[field], `provenance field ${field} is missing`);
  }
});
