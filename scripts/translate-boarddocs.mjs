#!/usr/bin/env node
/**
 * Translate BoardDocs (2020–2025) agenda-item body text to Spanish so the
 * /reuniones/ pages can show historical item details in Spanish.
 *
 * Input:  data/boarddocs-scraped.json  (meetings[].items[].{order, body})
 * Output: data/boarddocs-es.json       ({ [boardDocsId]: { [order]: esText } })
 *
 * Keyed by the BoardDocs goto-URL id (the same key build-meeting-pages uses to
 * join content). BoardDocs is a frozen historical archive (new meetings come
 * from Simbli), so caching is simply "translate any id/order not already
 * present" — no source-hash needed. Phase D-translate of AGENDA_CONTENT_PLAN.md.
 *
 * Requires ANTHROPIC_API_KEY. Runs in full pipeline mode only.
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'data/boarddocs-scraped.json');
const OUT = resolve(ROOT, 'data/boarddocs-es.json');

const args = process.argv.slice(2);
const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : 0;

const SYSTEM_PROMPT = `You translate Redwood City School District board-meeting agenda item content from English to Spanish.

You receive a JSON array of strings (agenda item body text). Translate each into clear, formal Latin American Spanish appropriate for official school-district communications to parents. Rules:
- Preserve proper nouns, person names, dollar amounts, dates, percentages, URLs, and acronyms (LCAP, MOU, ELD, HVAC, RFP) as-is.
- Do not add, drop, or reorder array elements.
- Output ONLY a JSON array of the same length, same order, each a translated string.`;

const client = new Anthropic();

function boardDocsId(url) {
  const m = String(url || '').match(/id=([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}
function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ').trim();
}

// Translate an array of strings, batching by character budget to stay within
// output limits. Falls back to the English source for any unusable element.
async function translateStrings(texts) {
  const MAX_CHARS = 24000;
  const out = [];
  let batch = [];
  let size = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 32768,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(batch) }],
    });
    const resp = await stream.finalMessage();
    let arr;
    try {
      const m = resp.content[0].text.match(/\[[\s\S]*\]/);
      arr = JSON.parse(m ? m[0] : resp.content[0].text);
    } catch { arr = null; }
    batch.forEach((src, i) => {
      const v = arr && arr[i];
      out.push(typeof v === 'string' && v.trim() ? v : src);
    });
    batch = [];
    size = 0;
  };
  for (const t of texts) {
    if (size + t.length > MAX_CHARS && batch.length > 0) await flush();
    batch.push(t);
    size += t.length;
  }
  await flush();
  return out;
}

async function main() {
  if (!existsSync(SRC)) { console.log('No boarddocs-scraped.json; nothing to translate.'); return; }
  const j = JSON.parse(readFileSync(SRC, 'utf-8'));
  const meetings = j.meetings || j;
  const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf-8')) : {};

  // Find meetings with untranslated content.
  const todo = [];
  for (const m of meetings) {
    const id = boardDocsId(m.url);
    if (!id) continue;
    const have = existing[id] || {};
    const pending = [];
    for (const it of m.items || []) {
      const text = htmlToText(it.body);
      if (it.order != null && text && !have[String(it.order)]) pending.push({ order: String(it.order), text });
    }
    if (pending.length) todo.push({ id, pending });
  }

  if (todo.length === 0) { console.log('All BoardDocs content already translated.'); return; }
  const work = limit ? todo.slice(0, limit) : todo;
  console.log(`BoardDocs translation: ${todo.length} meeting(s) with untranslated content${limit ? `, doing ${work.length}` : ''}.`);

  // Concurrent translation (the backfill is large and the pipeline step caps at
  // 30 min). The update-and-write block below has no await, so it runs
  // atomically relative to other workers — no torn writes to the shared file.
  const CONCURRENCY = 6;
  let done = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < work.length) {
      const { id, pending } = work[cursor++];
      try {
        const translations = await translateStrings(pending.map((p) => p.text));
        existing[id] = existing[id] || {};
        pending.forEach((p, i) => { existing[id][p.order] = translations[i]; });
        writeFileSync(OUT, JSON.stringify(existing, null, 2) + '\n'); // persist incrementally
        done++;
        console.log(`  translated ${id} (${pending.length} items) [${done}/${work.length}]`);
      } catch (e) {
        console.error(`  ERROR translating ${id}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, work.length) }, worker));
  console.log(`\nBoardDocs translation done: ${done} meeting(s) translated.`);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
