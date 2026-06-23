#!/usr/bin/env node
/**
 * Full data pipeline — run after new meetings are scraped or videos posted.
 * Idempotent: safe to re-run at any time. Each step skips already-processed data.
 *
 * Usage:
 *   node scripts/run-pipeline.mjs           # full pipeline
 *   node scripts/run-pipeline.mjs --quick   # skip transcription/translation (for agenda-only updates)
 */

import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const quick = process.argv.includes('--quick');
const upload = process.argv.includes('--upload');
const deploy = process.argv.includes('--deploy');

function run(label, script, { nonFatal = false } = {}) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${label}`);
  console.log('='.repeat(60));
  try {
    execFileSync('node', [resolve(ROOT, 'scripts', script)], { cwd: ROOT, stdio: 'inherit', timeout: 1800000 });
  } catch (err) {
    console.error(`\n  FAILED: ${label} (${script})`);
    console.error(`  ${err.message}\n`);
    // Some steps are best-effort enrichment (e.g. ES translation of agenda
    // content): a failure or 30-min timeout there must not abort the deploy.
    // Their output is cached, so the next run resumes where this one stopped.
    if (nonFatal) {
      console.error(`  (non-fatal — continuing; cached output lets the next run resume.)\n`);
      return;
    }
    process.exit(1);
  }
}

console.log(`\nRCSD Pipeline — ${new Date().toISOString()}`);
console.log(`Mode: ${quick ? 'QUICK (skip transcription/translation)' : 'FULL'}\n`);

// Phase 0: Pull any newly-posted Simbli agendas (items + attachments) before
// the build reads them. Idempotent — only fetches MIDs without a memo file.
run('0. Scrape new Simbli agendas', 'scrape-simbli-agendas.mjs');
run('0a. Scrape new YouTube videos', 'scrape-youtube-index.mjs');
// Download packet PDFs for any attachment that has a Simbli AID but no filename
// yet (idempotent — committed filenames are skipped). Without this, a newly
// discovered meeting ships with board-packets/{date}/undefined dead links.
run('0b. Download board packets', 'download-board-packets.mjs');

// Phase 1: Data assembly
run('1. Build meetings data', 'build-meetings.mjs');
// Enrich committee registries (recordings + transcript status) from the YouTube index.
run('1a. Build committee registries', 'build-committees.mjs');

if (!quick) {
  // Restore any existing transcription/translation caches to avoid duplicate API calls
  run('1b. Restore cache from CDN', 'restore-cache.mjs');

  // Phase 2: Audio + transcription (slow, costs API $)
  run('2. Download audio', 'download-audio.mjs');
  run('3. Transcribe (AssemblyAI)', 'transcribe-assemblyai.mjs');

  // Rebuild so meetings just transcribed get hasTranscript=true BEFORE the slim
  // and translate steps run — both skip meetings where hasTranscript is false
  // (publish-transcripts.mjs / translate-transcripts.mjs), so without this a
  // newly-transcribed meeting would otherwise be skipped until the next run.
  run('3b. Rebuild meetings data (flag new transcripts)', 'build-meetings.mjs');
  // Same rationale for committees: flip hasTranscript before slim/translate read it.
  run('3c. Rebuild committee registries', 'build-committees.mjs');

  run('4. Slim transcripts', 'publish-transcripts.mjs');
  run('5. Translate transcripts (ES)', 'translate-transcripts.mjs');
  // Translate agenda-item content to ES (cached; only new/changed content
  // translates). Non-fatal + cached so a large backfill converges across runs
  // without ever blocking the deploy; ES pages fall back to EN-with-note.
  run('5a. Translate Simbli agenda content (ES)', 'translate-memos.mjs', { nonFatal: true });
  run('5b. Translate BoardDocs agenda content (ES)', 'translate-boarddocs.mjs', { nonFatal: true });

  // Phase 3: LLM enrichment (costs API $)
  run('6. Chapter markers', 'extract-chapter-markers.mjs');
  run('7. Timestamp mapping', 'map-timestamps-llm.mjs');

  // Phase 4: Rebuild with enrichment data
  run('8. Rebuild meetings data', 'build-meetings.mjs');
}

// Phase 5: Summaries + HTML generation
let step = quick ? 2 : 9;
run(`${step++}. Meeting summaries`, 'generate-meeting-summaries.mjs');
run(`${step++}. OG images`, 'generate-og-images.mjs');
run(`${step++}. Meetings index`, 'build-meetings-html.mjs');
run(`${step++}. iCalendar feeds`, 'build-ics.mjs');
run(`${step++}. Meeting detail pages`, 'build-meeting-pages.mjs');
run(`${step++}. Committee summaries`, 'generate-committee-summaries.mjs');
run(`${step++}. Committee pages`, 'build-committee-pages.mjs');
run(`${step++}. Homepage`, 'build-homepage.mjs');
run(`${step++}. District pages`, 'build-district.mjs');
run(`${step++}. School pages`, 'build-schools.mjs');
run(`${step++}. Charter school pages`, 'build-charters.mjs');
run(`${step++}. Budget pages`, 'build-budget.mjs');
run(`${step++}. Blog`, 'build-blog.mjs');
run(`${step++}. Board policy pages`, 'build-policies.mjs');
run(`${step++}. Search pages`, 'build-search.mjs');

// Build the Pagefind index AFTER all HTML is generated. This indexes docs/ HTML
// AND injects per-document records (board attachments + curated off-portal docs)
// so searches link directly to files. Writes docs/pagefind/, which the wrangler
// deploy below ships. See SEARCH.md.
run(`${step++}. Build search index`, 'build-search-index.mjs');

console.log(`\n${'='.repeat(60)}`);
console.log('  Pipeline complete!');
console.log('='.repeat(60));

if (upload) {
  run('Upload data & transcripts to Cloudflare R2', 'upload-to-r2.mjs');
} else {
  console.log('\nUpload data to R2 (run with --upload to automate):');
  console.log('  node scripts/upload-to-r2.mjs');
}

if (deploy) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('  Deploying to Cloudflare Pages');
  console.log('='.repeat(60));
  try {
    execFileSync('npx', ['wrangler', 'pages', 'deploy', 'docs', '--project-name=rcsd-meetings'], { cwd: ROOT, stdio: 'inherit' });
  } catch (err) {
    console.error(`\n  FAILED: Wrangler Deploy`);
    console.error(`  ${err.message}\n`);
    process.exit(1);
  }
} else {
  console.log('\nDeploy (run with --deploy to automate):');
  console.log('  npx wrangler pages deploy docs --project-name=rcsd-meetings');
}
console.log('');
