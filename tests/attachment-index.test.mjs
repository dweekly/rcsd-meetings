// The MCP find-document tool searches document-index.json first, then
// attachment-index.json for everything the classifier skipped, and de-duplicates
// between them. That de-duplication is only sound if the two indexes overlap in a
// way it can actually detect, so these tests pin the properties it depends on
// rather than re-implementing the Worker's merge.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));

const attachments = read('data/attachment-index.json');
const classified = read('data/document-index.json').documents ?? [];
const documents = attachments.documents ?? [];

test('the index carries provenance and real coverage', () => {
  const meta = attachments._metadata;
  assert.ok(meta, 'no _metadata block');
  assert.equal(meta.source, 'data/meetings-data.json');
  assert.ok(meta.coverage?.from && meta.coverage?.to, 'coverage is not stated');
  assert.equal(meta.counts.documents, documents.length,
    'counts.documents disagrees with the documents actually written');
});

test('no attachment is listed twice on the same agenda item', () => {
  // meetings-data.json repeats a handful of attachments; the builder collapses
  // them, because a repeat here becomes a repeated search result.
  const seen = new Set();
  const repeats = [];
  for (const d of documents) {
    const key = `${d.meetingDate}|${d.itemLabel}|${d.url}`;
    if (seen.has(key)) repeats.push(key);
    seen.add(key);
  }
  assert.deepEqual(repeats, [], `repeated entries: ${repeats.slice(0, 3).join(', ')}`);
});

test('every classified document is reachable in the index by AID or by URL', () => {
  // This is what lets find-document de-duplicate. A classified document that
  // matches on neither key would be returned twice, once from each index.
  //
  // Both keys are needed: document-index rewrites Simbli-era URLs to the R2
  // mirror, so those match only by AID; BoardDocs-era records have no AID, so
  // those match only by URL.
  const aids = new Set(documents.filter((d) => d.aid).map((d) => String(d.aid)));
  const urls = new Set(documents.filter((d) => d.url).map((d) => d.url));

  const unreachable = classified.filter(
    (d) => !(d.aid && aids.has(String(d.aid))) && !(d.url && urls.has(d.url)),
  );
  assert.deepEqual(unreachable.map((d) => d.title).slice(0, 5), [],
    `${unreachable.length} classified document(s) match the attachment index on neither `
    + 'AID nor URL, so find-document would return them twice');
});

test('every entry has something a reader can open', () => {
  const broken = documents.filter((d) => !d.url || !/^https?:\/\//.test(d.url));
  assert.deepEqual(broken.slice(0, 3), [], 'entries without a usable URL');
});
