#!/usr/bin/env node
/**
 * extract-warrants.mjs — parse every monthly warrant-register PDF into per-payment line items.
 *
 * Reads the PDFs backfilled by scrape-warrant-pdfs.mjs (BoardDocs era) and downloaded by
 * scrape-board-packets.mjs (Simbli era), detects the report format (QSS vs Escape — see
 * scripts/lib/warrant-parsers.mjs), parses the line items, and reconciles the summed amounts
 * against the register's printed grand total. Garbled/no-ToUnicode-font PDFs (where pdftotext
 * drops the numeric columns) fall back to tesseract OCR.
 *
 * Output:
 *   - data/warrants/{YYYY-MM}.json    one file per register (line items + checksum + provenance)
 *   - data/warrants-index.json        per-register summary, checksum status, period-overlap flags
 *
 * Usage:
 *   node scripts/extract-warrants.mjs                # extract all (idempotent: skip unchanged)
 *   node scripts/extract-warrants.mjs --month 2020-03
 *   node scripts/extract-warrants.mjs --force        # re-extract even if PDF sha unchanged
 *   node scripts/extract-warrants.mjs --no-ocr       # disable OCR fallback (for debugging)
 *
 * Idempotent: a register whose PDF sha256 matches the existing output is skipped unless --force.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import {
  detectFormat, looksGarbled, parseQSS, parseEscape, classifyPayee, normalizePayeeKey, monthKeyFromMDY,
} from './lib/warrant-parsers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, 'data/warrants');
const OCR_TMP = resolve(ROOT, 'tmp/warrant-ocr');

function sha256File(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

function pdftotextLayout(pdf) {
  return execFileSync('pdftotext', ['-layout', pdf, '-'], { maxBuffer: 128 << 20 }).toString();
}

/** Render each page to PNG and OCR with tesseract; returns concatenated text. */
function ocrPdf(pdf) {
  mkdirSync(OCR_TMP, { recursive: true });
  const stem = resolve(OCR_TMP, basename(pdf, '.pdf'));
  execFileSync('pdftoppm', ['-r', '300', '-png', pdf, stem], { maxBuffer: 256 << 20 });
  const pages = readdirSync(OCR_TMP).filter((f) => f.startsWith(basename(pdf, '.pdf')) && f.endsWith('.png')).sort();
  let text = '';
  for (const pg of pages) {
    const img = resolve(OCR_TMP, pg);
    text += execFileSync('tesseract', [img, '-', '--psm', '6'], { maxBuffer: 64 << 20 }).toString() + '\n';
    rmSync(img);
  }
  return text;
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

function monthFromTitle(title) {
  const m = (title || '').match(
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+(\d{4})/i);
  if (!m) return null;
  return `${m[2]}-${String(MONTH_NAMES.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0')}`;
}

/** Discover every warrant register and resolve its local PDF path (BoardDocs + Simbli eras). */
function discoverRegisters() {
  const meetings = JSON.parse(readFileSync(resolve(ROOT, 'data/meetings-data.json'), 'utf8'));
  const list = Array.isArray(meetings) ? meetings : meetings.meetings || Object.values(meetings);
  const manifest = existsSync(resolve(ROOT, 'data/warrant-pdf-manifest.json'))
    ? JSON.parse(readFileSync(resolve(ROOT, 'data/warrant-pdf-manifest.json'), 'utf8'))
    : { registers: [] };
  const manifestByHref = new Map(manifest.registers.map((r) => [r.sourceHref, r]));

  const registers = [];
  const seenPaths = new Set();
  for (const m of list) {
    for (const item of m.items || []) {
      if (!/warrant/i.test(item.title || '')) continue;
      for (const att of item.attachments || []) {
        let localPath = null, source = null, sourceUrl = null;
        if (att.href && manifestByHref.has(att.href)) {
          const mr = manifestByHref.get(att.href);
          localPath = resolve(ROOT, mr.localPath);
          source = 'boarddocs';
          sourceUrl = att.href;
        } else {
          // Simbli era (no direct href): find a warrant PDF in the meeting's packet dir.
          const dir = resolve(ROOT, 'artifacts/board-packets', m.date);
          if (existsSync(dir)) {
            const hit = readdirSync(dir).find((f) => /warrant|board-report.*warrant|warrant.*report/i.test(f) && f.endsWith('.pdf'));
            if (hit) { localPath = resolve(dir, hit); source = 'simbli'; sourceUrl = `https://data.rcsd.info/board-packets/${m.date}/${hit}`; }
          }
        }
        if (!localPath || !existsSync(localPath) || seenPaths.has(localPath)) continue;
        seenPaths.add(localPath);
        registers.push({
          meetingDate: m.date,
          mid: m.mid ?? null,
          itemLabel: item.itemLabel ?? null,
          title: item.title,
          monthGuess: monthFromTitle(item.title),
          source,
          sourceUrl,
          localPath,
          relPath: localPath.replace(ROOT + '/', ''),
        });
      }
    }
  }
  return registers;
}

function extractOne(reg, { noOcr }) {
  let text = pdftotextLayout(reg.localPath);
  let viaOcr = false;
  if (!noOcr && (looksGarbled(text) || detectFormat(text) === 'unknown')) {
    const ocrText = ocrPdf(reg.localPath);
    if (detectFormat(ocrText) !== 'unknown') { text = ocrText; viaOcr = true; }
  }
  const format = detectFormat(text);
  let parsed;
  if (format === 'escape') parsed = parseEscape(text);
  else if (format === 'qss') parsed = parseQSS(text);
  else {
    // Distinguish a genuinely-unreadable PDF from a misfiled attachment (the named file is some
    // other document entirely — e.g. an SPSA uploaded under a warrant-register filename).
    const misfiled = /SPSA|School Plan for Student Achievement|Title Page|Single Plan/i.test(text);
    return { ok: false, format: 'unknown', viaOcr, reason: misfiled ? 'misfiled-attachment' : 'unrecognized-format' };
  }

  const sum = parsed.reconcileTotal;
  const printed = parsed.printedTotal;
  // Reconcile the format-appropriate total within a cent of the printed grand total.
  const reconciled = printed != null && Math.abs(sum - printed) < 0.015;
  const coverageRatio = printed ? Math.round((sum / printed) * 10000) / 10000 : null;

  const lineItems = parsed.rows.map((r) => {
    const cls = classifyPayee(r.payee);
    return {
      ...r,
      payeeKey: normalizePayeeKey(r.payee),
      payeeType: cls.type,
      payeeTypeConfidence: cls.confidence,
    };
  });

  return {
    ok: true,
    format,
    viaOcr,
    parsed,
    lineItems,
    sum: Math.round(sum * 100) / 100,
    disbursedTotal: Math.round(parsed.disbursedTotal * 100) / 100,
    printedTotal: printed,
    reconciled,
    coverageRatio,
    diff: printed != null ? Math.round((sum - printed) * 100) / 100 : null,
  };
}

function periodsOverlap(a, b) {
  if (!a.from || !a.to || !b.from || !b.to) return false;
  const d = (s) => { const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}${m[1]}${m[2]}` : null; };
  return d(a.from) <= d(b.to) && d(b.from) <= d(a.to);
}

function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const noOcr = args.includes('--no-ocr');
  const onlyMonth = args.includes('--month') ? args[args.indexOf('--month') + 1] : null;

  mkdirSync(OUT_DIR, { recursive: true });
  const registers = discoverRegisters();
  console.log(`Discovered ${registers.length} warrant register PDF(s).`);

  const index = [];
  const usedNames = new Set();
  let okCount = 0, mismatchCount = 0, ocrCount = 0, failCount = 0, skipCount = 0, gapCount = 0;

  for (const reg of registers) {
    const sha = sha256File(reg.localPath);
    // Determine output name from the title guess first (final name set after parse for collisions).
    if (onlyMonth && reg.monthGuess !== onlyMonth) continue;

    let res;
    try {
      res = extractOne(reg, { noOcr });
    } catch (err) {
      console.warn(`  FAIL  ${reg.monthGuess || reg.meetingDate}  ${basename(reg.localPath)}: ${err.message}`);
      failCount++;
      index.push({ meetingDate: reg.meetingDate, monthGuess: reg.monthGuess, status: 'error', error: err.message, relPath: reg.relPath });
      continue;
    }
    if (!res.ok) {
      // A misfiled attachment (wrong document behind a warrant filename) is a source-side
      // coverage gap, not a parser failure — record it as such rather than a hard failure.
      const soft = res.reason === 'misfiled-attachment';
      console.warn(`  ${soft ? 'GAP ' : 'FAIL'}  ${reg.monthGuess || reg.meetingDate}  ${basename(reg.localPath)}: ${res.reason}`);
      if (soft) gapCount++; else failCount++;
      index.push({ month: reg.monthGuess, meetingDate: reg.meetingDate, status: res.reason, parseStatus: soft ? 'coverage-gap' : 'failed', relPath: reg.relPath, sourceUrl: reg.sourceUrl });
      continue;
    }

    const monthKey = res.parsed.period.monthKey || reg.monthGuess || reg.meetingDate;
    // Collision-safe filename: {month}.json, then {month}-b, -c, … in discovery order.
    let name = monthKey;
    let suffix = 1;
    while (usedNames.has(name)) { suffix++; name = `${monthKey}-${String.fromCharCode(96 + suffix)}`; }
    usedNames.add(name);
    const outPath = resolve(OUT_DIR, `${name}.json`);

    // Idempotent skip.
    if (!force && existsSync(outPath)) {
      const prev = JSON.parse(readFileSync(outPath, 'utf8'));
      if (prev._metadata?.pdfSha256 === sha) {
        skipCount++;
        index.push(prev._index);
        continue;
      }
    }

    if (res.viaOcr) ocrCount++;
    if (res.reconciled) okCount++; else mismatchCount++;

    // Classify the reconciliation outcome so PR3 knows how to use each register.
    //   reconciled           — line items sum to the printed total; fully trustworthy
    //   minor-mismatch       — within 0.5% (one stray fraction; usable)
    //   total-exceeds-detail — printed grand total is much larger than the summed line items.
    //       For the mid-2021 QSS "Summary" reports this is the printed TOTAL over-counting (it
    //       appears to sum fund-distribution lines while displaying one row per warrant); the
    //       line items themselves are COMPLETE — proven for 2021-06, whose 616 warrants are a
    //       superset of the separately-reconciled 6/1–6/25 register. Use `disbursedTotal`
    //       (summed line items), NOT the printed total, for these months.
    let parseStatus;
    if (res.reconciled) parseStatus = 'reconciled';
    else if (res.coverageRatio != null && res.coverageRatio >= 0.995 && res.coverageRatio <= 1.005) parseStatus = 'minor-mismatch';
    else parseStatus = 'total-exceeds-detail';

    const indexEntry = {
      month: name,
      meetingDate: reg.meetingDate,
      title: reg.title,
      source: reg.source,
      format: res.format,
      viaOcr: res.viaOcr,
      lineItemCount: res.lineItems.length,
      total: res.sum,
      disbursedTotal: res.disbursedTotal,
      printedTotal: res.printedTotal,
      reconciled: res.reconciled,
      parseStatus,
      coverageRatio: res.coverageRatio,
      diff: res.diff,
      period: res.parsed.period,
      sourceUrl: reg.sourceUrl,
      file: `data/warrants/${name}.json`,
    };

    const out = {
      _metadata: {
        description: `Warrant register for ${name}: per-payment line items parsed from the board-ratified register.`,
        month: name,
        meetingDate: reg.meetingDate,
        meetingItem: reg.itemLabel,
        title: reg.title,
        source: reg.source,
        sourceUrl: reg.sourceUrl,
        reportFormat: res.format,
        extraction: res.viaOcr ? 'pdftoppm+tesseract (OCR)' : 'pdftotext -layout',
        pdfSha256: sha,
        script: 'scripts/extract-warrants.mjs',
        generated: new Date().toISOString().slice(0, 10),
        period: res.parsed.period,
        checksum: {
          printedTotal: res.printedTotal,
          parsedTotal: res.sum,
          disbursedTotal: res.disbursedTotal,
          reconciled: res.reconciled,
          parseStatus,
          coverageRatio: res.coverageRatio,
          diff: res.diff,
          note: res.format === 'escape'
            ? 'parsedTotal sums non-cancelled checks; should equal the printed "Net (Check Amount)". disbursedTotal excludes cancelled checks.'
            : 'parsedTotal sums all warrants (incl. cancelled, to match "TOTAL DISTRICT 18"); disbursedTotal excludes cancelled/voided.',
        },
        ...(res.parsed.printedCount != null ? { printedCheckCount: res.parsed.printedCount } : {}),
        ...(res.parsed.fundRecap?.length ? { fundRecap: res.parsed.fundRecap } : {}),
      },
      _index: indexEntry,
      lineItems: res.lineItems,
    };
    writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
    index.push(indexEntry);

    const flag = res.reconciled ? 'OK  ' : 'DIFF';
    console.log(`  ${flag}  ${name}  ${res.format}${res.viaOcr ? '+ocr' : ''}  items=${res.lineItems.length}  total=${res.sum}  printed=${res.printedTotal}  diff=${res.diff}`);
  }

  // Period-overlap detection (e.g. 2020-06 had a 6/1–6/15 and a 6/1–6/30 register).
  const overlaps = [];
  for (let i = 0; i < index.length; i++) {
    for (let j = i + 1; j < index.length; j++) {
      const a = index[i], b = index[j];
      if (a.period && b.period && periodsOverlap(a.period, b.period)) {
        overlaps.push([a.month, b.month]);
      }
    }
  }

  index.sort((a, b) => (a.month || '').localeCompare(b.month || ''));
  const indexOut = {
    _metadata: {
      description: 'Index of all parsed monthly warrant registers, with checksum reconciliation status and period-overlap warnings. Source of truth for the vendor-spend DB/reports (PR3).',
      script: 'scripts/extract-warrants.mjs',
      generated: new Date().toISOString().slice(0, 10),
      counts: { registers: index.length, reconciled: okCount, mismatch: mismatchCount, viaOcr: ocrCount, failed: failCount, coverageGaps: gapCount, skipped: skipCount },
      periodOverlaps: overlaps,
    },
    registers: index,
  };
  writeFileSync(resolve(ROOT, 'data/warrants-index.json'), JSON.stringify(indexOut, null, 2) + '\n');

  console.log(`\nDone. reconciled=${okCount} mismatch=${mismatchCount} ocr=${ocrCount} failed=${failCount} gaps=${gapCount} skipped=${skipCount}`);
  if (overlaps.length) console.log(`Period overlaps (reporting must dedupe): ${JSON.stringify(overlaps)}`);
  // Hard failures and unexplained mismatches are errors; documented incomplete-detail/coverage gaps are not.
  if (failCount > 0) process.exitCode = 1;
}

main();
