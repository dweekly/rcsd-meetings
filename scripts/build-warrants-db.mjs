#!/usr/bin/env node
/**
 * build-warrants-db.mjs — assemble the per-register JSON into a queryable SQLite database.
 *
 * Reads data/warrants/{YYYY-MM}.json + data/warrants-index.json (from extract-warrants.mjs) and
 * data/warrant-vendor-aliases.json, and writes ./warrants.db — the local query layer for
 * vendor-spend reporting (report-vendor-spend.mjs). The DB is gitignored and NOT synced to R2:
 * it carries individual-reimbursement payee names, and the project is internal-first.
 *
 * Two correctness rules are baked into the `excluded` flag so spend queries can simply filter
 * `excluded = 0`:
 *   - Cancelled / voided warrants never disbursed money → excluded.
 *   - Overlapping registers (e.g. a 6/1–6/25 and a 6/1–6/30 sheet for the same month) would
 *     double-count their shared warrants. The register whose period CONTAINS the other is kept;
 *     the contained (subset) register is marked superseded and all its rows are excluded.
 *     (Warrant numbers recycle across years, so dedup is scoped to overlapping pairs, never global.)
 *
 * Usage:  node scripts/build-warrants-db.mjs            (rebuilds ./warrants.db from scratch)
 */

import Database from 'better-sqlite3';
import { prettyVendorName, isCommaName, personMatchKey, isPlainPersonCandidate, titleCasePerson } from './lib/warrant-parsers.mjs';
import { readFileSync, readdirSync, existsSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_PATH = resolve(ROOT, 'warrants.db');
const WARR_DIR = resolve(ROOT, 'data/warrants');

// California school-district fiscal year runs Jul 1 – Jun 30. FY2024-25 = Jul 2024 … Jun 2025.
function fiscalYear(mdy) {
  const m = (mdy || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  let y = +m[3]; if (y < 100) y += 2000;
  const mo = +m[1];
  const start = mo >= 7 ? y : y - 1;
  return `FY${start}-${String(start + 1).slice(2)}`;
}

function ymd(mdy) {
  const m = (mdy || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  let y = +m[3]; if (y < 100) y += 2000;
  return `${y}-${String(+m[1]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`;
}

// Build a normalized-key → canonical-name lookup from the curated alias map.
function loadAliasMap() {
  const p = resolve(ROOT, 'data/warrant-vendor-aliases.json');
  const keyToCanonical = new Map();
  if (existsSync(p)) {
    const { aliases } = JSON.parse(readFileSync(p, 'utf8'));
    for (const [canonical, keys] of Object.entries(aliases || {})) {
      for (const k of keys) keyToCanonical.set(k.toUpperCase(), canonical);
    }
  }
  return keyToCanonical;
}

// Decide which of two overlapping registers supersedes the other (the one whose period contains it).
function supersededMap(index) {
  const byMonth = new Map(index.registers.map((r) => [r.month, r]));
  const superseded = new Map(); // subsetMonth -> containerMonth
  for (const [a, b] of (index._metadata.periodOverlaps || [])) {
    const ra = byMonth.get(a), rb = byMonth.get(b);
    if (!ra?.period || !rb?.period) continue;
    const fa = ymd(ra.period.from), ta = ymd(ra.period.to);
    const fb = ymd(rb.period.from), tb = ymd(rb.period.to);
    if (!fa || !ta || !fb || !tb) continue;
    if (fa <= fb && ta >= tb) superseded.set(b, a);        // a contains b → b superseded
    else if (fb <= fa && tb >= ta) superseded.set(a, b);   // b contains a → a superseded
    // partial overlap (neither contains): leave both; would need warrant-level dedup (none seen so far)
  }
  return superseded;
}

function main() {
  if (existsSync(DB_PATH)) rmSync(DB_PATH);
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE registers (
      month TEXT PRIMARY KEY, meeting_date TEXT, format TEXT, source TEXT, source_url TEXT,
      period_from TEXT, period_to TEXT, printed_total REAL, disbursed_total REAL,
      parse_status TEXT, reconciled INTEGER, superseded_by TEXT
    );
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      register_month TEXT, warrant TEXT, date_issued TEXT, date_iso TEXT, fiscal_year TEXT,
      payee TEXT, payee_key TEXT, canonical TEXT, payee_type TEXT,
      amount REAL, status TEXT, fund_objects TEXT, excluded INTEGER
    );
  `);

  const index = JSON.parse(readFileSync(resolve(ROOT, 'data/warrants-index.json'), 'utf8'));
  const superseded = supersededMap(index);
  const keyToCanonical = loadAliasMap();
  const overrides = (() => {
    const p = resolve(ROOT, 'data/warrant-payee-overrides.json');
    if (!existsSync(p)) return {};
    const { overrides: o } = JSON.parse(readFileSync(p, 'utf8'));
    return Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k.toUpperCase(), v]));
  })();

  // First pass: collect a display name per normalized key (most frequent original spelling),
  // so non-aliased vendors get a readable canonical instead of the stripped key.
  const spellingCounts = new Map(); // key -> Map(spelling -> count)
  const personRoster = new Set();   // "GIVEN SURNAME" keys of known individuals (comma-format names)
  const files = readdirSync(WARR_DIR).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const j = JSON.parse(readFileSync(resolve(WARR_DIR, f), 'utf8'));
    for (const r of (j.lineItems || [])) {
      const k = r.payeeKey;
      if (!k) continue;
      if (!spellingCounts.has(k)) spellingCounts.set(k, new Map());
      const sc = spellingCounts.get(k);
      sc.set(r.payee, (sc.get(r.payee) || 0) + 1);
      if (isCommaName(r.payee)) { const pk = personMatchKey(r.payee); if (pk) personRoster.add(pk); }
    }
  }
  const displayForKey = new Map();
  for (const [k, sc] of spellingCounts) displayForKey.set(k, prettyVendorName(sc));
  const canonicalFor = (key) => keyToCanonical.get(key) || displayForKey.get(key) || key;
  // Match the public page: only registers whose detail reconciles, and only FY2014-15 onward.
  const usable = new Set(index.registers
    .filter((r) => r.parseStatus === 'reconciled' || r.parseStatus === 'minor-mismatch').map((r) => r.month));
  const FY_FLOOR = '2014-07-01';
  // Cross-era individual: comma-format names, plus plain "GIVEN SURNAME" names matching a rostered person.
  const individualOf = (payee) => {
    if (isCommaName(payee)) return personMatchKey(payee);
    if (isPlainPersonCandidate(payee)) { const pk = personMatchKey(payee); if (pk && personRoster.has(pk)) return pk; }
    return null;
  };

  const insReg = db.prepare(`INSERT INTO registers VALUES (@month,@meeting_date,@format,@source,@source_url,@period_from,@period_to,@printed_total,@disbursed_total,@parse_status,@reconciled,@superseded_by)`);
  const insPay = db.prepare(`INSERT INTO payments (register_month,warrant,date_issued,date_iso,fiscal_year,payee,payee_key,canonical,payee_type,amount,status,fund_objects,excluded)
    VALUES (@register_month,@warrant,@date_issued,@date_iso,@fiscal_year,@payee,@payee_key,@canonical,@payee_type,@amount,@status,@fund_objects,@excluded)`);

  let nReg = 0, nPay = 0, nExcluded = 0;
  const tx = db.transaction(() => {
    for (const f of files) {
      const j = JSON.parse(readFileSync(resolve(WARR_DIR, f), 'utf8'));
      const meta = j._metadata;
      const month = meta.month;
      const idx = index.registers.find((r) => r.month === month) || {};
      const isSuperseded = superseded.has(month);
      insReg.run({
        month,
        meeting_date: meta.meetingDate || null,
        format: meta.reportFormat || null,
        source: meta.source || null,
        source_url: meta.sourceUrl || null,
        period_from: meta.period?.from || null,
        period_to: meta.period?.to || null,
        printed_total: meta.checksum?.printedTotal ?? null,
        disbursed_total: meta.checksum?.disbursedTotal ?? null,
        parse_status: idx.parseStatus || (meta.checksum?.reconciled ? 'reconciled' : 'mismatch'),
        reconciled: meta.checksum?.reconciled ? 1 : 0,
        superseded_by: superseded.get(month) || null,
      });
      nReg++;
      for (const r of (j.lineItems || [])) {
        const num = r.warrant || r.check;
        const cancelled = /^(Cancelled|Voided)/i.test(r.status || '');
        const belowFloor = (ymd(r.dateIssued) || '') < FY_FLOOR;
        const excluded = (cancelled || isSuperseded || !usable.has(month) || belowFloor) ? 1 : 0;
        if (excluded) nExcluded++;
        insPay.run({
          register_month: month,
          warrant: num || null,
          date_issued: r.dateIssued || null,
          date_iso: ymd(r.dateIssued),
          fiscal_year: fiscalYear(r.dateIssued),
          payee: r.payee,
          payee_key: r.payeeKey || null,
          canonical: (() => { const pk = individualOf(r.payee); const ov = pk ? overrides[pk] : null; return ov ? ov.canonical : (pk ? titleCasePerson(pk) : canonicalFor(r.payeeKey)); })(),
          payee_type: (() => { const pk = individualOf(r.payee); return (pk && !overrides[pk]) ? 'individual' : (r.payeeType || (pk ? 'vendor' : null)); })(),
          amount: r.amount,
          status: r.status || null,
          fund_objects: (r.fundObjects || []).join(',') || null,
          excluded,
        });
        nPay++;
      }
    }
  });
  tx();

  db.exec(`
    CREATE INDEX idx_pay_canonical ON payments(canonical);
    CREATE INDEX idx_pay_key ON payments(payee_key);
    CREATE INDEX idx_pay_fy ON payments(fiscal_year);
    CREATE INDEX idx_pay_excluded ON payments(excluded);
  `);

  const live = db.prepare(`SELECT COUNT(*) n, ROUND(SUM(amount),2) s FROM payments WHERE excluded=0`).get();
  console.log(`Built ${DB_PATH}`);
  console.log(`  registers: ${nReg}  payments: ${nPay}  (excluded ${nExcluded}: cancelled/voided + superseded)`);
  console.log(`  spendable: ${live.n} payments totaling $${live.s.toLocaleString()}`);
  console.log(`  superseded registers: ${[...superseded.keys()].join(', ') || '(none)'}`);
  db.close();
}

main();
