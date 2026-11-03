/**
 * Pre-Meeting Packet Digest & Consent Calendar Screener (Stage 2).
 *
 * Synthesizes and validates structured, bilingual (EN/ES) pre-meeting briefs
 * (`data/docket-briefs/{date}.json`) with:
 *   1. Top time-weighted Open Session agenda items (via rankItems)
 *   2. 100% Consent Calendar screening (>= $50K contracts/change orders,
 *      policy/bylaw revisions, charter/Measure U allocations, and explicit
 *      disclosures when PDFs are scanned or external)
 *   3. Baseline & proposal-status context (census date, fiscal period,
 *      certification status, and "Proposed — Not Yet Voted" framing)
 *   4. Cryptographic artifact provenance (SHA-256 + byte size of local
 *      board-packet PDFs and R2 URLs)
 */

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256, hashFile } from './provenance.mjs';
import { rankItems } from './agenda-weight.mjs';
import { isProceduralAgendaItem, isClosedSessionAgendaItem } from './meeting-participation.mjs';

export const CONSENT_DOLLAR_THRESHOLD = 50_000;
export const R2_BASE = 'https://data.rcsd.info';

const DOLLAR_TOKEN_RE =
  /\$\s*([\d,]+(?:\.\d{1,2})?)\s*(million|billion|thousand|m|k|b)?\b/gi;

/**
 * Parse all dollar figures from a prose string and return sorted descending numbers
 * with their raw matched strings.
 */
export function extractDollarAmounts(text) {
  if (!text) return [];
  const results = [];
  let match;
  DOLLAR_TOKEN_RE.lastIndex = 0;
  while ((match = DOLLAR_TOKEN_RE.exec(String(text))) !== null) {
    const rawNum = parseFloat(match[1].replace(/,/g, ''));
    if (Number.isNaN(rawNum)) continue;
    const suffix = (match[2] || '').toLowerCase();
    let multiplier = 1;
    if (suffix === 'million' || suffix === 'm') multiplier = 1_000_000;
    else if (suffix === 'billion' || suffix === 'b') multiplier = 1_000_000_000;
    else if (suffix === 'thousand' || suffix === 'k') multiplier = 1_000;
    const amount = rawNum * multiplier;
    results.push({
      raw: match[0].trim(),
      amount,
    });
  }
  results.sort((a, b) => b.amount - a.amount);
  return results;
}

/**
 * Memo section names. English memos (data/board-memos) use the Simbli labels;
 * the translated memos (data/board-memos-es) use several Spanish spellings of
 * the same sections (e.g. "Impacto Financiero" / "Impacto financiero",
 * "Resumen Ejecutivo / Abstracto" / "Resumen ejecutivo / Extracto" /
 * "Resumen Ejecutivo / Resumen"). Keys are matched case-insensitively; a
 * RegExp matches a key prefix family.
 */
const MEMO_FIELD_KEYS = {
  financialImpact: { en: ['Financial Impact'], es: ['Impacto Financiero'] },
  summary: { en: ['Quick Summary / Abstract'], es: [/^resumen ejecutivo\b/i] },
  recommendation: { en: ['Recommendation'], es: ['Recomendación'] },
  rationale: { en: ['Rationale'], es: ['Justificación', 'Fundamento'] },
};

function lookupMemoKey(memoFields, candidates) {
  const keys = Object.keys(memoFields || {});
  for (const cand of candidates) {
    const key = keys.find((k) =>
      cand instanceof RegExp ? cand.test(k.trim()) : k.trim().toLowerCase() === cand.toLowerCase()
    );
    if (key && String(memoFields[key] || '').trim()) return String(memoFields[key]).trim();
  }
  return '';
}

/**
 * Read one memo section. For lang 'es', Spanish section names are tried first,
 * then the English names (some translated records keep English keys).
 */
export function readMemoField(memoFields, field, lang = 'en') {
  const spec = MEMO_FIELD_KEYS[field];
  if (!spec) throw new Error(`Unknown memo field: ${field}`);
  const candidates = lang === 'es' ? [...spec.es, ...spec.en] : spec.en;
  return lookupMemoKey(memoFields, candidates);
}

/**
 * Set of archived attachment filenames for a meeting's board memo
 * (data/board-memos/{date}.json items[].attachments[].filename). These are the
 * only names that exist under https://data.rcsd.info/board-packets/{date}/.
 */
export function attachmentInventory(memo) {
  const names = new Set();
  for (const it of memo?.items || []) {
    for (const att of it.attachments || []) {
      if (att?.filename) names.add(att.filename);
    }
  }
  return names;
}

/**
 * Expand a curated item label into the agenda labels it covers:
 * "10.12–10.22" -> 10.12 … 10.22, "6.1 & 11.1–11.3" -> 6.1, 11.1, 11.2, 11.3.
 * Ranges expand only within one agenda section (same prefix).
 */
export function expandItemLabels(label) {
  const out = [];
  for (const part of String(label || '').split(/\s*(?:&|,|\band\b)\s*/)) {
    const p = part.trim();
    if (!p) continue;
    const range = p.match(/^(\d+)\.(\d+)\s*[–—-]\s*(?:(\d+)\.)?(\d+)$/);
    if (range && (!range[3] || range[3] === range[1])) {
      const lo = Number(range[2]);
      const hi = Number(range[4]);
      for (let n = lo; n <= hi; n++) out.push(`${range[1]}.${n}`);
    } else {
      out.push(p);
    }
  }
  return out;
}

/**
 * Screen all Consent Calendar items (both Bond Program Consent and General Consent)
 * from a meeting and its board memo.
 */
export function screenConsentCalendar(meeting, memo, memoEs = null, aidToR2Path = {}) {
  const parsedItems = meeting?.items || [];
  const rawItems = memo?.items || [];
  const rawItemsEs = Array.isArray(memoEs?.items) && memoEs.items.length === rawItems.length
    ? memoEs.items
    : null;

  const { consent } = rankItems(parsedItems, isProceduralAgendaItem);

  // Map parsed item reference -> index in meeting.items
  const itemIdxMap = new Map();
  parsedItems.forEach((it, idx) => itemIdxMap.set(it, idx));

  const flaggedItems = [];
  const routineItems = [];
  const unextractableDisclosures = [];

  for (const consentItem of consent) {
    const idx = itemIdxMap.get(consentItem);
    const raw = idx != null ? rawItems[idx] : null;
    const rawEs = idx != null && rawItemsEs ? rawItemsEs[idx] : null;

    const memoFields = raw?.memo || {};
    const financialImpact = readMemoField(memoFields, 'financialImpact');
    const abstract = readMemoField(memoFields, 'summary');
    const rationale = readMemoField(memoFields, 'rationale');
    const recommendation = readMemoField(memoFields, 'recommendation');
    const memoFieldsEs = rawEs?.memo || {};
    const combinedText = [financialImpact, abstract, rationale, recommendation].join(' ');

    const amounts = extractDollarAmounts(combinedText);
    const maxAmount = amounts.length > 0 ? amounts[0].amount : null;
    const maxAmountRaw = amounts.length > 0 ? amounts[0].raw : null;

    const title = consentItem.title || '';
    const isPolicyRevision = /\b(board policy|board policies|board bylaw|administrative regulation|bp\s*\d|bb\s*\d|ar\s*\d)/i.test(
      `${title} ${abstract}`
    );
    const isChangeOrderOrAmendment = /\b(change order|amendment|addendum)\b/i.test(`${title} ${abstract}`);
    const isCharterOrParcelTax = /\b(kipp|rocketship|connect community|charter|measure u)\b/i.test(
      `${title} ${abstract}`
    );
    const isWarrantRegister = /\bwarrant(?:s)?\s+register|\bwarrants\b/i.test(title);
    const isMinutes = /\bminutes\b/i.test(title);
    const isFieldTripOrDonation = /\b(field trip|outdoor education|donation)\b/i.test(title);

    const flags = [];
    if (maxAmount != null && maxAmount >= CONSENT_DOLLAR_THRESHOLD && !isWarrantRegister) {
      flags.push('financial-threshold');
    }
    if (isChangeOrderOrAmendment) {
      flags.push('contract-amendment-or-change-order');
    }
    if (isPolicyRevision) {
      flags.push('policy-or-bylaw-revision');
    }
    if (isCharterOrParcelTax) {
      flags.push('charter-or-parcel-tax');
    }

    const attachments = (consentItem.attachments || []).map((att) => {
      const r2Rel = att.aid && aidToR2Path[att.aid];
      return {
        title: att.title || att.name || 'Attachment',
        aid: att.aid || null,
        r2Url: r2Rel ? `${R2_BASE}/${r2Rel}` : (att.href || null),
      };
    });

    // Check if item has contract/agreement keywords but no extractable dollar figure in memo
    const looksFinancial = /\b(agreement|contract|proposal|fee|consultant|services|mou)\b/i.test(title);
    const explicitlyNoCost = /\b(no financial impact|no fiscal impact|none|n\/a|\$0)\b/i.test(financialImpact);
    if (looksFinancial && maxAmount == null && !explicitlyNoCost && !isPolicyRevision && !isMinutes) {
      unextractableDisclosures.push({
        itemLabel: consentItem.itemLabel || null,
        titleEn: title,
        reasonEn: 'Financial amount not machine-extractable from memo summary; check attached agreement PDF.',
        reasonEs: 'Monto financiero no extraíble automáticamente del resumen del memorando; consulte el contrato PDF adjunto.',
        attachments,
      });
    }

    const entry = {
      itemLabel: consentItem.itemLabel || null,
      titleEn: title,
      titleEs: rawEs?.title
        ? String(rawEs.title).replace(/^\d+\.\s*/, '').replace(/\s*-\s*\d+\s*(?:min|hr|hour)s?\s*$/i, '').trim()
        : title,
      flags,
      maxAmount,
      maxAmountDisplay: maxAmountRaw,
      financialImpactEn: financialImpact || null,
      financialImpactEs: readMemoField(memoFieldsEs, 'financialImpact', 'es') || null,
      summaryEn: abstract || recommendation || null,
      summaryEs:
        readMemoField(memoFieldsEs, 'summary', 'es') || readMemoField(memoFieldsEs, 'recommendation', 'es') || null,
      attachments,
      isWarrantRegister,
      isMinutes,
      isFieldTripOrDonation,
    };

    if (flags.length > 0) {
      flaggedItems.push(entry);
    } else {
      routineItems.push(entry);
    }
  }

  return {
    totalConsentItems: consent.length,
    thresholdUsd: CONSENT_DOLLAR_THRESHOLD,
    flaggedItems,
    routineItems,
    unextractableDisclosures,
  };
}

/**
 * Attach SHA-256 and byte size metadata for local board-packet PDFs referenced
 * in a docket brief citation list.
 */
export async function enrichCitationArtifacts(rootDir, meetingDate, citations = []) {
  const enriched = [];
  for (const cit of citations) {
    const copy = { ...cit };
    if (cit.filename) {
      const localPath = resolve(rootDir, 'artifacts/board-packets', meetingDate, cit.filename);
      if (existsSync(localPath)) {
        copy.localPath = `artifacts/board-packets/${meetingDate}/${cit.filename}`;
        copy.sha256 = await hashFile(localPath);
        copy.bytes = statSync(localPath).size;
      }
      if (!copy.r2Url) {
        copy.r2Url = `${R2_BASE}/board-packets/${meetingDate}/${encodeURIComponent(cit.filename).replace(/%20/g, '%20')}`;
      }
    }
    enriched.push(copy);
  }
  return enriched;
}

const SIMBLI_MID_RE = /simbli\.eboardsolutions\.com\/[^\s"]*[?&]MID=(\d+)/i;

/**
 * Source-grounding checks for one citation against the meeting it belongs to.
 * - a `filename` must be one of the meeting's archived attachments;
 * - an R2 board-packet URL must point at this meeting's folder and an archived file;
 * - a Simbli URL must carry this meeting's MID.
 */
function checkCitationSource(cit, path, doc, context, pushErr) {
  const inventory = context.attachmentFilenames
    ? context.attachmentFilenames instanceof Set
      ? context.attachmentFilenames
      : new Set(context.attachmentFilenames)
    : null;
  if (cit.filename && inventory && !inventory.has(cit.filename)) {
    pushErr(`${path}/filename`, `Citation filename "${cit.filename}" is not an archived attachment of the ${doc.date} meeting`);
  }
  const packetPrefix = `${R2_BASE}/board-packets/`;
  for (const key of ['r2Url', 'url']) {
    const u = cit[key];
    if (!u || typeof u !== 'string') continue;
    if (u.startsWith(packetPrefix)) {
      const rest = u.slice(packetPrefix.length);
      const slash = rest.indexOf('/');
      const folder = slash >= 0 ? rest.slice(0, slash) : rest;
      let file = slash >= 0 ? rest.slice(slash + 1) : '';
      try {
        file = decodeURIComponent(file);
      } catch {
        // keep raw
      }
      if (folder !== doc.date) {
        pushErr(`${path}/${key}`, `Board-packet URL points at ${folder}, not this meeting (${doc.date})`);
      } else if (inventory && !inventory.has(file)) {
        pushErr(`${path}/${key}`, `Board-packet URL file "${file}" is not an archived attachment of the ${doc.date} meeting`);
      }
    }
    const mid = u.match(SIMBLI_MID_RE);
    if (mid && context.meetingMid != null && String(mid[1]) !== String(context.meetingMid)) {
      pushErr(`${path}/${key}`, `Simbli URL MID ${mid[1]} does not match this meeting's MID ${context.meetingMid}`);
    }
  }
}

/**
 * Validate a Docket Brief JSON document for schema and provenance invariants.
 *
 * `context` (optional, supplied by the generator and the test suite) grounds the
 * brief in its meeting's source files:
 *   - attachmentFilenames: Set/array of archived attachment filenames
 *     (attachmentInventory(memo)); every citation must resolve to one of them.
 *   - meetingMid: the meeting's Simbli MID; any Simbli citation URL must match.
 *   - automatedFlags: screenConsentCalendar(...).flaggedItems; every flagged
 *     consent item must appear in spotlightItems (by expanded itemLabel) or in
 *     consentScreening.reviewedExceptions with a bilingual reason.
 */
export function validateDocketBrief(doc, context = {}) {
  const errors = [];
  const pushErr = (path, message) => errors.push({ path, message });

  if (!doc || typeof doc !== 'object') {
    pushErr('', 'Docket brief must be an object');
    return { valid: false, errors };
  }

  if (!doc._metadata || typeof doc._metadata !== 'object') {
    pushErr('/_metadata', 'Missing required _metadata provenance block');
  } else {
    if (!doc._metadata.source) pushErr('/_metadata/source', 'Missing _metadata.source');
    if (!doc._metadata.scrapedAt) pushErr('/_metadata/scrapedAt', 'Missing _metadata.scrapedAt');
    if (!doc._metadata.method) pushErr('/_metadata/method', 'Missing _metadata.method');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(doc.date || ''))) {
    pushErr('/date', 'date must be YYYY-MM-DD');
  }
  if (!doc.meetingSlug || typeof doc.meetingSlug !== 'string') {
    pushErr('/meetingSlug', 'Missing meetingSlug');
  }
  if (!['proposed', 'completed'].includes(doc.meetingStage)) {
    pushErr('/meetingStage', 'meetingStage must be "proposed" or "completed"');
  }
  if (!['human-reviewed', 'machine-checked'].includes(doc.qualityState)) {
    pushErr('/qualityState', 'qualityState must be "human-reviewed" or "machine-checked"');
  }

  if (!doc.overviewEn || !doc.overviewEs) {
    pushErr('/overview', 'Both overviewEn and overviewEs are required for bilingual parity');
  }

  if (!Array.isArray(doc.topItems) || doc.topItems.length === 0) {
    pushErr('/topItems', 'topItems must be a non-empty array');
  } else {
    doc.topItems.forEach((item, i) => {
      const p = `/topItems/${i}`;
      if (!item.itemLabel) pushErr(`${p}/itemLabel`, 'Missing itemLabel');
      if (!item.titleEn || !item.titleEs) pushErr(`${p}/title`, 'Both titleEn and titleEs are required');
      if (!item.whatIsProposedEn || !item.whatIsProposedEs) {
        pushErr(`${p}/whatIsProposed`, 'Both whatIsProposedEn and whatIsProposedEs are required');
      }
      if (!item.whyItMattersEn || !item.whyItMattersEs) {
        pushErr(`${p}/whyItMatters`, 'Both whyItMattersEn and whyItMattersEs are required');
      }
      if (!item.proposalStatusBadgeEn || !item.proposalStatusBadgeEs) {
        pushErr(`${p}/proposalStatusBadge`, 'Both proposalStatusBadgeEn and proposalStatusBadgeEs are required');
      }
      if (!Array.isArray(item.citations) || item.citations.length === 0) {
        pushErr(`${p}/citations`, 'Every topItem must have at least one source citation');
      } else {
        item.citations.forEach((cit, j) => {
          if (!cit.url && !cit.r2Url) {
            pushErr(`${p}/citations/${j}`, 'Citation must include url or r2Url');
          }
          if (!cit.extractionStatus) {
            pushErr(`${p}/citations/${j}/extractionStatus`, 'Citation must declare extractionStatus');
          }
          checkCitationSource(cit, `${p}/citations/${j}`, doc, context, pushErr);
        });
      }
    });

    // topItems are time-weighted: each item's agenda allocation must not exceed the previous one's.
    let prevMinutes = Infinity;
    doc.topItems.forEach((item, i) => {
      if (item.allocatedMinutes == null) return;
      if (typeof item.allocatedMinutes !== 'number' || !(item.allocatedMinutes >= 0)) {
        pushErr(`/topItems/${i}/allocatedMinutes`, 'allocatedMinutes must be a non-negative number');
        return;
      }
      if (item.allocatedMinutes > prevMinutes) {
        pushErr(
          `/topItems/${i}/allocatedMinutes`,
          `topItems must be ordered by allocatedMinutes (descending); ${item.allocatedMinutes} follows ${prevMinutes}`
        );
      }
      prevMinutes = item.allocatedMinutes;
    });
  }

  if (!doc.consentScreening || typeof doc.consentScreening !== 'object') {
    pushErr('/consentScreening', 'Missing consentScreening block');
  } else {
    const cs = doc.consentScreening;
    if (typeof cs.totalConsentItems !== 'number' || cs.totalConsentItems < 0) {
      pushErr('/consentScreening/totalConsentItems', 'totalConsentItems must be a non-negative integer');
    }
    if (!Array.isArray(cs.spotlightItems)) {
      pushErr('/consentScreening/spotlightItems', 'spotlightItems must be an array');
    } else {
      cs.spotlightItems.forEach((sp, i) => {
        const p = `/consentScreening/spotlightItems/${i}`;
        if (!sp.itemLabel) pushErr(`${p}/itemLabel`, 'Missing itemLabel');
        if (!sp.titleEn || !sp.titleEs) pushErr(`${p}/title`, 'Both titleEn and titleEs required');
        if (!sp.summaryEn || !sp.summaryEs) pushErr(`${p}/summary`, 'Both summaryEn and summaryEs required');
        if (!Array.isArray(sp.flags) || sp.flags.length === 0) {
          pushErr(`${p}/flags`, 'Spotlight item must list at least one screening flag');
        }
        if (!Array.isArray(sp.citations) || sp.citations.length === 0) {
          pushErr(`${p}/citations`, 'Spotlight item must have at least one source citation');
        } else {
          sp.citations.forEach((cit, j) => {
            if (!cit.url && !cit.r2Url) {
              pushErr(`${p}/citations/${j}`, 'Citation must include url or r2Url');
            }
            checkCitationSource(cit, `${p}/citations/${j}`, doc, context, pushErr);
          });
        }
      });
    }

    const exceptions = cs.reviewedExceptions == null ? [] : cs.reviewedExceptions;
    if (!Array.isArray(exceptions)) {
      pushErr('/consentScreening/reviewedExceptions', 'reviewedExceptions must be an array when present');
    } else {
      exceptions.forEach((ex, i) => {
        const p = `/consentScreening/reviewedExceptions/${i}`;
        if (!ex?.itemLabel) pushErr(`${p}/itemLabel`, 'Missing itemLabel');
        if (!ex?.reasonEn || !ex?.reasonEs) pushErr(`${p}/reason`, 'Both reasonEn and reasonEs are required');
      });
    }

    // Every automatically flagged consent item must be either spotlighted or explicitly excepted.
    if (Array.isArray(context.automatedFlags) && Array.isArray(cs.spotlightItems) && Array.isArray(exceptions)) {
      const covered = new Set();
      for (const sp of cs.spotlightItems) for (const l of expandItemLabels(sp.itemLabel)) covered.add(l);
      for (const ex of exceptions) for (const l of expandItemLabels(ex?.itemLabel)) covered.add(l);
      for (const flagged of context.automatedFlags) {
        const label = flagged?.itemLabel;
        if (label && !covered.has(label)) {
          pushErr(
            '/consentScreening/spotlightItems',
            `Automated screen flagged consent item ${label} (${(flagged.flags || []).join(', ')}) but it is neither spotlighted nor listed in reviewedExceptions`
          );
        }
      }
    }
    if (!cs.routineSummaryEn || !cs.routineSummaryEs) {
      pushErr('/consentScreening/routineSummary', 'Both routineSummaryEn and routineSummaryEs are required');
    }
    if (!Array.isArray(cs.extractionNotes)) {
      pushErr('/consentScreening/extractionNotes', 'extractionNotes must be an array');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
