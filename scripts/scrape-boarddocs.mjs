#!/usr/bin/env node
/**
 * Scrape BoardDocs API for RCSD meeting agendas and attachments.
 *
 * For each meeting in the past 2 years:
 *   1. Fetch BD-GetAgenda -> parse categories + items from HTML
 *   2. For items with attachments, fetch BD-GetPublicFiles -> parse file links
 *
 * Outputs: data/boarddocs-scraped.json
 *
 * Usage: node scripts/scrape-boarddocs.mjs
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'https://go.boarddocs.com/ca/redwood/Board.nsf';
const COMMITTEE_ID = 'A4EP6J588C05';
const CUTOFF_DATE = '20240301'; // 2 years back from Mar 2026

// Rate limiting: delay between requests
const DELAY_MS = 300;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function bdPost(endpoint, body) {
  const resp = await fetch(`${BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return resp.text();
}

async function fetchMeetingsList() {
  const text = await bdPost('BD-GetMeetingsList', `current_committee_id=${COMMITTEE_ID}`);
  return JSON.parse(text);
}

/**
 * Parse BD-GetAgenda HTML into structured categories and items.
 */
function parseAgendaHtml(html) {
  const categories = [];
  const items = [];

  // Parse categories
  const catRe = /<dt[^>]*class="category[^"]*"[^>]*id="([^"]*)"[^>]*unique="([^"]*)"[^>]*>.*?<span class="order">([^<]*)<\/span>.*?<span class="category-name">([^<]*)<\/span>/gs;
  let m;
  while ((m = catRe.exec(html)) !== null) {
    categories.push({
      id: m[1],
      unique: m[2],
      order: m[3].trim(),
      name: m[4].trim(),
    });
  }

  // Parse items
  const itemRe = /<li[^>]*class="[^"]*item[^"]*"[^>]*id="([^"]*)"[^>]*unique="([^"]*)"[^>]*Xtitle="([^"]*)"[^>]*>([\s\S]*?)<\/li>/g;
  while ((m = itemRe.exec(html)) !== null) {
    const id = m[1];
    const unique = m[2];
    const xtitle = m[3];
    const body = m[4];

    const orderMatch = body.match(/<span class="order">([^<]*)<\/span>/);
    const order = orderMatch ? orderMatch[1].trim() : '';

    const titleMatch = body.match(/<span class="title">([^<]*)<\/span>/);
    const title = titleMatch ? titleMatch[1].trim() : xtitle;

    const typeMatch = body.match(/<div class="actiontype">\s*([^<]*?)(?:<span|$)/s);
    let actionType = '';
    if (typeMatch) {
      actionType = typeMatch[1].replace(/<[^>]*>/g, '').trim().replace(/,\s*$/, '');
    }

    const hasAttachment = body.includes('fa-file-text-o');

    const catOrder = order.split('.')[0] + '.';
    const category = categories.find(c => c.order === catOrder);

    items.push({
      id,
      unique,
      order,
      title,
      actionType,
      hasAttachment,
      categoryName: category ? category.name : '',
      url: `https://go.boarddocs.com/ca/redwood/Board.nsf/goto?open&id=${unique}`,
      attachments: [],
    });
  }

  return { categories, items };
}

/**
 * Parse BD-GetPublicFiles HTML into attachment objects.
 */
function parsePublicFilesHtml(html) {
  const attachments = [];
  const fileRe = /<a[^>]*class="public-file"[^>]*unique="([^"]*)"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g;
  let m;
  while ((m = fileRe.exec(html)) !== null) {
    const rawName = m[3].trim();
    const sizeMatch = rawName.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    attachments.push({
      unique: m[1],
      href: `https://go.boarddocs.com${m[2]}`,
      name: sizeMatch ? sizeMatch[1].trim() : rawName,
      size: sizeMatch ? sizeMatch[2].trim() : '',
    });
  }
  return attachments;
}

function parseBdDate(numberdate) {
  const y = numberdate.slice(0, 4);
  const m = numberdate.slice(4, 6);
  const d = numberdate.slice(6, 8);
  return `${y}-${m}-${d}`;
}

function classifyMeetingType(name) {
  const n = name.toLowerCase();
  if (n.includes('special')) return 'Special Meeting';
  if (n.includes('study session')) return 'Study Session';
  return 'Board Meeting';
}

async function main() {
  console.log('Fetching meetings list...');
  const allMeetings = await fetchMeetingsList();
  console.log(`Total meetings in BoardDocs: ${allMeetings.length}`);

  const meetings = allMeetings
    .filter(m => m.numberdate && m.numberdate >= CUTOFF_DATE)
    .sort((a, b) => b.numberdate.localeCompare(a.numberdate));
  console.log(`Meetings since ${CUTOFF_DATE}: ${meetings.length}`);

  const results = [];
  let totalItems = 0;
  let totalAttachments = 0;
  let attachmentFetches = 0;

  for (let i = 0; i < meetings.length; i++) {
    const mtg = meetings[i];
    const date = parseBdDate(mtg.numberdate);
    const type = classifyMeetingType(mtg.name);
    console.log(`\n[${i + 1}/${meetings.length}] ${date} — ${mtg.name.slice(0, 60)}`);

    await sleep(DELAY_MS);
    const agendaHtml = await bdPost('BD-GetAgenda', `id=${mtg.unique}&current_committee_id=${COMMITTEE_ID}`);
    const { categories, items } = parseAgendaHtml(agendaHtml);
    console.log(`  ${categories.length} categories, ${items.length} items`);

    const itemsWithAttachments = items.filter(it => it.hasAttachment);
    if (itemsWithAttachments.length > 0) {
      console.log(`  Fetching attachments for ${itemsWithAttachments.length} items...`);
      for (const item of itemsWithAttachments) {
        await sleep(DELAY_MS);
        const filesHtml = await bdPost('BD-GetPublicFiles', `id=${item.unique}&current_committee_id=${COMMITTEE_ID}`);
        item.attachments = parsePublicFilesHtml(filesHtml);
        attachmentFetches++;
        totalAttachments += item.attachments.length;
      }
    }

    totalItems += items.length;

    results.push({
      date,
      name: mtg.name,
      type,
      unique: mtg.unique,
      unid: mtg.unid,
      url: `https://go.boarddocs.com/ca/redwood/Board.nsf/goto?open&id=${mtg.unique}`,
      categories: categories.map(c => ({ order: c.order, name: c.name })),
      items: items.map(it => ({
        order: it.order,
        title: it.title,
        actionType: it.actionType,
        category: it.categoryName,
        url: it.url,
        attachments: it.attachments,
      })),
    });
  }

  const outPath = resolve(__dirname, '../data/boarddocs-scraped.json');
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nDone! Wrote ${outPath}`);
  console.log(`  ${results.length} meetings, ${totalItems} agenda items, ${totalAttachments} attachments`);
  console.log(`  ${attachmentFetches} attachment API calls made`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
