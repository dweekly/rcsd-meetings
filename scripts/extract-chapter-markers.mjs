#!/usr/bin/env node
/**
 * Extract structured chapter markers from board meeting transcripts.
 *
 * For each meeting with an AssemblyAI transcript, sends the speaker-diarized
 * utterances + agenda items to Claude Sonnet, which returns per-item phase
 * timestamps (opened, presentation, publicComment, discussion, vote).
 *
 * Results are cached per meeting in data/chapter-markers-cache/
 * so we only call the API for new or changed meetings.
 *
 * Usage: node scripts/extract-chapter-markers.mjs [--force] [--date 2026-02-26]
 *
 * Requires ANTHROPIC_API_KEY in environment.
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { parseSimbliAgenda, parseBoarddocsAgenda } from './parse-formal-agenda.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CACHE_DIR = resolve(ROOT, 'data/chapter-markers-cache');
const TRANSCRIPT_AAI_DIR = resolve(ROOT, 'artifacts/transcripts-aai');
const MINUTES_DIR = resolve(ROOT, 'artifacts/minutes');
const MEMOS_DIR = resolve(ROOT, 'data/board-memos');
const BOARDDOCS_SCRAPED_PATH = resolve(ROOT, 'data/boarddocs-scraped.json');
const DATA_PATH = resolve(ROOT, 'data/meetings-data.json');
const OUTPUT_PATH = resolve(ROOT, 'data/chapter-markers.json');

mkdirSync(CACHE_DIR, { recursive: true });

const args = process.argv.slice(2);
const force = args.includes('--force');
// Cap per-run refreshes of markers whose transcript changed (see July 2026
// re-transcription); new meetings are never capped.
const maxRefresh = args.includes('--max-refresh')
  ? parseInt(args[args.indexOf('--max-refresh') + 1], 10)
  : process.env.MAX_REFRESH === 'all'
    ? Infinity
    : process.env.MAX_REFRESH
      ? parseInt(process.env.MAX_REFRESH, 10)
      : 25;
const dateFilter = args.includes('--date') ? args[args.indexOf('--date') + 1] : null;
const slugFilter = args.includes('--slug') ? args[args.indexOf('--slug') + 1] : null;

// ---- Format AAI utterances as compact text ----

function formatUtterances(utterances) {
  return utterances.map(u => {
    const seconds = Math.round(u.start / 1000);
    return `[${seconds}s] ${u.speaker}: ${u.text}`;
  }).join('\n');
}

// ---- Extract minutes text from PDF ----

function extractMinutesText(date) {
  const pdfPath = resolve(MINUTES_DIR, `${date}-minutes.pdf`);
  if (!existsSync(pdfPath)) return null;
  // Use system python3 (pymupdf must be installed: pip3 install pymupdf)
  const venvPython = 'python3';
  try {
    const pyScript = `import fitz,sys; doc=fitz.open(sys.argv[1]); print('\\n'.join(p.get_text() for p in doc))`;
    const text = execFileSync(venvPython, ['-c', pyScript, pdfPath], {
      maxBuffer: 1024 * 1024,
      timeout: 10000,
    }).toString();
    return text.substring(0, 8000);
  } catch {
    return null;
  }
}

// ---- Load full formal agenda (board memos or BoardDocs scraped) ----

let boarddocsScraped = null;
function getBoarddocsScraped() {
  if (boarddocsScraped === null) {
    try {
      boarddocsScraped = JSON.parse(readFileSync(BOARDDOCS_SCRAPED_PATH, 'utf-8'));
    } catch {
      boarddocsScraped = [];
    }
  }
  return boarddocsScraped;
}

function loadFormalAgenda(date) {
  // Prefer board memo (Simbli meetings, more recent)
  const memoPath = resolve(MEMOS_DIR, `${date}.json`);
  if (existsSync(memoPath)) {
    const memo = JSON.parse(readFileSync(memoPath, 'utf-8'));
    const items = parseSimbliAgenda(memo.items);
    return items.map(it => ({
      order: it.itemLabel,
      title: it.isSection ? `[Section ${it.itemLabel}] ${it.title}` : it.title,
      speaker: it.speaker,
      attachments: (it.attachments || []).map(a => a.title).filter(Boolean),
    }));
  }

  // Fall back to BoardDocs scraped data
  const scraped = getBoarddocsScraped();
  const meeting = scraped.find(m => m.date === date);
  if (meeting) {
    const items = parseBoarddocsAgenda(meeting);
    return items.map(it => ({
      order: it.itemLabel,
      title: it.isSection ? `[Section ${it.itemLabel}] ${it.title}` : it.title,
      speaker: it.speaker,
      attachments: (it.attachments || []).map(a => a.title || a.name).filter(Boolean),
    }));
  }

  return null;
}

// ---- Build prompt ----

// Officer rotations: same source of truth as build-meetings-html.mjs.
// afterDate = first meeting UNDER the new officers (previous officers served before this date).
// Sorted newest-first.
const OFFICER_ROTATIONS = [
  {
    afterDate: '2025-12-17',
    president: 'David Weekly', vp: 'Cecilia I. Márquez', clerk: 'Jennifer Ng Kwing King',
    members: ['David Li', 'Mike Wells'],
  },
  {
    afterDate: '2024-12-17',
    president: 'Mike Wells', vp: 'David Weekly', clerk: 'Cecilia I. Márquez',
    members: ['David Li', 'Jennifer Ng Kwing King'],
    note: 'Trustees Lawson & MacAvoy departed; Li & Ng Kwing King sworn in',
  },
  {
    afterDate: '2023-12-06',
    president: 'Cecilia I. Márquez', vp: 'Janet Lawson', clerk: 'Mike Wells',
    members: ['David Weekly', 'Alisa MacAvoy'],
  },
  {
    afterDate: '2022-12-14',
    president: 'María Díaz-Slocum', vp: 'Cecilia I. Márquez', clerk: 'Janet Lawson',
    members: ['Alisa MacAvoy', 'Mike Wells'],
    note: 'Trustee Díaz-Slocum departed; Weekly & Márquez sworn in',
  },
  {
    afterDate: '2021-12-15',
    president: 'Alisa MacAvoy', vp: 'María Díaz-Slocum', clerk: 'Cecilia I. Márquez',
    members: ['Janet Lawson', 'Mike Wells'],
  },
  {
    afterDate: '2020-12-11',
    president: 'Janet Lawson', vp: 'Alisa MacAvoy', clerk: 'María Díaz-Slocum',
    members: ['Cecilia I. Márquez', 'Mike Wells'],
    note: 'Trustee McBride departed; Wells, MacAvoy, and Lawson sworn in',
  },
  {
    afterDate: '2019-12-11',
    president: 'Dennis McBride', vp: 'Janet Lawson', clerk: 'Alisa MacAvoy',
    members: ['María Díaz-Slocum', 'Cecilia I. Márquez'],
  },
];

// Key district staff (non-board). Filtered by date range.
//
// This is the SECOND place the superintendency is recorded — data/trustees.json
// is the first, and it is what /district renders. The two must move together:
// this roster went on telling the LLM that Baker was superintendent for seven
// weeks after Rubalcaba took office, silently mis-attributing speakers in every
// chapter marker extracted in that window. scripts/check-freshness.mjs asserts
// the trustees.json side and its failure message points here. See
// docs/ANNUAL-REFRESH.md.
const DISTRICT_STAFF = [
  { name: 'John Baker', role: 'Superintendent', from: '2023-07-01', to: '2026-06-30', notes: 'Dr. Baker; retired 2026-06-30' },
  { name: 'Christian Rubalcaba', role: 'Superintendent', from: '2026-07-01', notes: 'Dr. Rubalcaba; took office 2026-07-01' },
  { name: 'Evelyn Sanchez', role: 'Executive Assistant to Superintendent', from: '2024-01-01', notes: 'Acts as board secretary — takes roll call, drafts minutes' },
];

// Get the board roster for a specific meeting date
function getBoardRoster(date) {
  // Find the rotation that applies: the most recent rotation where afterDate <= date
  const rotation = OFFICER_ROTATIONS.find(r => date >= r.afterDate);
  if (!rotation) {
    // Before our earliest data
    return [];
  }

  const roster = [
    `  - ${rotation.president} (President)`,
    `  - ${rotation.vp} (Vice President)`,
    `  - ${rotation.clerk} (Clerk)`,
    ...rotation.members.map(m => `  - ${m} (Trustee)`),
  ];

  // Add district staff active at this date
  for (const s of DISTRICT_STAFF) {
    if (date >= s.from && (!s.to || date <= s.to)) {
      roster.push(`  - ${s.name} (${s.role}${s.notes ? '; ' + s.notes : ''})`);
    }
  }

  return roster;
}

function buildPrompt(meeting, compactTranscript, minutesText, formalAgenda) {
  // Build agenda list from formal agenda (complete with procedural items and real numbering)
  // or fall back to meetings-data items
  let agendaList;
  if (formalAgenda) {
    agendaList = formalAgenda.map(item => {
      let line = item.title;
      if (item.speaker) line += `\n   Speaker: ${item.speaker}`;
      if (item.attachments && item.attachments.length > 0) {
        line += `\n   Attachments: ${item.attachments.join('; ')}`;
      }
      return line;
    }).join('\n');
  } else {
    // Fall back to meetings-data items (no formal item numbers available)
    agendaList = meeting.items.map((item, i) => {
      let line = `[item ${i}] ${item.title}`;
      if (item.attachments && item.attachments.length > 0) {
        const attNames = item.attachments.map(a => a.title || a.name).filter(Boolean);
        if (attNames.length > 0) {
          line += `\n   Attachments: ${attNames.join('; ')}`;
        }
      }
      return line;
    }).join('\n');
  }

  // Get board roster for this specific meeting date
  const activeMembers = getBoardRoster(meeting.date).join('\n');

  let minutesSection = '';
  if (minutesText) {
    minutesSection = `

APPROVED MINUTES (use for speaker names, vote results, and formal actions):
${minutesText}
`;
  }

  return `You are analyzing a school board meeting transcript to extract structured chapter markers for each agenda item.

MEETING: ${meeting.date} (${meeting.type})
Duration: ${meeting.durationSeconds ? Math.round(meeting.durationSeconds) + 's' : 'unknown'}

BOARD MEMBERS AND STAFF (correct spellings — ASR often misspells these names):
${activeMembers}

FORMAL AGENDA (with item numbers as they appear on the posted agenda):
${agendaList}
${minutesSection}
TRANSCRIPT (format: [Ns] Speaker: text — N is seconds from start, Speaker is a letter label):
${compactTranscript}

TASK: For EVERY agenda item listed above, identify the timestamp (in seconds) when it occurs in the transcript. This includes procedural items (call to order, roll call, approval of agenda, adjournment, etc.) — not just the substantive items.

ITEM PHASES — identify whichever phases apply to each item:
- "opened": When the item begins (president introduces it, or the procedural action starts)
- "presentation": When a presenter begins their substantive presentation (not the president's intro)
- "publicComment": When public comment is opened for this item
- "discussion": When board members begin deliberating/asking questions
- "vote": When the vote is called — also identify the vote type and result

PUBLIC COMMENT SPEAKERS — for EVERY item that has public comment (both standalone "Public Comment" / "Oral Communication" agenda items AND item-specific public comment phases), extract each individual speaker:
- "publicComments": array of individual speakers, in the order they spoke
- Each entry: { "name": "speaker name", "startSeconds": N, "endSeconds": N, "summary": "1-sentence summary of what they said" }
- For the speaker name: APPROVED MINUTES are the authoritative source for speaker names — if minutes are provided, use the exact spelling from the minutes (e.g., minutes may list "Elle Kolekar" where ASR heard "L. Colar"). If no minutes are available, use whatever name the speaker gives or the president announces. If the name is unclear from both sources, use "Unidentified speaker".
- startSeconds: when the speaker begins talking (not when the president introduces them)
- endSeconds: when the speaker finishes (before the next speaker or the president's transition)
- summary: a concise, neutral 1-sentence summary of the speaker's comment
- If no public comment speakers spoke, use an empty array []

RULES:
1. All timestamps must be integers (seconds from start of recording)
2. Timestamps must be monotonically increasing within an item's phases (exception: publicComment may precede opened if public comment was taken early)
3. "opened" is required for every item that was actually taken up
4. Other phases are null if they didn't happen for that item
5. For consent calendar items approved as a bundle, mark consent:true and give a single "opened" timestamp for the bundle introduction, plus a "vote" for the bundle vote
6. If an item was pulled from the consent calendar for individual discussion, mark pulled:true and give it full individual phases
7. If the agenda was resequenced, note it in agendaChanges and list items in the order they actually appeared
8. For speaker identification: use the BOARD MEMBERS AND STAFF list above for correct name spellings (ASR frequently garbles these). Agenda item titles often name expected presenters (e.g., "Speakers: Jane Doe, Director"). Minutes list attendees with roles. Use all of these sources to map speaker labels (A, B, C...) to full names and roles. For staff presenters not in the roster, use the name as given in the agenda/minutes.
9. Use the EXACT item label/number from the formal agenda (e.g., "1", "6", "7.1", "8.1") as the "itemLabel" — do NOT use 0-indexed numbers.

RESPOND WITH ONLY VALID JSON (no markdown fences):
{
  "speakers": {
    "A": { "name": "Name or null", "role": "role description" }
  },
  "agendaChanges": "description of any resequencing or pulls, or null",
  "items": [
    {
      "itemLabel": "1",
      "title": "Call to Order",
      "phases": {
        "opened": 5,
        "presentation": null,
        "publicComment": null,
        "discussion": null,
        "vote": null
      },
      "publicComments": [],
      "consent": false,
      "pulled": false
    },
    {
      "itemLabel": "5",
      "title": "Public Comment",
      "phases": {
        "opened": 93,
        "presentation": null,
        "publicComment": 93,
        "discussion": null,
        "vote": null
      },
      "publicComments": [
        { "name": "Jessica", "startSeconds": 118, "endSeconds": 219, "summary": "Encouraged the board to place the parcel tax on the June ballot." },
        { "name": "Elle Kolekar", "startSeconds": 248, "endSeconds": 275, "summary": "Echoed support for the parcel tax renewal." }
      ],
      "consent": false,
      "pulled": false
    },
    {
      "itemLabel": "7.1",
      "title": "Resolution No. 21",
      "phases": {
        "opened": 123,
        "presentation": 200,
        "publicComment": 400,
        "discussion": 450,
        "vote": { "seconds": 500, "type": "roll-call", "result": "5-0" }
      },
      "publicComments": [
        { "name": "Maria Lopez", "startSeconds": 405, "endSeconds": 430, "summary": "Asked about the exemption process for seniors." }
      ],
      "consent": false,
      "pulled": false
    }
  ]
}`;
}

// ---- Validate output ----

function validateResult(result, meeting) {
  const errors = [];
  const duration = meeting.durationSeconds || Infinity;

  if (!result.items || !Array.isArray(result.items)) {
    errors.push('Missing or invalid items array');
    return errors;
  }

  for (const item of result.items) {
    const label = item.itemLabel || '??';

    const p = item.phases;
    if (!p) {
      errors.push(`Item ${label}: missing phases`);
      continue;
    }

    // Collect all non-null timestamps for monotonicity check
    const timestamps = [];
    if (p.opened != null) timestamps.push(['opened', p.opened]);
    if (p.presentation != null) timestamps.push(['presentation', p.presentation]);
    if (p.publicComment != null) timestamps.push(['publicComment', p.publicComment]);
    if (p.discussion != null) timestamps.push(['discussion', p.discussion]);
    if (p.vote != null) {
      const voteSec = typeof p.vote === 'object' ? p.vote.seconds : p.vote;
      if (voteSec != null) timestamps.push(['vote', voteSec]);
    }

    // Check within duration
    for (const [phase, sec] of timestamps) {
      if (sec < 0 || sec > duration + 60) {
        errors.push(`Item ${label}.${phase}: ${sec}s outside duration ${duration}s`);
      }
    }

    // Check monotonicity within item
    for (let i = 1; i < timestamps.length; i++) {
      if (timestamps[i][1] < timestamps[i - 1][1]) {
        errors.push(`Item ${label}: ${timestamps[i][0]} (${timestamps[i][1]}s) before ${timestamps[i - 1][0]} (${timestamps[i - 1][1]}s)`);
      }
    }
  }

  // Check opened timestamps are monotonic across items (in listed order)
  const openedTimes = result.items
    .filter(it => it.phases?.opened != null)
    .map(it => ({ label: it.itemLabel, opened: it.phases.opened }));
  for (let i = 1; i < openedTimes.length; i++) {
    if (openedTimes[i].opened < openedTimes[i - 1].opened) {
      errors.push(`Cross-item: item ${openedTimes[i].label} opened (${openedTimes[i].opened}s) before item ${openedTimes[i - 1].label} (${openedTimes[i - 1].opened}s)`);
    }
  }

  return errors;
}

// ---- Main ----

async function main() {
  const client = new Anthropic();
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));

  // Load existing output when filtering by date or slug
  const chapterMarkers = ((dateFilter || slugFilter) && existsSync(OUTPUT_PATH))
    ? JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'))
    : {};
  let apiCalls = 0;
  let cached = 0;
  let skipped = 0;
  let staleQueued = 0;
  let staleDeferred = 0;
  let errors = 0;

  for (const meeting of data.meetings) {
    if (dateFilter && meeting.date !== dateFilter) continue;
    if (slugFilter && meeting.slug !== slugFilter) continue;
    if (!meeting.youtube) { skipped++; continue; }
    if (!meeting.items || meeting.items.length === 0) { skipped++; continue; }

    const aaiPath = resolve(TRANSCRIPT_AAI_DIR, `${meeting.youtube}.json`);
    if (!existsSync(aaiPath)) { skipped++; continue; }

    // Use slug as the key to support multiple meetings on the same date
    const markerKey = meeting.slug;

    // Check cache (support both new slug-based and legacy date-based cache files)
    const cacheFile = resolve(CACHE_DIR, `${markerKey}.json`);
    const legacyCacheFile = resolve(CACHE_DIR, `${meeting.date}.json`);
    const activeCacheFile = existsSync(cacheFile) ? cacheFile : (existsSync(legacyCacheFile) ? legacyCacheFile : null);
    const aaiRaw = readFileSync(aaiPath, 'utf-8');
    const aaiHash = createHash('sha256').update(aaiRaw).digest('hex').slice(0, 16);
    if (!force && activeCacheFile) {
      try {
        const cacheData = JSON.parse(readFileSync(activeCacheFile, 'utf-8'));
        if (cacheData.result && cacheData.itemCount === meeting.items.length) {
          if (cacheData.transcriptHash === aaiHash) {
            chapterMarkers[markerKey] = cacheData.result;
            cached++;
            continue;
          }
          // Transcript changed under a valid cache entry (pre-hash entries
          // count as changed): refresh up to --max-refresh per run, serving
          // the stale result until this meeting's turn comes up.
          if (staleQueued >= maxRefresh) {
            chapterMarkers[markerKey] = cacheData.result;
            staleDeferred++;
            continue;
          }
          staleQueued++;
        }
      } catch { /* re-process if cache is corrupt */ }
    }

    // Parse AAI transcript
    const aai = JSON.parse(aaiRaw);
    if (!aai.utterances || aai.utterances.length === 0) { skipped++; continue; }

    const compactTranscript = formatUtterances(aai.utterances);
    const minutesText = extractMinutesText(meeting.date);

    // Load full formal agenda
    const formalAgenda = loadFormalAgenda(meeting.date);

    console.log(`${markerKey} (${formalAgenda ? formalAgenda.length : meeting.items.length} agenda items, ${aai.utterances.length} utterances, ${Math.round(compactTranscript.length / 1000)}K chars${minutesText ? ', +minutes' : ''}${formalAgenda ? ', formal agenda' : ''})...`);

    const prompt = buildPrompt(meeting, compactTranscript, minutesText, formalAgenda);

    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-5',
        // Disable Sonnet 5's default adaptive thinking to keep cost parity
        // with the prior 4.6 behavior (thinking off unless requested).
        thinking: { type: 'disabled' },
        max_tokens: 16384,
        messages: [{ role: 'user', content: prompt }],
      });

      apiCalls++;
      const text = response.content[0].text;

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error(`  FAIL: no JSON in response`);
        errors++;
        continue;
      }

      let llmResult;
      try {
        llmResult = JSON.parse(jsonMatch[0]);
      } catch (parseErr) {
        // Try to repair truncated JSON by closing open arrays/objects
        let repaired = jsonMatch[0];
        // Remove trailing incomplete entry (after last comma in items array)
        repaired = repaired.replace(/,\s*\{[^}]*$/, '');
        // Close any unclosed brackets
        const opens = (repaired.match(/\[/g) || []).length;
        const closes = (repaired.match(/\]/g) || []).length;
        for (let i = 0; i < opens - closes; i++) repaired += ']';
        const openBraces = (repaired.match(/\{/g) || []).length;
        const closeBraces = (repaired.match(/\}/g) || []).length;
        for (let i = 0; i < openBraces - closeBraces; i++) repaired += '}';
        try {
          llmResult = JSON.parse(repaired);
          console.warn(`  REPAIRED truncated JSON (${response.usage.output_tokens} output tokens hit limit)`);
        } catch {
          console.error(`  FAIL: malformed JSON: ${parseErr.message}`);
          errors++;
          continue;
        }
      }

      // Validate
      const validationErrors = validateResult(llmResult, meeting);
      if (validationErrors.length > 0) {
        console.warn(`  WARNINGS:`);
        for (const e of validationErrors) console.warn(`    ${e}`);
      }

      if (llmResult.agendaChanges) {
        console.log(`  Agenda changes: ${llmResult.agendaChanges}`);
      }

      // Build output
      const result = {
        videoId: meeting.youtube,
        speakers: llmResult.speakers || {},
        agendaChanges: llmResult.agendaChanges || null,
        items: llmResult.items || [],
      };

      chapterMarkers[markerKey] = result;

      // Cache using slug-based filename
      const newCacheFile = resolve(CACHE_DIR, `${markerKey}.json`);
      writeFileSync(newCacheFile, JSON.stringify({
        date: meeting.date,
        slug: markerKey,
        itemCount: meeting.items.length,
        transcriptHash: aaiHash,
        llmResponse: llmResult,
        result,
        cachedAt: new Date().toISOString(),
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      }, null, 2));

      const cost = (response.usage.input_tokens * 3 + response.usage.output_tokens * 15) / 1_000_000;
      const itemsWithOpened = (llmResult.items || []).filter(it => it.phases?.opened != null).length;
      console.log(`  ${itemsWithOpened}/${meeting.items.length} items mapped (${response.usage.input_tokens} in, ${response.usage.output_tokens} out, $${cost.toFixed(4)})`);

    } catch (err) {
      console.error(`  API error: ${err.message}`);
      errors++;
    }
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(chapterMarkers, null, 2));
  console.log(`\nDone: ${apiCalls} API calls, ${cached} cached, ${staleDeferred} stale-deferred, ${skipped} skipped, ${errors} errors`);
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch(err => { console.error(err); process.exit(1); });
