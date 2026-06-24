#!/usr/bin/env node
/**
 * report-vendor-spend.mjs — answer "how much does the district pay <vendor> per year?"
 *
 * Queries warrants.db (built by build-warrants-db.mjs) for payments to a vendor, grouped by
 * California fiscal year (Jul–Jun). Excludes cancelled/voided warrants and superseded duplicate
 * registers automatically (the `excluded` flag). Vendor-name variants roll up via the canonical
 * name from data/warrant-vendor-aliases.json.
 *
 * Usage:
 *   node scripts/report-vendor-spend.mjs "van pelt"        # spend by fiscal year
 *   node scripts/report-vendor-spend.mjs "van pelt" --detail   # + every check, with source PDF links
 *   node scripts/report-vendor-spend.mjs --top 25          # top 25 vendors all-time
 *   node scripts/report-vendor-spend.mjs --top 25 --fy FY2024-25
 *   npm run report:warrants -- "kipp"
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { normalizePayeeKey } from './lib/warrant-parsers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_PATH = resolve(ROOT, 'warrants.db');

const usd = (n) => '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function openDb() {
  if (!existsSync(DB_PATH)) {
    console.log('warrants.db not found — building it first…');
    execFileSync('node', [resolve(__dirname, 'build-warrants-db.mjs')], { stdio: 'inherit' });
  }
  return new Database(DB_PATH, { readonly: true });
}

function topVendors(db, n, fy) {
  const where = fy ? 'AND fiscal_year = ?' : '';
  const rows = db.prepare(
    `SELECT canonical, ROUND(SUM(amount),2) total, COUNT(*) checks
     FROM payments WHERE excluded = 0 ${where}
     GROUP BY canonical ORDER BY total DESC LIMIT ?`
  ).all(...(fy ? [fy, n] : [n]));
  console.log(`\nTop ${n} vendors${fy ? ` — ${fy}` : ' (all time)'} by warrant spend:\n`);
  rows.forEach((r, i) => console.log(`  ${String(i + 1).padStart(2)}. ${usd(r.total).padStart(15)}  ${String(r.checks).padStart(4)} ✓  ${r.canonical}`));
  console.log(`\n(${rows.length} shown. Cancelled/voided and superseded-duplicate registers excluded.)`);
}

function vendorReport(db, query, detail) {
  const nk = normalizePayeeKey(query);
  const like = `%${nk}%`;
  // Match on the normalized key, the raw payee, or the canonical display name.
  const canon = db.prepare(
    `SELECT DISTINCT canonical FROM payments
     WHERE excluded = 0 AND (payee_key LIKE ? OR UPPER(payee) LIKE ? OR UPPER(canonical) LIKE ?)
     ORDER BY canonical`
  ).all(like, `%${query.toUpperCase()}%`, `%${query.toUpperCase()}%`).map((r) => r.canonical);

  if (!canon.length) {
    console.log(`\nNo payments found matching "${query}". Try \`--top 50\` to browse vendor names.`);
    return;
  }
  console.log(`\nVendor spend for "${query}"`);
  console.log(`Matched canonical vendor(s): ${canon.join('; ')}`);

  const placeholders = canon.map(() => '?').join(',');
  const byFy = db.prepare(
    `SELECT fiscal_year fy, ROUND(SUM(amount),2) total, COUNT(*) checks
     FROM payments WHERE excluded = 0 AND canonical IN (${placeholders})
     GROUP BY fiscal_year ORDER BY fiscal_year`
  ).all(...canon);

  console.log('');
  let grand = 0, grandChecks = 0;
  for (const r of byFy) { grand += r.total; grandChecks += r.checks; console.log(`  ${r.fy}   ${usd(r.total).padStart(15)}   ${String(r.checks).padStart(3)} ✓`); }
  console.log(`  ${'─'.repeat(34)}`);
  console.log(`  TOTAL      ${usd(grand).padStart(15)}   ${String(grandChecks).padStart(3)} ✓`);

  // Caveat footnote: any matched payments from non-reconciled registers?
  const caveats = db.prepare(
    `SELECT DISTINCT r.month, r.parse_status FROM payments p JOIN registers r ON r.month = p.register_month
     WHERE p.excluded = 0 AND p.canonical IN (${placeholders}) AND r.parse_status != 'reconciled' ORDER BY r.month`
  ).all(...canon);
  if (caveats.length) {
    console.log(`\n  ⚠ Includes months whose register did not fully reconcile (line items still complete):`);
    for (const c of caveats) console.log(`      ${c.month} — ${c.parse_status}`);
  }

  if (detail) {
    const rows = db.prepare(
      `SELECT p.date_iso, p.warrant, p.amount, p.status, p.payee, p.register_month, r.source_url
       FROM payments p JOIN registers r ON r.month = p.register_month
       WHERE p.excluded = 0 AND p.canonical IN (${placeholders})
       ORDER BY p.date_iso, p.warrant`
    ).all(...canon);
    console.log(`\n  Checks (${rows.length}):`);
    for (const r of rows) {
      console.log(`    ${r.date_iso}  #${r.warrant}  ${usd(r.amount).padStart(14)}  ${r.payee}`);
    }
    const urls = [...new Set(rows.map((r) => `${r.register_month}: ${r.source_url}`))];
    console.log(`\n  Source registers:`);
    urls.forEach((u) => console.log(`    ${u}`));
  } else {
    console.log(`\n  (run with --detail for every check + source PDF links)`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const db = openDb();
  try {
    if (args.includes('--top')) {
      const n = parseInt(args[args.indexOf('--top') + 1], 10) || 25;
      const fy = args.includes('--fy') ? args[args.indexOf('--fy') + 1] : null;
      topVendors(db, n, fy);
      return;
    }
    const query = args.find((a) => !a.startsWith('--'));
    if (!query) {
      console.log('Usage: node scripts/report-vendor-spend.mjs "<vendor>" [--detail]   |   --top N [--fy FYxxxx-yy]');
      return;
    }
    vendorReport(db, query, args.includes('--detail'));
  } finally {
    db.close();
  }
}

main();
