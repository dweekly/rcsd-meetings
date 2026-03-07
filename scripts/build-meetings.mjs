#!/usr/bin/env node
/**
 * Build meetings-data.json from two sources:
 * 1. rcsd-meetings.md (23 Simbli meetings, Jun 2025 - Feb 2026)
 * 2. boarddocs-meetings.json (BoardDocs meetings, filtered to Mar 2024 - Jun 2025)
 *
 * Deduplicates Jun 11/18/25 2025 (Simbli wins).
 * Outputs: data/meetings-data.json
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---- Parse Simbli meetings from rcsd-meetings.md ----

const md = readFileSync(resolve(ROOT, 'sources/rcsd-meetings.md'), 'utf-8');

// Parse the index table
const tableRows = md.match(/\| \d{2}\/\d{2}\/\d{4} .+/g) || [];

function parseMdDate(s) {
  // "02/26/2026" -> "2026-02-26"
  const [mm, dd, yyyy] = s.split('/');
  return `${yyyy}-${mm}-${dd}`;
}

function extractYoutubeId(s) {
  const m = s.match(/watch\?v=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

// Parse detailed sections for topics and attachments
function parseDetailedSections(md) {
  const sections = {};
  const sectionRegex = /### (\d{2}\/\d{2}\/\d{4}) — (.+?) \(MID (\d+)\)/g;
  let match;
  while ((match = sectionRegex.exec(md)) !== null) {
    const date = parseMdDate(match[1]);
    const mid = match[3];
    // Find the content until the next --- or ### or end
    const startIdx = match.index + match[0].length;
    const nextSection = md.indexOf('\n---', startIdx);
    const content = nextSection > 0 ? md.slice(startIdx, nextSection) : md.slice(startIdx);

    // Extract key items
    const items = [];
    const itemRegex = /^\d+\.\s+(.+)/gm;
    let itemMatch;
    while ((itemMatch = itemRegex.exec(content)) !== null) {
      const title = itemMatch[1].replace(/\*\*/g, '').trim();
      // Find attachments for this item
      const attachments = [];
      const afterItem = content.slice(itemMatch.index + itemMatch[0].length);
      const nextItem = afterItem.search(/^\d+\./m);
      const itemBlock = nextItem > 0 ? afterItem.slice(0, nextItem) : afterItem.slice(0, 500);
      const attachRegex = /\[(.+?)\]\(https:\/\/simbli\.eboardsolutions\.com\/Meetings\/Attachment\.aspx\?S=36030397&AID=(\d+)&MID=\d+\)/g;
      let attMatch;
      while ((attMatch = attachRegex.exec(itemBlock)) !== null) {
        attachments.push({ title: attMatch[1], aid: attMatch[2] });
      }
      items.push({ title, attachments });
    }

    // Extract Simbli URL
    const simbliMatch = content.match(/\*\*Simbli:\*\*\s+(https:\/\/simbli[^\s]+)/);

    // Extract Zoom URL
    const zoomMatch = content.match(/https:\/\/rcsdk8-net\.zoom\.us\/\S+/);

    sections[date] = { mid, items, simbliUrl: simbliMatch ? simbliMatch[1] : null, zoom: zoomMatch ? zoomMatch[0] : null };
  }
  return sections;
}

const detailedSections = parseDetailedSections(md);

// Thread classification based on topics
function classifyThreads(topics, type, date) {
  const threads = [];
  const t = (topics || '').toLowerCase();

  if (t.includes('superintendent search') || t.includes('search firm') || t.includes('search process') ||
      t.includes('superintendent contract') || t.includes('new superintendent') ||
      (type === 'Special (Closed)' && date >= '2025-11-01')) {
    threads.push('superintendent-search');
  }
  if (t.includes('budget') || t.includes('resource alignment') || t.includes('first interim') ||
      t.includes('budget reduction') || t.includes('strategic resource')) {
    threads.push('budget');
  }
  if (t.includes('parcel tax') || t.includes('local funding measure') || t.includes('ballot measure') ||
      t.includes('parcel tax renewal') || t.includes('teamcivx') || t.includes('tax election')) {
    threads.push('parcel-tax');
  }
  if (t.includes('bond') || t.includes('measure s') || t.includes('measure t') ||
      t.includes('facilities master plan') || t.includes('hvac') || t.includes('solar') ||
      t.includes('blach') || t.includes('siemens') || t.includes('construction') ||
      t.includes('implementation plan') || t.includes('lease-leaseback') ||
      t.includes('notice of completion') || t.includes('facilities lease')) {
    threads.push('facilities-bond');
  }
  if (t.includes('policy') || t.includes('readings') || t.includes('first reading') || t.includes('second reading')) {
    threads.push('policy');
  }
  if (t.includes('lcap')) {
    threads.push('budget');
  }
  if (t.includes('charter')) {
    threads.push('charter');
  }
  return [...new Set(threads)];
}

// Build Simbli meetings
const simbliMeetings = tableRows.map(row => {
  // | 02/26/2026 | Special | 56022 | [Video](...) | Parcel tax... |
  const cells = row.split('|').map(c => c.trim()).filter(Boolean);
  if (cells.length < 5) return null;

  const date = parseMdDate(cells[0]);
  const type = cells[1];
  const mid = cells[2];
  const youtubeId = extractYoutubeId(cells[3]);
  const topics = cells[4];

  const detail = detailedSections[date];
  const simbliUrl = detail?.simbliUrl ||
    `https://simbli.eboardsolutions.com/SB_Meetings/ViewMeeting.aspx?S=36030397&MID=${mid}`;

  return {
    date,
    type,
    source: 'simbli',
    mid,
    slug: `${date}-${type.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}`,
    youtube: youtubeId,
    simbli: simbliUrl,
    boarddocs: null,
    zoom: detail?.zoom || null,
    topics: topics ? [topics] : [],
    threads: classifyThreads(topics, type, date),
    items: detail?.items || []
  };
}).filter(Boolean);

// ---- Parse BoardDocs meetings (enriched with scraped data) ----

const boarddocsRaw = JSON.parse(readFileSync(
  resolve(ROOT, 'sources/boarddocs-meetings.json'), 'utf-8'
));

// Load scraped agenda data if available
let scrapedByDate = {};
try {
  const scraped = JSON.parse(readFileSync(resolve(ROOT, 'data/boarddocs-scraped.json'), 'utf-8'));
  scrapedByDate = Object.fromEntries(scraped.map(m => [m.date, m]));
  console.log(`Loaded scraped data for ${scraped.length} meetings`);
} catch {
  console.log('No scraped BoardDocs data found (run scrape-boarddocs.mjs first)');
}

function parseBoarddocsDate(s) {
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

// Generate topic summary from substantive agenda items
function extractTopics(items) {
  const skipCategories = [
    'call to order', 'oral communication', 'reconvene', 'welcome',
    'changes to the agenda', 'pledge of allegiance', 'approval of agenda',
    'adjournment', 'closed session', 'report out', 'board member reports',
    'superintendent report', 'approval of consent',
  ];
  return items
    .filter(it => {
      const cat = (it.category || '').toLowerCase();
      const title = (it.title || '').toLowerCase();
      // Skip procedural items and boilerplate
      if (it.actionType === 'Procedural') return false;
      if (skipCategories.some(s => cat.includes(s) || title.includes(s))) return false;
      if (title.includes('roll call') || title.includes('public comment')) return false;
      // Keep action and information items with substantive titles
      return it.title.length > 10;
    })
    .map(it => it.title)
    .slice(0, 6); // Cap at 6 for display
}

// Filter to Mar 2024 - Jun 2025 (before Simbli overlap)
const simbliDates = new Set(simbliMeetings.map(m => m.date));

const boarddocsMeetings = boarddocsRaw
  .filter(m => m.date != null)
  .map(m => ({
    ...m,
    isoDate: parseBoarddocsDate(m.date)
  }))
  .filter(m => m.isoDate >= '2024-03-01' && m.isoDate <= '2025-06-10')
  .filter(m => !simbliDates.has(m.isoDate))
  .map(m => {
    const scraped = scrapedByDate[m.isoDate];
    const name = (scraped?.name || '').toLowerCase();
    const type = name.includes('retreat') ? 'Retreat (Offsite)'
      : scraped ? scraped.type : 'Board Meeting';
    const items = scraped ? scraped.items : [];
    const topics = scraped ? extractTopics(items) : [];
    const slug = `${m.isoDate}-${type.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}`;

    return {
      date: m.isoDate,
      type,
      source: 'boarddocs',
      mid: null,
      slug,
      youtube: null,
      simbli: null,
      boarddocs: scraped?.url || `https://go.boarddocs.com/ca/redwood/Board.nsf/goto?open&id=${m.unid}`,
      topics,
      threads: classifyThreads(topics.join(' '), type, m.isoDate),
      items: items.map(it => ({
        title: it.title,
        order: it.order || undefined,
        actionType: it.actionType || undefined,
        category: it.category || undefined,
        attachments: (it.attachments || []).map(a => ({
          title: a.name,
          href: a.href,
          size: a.size,
        })),
      })),
    };
  });

// ---- Merge YouTube video IDs from youtube-index.json ----

const youtubeIndexPath = resolve(ROOT, 'data/youtube-index.json');
let youtubeByDate = {};
if (existsSync(youtubeIndexPath)) {
  const ytIndex = JSON.parse(readFileSync(youtubeIndexPath, 'utf-8'));
  youtubeByDate = Object.fromEntries(ytIndex.map(v => [v.date, v.id]));
  console.log(`Loaded YouTube index: ${ytIndex.length} videos`);
}

// ---- Load timestamp map ----

const timestampMapPath = resolve(ROOT, 'data/timestamp-map.json');
let timestampMap = {};
if (existsSync(timestampMapPath)) {
  timestampMap = JSON.parse(readFileSync(timestampMapPath, 'utf-8'));
  console.log(`Loaded timestamp map for ${Object.keys(timestampMap).length} meetings`);
}

// ---- Check which videos have transcripts + extract duration ----

// Manual duration overrides for meetings without transcripts/captions
const manualDurations = {
  '2026-02-11': { seconds: 6120, display: '1h 42m' }, // no auto-captions on YouTube
};

const transcriptDir = resolve(ROOT, 'artifacts/transcripts');
function hasTranscript(videoId) {
  if (!videoId) return false;
  return existsSync(resolve(transcriptDir, `${videoId}.en.srt`)) ||
         existsSync(resolve(transcriptDir, `${videoId}.en.vtt`));
}

function getDurationFromTranscript(videoId) {
  if (!videoId) return null;
  const srtPath = resolve(transcriptDir, `${videoId}.en.srt`);
  if (!existsSync(srtPath)) return null;
  const content = readFileSync(srtPath, 'utf-8');
  // Find last timestamp in SRT (format: HH:MM:SS,mmm --> HH:MM:SS,mmm)
  const timestamps = content.match(/(\d{2}:\d{2}:\d{2}),\d{3}\s*-->/g);
  if (!timestamps || timestamps.length === 0) return null;
  const last = timestamps[timestamps.length - 1].match(/(\d{2}):(\d{2}):(\d{2})/);
  if (!last) return null;
  const hours = parseInt(last[1]);
  const minutes = parseInt(last[2]);
  const seconds = parseInt(last[3]);
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  // Format as "Xh Ym" or "Ym"
  if (hours > 0) {
    return { seconds: totalSeconds, display: `${hours}h ${minutes}m` };
  }
  return { seconds: totalSeconds, display: `${minutes}m` };
}

// ---- Replace Simbli attachments with authoritative agenda PDF data ----

const agendaAttPath = resolve(ROOT, 'data/agenda-attachments.json');
if (existsSync(agendaAttPath)) {
  const agendaAtt = JSON.parse(readFileSync(agendaAttPath, 'utf-8'));
  let replaced = 0;
  for (const m of simbliMeetings) {
    const pdfData = agendaAtt[m.date];
    if (!pdfData) continue;

    // Build the real attachment list from agenda PDF links
    const pdfLinks = pdfData.attachments.map(a => ({
      title: a.title,
      aid: a.aid,
      url: a.url,
      page: a.page,
    }));

    // Clear fabricated attachments from all items
    for (const item of m.items) {
      item.attachments = [];
    }

    // Assign PDF attachments to items via keyword matching
    for (const link of pdfLinks) {
      const linkText = link.title.toLowerCase();
      let bestItem = null;
      let bestScore = 0;

      for (const item of m.items) {
        const itemTitle = item.title.toLowerCase();
        // Score: count matching significant words
        const itemWords = itemTitle.split(/\s+/).filter(w => w.length > 3);
        let score = 0;
        for (const w of itemWords) {
          if (linkText.includes(w)) score++;
        }
        // Boost for number matches (e.g., "3510", "9324", "16")
        const itemNums = itemTitle.match(/\d{3,}/g) || [];
        for (const n of itemNums) {
          if (linkText.includes(n)) score += 3;
        }
        if (score > bestScore) {
          bestScore = score;
          bestItem = item;
        }
      }

      if (bestItem && bestScore >= 2) {
        bestItem.attachments.push({ title: link.title, aid: link.aid });
      } else {
        // Unmatched -- add to a meeting-level bucket
        if (!m.extraAttachments) m.extraAttachments = [];
        m.extraAttachments.push({ title: link.title, aid: link.aid });
      }
    }
    replaced++;
  }
  console.log(`Replaced attachments for ${replaced} Simbli meetings from agenda PDFs (${Object.keys(agendaAtt).length} available)`);
} else {
  console.log('No agenda-attachments.json found (run extract-agenda-links.py first)');
}

// ---- Merge and sort ----

const allMeetings = [...simbliMeetings, ...boarddocsMeetings]
  .sort((a, b) => b.date.localeCompare(a.date)); // Reverse chronological

// Merge YouTube IDs and timestamps into all meetings
for (const m of allMeetings) {
  // Fill in YouTube ID from youtube-index.json if not already set
  if (!m.youtube && youtubeByDate[m.date]) {
    m.youtube = youtubeByDate[m.date];
  }

  // Mark if transcript is available + extract duration
  m.hasTranscript = hasTranscript(m.youtube);
  const dur = getDurationFromTranscript(m.youtube) || manualDurations[m.date];
  if (dur) {
    m.duration = dur.display;
    m.durationSeconds = dur.seconds;
  }

  // Merge timestamps into items
  const tsData = timestampMap[m.date];
  if (tsData && m.items) {
    for (let i = 0; i < m.items.length; i++) {
      if (tsData.items[i]) {
        m.items[i].timestamp = tsData.items[i].timestamp;
        m.items[i].timestampSeconds = tsData.items[i].timestampSeconds;
      }
    }
  }
}

// ---- Extract minutes linkage ----
// For each meeting, find where its minutes were approved and link to the PDF

function parseSimbliMinutesDates(title, approvalMeetingDate) {
  const monthNums = {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
    'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12',
  };
  const approvalYear = parseInt(approvalMeetingDate.slice(0, 4));
  const approvalMonth = parseInt(approvalMeetingDate.slice(5, 7));
  const dates = [];

  // Match "MonthName DD[, DD, DD]" patterns
  const monthPattern = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec';
  const regex = new RegExp(`(${monthPattern})\\w*\\s+(\\d{1,2}(?:[\\s,]+(?:and\\s+)?\\d{1,2})*)`, 'gi');

  let match;
  while ((match = regex.exec(title)) !== null) {
    const monthKey = match[1].toLowerCase().slice(0, 3);
    const monthNum = monthNums[monthKey];
    if (!monthNum) continue;

    const days = match[2].match(/\d{1,2}/g) || [];
    const afterDays = title.slice(match.index + match[0].length);
    const yearMatch = afterDays.match(/^[,\s]*(\d{4})/);

    const monthInt = parseInt(monthNum);
    for (const d of days) {
      const dayNum = parseInt(d);
      if (dayNum < 1 || dayNum > 31) continue;
      let year = yearMatch ? parseInt(yearMatch[1]) : approvalYear;
      if (!yearMatch && monthInt > approvalMonth) year--;
      dates.push(`${year}-${monthNum}-${String(dayNum).padStart(2, '0')}`);
    }
  }

  return [...new Set(dates)];
}

const minutesIndex = {}; // meetingDate -> { approvedAt, documents[] }

for (const m of allMeetings) {
  for (const item of (m.items || [])) {
    const title = (item.title || '').toLowerCase();
    if (!title.includes('minutes') || !title.includes('approv')) continue;
    // Skip policy items that mention "Minutes" in their name
    if (title.includes('bb 9324') || title.includes('policy') || title.includes('first reading')) continue;

    // BoardDocs: parse date from PDF filename
    for (const att of (item.attachments || [])) {
      const name = att.title || att.name || '';
      const dateMatch = name.match(/^(\d{4})\.(\d{2})\.(\d{2})\s+Minutes/i);
      if (dateMatch) {
        const minutesForDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
        if (!minutesIndex[minutesForDate]) {
          minutesIndex[minutesForDate] = { approvedAt: m.date, documents: [] };
        }
        const href = att.href || (att.aid ? `https://simbli.eboardsolutions.com/Meetings/Attachment.aspx?S=36030397&AID=${att.aid}&MID=${m.mid}` : undefined);
        minutesIndex[minutesForDate].documents.push({
          title: name,
          href,
          size: att.size,
        });
      }
    }

    // Simbli: parse dates from item title text (no PDFs)
    if (m.source === 'simbli') {
      const parsed = parseSimbliMinutesDates(item.title, m.date);
      for (const d of parsed) {
        if (!minutesIndex[d]) {
          minutesIndex[d] = { approvedAt: m.date, documents: [] };
        }
      }
    }
  }
}

// Merge Simbli minutes AIDs (extracted from PDF annotation layers)
const minutesAidsPath = resolve(ROOT, 'data/minutes-aids.json');
if (existsSync(minutesAidsPath)) {
  const minutesAids = JSON.parse(readFileSync(minutesAidsPath, 'utf-8'));
  let merged = 0;
  for (const [date, info] of Object.entries(minutesAids)) {
    if (date.includes('-amended')) continue; // skip amended versions
    const baseUrl = `https://simbli.eboardsolutions.com//Meetings/Attachment.aspx?S=36030397&AID=${info.aid}`;
    if (!minutesIndex[date]) {
      minutesIndex[date] = { approvedAt: info.approved_at, documents: [] };
    }
    // Only add if no documents exist yet (don't duplicate BoardDocs PDFs)
    if (minutesIndex[date].documents.length === 0) {
      minutesIndex[date].documents.push({
        title: info.title,
        href: baseUrl,
      });
      merged++;
    }
  }
  console.log(`Merged ${merged} Simbli minutes AIDs from PDF extraction`);
}

// Inject minutes field into meetings
for (const m of allMeetings) {
  if (minutesIndex[m.date]) {
    m.minutes = minutesIndex[m.date];
  }
}

const withMinutes = allMeetings.filter(m => m.minutes).length;
console.log(`Mapped minutes for ${withMinutes} meetings (${allMeetings.filter(m => m.minutes?.documents.length > 0).length} with PDFs)`);

// Count stats
const withVideo = allMeetings.filter(m => m.youtube).length;
const withTranscript = allMeetings.filter(m => m.hasTranscript).length;
const total = allMeetings.length;
const totalItems = allMeetings.reduce((sum, m) => sum + (m.items?.length || 0), 0);
const totalAttachments = allMeetings.reduce((sum, m) =>
  sum + (m.items || []).reduce((s, it) => s + (it.attachments?.length || 0), 0)
  + (m.extraAttachments?.length || 0), 0);

const output = {
  generated: new Date().toISOString().split('T')[0],
  stats: {
    total,
    withVideo,
    withTranscript,
    withMinutes,
    totalItems,
    totalAttachments,
    simbli: simbliMeetings.length,
    boarddocs: boarddocsMeetings.length
  },
  meetings: allMeetings
};

const outPath = resolve(ROOT, 'data/meetings-data.json');
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`Wrote ${total} meetings (${withVideo} with video, ${withTranscript} with transcript, ${totalItems} items, ${totalAttachments} attachments) to ${outPath}`);
