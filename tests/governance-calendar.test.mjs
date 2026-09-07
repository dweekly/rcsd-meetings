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

// The three tests below exist because the first version of the extractor passed
// every other assertion in this file while publishing wrong data. Each pins one
// class of parsing mistake against a case taken from the 2026-27 Schedule.

test('a date heading with a qualifier is its own meeting', () => {
  // "September 30, 2026 - Study Session" carries a suffix after the year. A date
  // pattern anchored to the year rejects the whole heading, and the study session's
  // topics are then filed under the meeting above it — telling families the wrong
  // date for a real discussion.
  assert.ok(topics['2026-09-30'], 'September 30 2026 is a scheduled meeting and must have its own entry');
  assert.match(topics['2026-09-30'].en, /Formative Assessment|PLC/i,
    'September 30 should carry the study-session topics');
  assert.doesNotMatch(topics['2026-09-23'].en, /Board Study Session Re:/i,
    'September 23 is publishing September 30 topics — the date heading was not recognised');
});

test('topics whose text starts outside their cell are still topics', () => {
  // Cell text can begin a few points left of its own column border, so assigning a
  // span by its left edge files it under Department, where summarise() drops it
  // silently. These four are the cases that occur in the 2026-27 Schedule.
  const expected = [
    ['2027-01-20', /Declaration of Need/i],
    ['2027-02-24', /Personnel Report/i],
    ['2027-04-28', /Personnel Report/i],
    ['2027-06-23', /Personnel Report/i],
  ];
  for (const [date, pattern] of expected) {
    assert.match(topics[date]?.en ?? '', pattern,
      `${date} is missing a topic — check column assignment, not the source document`);
  }
});

test('undated suggestions are not attached to a meeting', () => {
  // The Schedule closes with "Future Agenda Items/Suggestions:", an undated table of
  // ideas trustees have raised — currently one entry, "Discussion Re: Technology
  // use/AI within the district", requested by Trustee Li. Carrying the last seen date
  // into that section publishes an unscheduled idea as a planned topic and records
  // the trustee who raised it as the presenting administrator.
  //
  // Matched on the section's own content as well as its heading: the heading alone
  // can be filtered out by unrelated parsing while the rows beneath it still leak.
  const patterns = [
    /Future Agenda Items/i,
    /Requested by/i,
    /Technology use\/AI/i,
    /Trustee\s+\w+/i,
    /All Board Meetings at District Office/i,
  ];
  for (const [date, entry] of Object.entries(topics)) {
    const blob = JSON.stringify(entry);
    for (const pattern of patterns) {
      assert.doesNotMatch(blob, pattern,
        `${date} carries content from the undated suggestions section (${pattern})`);
    }
  }
});
