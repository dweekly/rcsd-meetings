#!/usr/bin/env node
/**
 * Generate meeting card summaries from what a meeting actually did, using its
 * transcript, rather than from what its agenda listed.
 *
 * An agenda title can say "Approval of the 2025-26 Unaudited Actuals Financial
 * Report". Only the transcript can say the board approved it 5-0 after asking
 * where the reserve landed. For a meeting that has happened, the second is the
 * summary a reader wants.
 *
 * The agenda is still sent alongside, ordered by the time it allocates to each
 * section (see scripts/lib/agenda-weight.mjs) — that ordering is the district's
 * own ranking of the meeting, and it tells the model which of the evening's many
 * subjects were the substance rather than the housekeeping.
 *
 * Writes:
 *   data/meeting-summaries.json           (EN)
 *   data/meeting-summaries-es.json        (ES)
 *   data/meeting-summaries-provenance.json (source/model/date per summary)
 *
 * The provenance file is what keeps this and the agenda-based generator from
 * fighting: generate-meeting-summaries.mjs refuses to touch any entry recorded
 * here as transcript-derived.
 *
 * Idempotent — a meeting already summarized from its transcript is skipped
 * unless --force.
 *
 * Usage:
 *   node scripts/generate-transcript-summaries.mjs --range 2025-07-01:2026-09-21
 *   node scripts/generate-transcript-summaries.mjs 2026-02-04 2026-05-13
 *   node scripts/generate-transcript-summaries.mjs --range 2025-07-01:2026-09-21 --dry-run
 *   node scripts/generate-transcript-summaries.mjs 2026-02-04 --force
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';

import { rankItems } from './lib/agenda-weight.mjs';
import { getSummaryKey } from './lib/meeting-summary-key.mjs';
import { readProvenance, PROVENANCE_FILENAME, summaryHash, matchesRecordedSummary } from './lib/summary-provenance.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
config({ path: resolve(ROOT, '.env') });

const SLIM_DIR = resolve(ROOT, 'artifacts/transcripts-slim');
const EN_PATH = resolve(ROOT, 'data/meeting-summaries.json');
const ES_PATH = resolve(ROOT, 'data/meeting-summaries-es.json');
const PROV_PATH = resolve(ROOT, PROVENANCE_FILENAME);

// Reading a three-hour meeting and telling a decision from a discussion of one
// is the whole task here, so this path uses a reasoning model. The agenda-title
// path in generate-meeting-summaries.mjs stays on Haiku, where there is nothing
// to reason about. Model ids in this project carry no date suffix.
const MODEL = 'claude-sonnet-4-6';

// The full transcript is sent. The largest board meeting in the 2025-26 school
// year is 208,054 characters (2025-11-12), roughly 52,000 tokens, which fits
// with room to spare. Truncating would be worse than it sounds: the action items
// are voted at the END of a board meeting, so a cap cuts exactly the outcomes
// this script exists to capture. This limit is a guard against a pathological
// input, not a working constraint — if it ever fires, raise it rather than
// accept a summary built from a partial meeting.
const TRANSCRIPT_CHAR_LIMIT = 600000;

const args = process.argv.slice(2);
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');

const rangeArg = args.find(a => a.startsWith('--range'));
let rangeStart = null;
let rangeEnd = null;
if (rangeArg) {
  const value = rangeArg.includes('=')
    ? rangeArg.split('=')[1]
    : args[args.indexOf(rangeArg) + 1];
  const [from, to] = String(value || '').split(':');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) {
    console.error('Error: --range takes YYYY-MM-DD:YYYY-MM-DD');
    process.exit(1);
  }
  rangeStart = from;
  rangeEnd = to;
}

const targetDates = args.filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a))
  .filter(a => a !== rangeStart && a !== rangeEnd);

if (!rangeArg && targetDates.length === 0) {
  console.error('Error: name the meetings to summarize, by --range or by date.');
  console.error('  node scripts/generate-transcript-summaries.mjs --range 2025-07-01:2026-09-21');
  process.exit(1);
}

if (!dryRun && !process.env.ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY not set. Add it to .env or export it.');
  process.exit(1);
}

const meetingsData = JSON.parse(readFileSync(resolve(ROOT, 'data/meetings-data.json'), 'utf-8'));
const allMeetings = meetingsData.meetings;
const enSummaries = JSON.parse(readFileSync(EN_PATH, 'utf-8'));
const esSummaries = JSON.parse(readFileSync(ES_PATH, 'utf-8'));
const provenance = readProvenance(ROOT);

/** Procedural lines carry a time allocation but no business; they are not the meeting. */
const SKIP_PATTERNS = [
  /^roll call$/i,
  /^pledge of allegiance/i,
  /^call to order/i,
  /^adjournment/i,
  /^approval of the agenda/i,
  /^approval of agenda/i,
  /^additions.*deletions.*modifications/i,
  /^welcome/i,
  /^if you have public comment/i,
  /^closed session$/i,
  /^report out on closed session/i,
  /^changes to the agenda/i,
  /^reconvene to (open|regular)/i,
  /^recess/i,
  /^board member reports/i,
  /^superintendent.*report$/i,
  /^future (agenda|board)/i,
  /^notification of /i,
  /^correspondence$/i,
  /^other business/i,
  /^board of trustees meeting (calendar|reflection)$/i,
  /^board and superintendent reports$/i,
];
const isProceduralItem = (title) => SKIP_PATTERNS.some(p => p.test(String(title || '').trim()));

/** The spoken text of a meeting, or null when no transcript has been made. */
function transcriptText(meeting) {
  for (const key of [meeting.date, meeting.slug]) {
    const path = resolve(SLIM_DIR, `${key}.json`);
    if (!existsSync(path)) continue;
    const json = JSON.parse(readFileSync(path, 'utf-8'));
    const text = (json.utterances || []).map(u => u.text).join(' ');
    if (!text.trim()) return null;
    return { key, text: text.slice(0, TRANSCRIPT_CHAR_LIMIT), truncated: text.length > TRANSCRIPT_CHAR_LIMIT };
  }
  return null;
}

/** The agenda, in the order the agenda's own time allocations imply. */
function agendaOutline(meeting) {
  const { ranked, consent, unranked } = rankItems(meeting.items || [], it => isProceduralItem(it.title));
  const describe = (it) => {
    let line = it.title;
    if (it.actionType && it.actionType !== 'Procedural') line += ` (${it.actionType})`;
    return line;
  };

  const blocks = [];
  if (ranked.length > 0) {
    blocks.push('Substantive items, in the order of the time the agenda allocates them:\n' +
      ranked.map(r => `- ${describe(r.item)}`).join('\n'));
  }
  if (unranked.length > 0) {
    blocks.push('Items with no stated time allocation:\n' +
      unranked.map(u => `- ${describe(u.item)}`).join('\n'));
  }
  if (consent.length > 0) {
    blocks.push(`Consent calendar — ${consent.length} item${consent.length === 1 ? '' : 's'}, ` +
      'passed together in one vote without discussion:\n' +
      consent.map(c => `- ${c.title}`).join('\n'));
  }
  return blocks.join('\n\n');
}

function buildPrompt(meeting, outline, text) {
  return `You are writing the summary that appears on a board meeting card on rcsd.info, a public website about the Redwood City School District. Below is the agenda for the ${meeting.type || 'board meeting'} of ${meeting.date}, followed by the transcript of the meeting itself.

Write a 2-3 sentence summary of what the board actually did.

AGENDA
${outline}

Instructions:
1. Report outcomes, not scheduling. What was decided, approved, rejected, postponed, or directed. The transcript is the record of the meeting; the agenda above only tells you which topics the district treated as the substance of the evening, and in what order of importance.
2. Lead with the most substantive business. The agenda ordering above is a strong guide to what mattered, but the transcript is the authority — if the board spent the evening on something the agenda gave five minutes, say so.
3. Be concrete. Name dollar figures, vote counts, resolution numbers, school names, and programs — but ONLY where the transcript states them. Never infer a vote count or a dollar amount that was not said aloud.
4. If the transcript does not record the outcome of an item, say the board discussed or heard it. Do NOT write that it was approved. A missing outcome means the recording did not capture it, not that nothing happened.
5. The consent calendar is routine business passed in one vote. Give it at most one short trailing clause with the count and theme; never itemize it and never lead with it.
6. These meetings have happened, so write in plain past tense ("The Board approved...", "Trustees heard...").
7. Use <strong> tags around important terms — school names, dollar amounts, resolution and policy numbers, program names. No other HTML, no links, no lists.
8. Keep it scannable. This is preview text on a card, not minutes.
9. Do not mention the transcript, the recording, or the agenda as such. Write about the meeting.

Respond with exactly this JSON and nothing else (no markdown fences):
{
  "en": "English summary here",
  "es": "Spanish summary here — sixth-grade Californian Spanish, simple and colloquial, keeping the English terms families actually use (LCAP, Measure S, charter, bond)"
}

TRANSCRIPT
${text}`;
}

const inRange = (date) => {
  if (targetDates.length > 0 && targetDates.includes(date)) return true;
  if (!rangeStart) return false;
  return date >= rangeStart && date <= rangeEnd;
};

const selected = allMeetings
  .filter(m => inRange(m.date))
  .sort((a, b) => a.date.localeCompare(b.date));

const client = dryRun ? null : new Anthropic();
const stamp = new Date().toISOString().slice(0, 10);

let generated = 0;
let skipped = 0;
let noTranscript = [];
let protectedExisting = [];
let errors = 0;

console.log(`Meetings selected: ${selected.length}`);

for (const meeting of selected) {
  const key = getSummaryKey(meeting, allMeetings);
  // Skip on the strength of the text that is actually there, not on the flag
  // alone: the sidecar and the summary files can be restored independently.
  if (matchesRecordedSummary(provenance, key, enSummaries[key]) && !force) {
    skipped++;
    continue;
  }

  // Never overwrite a summary this script did not write, unless a run names that
  // meeting outright. A summary with text but no provenance record is one of the
  // hand-written ones carried since the initial release: they cite figures out of
  // the board packets that nobody says aloud, so a transcript cannot reproduce
  // them and regenerating one is a straight loss. --range is a bulk instrument
  // and must not be able to reach them.
  const namedExplicitly = targetDates.includes(meeting.date) || targetDates.includes(meeting.slug)
    || targetDates.includes(key);
  if (enSummaries[key] && !provenance[key] && !namedExplicitly) {
    protectedExisting.push(meeting.date);
    continue;
  }

  const transcript = transcriptText(meeting);
  if (!transcript) {
    // Not an error: five meetings in the target range were never recorded. They
    // keep their agenda-derived summary, which is the best available account.
    noTranscript.push(meeting.date);
    continue;
  }
  if (transcript.truncated) {
    console.warn(`  ${key}: transcript exceeds ${TRANSCRIPT_CHAR_LIMIT} chars and was cut — ` +
      'the end of a board meeting is where votes happen, so raise TRANSCRIPT_CHAR_LIMIT rather than trust this one.');
  }

  const prompt = buildPrompt(meeting, agendaOutline(meeting), transcript.text);

  if (dryRun) {
    console.log(`  ${key}: would send ${prompt.length.toLocaleString()} chars ` +
      `(transcript ${transcript.text.length.toLocaleString()})`);
    generated++;
    continue;
  }

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });

    let raw = response.content[0].text.trim();
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error(`could not parse response: ${raw.slice(0, 200)}`);
      parsed = JSON.parse(match[0]);
    }
    if (!parsed.en || !parsed.es) {
      throw new Error(`missing en or es: ${JSON.stringify(parsed).slice(0, 200)}`);
    }

    enSummaries[key] = parsed.en;
    esSummaries[key] = parsed.es;
    provenance[key] = {
      source: 'transcript',
      transcriptKey: transcript.key,
      model: MODEL,
      generatedAt: stamp,
      enHash: summaryHash(parsed.en),
    };
    generated++;
    console.log(`[${generated}] ${key} — ${parsed.en.replace(/<[^>]+>/g, '').slice(0, 90)}…`);

    if (generated % 5 === 0) save();
  } catch (err) {
    errors++;
    console.error(`ERROR on ${key}: ${err.message}`);
  }
}

function sortKeys(obj) {
  const out = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k];
  return out;
}

function save() {
  writeFileSync(EN_PATH, JSON.stringify(sortKeys(enSummaries), null, 2) + '\n');
  writeFileSync(ES_PATH, JSON.stringify(sortKeys(esSummaries), null, 2) + '\n');
  writeFileSync(PROV_PATH, JSON.stringify(sortKeys(provenance), null, 2) + '\n');
}

if (!dryRun) save();

console.log(`\nDone. Generated: ${generated}, already transcript-derived: ${skipped}, errors: ${errors}`);
if (noTranscript.length > 0) {
  console.log(`No transcript (keeping agenda-derived summary): ${noTranscript.join(', ')}`);
}
if (protectedExisting.length > 0) {
  console.log(`Kept existing summary, not written by this script (name the date to override): ${protectedExisting.join(', ')}`);
}
if (errors > 0) process.exit(1);
