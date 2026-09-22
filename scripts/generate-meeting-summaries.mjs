#!/usr/bin/env node
/**
 * Generate concise per-meeting summaries for meetings that don't have them yet.
 * Uses Claude Haiku to produce 1-2 sentence summaries from agenda item titles.
 * Generates both English and Spanish summaries in a single API call.
 *
 * Output: data/meeting-summaries.json (EN), data/meeting-summaries-es.json (ES)
 *
 * Idempotent — skips meetings that already have summaries in both files.
 * Rate-limited with small delays between API calls.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';
import { rankItems } from './lib/agenda-weight.mjs';
import { getSummaryKey } from './lib/meeting-summary-key.mjs';
import { readProvenance, isTranscriptDerived } from './lib/summary-provenance.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Load .env for API key
config({ path: resolve(ROOT, '.env') });

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY not set. Add it to .env or export it.');
  process.exit(1);
}

const client = new Anthropic();

// Load data
const meetingsData = JSON.parse(readFileSync(resolve(ROOT, 'data/meetings-data.json'), 'utf-8'));
const enPath = resolve(ROOT, 'data/meeting-summaries.json');
const esPath = resolve(ROOT, 'data/meeting-summaries-es.json');

// A summary written from a meeting's transcript says what the board actually did.
// This generator can only say what the agenda listed, so it must never replace one
// — not even under --refresh. Without this the nightly pipeline would quietly walk
// every transcript-derived summary back to agenda prose.
const provenance = readProvenance(ROOT);
const enSummaries = JSON.parse(readFileSync(enPath, 'utf-8'));
const esSummaries = JSON.parse(readFileSync(esPath, 'utf-8'));

// Procedural items to skip when building context for the LLM
const SKIP_PATTERNS = [
  /^roll call$/i,
  /^pledge of allegiance/i,
  /^call to order/i,
  /^adjournment/i,
  /^approval of the agenda/i,
  /^approval of agenda/i,
  /^additions.*deletions.*modifications/i,
  /^welcome by the school board/i,
  /^if you have public comment/i,
  /^closed session$/i,
  /^report out on closed session/i,
  /^changes to the agenda/i,
  /^reconvene to (open|regular)/i,
  /^recess/i,
  /^board member reports/i,
  /^superintendent.*report$/i,
  /^future (agenda|board)/i,
  // Standing housekeeping lines. Each carries an agenda time allocation, so
  // without this they outrank real business that the agenda gives less time to.
  /^notification of /i,
  /^correspondence$/i,
  /^other business/i,
  /^board of trustees meeting (calendar|reflection)$/i,
  /^board and superintendent reports$/i,
];

function isProceduralItem(title) {
  return SKIP_PATTERNS.some(p => p.test(title.trim()));
}


const args = process.argv.slice(2);
const refreshNoMinutes = args.includes('--refresh-no-minutes') || args.includes('--refresh');
const targetDates = args.filter(arg => /^\d{4}-\d{2}-\d{2}$/.test(arg));

const allMeetings = meetingsData.meetings;

// Delete specific entries to force regeneration if CLI args specify
for (const meeting of allMeetings) {
  const key = getSummaryKey(meeting, allMeetings);
  const hasMinutes = !!(meeting.minutes && (meeting.minutes.documents?.length > 0 || meeting.minutes.approvedAt));
  
  const shouldRefresh = 
    (refreshNoMinutes && !hasMinutes) ||
    targetDates.includes(meeting.date) ||
    targetDates.includes(meeting.slug) ||
    targetDates.includes(key);

  if (shouldRefresh && isTranscriptDerived(provenance, key)) {
    console.log(`  ${key}: keeping transcript-derived summary (refresh does not apply)`);
    continue;
  }

  if (shouldRefresh) {
    delete enSummaries[key];
    delete enSummaries[meeting.date];
    delete enSummaries[meeting.slug];
    delete esSummaries[key];
    delete esSummaries[meeting.date];
    delete esSummaries[meeting.slug];
  }
}

const enKeys = new Set(Object.keys(enSummaries));
const esKeys = new Set(Object.keys(esSummaries));

const needsSummary = allMeetings.filter(m => {
  const key = getSummaryKey(m, allMeetings);
  // A transcript-derived summary is never repaired from the agenda. If one of its
  // two languages is missing, the fix is to re-run the transcript generator, not
  // to overwrite both with what the agenda listed — which is what this filter
  // would otherwise do the moment either file is restored without the other.
  if (isTranscriptDerived(provenance, key)) return false;
  // Also check both date and slug in case existing summaries use either
  return !(enKeys.has(key) || enKeys.has(m.date) || enKeys.has(m.slug))
      || !(esKeys.has(key) || esKeys.has(m.date) || esKeys.has(m.slug));
});

console.log(`Total meetings: ${allMeetings.length}`);
console.log(`Existing EN summaries: ${enKeys.size}`);
console.log(`Existing ES summaries: ${esKeys.size}`);
console.log(`Meetings needing summaries: ${needsSummary.length}`);

if (needsSummary.length === 0) {
  console.log('All meetings already have summaries. Nothing to do.');
  process.exit(0);
}

// Sort by date ascending (oldest first)
needsSummary.sort((a, b) => a.date.localeCompare(b.date));

let generated = 0;
let skipped = 0;
let errors = 0;

for (const meeting of needsSummary) {
  const key = getSummaryKey(meeting, allMeetings);

  // Double-check idempotency (in case we already generated it in this run)
  if (enSummaries[key] && esSummaries[key]) {
    skipped++;
    continue;
  }

  // Filter to substantive items
  const items = (meeting.items || []).filter(it => !isProceduralItem(it.title));

  if (items.length === 0) {
    // No substantive items — generate a minimal summary
    const typeLabel = meeting.type || 'meeting';
    enSummaries[key] = `${typeLabel} with no public agenda items listed.`;
    esSummaries[key] = `${typeLabel} sin puntos de agenda pública listados.`;
    generated++;
    console.log(`[${generated}] ${key} — no items, wrote minimal summary`);
    continue;
  }

  // Build the item list for the prompt.
  //
  // A flat list makes a sixteen-contract consent block look like the meeting and
  // buries the one report the board will actually spend half an hour on. The
  // agenda already ranks itself: it allocates minutes per section. So where the
  // agenda states times, hand the model that ranking; where it states none, fall
  // back to the flat list rather than inventing an order.
  const { ranked, consent, consentMinutes, unranked } = rankItems(meeting.items || [], (it) => isProceduralItem(it.title));
  const hasTimeSignal = ranked.length > 0;

  // The model is given the ORDER the allocations imply, never the minutes
  // themselves: told "35 min", Haiku writes "a 35-minute update on..." into public
  // preview text, and no instruction stopped it. Ranking is the signal we want;
  // the scheduling minutiae are not.
  //
  // Anything at or under this many minutes is a standing housekeeping line rather
  // than business — a one-minute "Correspondence" slot, or one filing of four
  // sharing a single minute. Listed, but never as the lead.
  const BRIEF_MINUTES = 2;

  const describe = (it) => {
    let line = it.title;
    if (it.category && it.category !== it.title) line += ` [${it.category}]`;
    if (it.actionType && it.actionType !== 'Procedural') line += ` (${it.actionType})`;
    return line;
  };

  let itemList;
  if (hasTimeSignal) {
    const substantial = ranked.filter(r => r.minutes > BRIEF_MINUTES);
    const brief = ranked.filter(r => r.minutes <= BRIEF_MINUTES);

    const blocks = [];
    blocks.push(
      'SUBSTANTIVE ITEMS, in order of the time the agenda allocates to them (most first):\n' +
      (substantial.length > 0 ? substantial : ranked).map(r => `- ${describe(r.item)}`).join('\n'),
    );
    if (substantial.length > 0 && brief.length > 0) {
      blocks.push(
        'BRIEF ITEMS (the agenda gives each a minute or less):\n' +
        brief.map(r => `- ${describe(r.item)}`).join('\n'),
      );
    }
    if (unranked.length > 0) {
      blocks.push(
        'ITEMS WITH NO STATED TIME ALLOCATION (rank these on substance):\n' +
        unranked.map(u => `- ${describe(u.item)}`).join('\n'),
      );
    }
    if (consent.length > 0) {
      const mins = consentMinutes != null ? `${consentMinutes} min total` : 'no separate discussion time';
      blocks.push(
        `CONSENT CALENDAR — ${consent.length} item${consent.length === 1 ? '' : 's'}, ${mins}, ` +
        'approved together in one vote without discussion:\n' +
        consent.map(c => `- ${describe(c)}`).join('\n'),
      );
    }
    itemList = blocks.join('\n\n');
  } else {
    itemList = items.map((it, i) => `${i + 1}. ${describe(it)}`).join('\n');
  }

  const weightingInstruction = hasTimeSignal
    ? `2. The order above is the district's own ranking of what this meeting is about, taken from the time its agenda allocates to each item. Lead with the first item and cover the rest in that order. A scheduled discussion or staff report outranks any number of consent items. Do not mention scheduling or how long anything is set to take — the ordering is for you, not for the reader.
3. Do not characterize an item's importance beyond what the agenda text itself says. The consent calendar is routine business approved in a single vote. Never open with a consent item and never itemize the block. Mention it, at most, in one short trailing clause naming the theme and the count (e.g. "alongside ${consent.length} routine consent items covering contracts and field trips"). Name an individual consent item only if it is genuinely remarkable — an unusually large dollar amount, or a change in policy.`
    : `2. This agenda states no time allocations, so rank the items on substance: policy decisions, money, and items affecting students or families come before routine approvals, contracts, and field trips.
3. Never open with a consent item or a routine contract approval, and never itemize a run of them. Mention routine approvals, if at all, in one short trailing clause naming the theme rather than the individual items.`;

  const dateStr = meeting.date;
  const typeStr = meeting.type || 'Board Meeting';

  const hasMinutes = !!(meeting.minutes && (meeting.minutes.documents?.length > 0 || meeting.minutes.approvedAt));
  const tenseInstruction = hasMinutes
    ? '8. Formal, approved meeting minutes exist for this meeting. You MUST write in a decisive past tense (e.g., "The Board approved multiple agreements..." or "The Board adopted the budget..."). Write the Spanish summary in matching decisive past tense (e.g., "La Junta aprobó múltiples acuerdos..." or "La Junta adoptó el presupuesto...").'
    : '8. No formal, approved meeting minutes exist for this meeting (either because it is scheduled in the future or because the minutes have not been approved/parsed yet). You MUST write in speculative, agenda-focused, or planned tense, describing what is scheduled, proposed, or planned to be discussed or voted on. Do NOT use decisive past-tense language like "approved" or "adopted" as the final outcome is not formally verified. Use phrases like "The agenda proposed...", "The Board was scheduled to consider...", "The Board will consider...", or "The meeting scheduled discussion of...". Write the Spanish summary in matching speculative or future tense (e.g., "La agenda propuso...", "La Junta tenía programado considerar...", "La Junta considerará...", or "La reunión programó la discusión de..."). Do NOT use "La Junta aprobó..." or "La Junta adoptó...".';

  const prompt = `You are writing a concise summary for a school board meeting card on a public website (rcsd.info) for the Redwood City School District.

Meeting date: ${dateStr}
Meeting type: ${typeStr}

Agenda items:
${itemList}

Instructions:
1. Write a 1-2 sentence summary leading with the most substantive business of the meeting. Skip routine procedural items.
${weightingInstruction}
4. Be specific about topics — include school names, dollar amounts, policy numbers, program names, and resolution numbers when they appear in the items.
5. Use <strong> tags around important terms (school names, dollar amounts, policy numbers, program names) for emphasis.
6. Keep it concise — this appears as preview text on a meeting card.
7. Do NOT include HTML other than <strong> tags. No links, no lists.
8. For closed sessions: note the general topics discussed (e.g., "personnel matters", "litigation", "property negotiations") without revealing confidential details.
9. For retreats/study sessions: describe the focus topic.
10. ${tenseInstruction}

Respond with exactly this JSON format (no markdown code fences, just raw JSON):
{
  "en": "English summary here",
  "es": "Spanish summary here (sixth-grade Californian Spanish — simple, colloquial, natural)"
}`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text.trim();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Try extracting JSON from markdown code block
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error(`Could not parse response: ${text.slice(0, 200)}`);
      }
    }

    if (!parsed.en || !parsed.es) {
      throw new Error(`Missing en or es in response: ${JSON.stringify(parsed).slice(0, 200)}`);
    }

    enSummaries[key] = parsed.en;
    esSummaries[key] = parsed.es;
    generated++;

    console.log(`[${generated}] ${key} — ${parsed.en.slice(0, 100)}...`);

    // Rate limit: 200ms delay between calls
    await new Promise(r => setTimeout(r, 200));

    // Save periodically (every 10 meetings) in case of interruption
    if (generated % 10 === 0) {
      writeFileSync(enPath, JSON.stringify(enSummaries, null, 2) + '\n');
      writeFileSync(esPath, JSON.stringify(esSummaries, null, 2) + '\n');
      console.log(`  (saved progress: ${generated} summaries so far)`);
    }

  } catch (err) {
    errors++;
    console.error(`ERROR on ${key}: ${err.message}`);
    // Continue to next meeting
    continue;
  }
}

// Sort keys chronologically before writing
function sortSummaries(obj) {
  const sorted = {};
  const keys = Object.keys(obj).sort();
  for (const k of keys) {
    sorted[k] = obj[k];
  }
  return sorted;
}

// Final save
writeFileSync(enPath, JSON.stringify(sortSummaries(enSummaries), null, 2) + '\n');
writeFileSync(esPath, JSON.stringify(sortSummaries(esSummaries), null, 2) + '\n');

console.log(`\nDone. Generated: ${generated}, Skipped: ${skipped}, Errors: ${errors}`);
console.log(`EN summaries: ${Object.keys(enSummaries).length}`);
console.log(`ES summaries: ${Object.keys(esSummaries).length}`);
