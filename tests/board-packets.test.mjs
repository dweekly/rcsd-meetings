import assert from 'node:assert/strict';
import test from 'node:test';

import { pendingFor } from '../scripts/download-board-packets.mjs';

// A memo shaped like data/board-memos/{date}.json, with one item per group of
// attachments.
function memo(date, attachments) {
  return { date, mid: '12345', items: [{ order: 1, title: '1. Item', attachments }] };
}

test('an attachment with an aid and no filename is pending', () => {
  const m = memo('2026-08-26', [{ aid: '111', name: 'Resolution No. 5' }]);
  const { pending } = pendingFor(m);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].aid, '111');
});

test('an external attachment with no aid is never pending', () => {
  // County reports are bare hrefs on smcgov.org with no Simbli AID; they have
  // no packet to download and must not be queued forever.
  const m = memo('2026-08-26', [{ name: 'Investment Report - July', href: 'https://www.smcgov.org/media/160665/download' }]);
  const { pending } = pendingFor(m);
  assert.equal(pending.length, 0);
});

test('a committed filename is trusted when no verification set is supplied', () => {
  const m = memo('2026-08-26', [{ aid: '111', name: 'Resolution No. 5', filename: 'Resolution-No-5.pdf' }]);
  const { pending, usedFilenames } = pendingFor(m);
  assert.equal(pending.length, 0);
  assert.ok(usedFilenames.has('Resolution-No-5.pdf'));
});

test('a committed filename present on R2 stays trusted', () => {
  const m = memo('2026-08-26', [{ aid: '111', name: 'Resolution No. 5', filename: 'Resolution-No-5.pdf' }]);
  const { pending } = pendingFor(m, new Set(['2026-08-26/some-other-file.pdf']));
  assert.equal(pending.length, 0);
  assert.equal(m.items[0].attachments[0].filename, 'Resolution-No-5.pdf');
});

// The regression this file exists for. A filename recorded by a local run that
// could not upload asserts an object that is not there; trusting it made the
// pipeline skip the packet on every subsequent run, shipping a dead link
// permanently. A filename with no object behind it must be demoted back to
// pending so it is re-fetched and re-uploaded.
test('a committed filename missing from R2 is cleared and re-queued', () => {
  const m = memo('2026-08-26', [{ aid: '111', name: 'Resolution No. 5', filename: 'Resolution-No-5.pdf' }]);
  const { pending, usedFilenames } = pendingFor(m, new Set(['2026-08-26/Resolution-No-5.pdf']));

  assert.equal(pending.length, 1, 'the attachment must be re-queued for download');
  assert.equal(pending[0].aid, '111');
  assert.equal(m.items[0].attachments[0].filename, undefined, 'the false claim must be cleared');
  assert.ok(!usedFilenames.has('Resolution-No-5.pdf'), 'the freed name must be reusable');
});

test('the missing-set is keyed by date, so same-named packets in other meetings are unaffected', () => {
  const m = memo('2026-08-26', [{ aid: '111', name: 'Agenda', filename: 'Agenda.pdf' }]);
  const { pending } = pendingFor(m, new Set(['2026-03-25/Agenda.pdf']));
  assert.equal(pending.length, 0);
  assert.equal(m.items[0].attachments[0].filename, 'Agenda.pdf');
});

test('mixed attachments are partitioned correctly in one pass', () => {
  const m = memo('2026-08-26', [
    { aid: '1', name: 'Present', filename: 'Present.pdf' },
    { aid: '2', name: 'Absent', filename: 'Absent.pdf' },
    { aid: '3', name: 'Never fetched' },
    { name: 'External', href: 'https://www.smcgov.org/media/1/download' },
  ]);
  const { pending, usedFilenames } = pendingFor(m, new Set(['2026-08-26/Absent.pdf']));

  assert.deepEqual(pending.map((a) => a.aid), ['2', '3']);
  assert.deepEqual([...usedFilenames], ['Present.pdf']);
});
