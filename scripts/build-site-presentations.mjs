#!/usr/bin/env node
/**
 * Build a per-school index of the last 3 years of board "site presentation"
 * decks, and mirror any deck that is still only on BoardDocs into our R2
 * bucket so every link points at data.rcsd.info (stable, under our control).
 *
 * Source of truth: data/document-index.json — every attachment classified
 * `type:'school-report', subtype:'presentation'` already carries a `schools`
 * slug array (title-primary school first), a `schoolYear`, and a `url`
 * (already R2 for recent decks, a BoardDocs `$file` link for older ones).
 *
 * For each school we keep ONE deck per school-year (the definitive/latest),
 * across the 3 most recent school years present in the data. BoardDocs decks
 * are downloaded into artifacts/board-packets/{date}/{filename}.pdf; the R2
 * upload (scripts/upload-to-r2.mjs, Pass 1) publishes them at
 * https://data.rcsd.info/board-packets/{date}/{filename}.pdf.
 *
 * Output: data/site-presentations.json — consumed by build-schools.mjs.
 *
 * Idempotent: an already-mirrored PDF is not re-downloaded. Use --force to
 * re-download even if the artifact file exists.
 *
 * Usage:
 *   node scripts/build-site-presentations.mjs
 *   node scripts/build-site-presentations.mjs --force
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, openSync, readSync, closeSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const R2_BASE = 'https://data.rcsd.info';
// Match the Chrome UA used by the other BoardDocs fetchers; CloudFront 403s the
// Node default UA (see scripts/scrape-boarddocs.mjs, extract-ireadyu-growth.mjs).
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
// How many recent school years of presentations to publish per school.
const YEARS_TO_KEEP = 3;

const FORCE = process.argv.includes('--force');

// Reuse the exact sanitization rule from scripts/download-board-packets.mjs so
// mirrored filenames match the convention already in the R2 bucket.
function sanitizeFilename(name, maxLen = 80) {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, maxLen);
}

function isValidPdf(filePath) {
  try {
    if (statSync(filePath).size < 1024) return false;
    const buf = Buffer.alloc(5);
    const fd = openSync(filePath, 'r');
    readSync(fd, buf, 0, 5, 0);
    closeSync(fd);
    return buf.toString('ascii') === '%PDF-';
  } catch {
    return false;
  }
}

// Deterministic R2 filename for a deck we are mirroring from its title.
function deckFilename(title) {
  const base = sanitizeFilename(title.trim().replace(/\.pdf$/i, ''), 76);
  return `${base}.pdf`;
}

// Pick the single best deck when a (school, year) has more than one candidate
// (e.g. an "Updated" reprint, a re-presentation on a later date, or a DRAFT).
function scoreDeck(doc) {
  const t = doc.title.toLowerCase();
  let s = 0;
  // Prefer the actual board presentation deck over a School Plan (SPSA) PDF that
  // occasionally lands in the same classification on the same meeting date.
  if (/board presentation|data for board|board report|school report/.test(t)) s += 100_0000000;
  if (/\bspsa\b|school plan|_spring|\bspring[)_]/.test(t)) s -= 100_0000000;
  s += Number(doc.meetingDate.replace(/-/g, '')); // then latest meeting date
  if (/\bupdated\b|\bcombined\b|\bfinal\b/.test(t)) s += 5_0000000;
  if (/\bdraft\b/.test(t)) s -= 3_0000000;
  if ((doc.url || '').includes('data.rcsd.info')) s += 1_0000000; // prefer already-R2
  return s;
}

function main() {
  const docIndex = JSON.parse(readFileSync(resolve(ROOT, 'data/document-index.json'), 'utf-8'));
  const youtube = JSON.parse(readFileSync(resolve(ROOT, 'data/youtube-index.json'), 'utf-8'));
  const videoByDate = {};
  for (const e of youtube) {
    if (e.kind === 'board' && e.date && !videoByDate[e.date]) {
      videoByDate[e.date] = `https://www.youtube.com/watch?v=${e.id}`;
    }
  }

  const presDocs = docIndex.documents.filter(
    d => d.type === 'school-report' && d.subtype === 'presentation' && Array.isArray(d.schools) && d.schools.length
  );

  // Keep only the N most recent school years present in the data.
  const years = [...new Set(presDocs.map(d => d.schoolYear))].sort().reverse().slice(0, YEARS_TO_KEEP);
  const keepYears = new Set(years);

  // Group candidates by slug + schoolYear, attributing each deck to its
  // title-primary school (schools[0], verified reliable in document-index.json).
  const byKey = {};
  for (const d of presDocs) {
    if (!keepYears.has(d.schoolYear)) continue;
    const slug = d.schools[0];
    const key = `${slug}::${d.schoolYear}`;
    (byKey[key] ||= []).push(d);
  }

  const schools = {};
  let mirrored = 0, alreadyR2 = 0, failures = [];

  for (const key of Object.keys(byKey)) {
    const [slug, schoolYear] = key.split('::');
    const doc = byKey[key].sort((a, b) => scoreDeck(b) - scoreDeck(a))[0];

    let pdfUrl;
    let sourceUrl = doc.url;
    if ((doc.url || '').includes('data.rcsd.info')) {
      pdfUrl = doc.url;
      alreadyR2++;
    } else {
      // Mirror the BoardDocs deck into artifacts/board-packets/{date}/.
      const filename = deckFilename(doc.title);
      const destDir = resolve(ROOT, 'artifacts/board-packets', doc.meetingDate);
      const destPath = resolve(destDir, filename);
      mkdirSync(destDir, { recursive: true });
      if (FORCE || !existsSync(destPath) || !isValidPdf(destPath)) {
        try {
          console.log(`  ↓ mirroring ${slug} ${schoolYear}: ${filename}`);
          execFileSync('curl', ['-sL', '-A', UA, '-H', `Referer: ${doc.url}`, '-o', destPath, doc.url], { stdio: 'inherit' });
        } catch (e) {
          failures.push({ slug, schoolYear, url: doc.url, error: String(e) });
          continue;
        }
      }
      if (!isValidPdf(destPath)) {
        failures.push({ slug, schoolYear, url: doc.url, error: 'downloaded file is not a valid PDF (>=1KB, %PDF- magic)' });
        continue;
      }
      pdfUrl = `${R2_BASE}/board-packets/${doc.meetingDate}/${filename}`;
      mirrored++;
    }

    (schools[slug] ||= []).push({
      schoolYear,
      meetingDate: doc.meetingDate,
      title: doc.title.trim(),
      pdfUrl,
      videoUrl: videoByDate[doc.meetingDate] || null,
      sourceUrl,
    });
  }

  // Sort each school's decks newest school-year first.
  for (const slug of Object.keys(schools)) {
    schools[slug].sort((a, b) => b.schoolYear.localeCompare(a.schoolYear));
  }

  const out = {
    _metadata: {
      generated: new Date().toISOString().slice(0, 10),
      source: 'data/document-index.json (attachments classified school-report/presentation)',
      method: 'build-site-presentations.mjs: one deck per school per school-year for the 3 most recent years; BoardDocs-only decks mirrored to R2 board-packets/. These are official district presentation decks republished verbatim.',
      retrieved: new Date().toISOString().slice(0, 10),
      schoolYears: years,
    },
    schools,
  };
  writeFileSync(resolve(ROOT, 'data/site-presentations.json'), JSON.stringify(out, null, 2) + '\n');

  const nSchools = Object.keys(schools).length;
  const nDecks = Object.values(schools).reduce((s, a) => s + a.length, 0);
  console.log(`\nsite-presentations: ${nDecks} decks across ${nSchools} schools, years ${years.join(', ')}`);
  console.log(`  ${alreadyR2} already on R2, ${mirrored} newly mirrored from BoardDocs`);
  if (mirrored) console.log(`  → run scripts/upload-to-r2.mjs to publish the ${mirrored} mirrored PDF(s)`);
  if (failures.length) {
    console.log(`\nFAILURES (${failures.length}):`);
    for (const f of failures) console.log(`  ${f.slug} ${f.schoolYear}: ${f.error}`);
    process.exitCode = 2;
  }
}

main();
