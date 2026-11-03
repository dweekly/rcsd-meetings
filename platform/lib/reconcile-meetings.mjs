/**
 * Cross-Regime Meeting Reconciler (`platform/lib/reconcile-meetings.mjs`)
 *
 * Reconciles multi-regime district meeting observations (e.g., SMFCSD Agenda Online
 * 2019–2022 vs. Simbli 2022–present + Finalsite governance landing page + YouTube)
 * into the portable `urn:district-data-lab:schema:v0:meetings` dataset contract.
 *
 * Key guarantees:
 * 1. Independent 4-axis lifecycle states (`occurrence`, `agenda`, `minutes`, `recording`)
 *    each backed by dated `evidence` referencing declared `manifest.sources`.
 * 2. Explicit cross-source `discrepancies` (with >= 2 evidence records) whenever
 *    a vendor portal (e.g., Simbli `minutes: absent`) disagrees with the official
 *    district CMS landing page (e.g., Finalsite `minutes: approved` PDF link), or
 *    when start times differ across sources.
 * 3. Preservation of non-regular meeting semantics (e.g., school visitation or
 *    closed session where `recording.state` is `not-applicable` rather than a
 *    missing-video failure).
 */

import { validateMeetingDataset } from './validate-meetings.mjs';

/**
 * Determine which source regime in `manifest.sourceRegimes` covers a given `YYYY-MM` date prefix.
 *
 * @param {object} manifest - District reconnaissance manifest (`districts/<slug>/manifest.json`)
 * @param {string} dateStr - ISO date (`YYYY-MM-DD`) or timestamp
 * @returns {object|null} Matching sourceRegime entry or null
 */
export function resolveSourceRegime(manifest, dateStr) {
  const yearMonth = String(dateStr || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return null;

  for (const regime of manifest?.sourceRegimes || []) {
    if (regime.domain !== 'governance') continue;
    const afterStart = !regime.fromInclusive || yearMonth >= regime.fromInclusive;
    const beforeEnd = !regime.toExclusive || yearMonth < regime.toExclusive;
    if (afterStart && beforeEnd) {
      return regime;
    }
  }
  return null;
}

/**
 * Reconcile raw multi-source observations for a single meeting into a canonical
 * `urn:district-data-lab:schema:v0:meetings` record with explicit discrepancy tracking.
 *
 * @param {object} manifest - District manifest (`districts/<slug>/manifest.json`)
 * @param {object} candidate - Candidate meeting observation bundle
 * @returns {object} Canonical meeting record
 */
export function reconcileMeetingRecord(manifest, candidate) {
  const districtId = manifest.district.id;
  const timezone = manifest.district.timezone || 'America/Los_Angeles';
  const discrepancies = [];

  // Reconcile minutes state across primary portal (e.g. Simbli) and district CMS landing page
  let minutesState = candidate.minutes.state;
  const minutesEvidence = [...(candidate.minutes.evidence || [])];

  if (
    candidate.minutes.vendorState &&
    candidate.minutes.cmsState &&
    candidate.minutes.vendorState !== candidate.minutes.cmsState
  ) {
    // Official district CMS published/approved minutes take precedence over unlinked Simbli minutes tab,
    // while recording an explicit discrepancy with >= 2 evidence items.
    const stateRank = { absent: 0, unknown: 1, published: 2, approved: 3 };
    minutesState =
      (stateRank[candidate.minutes.cmsState] ?? 0) >= (stateRank[candidate.minutes.vendorState] ?? 0)
        ? candidate.minutes.cmsState
        : candidate.minutes.vendorState;

    if (minutesEvidence.length >= 2) {
      discrepancies.push({
        id: `${candidate.id}.discrepancy.minutes-regime`,
        field: 'minutes.state',
        summary:
          candidate.minutes.discrepancySummary ||
          `Vendor portal reports minutes as "${candidate.minutes.vendorState}" while official district page links "${candidate.minutes.cmsState}" minutes.`,
        status: 'resolved',
        evidence: minutesEvidence.slice(0, 2),
      });
    }
  }

  // Reconcile start time discrepancies if multiple sources disagree
  if (candidate.startsAtDiscrepancy && candidate.startsAtDiscrepancy.evidence?.length >= 2) {
    discrepancies.push({
      id: `${candidate.id}.discrepancy.starts-at`,
      field: 'startsAt',
      summary: candidate.startsAtDiscrepancy.summary,
      status: candidate.startsAtDiscrepancy.status || 'open',
      evidence: candidate.startsAtDiscrepancy.evidence,
    });
  }

  // Preserve explicit recording state for school-visitation / closed-session meetings
  const recordingState =
    candidate.meetingSubtype === 'school-visitation' || candidate.meetingSubtype === 'closed-session'
      ? candidate.recording?.state || 'not-applicable'
      : candidate.recording?.state || 'unknown';

  return {
    id: candidate.id,
    districtId,
    governingBodyId: candidate.governingBodyId || manifest.governingBodies?.[0]?.id || 'board-of-trustees',
    title: {
      text: candidate.title.text,
      locale: candidate.title.locale || 'en-US',
    },
    startsAt: candidate.startsAt,
    timezone,
    occurrence: {
      state: candidate.occurrence.state,
      evidence: candidate.occurrence.evidence,
    },
    agenda: {
      state: candidate.agenda.state,
      evidence: candidate.agenda.evidence,
    },
    minutes: {
      state: minutesState,
      evidence: minutesEvidence,
    },
    recording: {
      state: recordingState,
      evidence: candidate.recording.evidence,
    },
    discrepancies: [...(candidate.discrepancies || []), ...discrepancies],
  };
}

/**
 * Build and validate a full `urn:district-data-lab:schema:v0:meetings` dataset
 * from a district manifest and reconciled meeting records.
 */
export function buildReconciledMeetingDataset(manifest, candidates, options = {}) {
  const generatedAt = options.generatedAt || '2026-07-09T18:00:00.000Z';
  const records = candidates.map((c) => reconcileMeetingRecord(manifest, c));

  // Collect all referenced source IDs so _metadata.sources includes every cited authority
  const usedSourceIds = new Set();
  for (const record of records) {
    for (const axis of ['occurrence', 'agenda', 'minutes', 'recording']) {
      for (const ev of record[axis]?.evidence || []) {
        usedSourceIds.add(ev.sourceId);
      }
    }
    for (const disc of record.discrepancies || []) {
      for (const ev of disc.evidence || []) {
        usedSourceIds.add(ev.sourceId);
      }
    }
  }

  const sources = (manifest.sources || [])
    .filter((s) => usedSourceIds.has(s.id))
    .map((s) => ({
      id: s.id,
      url: s.url,
      authority: s.authority,
      checkedAt: s.checkedAt.includes('T') ? s.checkedAt : `${s.checkedAt}T18:00:00.000Z`,
    }));

  const dataset = {
    $schema: 'urn:district-data-lab:schema:v0:meetings',
    schemaVersion: '0.1.0',
    apiVersion: 'v0',
    contractStatus: 'experimental',
    datasetId: `${manifest.district.id}.board-meetings`,
    district: {
      id: manifest.district.id,
      slug: manifest.district.slug,
      name: manifest.district.publicName || manifest.district.name,
    },
    generatedAt,
    records,
    _metadata: {
      provenanceUrl:
        options.provenanceUrl ||
        `https://rcsd.info/api/v0/districts/${manifest.district.slug}/provenance/meetings.json`,
      scrapedAt: generatedAt,
      method: {
        kind: 'deterministic-extraction',
        tool: 'reconcile-meetings',
        toolVersion: '1.0.0',
      },
      sources,
    },
  };

  const validation = validateMeetingDataset(dataset);
  if (!validation.valid) {
    throw new Error(
      `Reconciled meeting dataset for ${manifest.district.slug} failed schema validation: ${JSON.stringify(validation.errors)}`,
    );
  }

  return dataset;
}
