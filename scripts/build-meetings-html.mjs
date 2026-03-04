#!/usr/bin/env node
/**
 * Generate docs/index.html from data/meetings-data.json
 * Run after build-meetings.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const data = JSON.parse(readFileSync(resolve(ROOT, 'data/meetings-data.json'), 'utf-8'));

// Load optional hand-crafted summaries (override auto-generated)
const summariesPath = resolve(ROOT, 'data/meeting-summaries.json');
let manualSummaries = {};
if (existsSync(summariesPath)) {
  manualSummaries = JSON.parse(readFileSync(summariesPath, 'utf-8'));
  console.log(`Loaded ${Object.keys(manualSummaries).length} manual summaries`);
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatDateBadge(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return { month: MONTH_NAMES[parseInt(m) - 1].toUpperCase(), day: parseInt(d), year: y };
}

function monthYear(dateStr) {
  const [y, m] = dateStr.split('-');
  return `${MONTH_FULL[parseInt(m) - 1]} ${y}`;
}

function monthKey(dateStr) {
  return dateStr.slice(0, 7);
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const THREAD_LABELS = {
  'superintendent-search': 'Superintendent Search',
  'budget': 'Budget & Resource Alignment',
  'parcel-tax': '2026 Parcel Tax',
  'facilities-bond': 'Facilities Bonds (Measure S/T)',
  'policy': 'Policy Updates',
  'charter': 'Charter School Oversight'
};

const THREAD_DESCRIPTIONS = {
  'superintendent-search': 'National search and selection of Dr. Christian Rubalcaba',
  'budget': 'Strategic resource alignment and budget reduction planning',
  'parcel-tax': 'Parcel tax polling, resolution, and June 2026 election',
  'facilities-bond': 'Measure S/T facilities, HVAC upgrades, solar, and Facilities Master Plan',
  'policy': 'Two-reading policy update cycle across facilities, student welfare, employment',
  'charter': 'Connect, KIPP, and Rocketship oversight and financial reviews'
};

// Count threads
const threadCounts = {};
data.meetings.forEach(m => m.threads.forEach(t => {
  threadCounts[t] = (threadCounts[t] || 0) + 1;
}));

// Split into school years
const sy2526 = data.meetings.filter(m => m.date >= '2025-06-11');
const sy2425 = data.meetings.filter(m => m.date < '2025-06-11');

// Group by month
function groupByMonth(meetings) {
  const groups = new Map();
  for (const m of meetings) {
    const key = monthKey(m.date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  return groups;
}

// ---- Summary generation ----

function generateSummary(m) {
  // Manual override first
  if (manualSummaries[m.date]) return manualSummaries[m.date];

  // Use topics (already curated for Simbli, auto-extracted for BoardDocs)
  if (m.topics && m.topics.length > 0 && m.topics[0]) {
    return m.topics.join('; ');
  }

  // Fallback: generate from substantive items
  if (!m.items || m.items.length === 0) return null;
  const sub = m.source === 'boarddocs' ? m.items.filter(isSubstantiveItem) : m.items;
  if (sub.length === 0) return null;
  return sub.slice(0, 5).map(it => it.title).join('; ');
}

function highlightSummary(text) {
  let html = escapeHtml(text);
  // Highlight dollar amounts
  html = html.replace(/\$[\d,.]+[MKBmkb]?(?:\/\w+)?/g, '<strong>$&</strong>');
  // Highlight key terms (case-insensitive, word boundary)
  const terms = [
    'superintendent', 'parcel tax', 'budget reduction', 'strategic resource alignment',
    'LCAP', 'Measure S', 'Measure T', 'Facilities Master Plan',
  ];
  for (const term of terms) {
    const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    html = html.replace(re, '<strong>$1</strong>');
  }
  // Highlight Resolution numbers
  html = html.replace(/Resolution\s+(?:No\.?\s*)?\d+/gi, '<strong>$&</strong>');
  // Highlight Res NN-NN patterns
  html = html.replace(/\bRes\.?\s+\d+[-–]\d+/gi, '<strong>$&</strong>');
  return html;
}

// ---- Agenda item rendering ----
// Render expandable agenda items
// Filter to substantive items only (skip procedural boilerplate and routine consent items)
function isSubstantiveItem(item) {
  const title = (item.title || '').toLowerCase();
  const cat = (item.category || '').toLowerCase();
  const actionType = item.actionType || '';

  // Always skip procedural and consent-calendar items
  if (actionType === 'Procedural') return false;
  if (actionType === 'Action (Consent)') return false;

  // Skip boilerplate by title
  const skipTitles = [
    'roll call', 'approval of agenda', 'approval of consent', 'adjourn',
    'pledge of allegiance', 'welcome by', 'additions, deletions',
    'changes to the agenda', 'public comment', 'oral communication',
    'correspondence', 'possible other business', 'suggested items for future',
    'report from board members', 'reconvene', 'return to open session',
    'report out of closed session', 'approval of minutes',
    'ratification of warrant', 'information on san mateo county investment',
    'approval of personnel changes', 'changes to the board meetings calendar',
    'rejection of claim', 'quarterly williams report',
  ];
  if (skipTitles.some(s => title.includes(s))) return false;

  // Skip boilerplate categories
  const skipCats = [
    'call to order', 'oral communication', 'reconvene', 'welcome',
    'pledge of allegiance', 'adjournment', 'closed session', 'report out',
    'consent', 'approval of consent',
  ];
  if (skipCats.some(s => cat.includes(s))) return false;

  // Skip routine consent-style items: individual contract/agreement approvals,
  // bid awards, service agreements (keep resolutions, plans, presentations)
  const isRoutineApproval =
    (title.startsWith('approval of the agreement') ||
     title.startsWith('approval of agreement') ||
     title.startsWith('approval of service agreement') ||
     title.startsWith('approval of the memorandum') ||
     title.startsWith('award of bid') ||
     title.startsWith('approval of the ') && title.includes(' quote'));
  // But keep items with "resolution", "plan", "report", "presentation", "budget", "lcap"
  const isHighSignal =
    title.includes('resolution') || title.includes('plan') ||
    title.includes('budget') || title.includes('lcap') ||
    title.includes('presentation') || title.includes('measure') ||
    title.includes('parcel tax') || title.includes('bond') ||
    title.includes('charter') || title.includes('superintendent') ||
    title.includes('facilities master') || title.includes('tentative agreement');
  if (isRoutineApproval && !isHighSignal) return false;

  // Skip very short titles (likely procedural)
  if (item.title && item.title.length <= 10) return false;

  return true;
}

function renderAgendaItems(m) {
  if (!m.items || m.items.length === 0) return '';

  // For BoardDocs meetings, filter to substantive items only
  const items = m.source === 'boarddocs'
    ? m.items.filter(isSubstantiveItem)
    : m.items;

  if (items.length === 0) return '';

  let itemsHtml = '';
  for (const item of items) {
    const title = item.title || '';

    const order = item.order ? `<span class="agenda-item-order">${escapeHtml(item.order)}</span>` : '';
    const typeLabel = item.actionType && item.actionType !== 'Information' ?
      `<span class="agenda-item-type">${escapeHtml(item.actionType)}</span>` : '';

    // Timestamp link if available
    const tsLink = (item.timestampSeconds != null && m.youtube)
      ? `<a class="agenda-timestamp" href="https://www.youtube.com/watch?v=${m.youtube}&t=${item.timestampSeconds}" target="_blank" rel="noopener">${escapeHtml(item.timestamp)}</a>`
      : '';

    itemsHtml += `<div class="agenda-item">${order}${tsLink}${escapeHtml(title)}${typeLabel}</div>`;

    // Render attachments
    if (item.attachments && item.attachments.length > 0) {
      itemsHtml += '<div class="agenda-attachments">';
      for (const att of item.attachments) {
        const name = att.title || att.name || 'Attachment';
        const href = att.href || (att.aid ? `https://simbli.eboardsolutions.com/Meetings/Attachment.aspx?S=36030397&AID=${att.aid}&MID=${m.mid}` : '#');
        const size = att.size ? ` <span class="agenda-attachment-size">(${att.size})</span>` : '';
        itemsHtml += `<a class="agenda-attachment" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(name)}${size}</a>`;
      }
      itemsHtml += '</div>';
    }
  }

  // Render extra (unmatched) attachments at meeting level
  if (m.extraAttachments && m.extraAttachments.length > 0) {
    itemsHtml += '<div class="agenda-item" style="opacity:0.7">Other Attachments</div>';
    itemsHtml += '<div class="agenda-attachments">';
    for (const att of m.extraAttachments) {
      const name = att.title || 'Attachment';
      const href = att.href || (att.aid ? `https://simbli.eboardsolutions.com/Meetings/Attachment.aspx?S=36030397&AID=${att.aid}&MID=${m.mid}` : '#');
      itemsHtml += `<a class="agenda-attachment" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(name)}</a>`;
    }
    itemsHtml += '</div>';
  }

  if (!itemsHtml) return '';

  return `<div class="meeting-agenda-items open">${itemsHtml}</div>`;
}

// Render a single meeting row
// Classify meeting type for visual treatment
function meetingTypeClass(type) {
  const t = type.toLowerCase();
  if (t.includes('study') || t.includes('workshop')) return 'study';
  if (t.includes('special') || t.includes('emergency') || t.includes('closed')) return 'special';
  if (t.includes('retreat') || t.includes('offsite')) return 'offsite';
  return '';
}

function renderMeeting(m) {
  const { month, day, year } = formatDateBadge(m.date);
  const isSparse = m.source === 'boarddocs' && (!m.items || m.items.length === 0);
  const threadAttrs = m.threads.length ? ` data-threads="${m.threads.join(' ')}"` : '';
  const sparseClass = isSparse ? ' meeting-row--sparse' : '';
  const typeClass = meetingTypeClass(m.type);
  const typeModifier = typeClass ? ` meeting-row--${typeClass}` : '';

  let links = '';
  if (m.youtube) {
    links += `<a href="https://www.youtube.com/watch?v=${m.youtube}" class="meeting-link meeting-link--video" target="_blank" rel="noopener">&#9654; Video</a>`;
  }
  if (m.simbli) {
    links += `<a href="${escapeHtml(m.simbli)}" class="meeting-link meeting-link--agenda" target="_blank" rel="noopener">&#8599; Agenda</a>`;
  }
  if (m.minutes) {
    if (m.minutes.documents && m.minutes.documents.length > 0 && m.minutes.documents[0].href) {
      const doc = m.minutes.documents[0];
      links += `<a href="${escapeHtml(doc.href)}" class="meeting-link meeting-link--minutes" target="_blank" rel="noopener">&#128196; Minutes</a>`;
    } else if (m.minutes.approvedAt) {
      // No direct PDF — link to the approving meeting's Simbli page where the minutes attachment lives
      const approver = data.meetings.find(x => x.date === m.minutes.approvedAt);
      const approverUrl = approver?.simbli || approver?.boarddocs;
      if (approverUrl) {
        links += `<a href="${escapeHtml(approverUrl)}" class="meeting-link meeting-link--minutes" target="_blank" rel="noopener" title="Minutes approved ${m.minutes.approvedAt}">&#128196; Minutes</a>`;
      }
    }
  }
  if (m.boarddocs) {
    links += `<a href="${escapeHtml(m.boarddocs)}" class="meeting-link meeting-link--agenda" target="_blank" rel="noopener">&#8599; Agenda</a>`;
  }

  let threadTags = '';
  if (m.threads.length) {
    threadTags = '<div class="meeting-threads">' +
      m.threads.map(t => `<span class="meeting-thread-tag" data-thread="${t}">${THREAD_LABELS[t] || t}</span>`).join('') +
      '</div>';
  }

  // Summary paragraph (replaces topic bullets)
  const summary = generateSummary(m);
  const summaryHtml = summary
    ? `<p class="meeting-summary">${highlightSummary(summary)}</p>`
    : '';

  // Agenda items in accordion
  const agendaSection = renderAgendaItems(m);
  const itemCount = m.source === 'boarddocs'
    ? (m.items || []).filter(isSubstantiveItem).length
    : (m.items || []).length;
  const accordionHtml = agendaSection
    ? `<details class="meeting-details"><summary class="meeting-details-toggle">${itemCount} agenda item${itemCount === 1 ? '' : 's'}</summary>${agendaSection}</details>`
    : '';

  return `    <div class="meeting-row${sparseClass}${typeModifier}"${threadAttrs}>
      <div class="meeting-date">
        <span class="meeting-date-month">${month}</span>
        <span class="meeting-date-day">${day}</span>
        <span class="meeting-date-year">${year}</span>
      </div>
      <div class="meeting-body">
        <div class="meeting-header">
          <span class="meeting-type">${escapeHtml(m.type)}</span>${m.duration ? `<span class="meeting-duration">${m.duration}</span>` : ''}
          <div class="meeting-links">${links}</div>
        </div>
        ${threadTags}
        ${summaryHtml}
        ${accordionHtml}
      </div>
    </div>`;
}

// Officer rotation annotations (date = first meeting UNDER the new officers)
const OFFICER_ROTATIONS = [
  {
    afterDate: '2025-12-17',
    previous: { president: 'Mike Wells', vp: 'David Weekly', clerk: 'Cecilia I. M\u00e1rquez' },
  },
  {
    afterDate: '2024-12-17',
    previous: { president: 'Janet Lawson', vp: 'Mike Wells' },
    note: 'Trustees Lawson (9 yrs) and MacAvoy (17 yrs) departed; Li and Ng Kwing King sworn in',
  },
];

function renderRotationDivider(rotation) {
  const p = rotation.previous;
  let officers = `<strong>${p.president}</strong> (President), <strong>${p.vp}</strong> (Vice President)`;
  if (p.clerk) officers += `, <strong>${p.clerk}</strong> (Clerk)`;
  const note = rotation.note ? `<br><span style="opacity:0.7">${rotation.note}</span>` : '';
  return `    <div class="rotation-divider">
      <span class="rotation-divider-icon">\u21BB</span>
      <div class="rotation-divider-text">
        <div class="rotation-divider-label">Annual Officer Rotation &middot; Per Board Bylaws</div>
        Meetings below: ${officers}${note}
      </div>
    </div>`;
}

// Render a school year section
function renderSchoolYear(id, title, meetings, subtitle) {
  const meetingRows = [];
  for (const m of meetings) {
    meetingRows.push(renderMeeting(m));
    // Insert rotation divider after the rotation meeting
    for (const rot of OFFICER_ROTATIONS) {
      if (m.date === rot.afterDate) {
        meetingRows.push(renderRotationDivider(rot));
      }
    }
  }

  let html = `<section class="section" id="${id}">
  <div class="section-rule"></div>
  <h2>${title}</h2>
  ${subtitle ? `<p class="section-subtitle">${subtitle}</p>` : ''}
  <div class="meeting-list">
${meetingRows.join('\n')}
  </div>
</section>`;
  return html;
}

// Thread filter section
function renderThreadFilters() {
  const threads = ['superintendent-search', 'budget', 'parcel-tax', 'facilities-bond', 'policy'];
  return `<section class="section" id="threads">
  <div class="section-rule"></div>
  <h2>Key Topics This Year</h2>
  <p>Click a topic to filter meetings. Click again to show all.</p>
  <div class="thread-filters">
${threads.map(t => `    <button class="thread-btn" data-filter="${t}">
      <span class="thread-btn-label">${THREAD_LABELS[t]}</span>
      <span class="thread-btn-count">${threadCounts[t] || 0}</span>
    </button>`).join('\n')}
  </div>
</section>`;
}

// Governance calendar — most recent "Schedule of Board Agenda Items"
function findGovernanceCalendar(data) {
  // Find the most recent schedule attachment across all meetings
  let latest = null;
  for (const m of data.meetings) {
    const allAtts = [
      ...((m.items || []).flatMap(it => (it.attachments || []).map(a => ({ ...a, date: m.date, mid: m.mid })))),
      ...((m.extraAttachments || []).map(a => ({ ...a, date: m.date, mid: m.mid }))),
    ];
    for (const att of allAtts) {
      if ((att.title || '').toLowerCase().includes('schedule of board agenda')) {
        if (!latest || att.date > latest.date) {
          latest = att;
        }
      }
    }
  }
  if (!latest) return null;

  const href = latest.href || (latest.aid ? `https://simbli.eboardsolutions.com/Meetings/Attachment.aspx?S=36030397&AID=${latest.aid}&MID=${latest.mid}` : null);
  if (!href) return null;

  return { date: latest.date, href };
}

// Resources section
function renderResources(data) {
  // Find governance calendar PDF from most recent meeting that has one
  let govCalCard = '';
  const govCal = findGovernanceCalendar(data);
  if (govCal) {
    const [y, m, d] = govCal.date.split('-');
    const dateStr = `${MONTH_FULL[parseInt(m) - 1]} ${parseInt(d)}, ${y}`;
    govCalCard = `
    <div class="resource-card">
      <h3>Governance Calendar</h3>
      <p>Planned board agenda items for the school year. From the ${dateStr} agenda.</p>
      <a href="${escapeHtml(govCal.href)}" target="_blank" rel="noopener">View Schedule (PDF) &#8599;</a>
    </div>`;
  }

  return `<section class="section" id="resources">
  <div class="section-rule"></div>
  <h2>Resources</h2>
  <div class="resource-grid">${govCalCard}
    <div class="resource-card">
      <h3>Board Meeting Portal</h3>
      <p>Current agendas and attachments on GAMUT/Simbli.</p>
      <a href="https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030397" target="_blank" rel="noopener">simbli.eboardsolutions.com &#8599;</a>
    </div>
    <div class="resource-card">
      <h3>BoardDocs Archive</h3>
      <p>Meeting agendas before June 2025.</p>
      <a href="https://go.boarddocs.com/ca/redwood/Board.nsf/goto?open&id=CVLPDX62089F" target="_blank" rel="noopener">go.boarddocs.com &#8599;</a>
    </div>
    <div class="resource-card">
      <h3>YouTube Channel</h3>
      <p>Video recordings of public board meetings.</p>
      <a href="https://www.youtube.com/@redwoodcityschooldistrict" target="_blank" rel="noopener">youtube.com &#8599;</a>
    </div>
    <div class="resource-card">
      <h3>District Website</h3>
      <p>Official RCSD information and announcements.</p>
      <a href="https://www.rcsdk8.net" target="_blank" rel="noopener">rcsdk8.net &#8599;</a>
    </div>
  </div>
</section>`;
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="index, follow">
<title>RCSD Board Meeting Index</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,600;0,9..144,700;1,9..144,400&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,400&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --green-deep: #1a3a2a;
    --green-mid: #2d5a3f;
    --green-light: #4a8c6a;
    --green-pale: #dcebd5;
    --green-wash: #f0f6ed;
    --cream: #faf8f4;
    --cream-dark: #f2efe8;
    --amber: #c4842d;
    --amber-light: #f0d9a8;
    --coral: #c45d4a;
    --coral-light: #f5ddd8;
    --text: #2a2a28;
    --text-secondary: #5a5a56;
    --text-muted: #8a8a84;
    --rule: #d4d0c8;
    --rule-light: #e8e4dc;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  html {
    font-size: 17px;
    scroll-behavior: smooth;
    background: var(--cream);
  }

  body {
    font-family: 'Newsreader', Georgia, serif;
    color: var(--text);
    line-height: 1.65;
    -webkit-font-smoothing: antialiased;
    background: var(--cream);
  }

  .section a {
    color: var(--green-mid);
    text-decoration-color: var(--rule);
    text-underline-offset: 2px;
    transition: color 0.15s, text-decoration-color 0.15s;
  }
  .section a:hover {
    color: var(--green-deep);
    text-decoration-color: var(--green-mid);
  }

  /* ---- HEADER ---- */
  .site-header {
    background: var(--green-deep);
    color: var(--cream);
    padding: 0;
    position: relative;
    overflow: hidden;
  }

  .site-header::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse at 20% 80%, rgba(74,140,106,0.3) 0%, transparent 60%),
      radial-gradient(ellipse at 80% 20%, rgba(196,132,45,0.15) 0%, transparent 50%);
    pointer-events: none;
  }

  .header-inner {
    max-width: 900px;
    margin: 0 auto;
    padding: 4rem 2rem 3.5rem;
    position: relative;
  }

  .header-district {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--green-light);
    margin-bottom: 1.2rem;
  }

  .header-title {
    font-family: 'Fraunces', Georgia, serif;
    font-size: clamp(2rem, 5vw, 3.2rem);
    font-weight: 300;
    line-height: 1.15;
    color: #fff;
    max-width: 600px;
    font-optical-sizing: auto;
  }

  .header-subtitle {
    margin-top: 1.5rem;
    font-size: 0.95rem;
    color: rgba(255,255,255,0.6);
    line-height: 1.6;
    max-width: 520px;
    font-style: italic;
  }

  .header-meta {
    margin-top: 2rem;
    display: flex;
    gap: 2rem;
    flex-wrap: wrap;
  }

  .header-stat {
    display: flex;
    flex-direction: column;
  }

  .header-stat-value {
    font-family: 'Fraunces', serif;
    font-size: 1.8rem;
    font-weight: 600;
    color: #fff;
    line-height: 1;
  }

  .header-stat-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.45);
    margin-top: 0.35rem;
  }

  /* ---- DISCLAIMER ---- */
  .disclaimer {
    background: #fff3cd;
    border-bottom: 2px solid #e0c36a;
    padding: 0.75rem 1.5rem;
    text-align: center;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.72rem;
    letter-spacing: 0.01em;
    line-height: 1.6;
    color: #664d03;
  }

  /* ---- NAV ---- */
  .toc {
    background: var(--cream-dark);
    border-bottom: 1px solid var(--rule);
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .toc-inner {
    max-width: 900px;
    margin: 0 auto;
    padding: 0 2rem;
    display: flex;
    gap: 0;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }

  .toc-inner::-webkit-scrollbar { display: none; }

  .toc a {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
    text-decoration: none;
    padding: 0.9rem 0.9rem;
    white-space: nowrap;
    border-bottom: 2px solid transparent;
    transition: color 0.2s, border-color 0.2s;
  }

  .toc a:hover {
    color: var(--green-mid);
    border-bottom-color: var(--green-light);
  }

  /* ---- MAIN ---- */
  .content {
    max-width: 900px;
    margin: 0 auto;
    padding: 0 2rem 6rem;
  }

  /* ---- SECTIONS ---- */
  .section {
    padding-top: 3.5rem;
  }

  .section-rule {
    width: 100%;
    height: 1px;
    background: var(--rule);
    margin-bottom: 0;
  }

  h2 {
    font-family: 'Fraunces', Georgia, serif;
    font-size: clamp(1.5rem, 3vw, 2rem);
    font-weight: 400;
    line-height: 1.2;
    color: var(--green-deep);
    margin-bottom: 1.5rem;
    font-optical-sizing: auto;
  }

  p {
    margin-bottom: 1rem;
    max-width: 640px;
  }

  .section-subtitle {
    font-size: 0.92rem;
    color: var(--text-secondary);
    margin-top: -0.8rem;
    margin-bottom: 2rem;
  }

  /* ---- THREAD FILTERS ---- */
  .thread-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 0.5rem;
  }

  .thread-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 1rem;
    border: 1px solid var(--rule);
    border-radius: 2rem;
    background: #fff;
    cursor: pointer;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.68rem;
    letter-spacing: 0.02em;
    color: var(--text-secondary);
    transition: all 0.15s;
  }

  .thread-btn:hover {
    border-color: var(--green-light);
    color: var(--green-mid);
    background: var(--green-wash);
  }

  .thread-btn.active {
    border-color: var(--green-mid);
    background: var(--green-deep);
    color: #fff;
  }

  .thread-btn-count {
    background: var(--cream-dark);
    padding: 0.15rem 0.45rem;
    border-radius: 1rem;
    font-size: 0.6rem;
    font-weight: 500;
  }

  .thread-btn.active .thread-btn-count {
    background: rgba(255,255,255,0.2);
    color: #fff;
  }

  /* ---- MEETING LIST ---- */
  .meeting-list {
    margin-top: 1.5rem;
  }

  /* ---- MEETING ROWS ---- */
  .meeting-row {
    display: flex;
    gap: 1.2rem;
    padding: 1rem 0;
    border-bottom: 1px solid var(--rule-light);
    transition: opacity 0.2s;
  }

  .meeting-row:last-child {
    border-bottom: none;
  }

  .meeting-row.hidden {
    display: none;
  }

  .meeting-row--sparse {
    opacity: 0.6;
  }

  .meeting-row--sparse:hover {
    opacity: 0.85;
  }

  /* Study sessions / workshops: indigo accent */
  .meeting-row--study {
    border-left: 3px solid #7c6caf;
    padding-left: 1rem;
  }

  .meeting-row--study .meeting-date-month {
    color: #7c6caf;
  }

  .meeting-row--study .meeting-type {
    color: #5b4d8a;
  }

  /* Special / closed / emergency: amber accent */
  .meeting-row--special {
    border-left: 3px solid var(--amber);
    padding-left: 1rem;
  }

  .meeting-row--special .meeting-date-month {
    color: var(--amber);
  }

  .meeting-row--special .meeting-type {
    color: #9a6a1e;
  }

  /* Retreat / offsite: teal accent */
  .meeting-row--offsite {
    border-left: 3px solid #3d8b8b;
    padding-left: 1rem;
  }

  .meeting-row--offsite .meeting-date-month {
    color: #3d8b8b;
  }

  .meeting-row--offsite .meeting-type {
    color: #2d6b6b;
  }

  /* ---- AGENDA ITEMS ---- */
  .meeting-agenda-items {
    display: block;
    margin-top: 0.5rem;
    padding-left: 0;
    list-style: none;
    border-left: 2px solid var(--rule-light);
    padding-left: 0.8rem;
  }

  .agenda-category {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-top: 0.6rem;
    margin-bottom: 0.15rem;
  }

  .agenda-category:first-child {
    margin-top: 0;
  }

  .agenda-item {
    font-size: 0.82rem;
    color: var(--text-secondary);
    line-height: 1.45;
    padding: 0.15rem 0;
  }

  .agenda-item-order {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
    color: var(--text-muted);
    margin-right: 0.3rem;
  }

  .agenda-item-type {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.55rem;
    color: var(--text-muted);
    background: var(--cream-dark);
    padding: 0.05rem 0.3rem;
    border-radius: 2px;
    margin-left: 0.3rem;
    vertical-align: middle;
  }

  .agenda-attachments {
    padding-left: 1.8rem;
    margin: 0.15rem 0 0.3rem;
  }

  .agenda-attachment {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    line-height: 1.6;
    color: var(--green-mid);
    text-decoration: none;
    display: block;
  }

  .agenda-attachment:hover {
    color: var(--green-deep);
    text-decoration: underline;
  }

  .agenda-attachment-size {
    color: var(--text-muted);
    font-size: 0.55rem;
  }

  .agenda-timestamp {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    color: var(--coral);
    text-decoration: none;
    margin-right: 0.4rem;
    white-space: nowrap;
  }

  .agenda-timestamp:hover {
    color: var(--green-deep);
    text-decoration: underline;
  }


  .meeting-date {
    flex-shrink: 0;
    width: 3rem;
    text-align: center;
    padding-top: 0.15rem;
  }

  .meeting-date-month {
    display: block;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
    font-weight: 500;
    letter-spacing: 0.12em;
    color: var(--green-light);
    line-height: 1;
  }

  .meeting-date-day {
    display: block;
    font-family: 'Fraunces', serif;
    font-size: 1.4rem;
    font-weight: 600;
    color: var(--green-deep);
    line-height: 1.1;
  }

  .meeting-date-year {
    display: block;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.5rem;
    color: var(--text-muted);
    opacity: 0.5;
    line-height: 1.4;
    letter-spacing: 0.04em;
  }

  .meeting-body {
    flex: 1;
    min-width: 0;
  }

  .meeting-header {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .meeting-type {
    font-family: 'Fraunces', serif;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
  }

  .meeting-duration {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
    color: var(--green-mid);
    opacity: 0.7;
  }

  /* ---- BOARD ROSTER ---- */
  .board-roster {
    margin-top: 2.2rem;
    padding-top: 1.5rem;
    border-top: 1px solid rgba(255,255,255,0.12);
  }

  .board-roster-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.4);
    margin-bottom: 0.6rem;
  }

  .board-roster-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 1.4rem;
    list-style: none;
  }

  .board-roster-list li {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    color: rgba(255,255,255,0.7);
    white-space: nowrap;
  }

  .board-roster-list .roster-role {
    color: rgba(255,255,255,0.4);
    font-size: 0.6rem;
  }

  /* ---- OFFICER ROTATION DIVIDER ---- */
  .rotation-divider {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin: 2rem 0 1.5rem;
    padding: 0.8rem 1rem;
    background: var(--cream-dark);
    border: 1px solid var(--rule-light);
    border-radius: 4px;
  }

  .rotation-divider-icon {
    font-size: 1rem;
    flex-shrink: 0;
  }

  .rotation-divider-text {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .rotation-divider-text strong {
    color: var(--text);
  }

  .rotation-divider-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: 0.2rem;
  }

  .meeting-links {
    display: flex;
    gap: 0.8rem;
    margin-left: auto;
  }

  .meeting-link {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 0.02em;
    text-decoration: none;
    white-space: nowrap;
    transition: color 0.15s;
  }

  .meeting-link--video {
    color: var(--coral);
  }

  .meeting-link--video:hover {
    color: var(--green-deep);
  }

  .meeting-link--agenda {
    color: var(--green-mid);
  }

  .meeting-link--agenda:hover {
    color: var(--green-deep);
  }

  .meeting-link--minutes {
    color: var(--amber);
  }

  .meeting-link--minutes:hover {
    color: var(--green-deep);
  }

  .meeting-threads {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-top: 0.35rem;
  }

  .meeting-thread-tag {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--green-mid);
    background: var(--green-wash);
    padding: 0.1rem 0.5rem;
    border-radius: 2px;
  }

  .meeting-summary {
    margin-top: 0.4rem;
    font-size: 0.88rem;
    color: var(--text-secondary);
    line-height: 1.55;
    max-width: none;
  }

  .meeting-summary strong {
    color: var(--text);
    font-weight: 500;
  }

  .meeting-details {
    margin-top: 0.5rem;
  }

  .meeting-details-toggle {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 0.02em;
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
    list-style: none;
    padding: 0.3rem 0;
  }

  .meeting-details-toggle::-webkit-details-marker { display: none; }
  .meeting-details-toggle::marker { display: none; content: ''; }

  .meeting-details-toggle::before {
    content: '\\25B8';
    display: inline-block;
    margin-right: 0.3rem;
    transition: transform 0.15s;
  }

  .meeting-details[open] > .meeting-details-toggle::before {
    transform: rotate(90deg);
  }

  .meeting-details-toggle:hover {
    color: var(--green-mid);
  }

  /* ---- RESOURCE GRID ---- */
  .resource-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    margin-top: 1rem;
  }

  .resource-card {
    border: 1px solid var(--rule);
    padding: 1.2rem;
    background: #fff;
  }

  .resource-card h3 {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
    margin: 0 0 0.4rem;
    line-height: 1.3;
  }

  .resource-card p {
    font-size: 0.82rem;
    color: var(--text-secondary);
    margin-bottom: 0.6rem;
    max-width: none;
  }

  .resource-card a {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
    color: var(--green-mid);
    text-decoration: none;
  }

  .resource-card a:hover {
    color: var(--green-deep);
    text-decoration: underline;
  }

  /* ---- FOOTER ---- */
  .site-footer {
    max-width: 900px;
    margin: 0 auto;
    padding: 2rem 2rem 4rem;
    border-top: 1px solid var(--rule);
    font-size: 0.8rem;
    color: var(--text-muted);
    font-style: italic;
  }

  .site-footer a {
    color: var(--green-mid);
  }

  .footer-nav {
    margin-top: 1rem;
    font-style: normal;
  }

  .footer-nav a {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.68rem;
    color: var(--green-mid);
    text-decoration: none;
    margin-right: 1.5rem;
  }

  .footer-nav a:hover {
    text-decoration: underline;
  }

  /* ---- RESPONSIVE ---- */
  @media (max-width: 640px) {
    html { font-size: 15px; }
    .header-inner { padding: 3rem 1.2rem 2.5rem; }
    .content { padding: 0 1.2rem 4rem; }
    .header-meta { gap: 1.5rem; }
    .toc a { padding: 0.8rem 0.6rem; font-size: 0.6rem; }
    .meeting-row { gap: 0.8rem; }
    .meeting-date { width: 2.6rem; }
    .meeting-date-day { font-size: 1.2rem; }
    .meeting-links { margin-left: 0; }
    .meeting-header { flex-direction: column; gap: 0.3rem; }
    .resource-grid { grid-template-columns: 1fr; }
    .thread-filters { gap: 0.4rem; }
    .thread-btn { padding: 0.45rem 0.75rem; font-size: 0.6rem; }
  }
</style>
</head>
<body>

<header class="site-header">
  <div class="header-inner">
    <div class="header-district">Redwood City School District</div>
    <h1 class="header-title">Board Meeting Index</h1>
    <p class="header-subtitle">Two years of board meetings with agendas, video recordings, and key topics. Data compiled from <a href="https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030397" style="color:rgba(255,255,255,0.75)">GAMUT/Simbli</a> and <a href="https://go.boarddocs.com/ca/redwood/Board.nsf/goto?open&id=CVLPDX62089F" style="color:rgba(255,255,255,0.75)">BoardDocs</a>.</p>
    <div class="header-meta">
      <div class="header-stat">
        <span class="header-stat-value">${data.stats.total}</span>
        <span class="header-stat-label">Meetings</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">${data.stats.totalItems || 0}</span>
        <span class="header-stat-label">Agenda items</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">${data.stats.totalAttachments || 0}</span>
        <span class="header-stat-label">Attachments</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">${data.stats.withVideo}</span>
        <span class="header-stat-label">With video</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">${data.stats.withTranscript || 0}</span>
        <span class="header-stat-label">With transcript</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">${data.stats.withMinutes || 0}</span>
        <span class="header-stat-label">With minutes</span>
      </div>
    </div>
    <div class="board-roster">
      <div class="board-roster-label"><a href="https://www.rcsdk8.net/our-district/our-board-of-trustees/meet-the-trustees" style="color:rgba(255,255,255,0.4);text-decoration:none" target="_blank" rel="noopener">Board of Education</a></div>
      <ul class="board-roster-list">
        <li>David Weekly <span class="roster-role">President</span></li>
        <li>Cecilia I. M&aacute;rquez <span class="roster-role">Vice President</span></li>
        <li>Jennifer Ng Kwing King <span class="roster-role">Clerk</span></li>
        <li>David Li</li>
        <li>Mike Wells</li>
      </ul>
    </div>
  </div>
</header>

<div class="disclaimer">
  Not an official District document; independently assembled by <a href="https://github.com/dweekly/rcsd-meetings" style="color:#664d03">David Weekly</a>. May contain errors.
</div>

<nav class="toc">
  <div class="toc-inner">
    <a href="#threads">Key Topics</a>
    <a href="#sy2526">2025-26</a>
    <a href="#sy2425">2024-25</a>
    <a href="#resources">Resources</a>
    <a href="https://github.com/dweekly/rcsd-meetings">Source Code</a>
  </div>
</nav>

<main class="content">
${renderThreadFilters()}

${renderSchoolYear('sy2526', '2025\u201326 School Year', sy2526, `${sy2526.length} meetings from June 2025 to present. Full agendas and video available.`)}

${renderSchoolYear('sy2425', '2024\u201325 School Year', sy2425, `${sy2425.length} meetings from the BoardDocs archive with full agendas and attachments.`)}

${renderResources(data)}
</main>

<footer class="site-footer">
  Compiled from publicly available RCSD documents. Source documents are available at <a href="https://www.rcsdk8.net">rcsdk8.net</a> and through the <a href="https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030397">GAMUT board portal</a>.
  <div class="footer-nav">
    <a href="https://github.com/dweekly/rcsd-meetings">Source Code &amp; Data Pipeline &#8599;</a>
  </div>
</footer>

<script>
(function() {
  var active = null;
  var btns = document.querySelectorAll('.thread-btn');
  var allRows = document.querySelectorAll('.meeting-row');

  btns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var filter = btn.dataset.filter;
      if (active === filter) {
        active = null;
        btns.forEach(function(b) { b.classList.remove('active'); });
        allRows.forEach(function(r) { r.classList.remove('hidden'); });
      } else {
        active = filter;
        btns.forEach(function(b) { b.classList.toggle('active', b.dataset.filter === filter); });
        allRows.forEach(function(r) {
          var threads = r.dataset.threads;
          r.classList.toggle('hidden', !threads || threads.indexOf(filter) === -1);
        });
      }
    });
  });


})();
</script>

</body>
</html>`;

writeFileSync(resolve(ROOT, 'docs/index.html'), html);
console.log('Wrote docs/index.html');
