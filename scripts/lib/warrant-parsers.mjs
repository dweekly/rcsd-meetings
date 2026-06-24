/**
 * warrant-parsers.mjs — parse the two warrant-register report formats RCSD has used,
 * into per-payment line items, plus the printed grand total used as a parse checksum.
 *
 * Formats (verified empirically 2026-06-24, see WARRANTS.md):
 *   - QSS  "Accounts Payable Warrant Status Report" / "Warrant Maintenance – …"
 *          (San Mateo COE / BoardDocs era, Mar 2020 – May 2025). One row per warrant:
 *          [status-code] warrant# payee DIST(18) date-issued amount [status-date] [reason] status
 *          Grand total: "** TOTAL DISTRICT 18   8,472,969.53" (sum of all warrant amounts).
 *   - ESCAPE "ReqPay12a Board Report" (Simbli era, Jun 2025+). One check, one or more
 *          fund-object lines; the rightmost "Check Amount" appears once per check on its
 *          last line. Grand total: "Net (Check Amount)   5,390,541.98".
 *
 * Both parsers are checksum-driven: callers compare summed line items against the printed
 * total and treat any register that fails to reconcile as suspect (parseStatus: "mismatch").
 */

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

function toNumber(s) {
  // "8,043.29" -> 8043.29 ; "211.55-" -> -211.55 (trailing-minus = credit)
  const neg = /-\s*$/.test(s);
  const n = parseFloat(s.replace(/[, ]/g, '').replace(/-$/, ''));
  return neg ? -n : n;
}

function monthKeyFromMDY(mdy) {
  // "03/01/2020" -> "2020-03"
  const m = mdy.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1]}` : null;
}

/** Detect which report format a PDF's extracted text is. */
export function detectFormat(text) {
  if (/ReqPay12a|Pay to the Order of|Net \(Check Amount\)/i.test(text)) return 'escape';
  if (/ACCOUNTS PAYABLE WARRANT STATUS REPORT|WARRANT MAINTENANCE|TOTAL DISTRICT/i.test(text)) return 'qss';
  return 'unknown';
}

/** True if the extracted text looks like a broken/no-ToUnicode font (glyph-shifted gibberish). */
export function looksGarbled(text) {
  const head = text.slice(0, 4000);
  const known = /ACCOUNTS PAYABLE|WARRANT|REPORT|Pay to the Order|Check|District|Redwood/i.test(head);
  // Glyph-shift signature: lots of '$' '&' runs where letters should be, and no known words.
  const shifted = /\$&&|\$<\$|55\$17|7865\(/.test(head);
  return !known || shifted;
}

/**
 * Parse the QSS "Accounts Payable Warrant Status Report" family.
 * Works on both `pdftotext -layout` (multi-space columns) and OCR (single-space) text,
 * because the row anchor keys on the warrant number, the literal DIST "18", dates and amount.
 */
export function parseQSS(text) {
  const lines = text.split('\n');
  // RCSD has used two QSS column layouts under this report family:
  //   CLASSIC (SMCOE, 2020–2021): [status-code] warrant# payee DIST(18) date amount [statusDate] [reason] STATUS
  //   MAINT  ("Warrant Maintenance", 2022+): DIST(18) warrant# payee amount date STATUS [statusDate]
  // Anchor on warrant# + DIST 18 + date + amount; the tail (optional status date, reason, status
  // word) is captured loosely so OUTSTANDING warrants that print a BLANK status (no word) — common
  // in the older registers — are still matched. Status is read from the tail; blank = Outstanding.
  const ROW_CLASSIC = /^\s*([A-Z]{0,2})\s+(\d{5,7})\s+(.+?)\s+18\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(-?[\d,]+\.\d{2})\s*(\d{1,2}\/\d{1,2}\/\d{2,4})?\s*(.*?)\s*$/i;
  const CLASSIC_STATUS = /\b(Redeemed|Outstanding|Cancelled(?:\/Reissued)?|Voided|Stale\s*Dated?)\b/i;
  // Trailing "...Cancelled 03/01/2023 LOST" — a cancelled warrant carries a status date and a
  // free-text reason after the status; tolerate both (the amount still counts toward the printed total).
  const ROW_MAINT = /^\s*18\s+(\d{5,7})\s+(.+?)\s+(-?[\d,]+\.\d{2})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(Redeemed|Outstanding|Cancelled(?:\/Reissued)?|Voided|Stale\s*Dated?)(?:\s+(\d{1,2}\/\d{1,2}\/\d{2,4}))?.*$/i;
  const STATUSES = /^(Redeemed|Outstanding|Cancelled|Voided|Stale)/i;
  const isRow = (ln) => ROW_CLASSIC.test(ln) || ROW_MAINT.test(ln);

  const rows = [];
  let periodFrom = null, periodTo = null;
  for (const ln of lines) {
    // Capture the reporting period from any page header.
    const per = ln.match(/ISSUED\s+(\d{2}\/\d{2}\/\d{4})\s+THRU\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (per) { periodFrom = periodFrom || per[1]; periodTo = per[2]; }

    const mc = ln.match(ROW_CLASSIC);
    if (mc) {
      const tail = (mc[7] || '').trim();
      const st = tail.match(CLASSIC_STATUS);
      rows.push({
        statusCode: (mc[1] || '').trim(),
        warrant: mc[2],
        payee: mc[3].trim().replace(/\s+/g, ' '),
        dateIssued: mc[4],
        amount: toNumber(mc[5]),
        statusDate: mc[6] || null,
        status: st ? st[1].replace(/\s+/g, ' ') : 'Outstanding', // blank status word = outstanding
      });
      continue;
    }
    const mm = ln.match(ROW_MAINT);
    if (mm) {
      rows.push({
        statusCode: '',
        warrant: mm[1],
        payee: mm[2].trim().replace(/\s+/g, ' '),
        dateIssued: mm[4],
        amount: toNumber(mm[3]),
        statusDate: mm[6] || null,
        status: mm[5].replace(/\s+/g, ' '),
      });
    }
  }

  // Multi-line payee names: a line under the payee column with no warrant#/amount,
  // following a row, continues the previous payee (e.g. "CALIFORNIA ASSOCIATION OF" +
  // "SCHOOL BUSINESS OFFICIALS"). Re-walk to stitch them.
  let lastRowIdx = -1, rowCursor = 0;
  for (const ln of lines) {
    if (isRow(ln)) { lastRowIdx = rowCursor; rowCursor++; continue; }
    const t = ln.trim();
    if (lastRowIdx >= 0 && t && !/^\d/.test(t) && !STATUSES.test(t) &&
        !/REPORT|DISTRICT|WARRANT|PAYEE|STATUS|COUNTY|OFFICE|EDUCATION|TOTAL|Page|ISSUED|CODE|NUMBER|DATE|AMOUNT|REASON/i.test(t) &&
        /^[A-Z0-9][A-Z0-9 '&./,\-]+$/.test(t) && t.length <= 45) {
      // Append to the most recently parsed row's payee.
      const r = rows[lastRowIdx];
      if (r && (r.payee.length + t.length) < 80) r.payee = `${r.payee} ${t}`.replace(/\s+/g, ' ');
    } else if (t) {
      // Any other non-row content ends the continuation window.
      if (!/^[A-Z0-9][A-Z0-9 '&./,\-]+$/.test(t)) lastRowIdx = -1;
    }
  }

  const totalMatch = text.match(/TOTAL\s+DISTRICT\s+18\s+([\d,]+\.\d{2})/i);
  const printedTotal = totalMatch ? toNumber(totalMatch[1]) : null;

  // QSS "** TOTAL DISTRICT 18" includes cancelled warrants, so reconcile against the sum of ALL
  // rows; disbursedTotal (money actually paid) excludes cancelled/voided for spend reporting.
  const isCancelled = (r) => /^(Cancelled|Voided)/i.test(r.status || '');
  const reconcileTotal = rows.reduce((s, r) => s + r.amount, 0);
  const disbursedTotal = rows.filter((r) => !isCancelled(r)).reduce((s, r) => s + r.amount, 0);

  return {
    format: 'qss',
    rows,
    printedTotal,
    reconcileTotal,
    disbursedTotal,
    period: { from: periodFrom, to: periodTo, monthKey: periodFrom ? monthKeyFromMDY(periodFrom) : null },
  };
}

/**
 * Parse the Escape "ReqPay12a Board Report" format.
 * A check's amount is the rightmost currency token on its last line; checks that span a
 * page break re-print their header, so we key by check number and keep the final fragment.
 */
export function parseEscape(text) {
  const lines = text.split('\n');
  // check#(6) + date is a strong, unambiguous anchor (fund-object continuation lines start with
  // whitespace, never with "######  MM/DD/YYYY"). The fund-object may sit on a later line for
  // long payee names, so don't require it here; payee ends at the first fund-object, amount, or EOL.
  const CHECK_START = /^\s*(\d{6})\s+(\d{2}\/\d{2}\/\d{4})\s+(.+?)(?:\s{2,}\d{2}-\w+|\s{2,}-?[\d,]+\.\d{2}|\s*$)/;
  const CURRENCY = /\d{1,3}(?:,\d{3})*\.\d{2}-?/g;
  const isSummary = (ln) => /Total Number of Checks|Fund Recap|Less Unpaid Tax|Net \(Check Amount\)/i.test(ln);

  const byNum = new Map();
  let curNum = null, inSummary = false;
  let periodFrom = null, periodTo = null;
  for (const ln of lines) {
    const per = ln.match(/Checks Dated\s+(\d{2}\/\d{2}\/\d{4})\s+through\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (per) { periodFrom = periodFrom || per[1]; periodTo = per[2]; }

    if (isSummary(ln)) inSummary = true;
    if (inSummary) continue;

    const m = ln.match(CHECK_START);
    if (m) {
      curNum = m[1];
      if (!byNum.has(curNum)) {
        // A cancelled check shows "... Cancelled  323.00 *" on its start line and a
        // "Cancelled on …" follow-up; its amount is NOT disbursed and is excluded from Net.
        const payee = m[3].trim().replace(/\s+Cancelled\s*$/i, '').replace(/\s+/g, ' ');
        byNum.set(curNum, { check: curNum, dateIssued: m[2], payee, amount: 0, fundObjects: [], status: 'Active' });
      }
    }
    if (curNum) {
      const rec = byNum.get(curNum);
      if (/\bCancelled\b/i.test(ln)) rec.status = 'Cancelled';
      const fo = ln.match(/(\d{2}-\w+)/);
      if (fo && !rec.fundObjects.includes(fo[1])) rec.fundObjects.push(fo[1]);
      const toks = ln.match(CURRENCY);
      if (toks) rec.amount = toNumber(toks[toks.length - 1]); // last token = check amount on final line
    }
  }
  const rows = [...byNum.values()];

  const netMatch = text.match(/Net \(Check Amount\)\s+([\d,]+\.\d{2})/i);
  const printedTotal = netMatch ? toNumber(netMatch[1]) : null;
  // Net (Check Amount) counts only money actually disbursed → exclude cancelled checks.
  const reconcileTotal = rows.filter((r) => r.status !== 'Cancelled').reduce((s, r) => s + r.amount, 0);
  const disbursedTotal = reconcileTotal;
  const cntMatch = text.match(/Total Number of Checks\s+(\d+)\s+[\d,]+\.\d{2}/i);
  const printedCount = cntMatch ? parseInt(cntMatch[1], 10) : null;

  // Fund Recap: per-fund "01  General Fund  319  3,373,105.97"
  const fundRecap = [];
  for (const fm of text.matchAll(/^\s*(\d{2})\s+([A-Za-z][A-Za-z .&-]+?)\s+(\d+)\s+([\d,]+\.\d{2})\s*$/gm)) {
    fundRecap.push({ fund: fm[1], description: fm[2].trim(), checkCount: parseInt(fm[3], 10), expensed: toNumber(fm[4]) });
  }

  return {
    format: 'escape',
    rows,
    printedTotal,
    reconcileTotal,
    disbursedTotal,
    printedCount,
    fundRecap,
    period: { from: periodFrom, to: periodTo, monthKey: periodFrom ? monthKeyFromMDY(periodFrom) : null },
  };
}

/**
 * Heuristically classify a payee as an individual vs a business/vendor.
 * High confidence for "LASTNAME, FIRSTNAME" (Escape-era reimbursements). QSS-era individuals
 * appear as "FIRST LAST" with no comma, which is harder — flagged low confidence for PR3 review.
 */
const BIZ_TOKENS = /\b(INC|LLC|L\.?L\.?C|CORP|CORPORATION|CO|COMPANY|LTD|LP|LLP|ASSOC|ASSOCIATION|SERVICES|SERVICE|SYSTEMS|SCHOOL|SCHOOLS|DISTRICT|COUNTY|UNIVERSITY|UNIV|COLLEGE|CENTER|FOUNDATION|TRUST|BANK|GROUP|SUPPLY|SUPPLIES|PRODUCTS|SOLUTIONS|TECHNOLOGIES|TECH|MEDIA|PRESS|BOOKS|MUSIC|ELECTRIC|PLUMBING|CONSTRUCTION|ENGINEERING|CONSULTING|INSURANCE|MEDICAL|HEALTH|THERAPY|DEPT|DEPARTMENT|OFFICE|CITY OF|STATE OF|REGENTS|CALPERS|CALSTRS|PG&E|AT&T|USA|INTERNATIONAL|ENTERPRISES|INDUSTRIES|SUPPLY|SHOP|STORE|MARKET|CATERING|SECURITY|SUPERINTENDENTS?)\b/i;

export function classifyPayee(name) {
  const n = (name || '').trim();
  // Only the "LASTNAME, FIRSTNAME" pattern is a reliable individual signal (Escape-era
  // reimbursements). A bare two-word name like "ROCKETSHIP EDUCATION" is indistinguishable from
  // a person, so we do NOT guess — everything without a surname-comma defaults to vendor. This
  // trades recall (QSS-era individuals get labeled vendor) for precision (no business mislabeled).
  if (/^[A-Z][A-Za-z'’.\-]+,\s+[A-Z]/.test(n)) return { type: 'individual', confidence: 'high' };
  return { type: 'vendor', confidence: BIZ_TOKENS.test(n) ? 'high' : 'low' };
}

// Known acronyms/suffixes to keep uppercase when title-casing an all-caps vendor name.
const KEEP_UPPER = new Set(['LLC', 'LLP', 'LP', 'USA', 'PG&E', 'AT&T', 'CDW', 'KIPP', 'ICC', 'RGM',
  'BMR', 'HVAC', 'PC', 'DBA', 'TK', 'SELPA', 'SMCOE', 'PAL', 'YMCA', 'II', 'III', 'IV']);

const MINOR_WORDS = new Set(['AND', 'OF', 'THE', 'FOR', 'TO', 'IN', 'ON', 'AT', 'BY', 'A', 'AN']);

function titleCaseName(s) {
  return s.split(/\s+/).map((w, i) => {
    const up = w.toUpperCase();
    if (up === 'INC' || up === 'INC.') return 'Inc';
    if (up === 'CORP' || up === 'CORP.') return 'Corp';
    if (KEEP_UPPER.has(up)) return up;
    if (i > 0 && MINOR_WORDS.has(up)) return w.toLowerCase();   // "and", "of" — but not as first word
    if (/^[A-Z]&[A-Z]$/.test(w)) return w;                       // R&B, A&B
    if (w.length <= 4 && !/[AEIOU]/i.test(w.replace(/[^A-Z]/gi, ''))) return up; // RGM, BMR (no vowels)
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
}

/**
 * Pick a clean display name from the spellings of one normalized payee key.
 * QSS-era registers print ALL CAPS, Escape-era print Title Case — prefer a mixed-case spelling
 * when the vendor appears in both eras; otherwise title-case the all-caps name.
 * @param {Map<string, number>} spellingCounts payee spelling → occurrence count
 */
export function prettyVendorName(spellingCounts) {
  const entries = [...spellingCounts.entries()].sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '';
  const mixed = entries.filter(([s]) => /[a-z]/.test(s));
  if (mixed.length) return mixed[0][0];
  return titleCaseName(entries[0][0]);
}

/**
 * Cross-era individual detection. The Escape era (Jun 2025+) prints employees as
 * "Surname, Given M" (a reliable person signal); the older QSS era prints "GIVEN SURNAME",
 * indistinguishable from a 2-word company. To recover QSS-era reimbursements, build a roster of
 * person keys from the comma-format names, then match plain names against it.
 */
export function isCommaName(payee) {
  const n = (payee || '').trim();
  // "Surname, Given" — but NOT a business that prints its suffix after a comma
  // ("Flextg, LLC", "Liminex, Inc"), which would otherwise read as a person.
  if (!/^[A-Z][A-Za-z'’.\-]+,\s+[A-Z]/.test(n)) return false;
  return !BIZ_TOKENS.test(n);
}
// Normalized "GIVEN SURNAME" key so the same person matches across both name formats.
export function personMatchKey(payee) {
  const n = (payee || '').trim();
  let first, last;
  const comma = n.match(/^([^,]+),\s*(.+)$/);
  if (comma) {
    const surname = comma[1].trim().split(/\s+/);
    last = surname[surname.length - 1];
    first = comma[2].trim().split(/\s+/)[0];
  } else {
    const w = n.split(/\s+/);
    if (w.length < 2) return null;
    first = w[0]; last = w[w.length - 1];
  }
  const norm = (s) => s.toUpperCase().replace(/[^A-Z]/g, '');
  const fk = norm(first), lk = norm(last);
  return fk && lk ? `${fk} ${lk}` : null;
}
// A plain (non-comma) name worth testing against the roster: 2-3 alpha words, no business tokens.
export function isPlainPersonCandidate(payee) {
  const n = (payee || '').trim();
  if (n.includes(',') || BIZ_TOKENS.test(n)) return false;
  const w = n.split(/\s+/);
  return w.length >= 2 && w.length <= 3 && w.every((x) => /^[A-Za-z][A-Za-z'’.\-]*$/.test(x));
}
export function titleCasePerson(key) {
  return key.toLowerCase().split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Normalize a payee into a match key for aggregation (PR3 refines with a curated alias map). */
export function normalizePayeeKey(name) {
  return (name || '')
    .toUpperCase()
    .replace(/[.,'’`]/g, '')
    .replace(/&/g, ' AND ')
    .replace(/\b(INC|LLC|LLP|LP|CORP|CORPORATION|CO|COMPANY|LTD|THE)\b/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export { MONTHS, toNumber, monthKeyFromMDY };
