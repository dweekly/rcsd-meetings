// The agenda's time allocation is the district's own statement of what a meeting
// is about. These tests pin the two halves of reading it: pulling the number out
// of the title text, and turning those numbers into a ranking that does not let a
// sixteen-line, one-minute consent block outrank a 35-minute staff report.
import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDuration } from '../scripts/lib/agenda-duration.mjs';
import { rankItems, groupBySection, isConsentItem } from '../scripts/lib/agenda-weight.mjs';

test('parseDuration reads every form the district actually writes', () => {
  const cases = [
    ['Action Items (Action Required) - 1 hr 20 min', 80, 'Action Items (Action Required)'],
    ['School/Community Reports - 1 hr 30 min', 90, 'School/Community Reports'],
    ['School/Community Reports 1 hr 30 min', 90, 'School/Community Reports'],
    ['School/Community Reports - 1.5 hrs', 90, 'School/Community Reports'],
    ['School/Community Reports - 2.5 hr', 150, 'School/Community Reports'],
    ['Measure T Bond Program Update (20 min)', 20, 'Measure T Bond Program Update'],
    ['Closed Session at 5:50 PM - Approx. 1 hr', 60, 'Closed Session at 5:50 PM'],
    ['Closed Session - 6:30 PM (20 min)', 20, 'Closed Session - 6:30 PM'],
    ['Correspondence - 1 min', 1, 'Correspondence'],
    ['Discussion Items - 4.5 hrs', 270, 'Discussion Items'],
  ];
  for (const [input, minutes, title] of cases) {
    assert.deepEqual(parseDuration(input), { minutes, title }, `parsing: ${input}`);
  }
});

test('parseDuration leaves titles without a duration alone', () => {
  for (const title of [
    'Approval of the September 9 School Board Meeting Minutes',
    'Closed Session at 5:50 PM',            // a clock time is not an allocation
    'Resolution No. 10: Gann Appropriations Limit',
    'Board Policy 4140: Bargaining Units',  // a bare number must not read as minutes
    'Public Hearing - 0 min',               // a zero allocation carries no signal
  ]) {
    assert.deepEqual(parseDuration(title), { minutes: null, title }, `left alone: ${title}`);
  }
});

// Shape of the 2026-09-23 regular meeting, trimmed to the parts that matter:
// a 35-minute report with one child, a 1-minute consent block with three, and an
// 80-minute action block with five.
const MEETING = [
  { itemLabel: '1', title: 'Call to Order', isSection: true, plannedMinutes: 1, actionType: 'Procedural' },
  { itemLabel: '1.1', title: 'Roll Call', isSection: false, plannedMinutes: null, actionType: 'Procedural' },
  { itemLabel: '6', title: 'School/Community Reports', isSection: true, plannedMinutes: 35, actionType: 'Information' },
  { itemLabel: '6.1', title: 'Update on Multi-Tiered Systems of Support (MTSS)', isSection: false, plannedMinutes: null, actionType: 'Information' },
  { itemLabel: '8', title: 'Approval of Consent Items', isSection: true, plannedMinutes: 1, actionType: 'Action (Consent)' },
  { itemLabel: '8.1', title: 'Approval of Clifford School Field Trip', isSection: false, plannedMinutes: null, actionType: 'Action (Consent)' },
  { itemLabel: '8.2', title: 'Approval of 36-Month Agreement with Motive Technologies, Inc.', isSection: false, plannedMinutes: null, actionType: 'Action (Consent)' },
  { itemLabel: '8.3', title: 'Approval of Board Bylaw 9250', isSection: false, plannedMinutes: null, actionType: 'Action (Consent)' },
  { itemLabel: '9', title: 'Action Items (Action Required)', isSection: true, plannedMinutes: 80, actionType: 'Action' },
  { itemLabel: '9.1', title: '2026-27 Annual Enrollment and Capacity Review', isSection: false, plannedMinutes: null, actionType: 'Action' },
  { itemLabel: '9.2', title: 'Approval of Unpaid General Leave of Absence Requests', isSection: false, plannedMinutes: null, actionType: 'Action' },
  { itemLabel: '9.3', title: 'Approval of Personnel Changes for the 2026-2027 School Year', isSection: false, plannedMinutes: null, actionType: 'Action' },
  { itemLabel: '9.4', title: 'Approval of the 2025-26 Unaudited Actuals Financial Report', isSection: false, plannedMinutes: null, actionType: 'Action' },
  { itemLabel: '9.5', title: 'Adoption of Resolution No. 10: Gann Appropriations Limit', isSection: false, plannedMinutes: null, actionType: 'Action' },
];

const isProcedural = (item) => item.actionType === 'Procedural';

test('a section splits its minutes across its substantive children', () => {
  const sections = groupBySection(MEETING, isProcedural);
  const byLabel = Object.fromEntries(
    sections.flatMap((g) => g.children.map((c) => [c.itemLabel, c.weightMinutes])),
  );
  assert.equal(byLabel['6.1'], 35);      // sole child takes the whole allocation
  assert.equal(byLabel['9.1'], 16);      // 80 minutes across five action items
  assert.equal(byLabel['9.4'], 16);
});

test('the substantive discussion outranks the consent block, whatever the line count', () => {
  const { ranked, consent, consentMinutes } = rankItems(MEETING, isProcedural);

  assert.equal(ranked[0].item.itemLabel, '6.1',
    'the 35-minute MTSS report is the headline, not one of sixteen consent contracts');
  assert.deepEqual(ranked.map((r) => r.item.itemLabel),
    ['6.1', '9.1', '9.2', '9.3', '9.4', '9.5'],
    'one 35-minute report leads five action items sharing 80 minutes');

  assert.deepEqual(consent.map((c) => c.itemLabel), ['8.1', '8.2', '8.3'],
    'consent items are collapsed out of the ranking, not scored line by line');
  assert.equal(consentMinutes, 1);
  assert.ok(!ranked.some((r) => isConsentItem(r.item)), 'no consent item is ranked');
});

test('items under a section with no stated time are reported as unranked, not as zero', () => {
  const { ranked, unranked } = rankItems([
    { itemLabel: '7', title: 'Discussion Items', isSection: true, plannedMinutes: null, actionType: 'Discussion' },
    { itemLabel: '7.1', title: 'Facilities Master Plan', isSection: false, plannedMinutes: null, actionType: 'Discussion' },
  ], isProcedural);
  assert.equal(ranked.length, 0);
  assert.deepEqual(unranked.map((u) => u.item.itemLabel), ['7.1']);
});

test('a standalone section with no stated time still reaches the summary', () => {
  // The shape of the 2026-02-26 agenda: a timed item elsewhere switches the
  // summarizer to the ranked prompt, and a childless, untimed public hearing must
  // not fall out of it on the way.
  const { ranked, unranked } = rankItems([
    { itemLabel: '6', title: 'School/Community Reports', isSection: true, plannedMinutes: 30, actionType: 'Information' },
    { itemLabel: '6.1', title: 'Roy Cloud Site Presentation', isSection: false, plannedMinutes: null, actionType: 'Information' },
    { itemLabel: '7', title: 'Public Hearing Regarding Proposed Education Parcel Tax', isSection: true, plannedMinutes: null, actionType: 'Information' },
  ], isProcedural);

  const everything = [...ranked, ...unranked].map((e) => e.item.title);
  assert.ok(everything.some((t) => /Public Hearing/.test(t)),
    'an untimed standalone item is unranked, never dropped — absent time is not absent importance');
  assert.equal(ranked[0].item.itemLabel, '6.1');
});

test('a meeting total counts each allocation once', async () => {
  // The 2025-11-12 agenda gives School/Community Reports 120 minutes and then
  // names two 60-minute reports inside it. The children's time is carved out of
  // the section's, not added to it, so the total is 130 and not 250.
  const { totalPlannedMinutes } = await import('../scripts/lib/agenda-weight.mjs');
  const total = totalPlannedMinutes([
    { itemLabel: '8', title: 'School/Community Reports', isSection: true, plannedMinutes: 120 },
    { itemLabel: '8.1', title: 'Community Schools Board Report', isSection: false, plannedMinutes: 60 },
    { itemLabel: '8.2', title: 'Mental Health Program Board Report', isSection: false, plannedMinutes: 60 },
    { itemLabel: '9', title: 'Discussion Items', isSection: true, plannedMinutes: 10 },
  ]);
  assert.equal(total, 130);
});

test('a meeting total falls back to sub-item times when a section states none', async () => {
  const { totalPlannedMinutes } = await import('../scripts/lib/agenda-weight.mjs');
  assert.equal(totalPlannedMinutes([
    { itemLabel: '4', title: 'Closed Session', isSection: true, plannedMinutes: null },
    { itemLabel: '4.1', title: 'Anticipated Litigation', isSection: false, plannedMinutes: 20 },
    { itemLabel: '4.2', title: 'Labor Negotiators', isSection: false, plannedMinutes: 35 },
  ]), 55);
  assert.equal(totalPlannedMinutes([
    { itemLabel: '1', title: 'Call to Order', isSection: true, plannedMinutes: null },
  ]), null, 'an agenda that states no times has no total, rather than a total of zero');
});
