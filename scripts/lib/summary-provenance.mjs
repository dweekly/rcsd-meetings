/**
 * Where a meeting summary came from.
 *
 * Two generators write data/meeting-summaries.json: one reads agenda item titles,
 * the other reads the meeting's transcript. The transcript one is the better
 * account — it reports what the board decided rather than what it listed — so the
 * agenda one has to be able to recognise its work and leave it alone. That is
 * what this sidecar is for.
 *
 * It is a sidecar rather than a field on the summary because every consumer
 * (build-homepage, build-meetings-html, build-ics, build-meeting-pages,
 * lib/discovery-datasets) reads the summary files as a flat key → string map.
 *
 * A key with no record predates the sidecar: those are the hand-written summaries
 * carried since the initial release. They are left alone by both generators
 * unless a run names them explicitly.
 */

import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export const PROVENANCE_FILENAME = 'data/meeting-summaries-provenance.json';

/** @returns {Record<string, {source: string, model?: string, generatedAt?: string}>} */
export function readProvenance(root) {
  const path = resolve(root, PROVENANCE_FILENAME);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/** True when this summary was written from a transcript and must not be regenerated from the agenda. */
export function isTranscriptDerived(provenance, key) {
  return provenance?.[key]?.source === 'transcript';
}

/**
 * Fingerprint of the summary text a provenance record describes.
 *
 * The record says a summary came from a transcript; this says *which* summary.
 * Without it the two can drift apart — restore the summaries file from git while
 * the provenance sidecar stays put, and the generator skips a meeting whose text
 * is no longer the text the record describes. A flag cannot detect that; a hash
 * of the content can.
 */
export function summaryHash(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex').slice(0, 16);
}

/**
 * True when this key holds the transcript-derived summary the record describes.
 *
 * Records written before hashing carry no `enHash`; those are trusted on the flag
 * alone rather than needlessly regenerated.
 */
export function matchesRecordedSummary(provenance, key, enText) {
  const record = provenance?.[key];
  if (record?.source !== 'transcript') return false;
  if (!record.enHash) return true;
  return record.enHash === summaryHash(enText);
}
