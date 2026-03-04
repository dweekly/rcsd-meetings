#!/usr/bin/env node
/**
 * Map agenda items to transcript timestamps using Claude Haiku.
 *
 * For each meeting with a transcript, sends the compact transcript text +
 * agenda items + approved minutes to Haiku, which returns the exact word
 * sequences marking each agenda item's start. We then search the SRT for
 * those sequences to get precise timestamps.
 *
 * Results are cached per meeting in data/llm-timestamp-cache/
 * so we only call the API for new or changed meetings.
 *
 * Usage: node scripts/map-timestamps-llm.mjs [--force] [--date 2026-01-14]
 *
 * Requires ANTHROPIC_API_KEY in environment.
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CACHE_DIR = resolve(ROOT, 'data/llm-timestamp-cache');
const TRANSCRIPT_DIR = resolve(ROOT, 'artifacts/transcripts');
const MINUTES_DIR = resolve(ROOT, 'artifacts/minutes');
const DATA_PATH = resolve(ROOT, 'data/meetings-data.json');
const OUTPUT_PATH = resolve(ROOT, 'data/timestamp-map.json');

mkdirSync(CACHE_DIR, { recursive: true });

const args = process.argv.slice(2);
const force = args.includes('--force');
const dateFilter = args.includes('--date') ? args[args.indexOf('--date') + 1] : null;

// ---- Parse SRT ----

function parseSRT(content) {
  const blocks = [];
  for (const entry of content.split(/\n\n+/)) {
    const lines = entry.trim().split('\n');
    if (lines.length < 3) continue;
    const tm = lines[1].match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!tm) continue;
    const seconds = parseInt(tm[1]) * 3600 + parseInt(tm[2]) * 60 + parseInt(tm[3]);
    const text = lines.slice(2).join(' ').replace(/<[^>]+>/g, '').trim();
    if (text) blocks.push({ seconds, text });
  }
  return blocks;
}

function srtToCompactText(blocks) {
  let text = '';
  let last = '';
  for (const b of blocks) {
    if (b.text !== last) {
      text += b.text + ' ';
      last = b.text;
    }
  }
  return text;
}

function formatTimestamp(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ---- Extract minutes text from PDF via pymupdf ----

function extractMinutesText(date) {
  const pdfPath = resolve(MINUTES_DIR, `${date}-minutes.pdf`);
  if (!existsSync(pdfPath)) return null;
  const venvPython = resolve(ROOT, '.venv/bin/python3');
  if (!existsSync(venvPython)) return null;
  try {
    const pyScript = `import fitz,sys; doc=fitz.open(sys.argv[1]); print('\\n'.join(p.get_text() for p in doc))`;
    const text = execFileSync(venvPython, ['-c', pyScript, pdfPath], {
      maxBuffer: 1024 * 1024,
      timeout: 10000,
    }).toString();
    return text.substring(0, 8000); // Cap at 8K chars
  } catch {
    return null;
  }
}

// ---- Search SRT for word sequence ----

function findWordsInSRT(blocks, phrase, afterSeconds = 0) {
  if (!phrase || phrase.toLowerCase().includes('not found') || phrase.toLowerCase().includes('part of consent')) {
    return null;
  }

  const searchWords = phrase.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 0);
  if (searchWords.length < 3) return null;

  const threshold = Math.ceil(searchWords.length * 0.7);

  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].seconds < afterSeconds) continue;

    let windowText = '';
    for (let j = i; j < Math.min(i + 15, blocks.length); j++) {
      windowText += ' ' + blocks[j].text;
    }
    const windowLower = windowText.toLowerCase().replace(/[^a-z0-9 ]/g, ' ');

    let pos = 0;
    let matchCount = 0;
    for (const w of searchWords) {
      const idx = windowLower.indexOf(w, pos);
      if (idx >= 0 && idx < pos + 200) {
        pos = idx + w.length;
        matchCount++;
      }
    }

    if (matchCount >= threshold) {
      return blocks[i].seconds;
    }
  }
  return null;
}

// ---- Build prompt ----

function buildPrompt(meeting, transcriptText, minutesText) {
  const agendaList = meeting.items.map((item, i) =>
    `${i + 1}. ${item.title}`
  ).join('\n');

  let minutesSection = '';
  if (minutesText) {
    minutesSection = `

APPROVED MINUTES (use for speaker names and formal actions taken):
${minutesText}
`;
  }

  return `You are analyzing a school board meeting transcript to find where each agenda item begins.

LEGAL CONTEXT: Under California's Brown Act, any changes to the posted agenda (items pulled, reordered, added) MUST be announced at the start of the meeting during "Changes to the Agenda" or "Approval of the Agenda." Read the early part of the transcript first to identify any changes, then determine the ACTUAL order items were taken up.

MEETING: ${meeting.date} (${meeting.type})

POSTED AGENDA:
${agendaList}
${minutesSection}
TASK:
1. Read the early transcript to find any agenda changes (pulled items, reordering, etc.)
2. For each agenda item, find the EXACT verbatim sequence of 8-15 consecutive words from the transcript marking where that item BEGINS. This is typically the board president's introduction ("next up we have...", "moving on to...", etc.) or the presenter beginning.
3. For consent agenda items approved as a bundle without individual discussion, mark as "consent_bundle" — they share a single timestamp.
4. If an item was pulled from the agenda, mark as "pulled".

CRITICAL: Every intro_words sequence MUST be copied EXACTLY and VERBATIM from the transcript. Do not paraphrase or approximate. Do not invent words.

Respond with ONLY valid JSON, no markdown fences, no other text:
{"agenda_changes":"description or null","consent_vote_words":"exact words when consent items voted on or null","items":[{"item":1,"intro_words":"exact verbatim words","status":"found"},{"item":2,"intro_words":"","status":"consent_bundle"}]}

TRANSCRIPT:
${transcriptText}`;
}

// ---- Main ----

async function main() {
  const client = new Anthropic();
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));

  // Load existing timestamp map when filtering by date (so we don't overwrite other meetings)
  const timestampMap = (dateFilter && existsSync(OUTPUT_PATH))
    ? JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'))
    : {};
  let apiCalls = 0;
  let cached = 0;
  let skipped = 0;

  for (const meeting of data.meetings) {
    if (dateFilter && meeting.date !== dateFilter) continue;
    if (!meeting.youtube) { skipped++; continue; }
    if (!meeting.items || meeting.items.length === 0) { skipped++; continue; }

    const srtPath = resolve(TRANSCRIPT_DIR, `${meeting.youtube}.en.srt`);
    if (!existsSync(srtPath)) { skipped++; continue; }

    // Check cache
    const cacheFile = resolve(CACHE_DIR, `${meeting.date}.json`);
    if (!force && existsSync(cacheFile)) {
      try {
        const cacheData = JSON.parse(readFileSync(cacheFile, 'utf-8'));
        if (cacheData.result && cacheData.items?.length === meeting.items.length) {
          timestampMap[meeting.date] = cacheData.result;
          cached++;
          continue;
        }
      } catch { /* re-process if cache is corrupt */ }
    }

    // Parse transcript
    const srtContent = readFileSync(srtPath, 'utf-8');
    const blocks = parseSRT(srtContent);
    const transcriptText = srtToCompactText(blocks);
    if (blocks.length === 0) { skipped++; continue; }

    // Extract minutes if available
    const minutesText = extractMinutesText(meeting.date);

    console.log(`${meeting.date} (${meeting.items.length} items, ${Math.round(transcriptText.length / 1000)}K chars${minutesText ? ', +minutes' : ''})...`);

    const prompt = buildPrompt(meeting, transcriptText, minutesText);

    try {
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });

      apiCalls++;
      const text = response.content[0].text;

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error(`  FAIL: no JSON in response`);
        continue;
      }

      const llmResult = JSON.parse(jsonMatch[0]);

      if (llmResult.agenda_changes && llmResult.agenda_changes !== 'null') {
        console.log(`  Changes: ${llmResult.agenda_changes}`);
      }

      // Map word sequences to SRT timestamps
      // Two passes: first map individually-found items, then consent bundle
      const itemTimestamps = new Array(meeting.items.length).fill(null);
      let lastTimestamp = 0;
      let foundCount = 0;

      // Pass 1: map non-consent items
      for (let i = 0; i < meeting.items.length; i++) {
        const llmItem = llmResult.items?.find(it => it.item === i + 1);
        if (!llmItem || llmItem.status === 'consent_bundle' || llmItem.status === 'pulled') continue;

        const seconds = findWordsInSRT(blocks, llmItem.intro_words, lastTimestamp > 0 ? lastTimestamp - 120 : 0);
        if (seconds != null && seconds >= lastTimestamp - 120) {
          lastTimestamp = seconds;
          itemTimestamps[i] = {
            timestamp: formatTimestamp(seconds),
            timestampSeconds: seconds,
          };
          foundCount++;
        } else if (llmItem.intro_words) {
          console.log(`  Item ${i + 1}: SRT miss: "${llmItem.intro_words.substring(0, 50)}"`);
        }
      }

      // Pass 2: find consent vote timestamp AFTER the last item before the consent block
      // (avoids false matches from early agenda overview AND from post-consent items)
      let preConsentSecs = 0;
      for (let i = 0; i < meeting.items.length; i++) {
        const llmItem = llmResult.items?.find(it => it.item === i + 1);
        if (llmItem?.status === 'consent_bundle') break; // stop at first consent item
        if (itemTimestamps[i]) preConsentSecs = itemTimestamps[i].timestampSeconds;
      }
      let consentSeconds = null;
      if (llmResult.consent_vote_words) {
        const afterSecs = Math.max(preConsentSecs - 60, 0);
        consentSeconds = findWordsInSRT(blocks, llmResult.consent_vote_words, afterSecs);
      }

      for (let i = 0; i < meeting.items.length; i++) {
        const llmItem = llmResult.items?.find(it => it.item === i + 1);
        if (llmItem?.status === 'consent_bundle' && consentSeconds != null) {
          itemTimestamps[i] = {
            timestamp: formatTimestamp(consentSeconds),
            timestampSeconds: consentSeconds,
            consent: true,
          };
        }
      }

      const result = { videoId: meeting.youtube, items: itemTimestamps };
      timestampMap[meeting.date] = result;

      writeFileSync(cacheFile, JSON.stringify({
        date: meeting.date,
        items: meeting.items.map(it => it.title),
        llmResponse: llmResult,
        result,
        cachedAt: new Date().toISOString(),
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      }, null, 2));

      const cost = (response.usage.input_tokens * 0.8 + response.usage.output_tokens * 4) / 1_000_000;
      console.log(`  ${foundCount}/${meeting.items.length} mapped (${response.usage.input_tokens} in, ${response.usage.output_tokens} out, $${cost.toFixed(4)})`);

    } catch (err) {
      console.error(`  API error: ${err.message}`);
    }
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(timestampMap, null, 2));
  console.log(`\nDone: ${apiCalls} API calls, ${cached} cached, ${skipped} skipped`);
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch(err => { console.error(err); process.exit(1); });
