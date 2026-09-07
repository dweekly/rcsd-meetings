#!/usr/bin/env node
/**
 * Build data/attachment-index.json — a flat, searchable list of every board-meeting
 * attachment, derived from data/meetings-data.json.
 *
 * Why it exists: `document-index.json` is a *curated taxonomy* and deliberately
 * omits item types the classifier does not recognise, so a search that only
 * consults it can conclude a document does not exist when it does. Something flat
 * and complete has to sit behind it. `meetings-data.json` is that complete record,
 * but at ~9 MB it is too large for the MCP Worker to fetch per request, so this
 * derives the small projection the search actually needs.
 *
 * Attribution comes from the meeting record itself rather than from re-reading
 * agenda PDFs, so an attachment is filed under the meeting that lists it, and the
 * index refreshes with every pipeline run.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MEETINGS = resolve(ROOT, 'data/meetings-data.json');
const OUT = resolve(ROOT, 'data/attachment-index.json');

/** Simbli serves an attachment by AID when the meeting record carries no direct href. */
const simbliUrl = (aid) =>
  `https://simbli.eboardsolutions.com//Meetings/Attachment.aspx?AID=${aid}`;

const meetings = JSON.parse(readFileSync(MEETINGS, 'utf-8'));

const documents = [];
// meetings-data.json lists a few attachments twice on the same agenda item (six of
// them, all on 2021-06-23). Restating them here would surface the same document
// twice in every search that matched it.
const seen = new Set();
let skipped = 0;
let deduped = 0;
for (const meeting of meetings.meetings) {
  for (const item of meeting.items ?? []) {
    for (const attachment of item.attachments ?? []) {
      const url = attachment.href ?? (attachment.aid ? simbliUrl(attachment.aid) : null);
      if (!url) {
        // No href and no AID: nothing a reader could open.
        skipped += 1;
        continue;
      }
      const key = `${meeting.date}|${item.itemLabel}|${url}`;
      if (seen.has(key)) {
        deduped += 1;
        continue;
      }
      seen.add(key);
      documents.push({
        title: attachment.title ?? null,
        aid: attachment.aid != null ? String(attachment.aid) : null,
        url,
        meetingDate: meeting.date,
        itemLabel: item.itemLabel ?? null,
        // itemTitle is what makes a search hit readable ("Approval of ..." rather
        // than a bare filename), so it stays. meetingSlug and filename are dropped:
        // both are derivable or already in document-index, and this file is fetched
        // whole by the MCP Worker, where every field costs bandwidth per isolate.
        itemTitle: item.title ?? null,
      });
    }
  }
}

documents.sort((a, b) =>
  a.meetingDate === b.meetingDate
    ? String(a.itemLabel).localeCompare(String(b.itemLabel), undefined, { numeric: true })
    : a.meetingDate.localeCompare(b.meetingDate));

const dates = documents.map((d) => d.meetingDate);
const payload = {
  _metadata: {
    description: 'Every board-meeting attachment with a resolvable URL, flattened from '
      + 'meetings-data.json. Complete where document-index.json is curated: use this to '
      + 'confirm a document does not exist before saying so.',
    source: 'data/meetings-data.json',
    script: 'scripts/build-attachment-index.mjs',
    generated: meetings.generated,
    coverage: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    counts: { documents: documents.length, withAid: documents.filter((d) => d.aid).length },
    note: 'Attribution follows meetings-data.json: an attachment is filed under the '
      + 'meeting whose agenda lists it.',
  },
  documents,
};

writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
const kb = Math.round(Buffer.byteLength(JSON.stringify(payload)) / 1024);
console.log(`  Wrote ${documents.length} attachments (${kb} KB) to data/attachment-index.json`);
console.log(`  Coverage ${payload._metadata.coverage?.from} .. ${payload._metadata.coverage?.to}`
  + `; ${skipped} had neither href nor AID, ${deduped} were repeats of the same item.`);
