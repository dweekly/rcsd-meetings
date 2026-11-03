/**
 * Evidence-Typed Post-Meeting Deliberation Recap Schema & Validator (Stage 3).
 *
 * Enforces strict separation between four evidentiary layers for each deliberated
 * agenda item (see decision-litigation-log.md D-006):
 *   1. `proposal`           — What the pre-meeting board packet proposed (PDF citation)
 *   2. `discussion`         — What staff, public speakers, and trustees stated on video
 *                             (with clickable [MM:SS] timestamps and interval-scoped
 *                             speaker attribution; global diarization maps are banned)
 *   3. `motion_recorded`    — What motion/roll-call vote was heard on video (explicitly
 *                             badged as provisional until formal minutes are approved)
 *   4. `minutes_reconciled` — What the formally approved minutes record (or pending state)
 */

export const VALID_ATTRIBUTION_SCOPES = new Set([
  'interval-verified',
  'role-generic',
]);

export const VALID_MOTION_STATUSES = new Set([
  'provisional-video-tally',
  'no-vote-information-only',
  'public-hearing-no-vote',
]);

export const VALID_MINUTES_STATUSES = new Set([
  'reconciled',
  'draft-in-subsequent-packet',
  'pending-approval',
]);

/**
 * Format seconds into M:SS or H:MM:SS for display.
 */
export function formatTimestamp(seconds) {
  if (seconds == null || Number.isNaN(Number(seconds))) return '';
  const total = Math.max(0, Math.floor(Number(seconds)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

/**
 * Guard against unverified multi-person diarization labels ("Mike Wells / Liz Coughenour"
 * or "Speaker B") leaking into a published deliberation recap.
 */
export function isAmbiguousDiarizationLabel(label) {
  if (!label) return true;
  const s = String(label).trim();
  if (/^speaker\s+[a-z0-9]+$/i.test(s)) return true;
  if (s.includes('/') || /\b(misc|various|varies by context|unidentified|unknown)\b/i.test(s)) {
    return true;
  }
  return false;
}

/**
 * Validate a Deliberation Recap JSON document against all Stage 3 evidentiary
 * and bilingual invariants.
 */
export function validateDeliberationRecap(doc) {
  const errors = [];
  const pushErr = (path, message) => errors.push({ path, message });

  if (!doc || typeof doc !== 'object') {
    pushErr('', 'Deliberation recap must be an object');
    return { valid: false, errors };
  }

  if (!doc._metadata || typeof doc._metadata !== 'object') {
    pushErr('/_metadata', 'Missing required _metadata provenance block');
  } else {
    if (!doc._metadata.source) pushErr('/_metadata/source', 'Missing _metadata.source');
    if (!doc._metadata.videoSource) pushErr('/_metadata/videoSource', 'Missing _metadata.videoSource');
    if (!doc._metadata.transcriptSource) pushErr('/_metadata/transcriptSource', 'Missing _metadata.transcriptSource');
    if (!doc._metadata.scrapedAt) pushErr('/_metadata/scrapedAt', 'Missing _metadata.scrapedAt');
    if (!doc._metadata.method) pushErr('/_metadata/method', 'Missing _metadata.method');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(doc.date || ''))) {
    pushErr('/date', 'date must be YYYY-MM-DD');
  }
  if (!doc.meetingSlug || typeof doc.meetingSlug !== 'string') {
    pushErr('/meetingSlug', 'Missing meetingSlug');
  }
  if (!doc.videoId || typeof doc.videoId !== 'string') {
    pushErr('/videoId', 'Missing YouTube videoId');
  }
  if (!doc.overviewEn || !doc.overviewEs) {
    pushErr('/overview', 'Both overviewEn and overviewEs are required');
  }
  if (!Array.isArray(doc.corrections)) {
    pushErr('/corrections', 'corrections must be an array');
  }

  if (!Array.isArray(doc.items) || doc.items.length === 0) {
    pushErr('/items', 'items must be a non-empty array');
  } else {
    doc.items.forEach((item, i) => {
      const p = `/items/${i}`;
      if (!item.itemLabel) pushErr(`${p}/itemLabel`, 'Missing itemLabel');
      if (!item.titleEn || !item.titleEs) pushErr(`${p}/title`, 'Both titleEn and titleEs are required');

      // 1. Proposal block
      if (!item.proposal || typeof item.proposal !== 'object') {
        pushErr(`${p}/proposal`, 'Missing proposal evidence block');
      } else {
        if (!item.proposal.textEn || !item.proposal.textEs) {
          pushErr(`${p}/proposal/text`, 'Both proposal.textEn and proposal.textEs are required');
        }
        if (!Array.isArray(item.proposal.citations) || item.proposal.citations.length === 0) {
          pushErr(`${p}/proposal/citations`, 'proposal must include at least one source citation');
        }
      }

      // 2. Discussion block
      if (!item.discussion || typeof item.discussion !== 'object') {
        pushErr(`${p}/discussion`, 'Missing discussion evidence block');
      } else {
        if (!item.discussion.summaryEn || !item.discussion.summaryEs) {
          pushErr(`${p}/discussion/summary`, 'Both discussion.summaryEn and discussion.summaryEs are required');
        }
        if (!Array.isArray(item.discussion.highlights) || item.discussion.highlights.length === 0) {
          pushErr(`${p}/discussion/highlights`, 'discussion.highlights must be a non-empty array');
        } else {
          item.discussion.highlights.forEach((hl, j) => {
            const hp = `${p}/discussion/highlights/${j}`;
            if (!hl.speakerLabelEn || !hl.speakerLabelEs) {
              pushErr(`${hp}/speakerLabel`, 'Both speakerLabelEn and speakerLabelEs are required');
            }
            if (isAmbiguousDiarizationLabel(hl.speakerLabelEn)) {
              pushErr(
                `${hp}/speakerLabelEn`,
                `Ambiguous or unverified diarization label "${hl.speakerLabelEn}" is forbidden`
              );
            }
            if (!VALID_ATTRIBUTION_SCOPES.has(hl.attributionScope)) {
              pushErr(
                `${hp}/attributionScope`,
                `attributionScope must be one of: ${[...VALID_ATTRIBUTION_SCOPES].join(', ')}`
              );
            }
            if (typeof hl.startSeconds !== 'number' || hl.startSeconds < 0) {
              pushErr(`${hp}/startSeconds`, 'startSeconds must be a non-negative number');
            }
            if (typeof hl.endSeconds !== 'number' || hl.endSeconds < hl.startSeconds) {
              pushErr(`${hp}/endSeconds`, 'endSeconds must be >= startSeconds');
            }
            if (!hl.textEn || !hl.textEs) {
              pushErr(`${hp}/text`, 'Both textEn and textEs are required');
            }
          });
        }
      }

      // 3. Motion recorded block
      if (!item.motion_recorded || typeof item.motion_recorded !== 'object') {
        pushErr(`${p}/motion_recorded`, 'Missing motion_recorded evidence block');
      } else {
        if (!VALID_MOTION_STATUSES.has(item.motion_recorded.status)) {
          pushErr(
            `${p}/motion_recorded/status`,
            `motion_recorded.status must be one of: ${[...VALID_MOTION_STATUSES].join(', ')}`
          );
        }
        if (!item.motion_recorded.textEn || !item.motion_recorded.textEs) {
          pushErr(`${p}/motion_recorded/text`, 'Both motion_recorded.textEn and textEs are required');
        }
      }

      // 4. Minutes reconciled block
      if (!item.minutes_reconciled || typeof item.minutes_reconciled !== 'object') {
        pushErr(`${p}/minutes_reconciled`, 'Missing minutes_reconciled evidence block');
      } else {
        if (!VALID_MINUTES_STATUSES.has(item.minutes_reconciled.status)) {
          pushErr(
            `${p}/minutes_reconciled/status`,
            `minutes_reconciled.status must be one of: ${[...VALID_MINUTES_STATUSES].join(', ')}`
          );
        }
        if (!item.minutes_reconciled.textEn || !item.minutes_reconciled.textEs) {
          pushErr(`${p}/minutes_reconciled/text`, 'Both minutes_reconciled.textEn and textEs are required');
        }
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/** Every archived attachment filename in a `data/board-memos/{date}.json` document. */
export function memoAttachmentFilenames(memosDoc) {
  const names = new Set();
  for (const item of memosDoc?.items || []) {
    for (const att of item.attachments || []) {
      if (att?.filename) names.add(att.filename);
    }
  }
  return names;
}

/** Parse `<base>/board-packets/<date>/<filename>` into its packet date and filename. */
export function parseBoardPacketUrl(url) {
  const m = /\/board-packets\/(\d{4}-\d{2}-\d{2})\/([^/?#]+)$/.exec(String(url || ''));
  return m ? { date: m[1], filename: decodeURIComponent(m[2]) } : null;
}

/**
 * List every evidence filename in a recap that does not resolve to a real
 * attachment in the archived board-memo manifest. Proposal citations must be
 * attachments of the recap's own meeting; a `minutesUrl` must be an attachment
 * of the meeting whose packet published the minutes.
 *
 * @param {object} recap - recap document or REVIEWED_RECAPS definition
 * @param {(date: string) => object|null} loadMemos - returns `data/board-memos/{date}.json` or null
 * @returns {{path: string, date: string, filename: string|null, reason: string}[]}
 */
export function findUnresolvedEvidenceFiles(recap, loadMemos) {
  const unresolved = [];
  const cache = new Map();
  const filenamesFor = (date) => {
    if (!cache.has(date)) {
      const doc = loadMemos(date);
      cache.set(date, doc ? memoAttachmentFilenames(doc) : null);
    }
    return cache.get(date);
  };
  const check = (path, date, filename) => {
    const names = filenamesFor(date);
    if (!names) unresolved.push({ path, date, filename, reason: `no data/board-memos/${date}.json` });
    else if (!filename || !names.has(filename)) {
      unresolved.push({ path, date, filename: filename || null, reason: `not an attachment in data/board-memos/${date}.json` });
    }
  };

  (recap?.items || []).forEach((item, i) => {
    (item.proposal?.citations || []).forEach((cit, j) => {
      check(`/items/${i}/proposal/citations/${j}/filename`, recap.date, cit.filename);
    });
    const minutesUrl = item.minutes_reconciled?.minutesUrl;
    if (minutesUrl) {
      const parsed = parseBoardPacketUrl(minutesUrl);
      if (!parsed) {
        unresolved.push({ path: `/items/${i}/minutes_reconciled/minutesUrl`, date: null, filename: null, reason: `not a board-packets URL: ${minutesUrl}` });
      } else {
        check(`/items/${i}/minutes_reconciled/minutesUrl`, parsed.date, parsed.filename);
      }
    }
  });
  return unresolved;
}
