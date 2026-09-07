// An agenda pull is not finished at the meeting page: the thematic pages
// (/district/budget/, charter pages, properties.json) are hand-authored from a
// source snapshot and do not update themselves. That rule was in CLAUDE.md and in
// memory, and was still missed for two consecutive meetings — so it is a check
// now rather than a sentence.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { outstandingTriage, TRIAGE_FROM } from '../scripts/check-triage.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

test('every pulled meeting with attachments has a theme-triage record', () => {
  const outstanding = outstandingTriage();
  assert.deepEqual(outstanding, [],
    `these meetings have attachments but no data/triage/<date>.md:\n  ${outstanding.join('\n  ')}\n` +
    'Read the new attachments by theme, route what is salient to the owning page, then write the record.');
});

test('the triage floor is a real triaged meeting, not a date that skips work', () => {
  // If TRIAGE_FROM is ever moved forward to silence the check, the record it
  // names must still exist — otherwise the floor is just a way to skip a pull.
  const floor = resolve(ROOT, 'data/triage', `${TRIAGE_FROM}.md`);
  assert.ok(existsSync(floor),
    `TRIAGE_FROM is ${TRIAGE_FROM} but data/triage/${TRIAGE_FROM}.md does not exist`);
});

test('a triage record routes each theme somewhere, rather than only listing files', () => {
  // The value is the routing decision, so a record that names no owning page is
  // not a triage. Every record must have the table header and at least one row
  // naming an action.
  for (const date of ['2026-08-26', '2026-09-09']) {
    const text = readFileSync(resolve(ROOT, 'data/triage', `${date}.md`), 'utf8');
    assert.match(text, /\| Attachment\(s\) \| Theme \| Owning page \/ data \| Action \|/,
      `${date}: expected the standard triage table`);
    assert.match(text, /\*\*(Done|Filed|Unblocks)/,
      `${date}: no row records an action taken or filed`);
  }
});
