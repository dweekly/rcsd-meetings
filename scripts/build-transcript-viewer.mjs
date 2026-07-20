#!/usr/bin/env node
/**
 * Generate per-meeting viewer pages with tabbed Transcript / Agenda / Minutes.
 *
 * All three tabs sync with the embedded YouTube player:
 * - Transcript: auto-scrolls to current utterance, click to seek
 * - Agenda: highlights current agenda item based on chapter markers, click to seek
 * - Minutes: links to approved minutes PDF (static, no sync)
 *
 * Output: docs/meetings/{date}/index.html
 *
 * NOTE: superseded by build-meeting-pages.mjs (bilingual EN+ES, same output
 * paths) — run-pipeline.mjs no longer runs this script. Running it manually
 * overwrites the bilingual EN pages with EN-only output.
 *
 * Security note: all user-facing text is rendered via textContent or
 * pre-escaped at build time. No dynamic innerHTML from untrusted sources.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { headMeta, siteNav, siteFooter } from './html-parts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const R2_BASE = 'https://data.rcsd.info';

const data = JSON.parse(readFileSync(resolve(ROOT, 'data/meetings-data.json'), 'utf-8'));

// Build AID → R2 path lookup for attachment links
const aidToR2Path = {};
const memoDir = resolve(ROOT, 'data/board-memos');
try {
  for (const f of readdirSync(memoDir)) {
    if (!f.endsWith('.json')) continue;
    const memo = JSON.parse(readFileSync(resolve(memoDir, f), 'utf-8'));
    for (const item of memo.items) {
      for (const att of item.attachments) {
        if (att.aid && att.filename) aidToR2Path[att.aid] = `board-packets/${memo.date}/${att.filename}`;
      }
    }
  }
} catch {}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[parseInt(m) - 1]} ${parseInt(d)}, ${y}`;
}

function formatSec(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = n => n < 10 ? '0' + n : '' + n;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

const SPEAKER_COLORS = [
  '#1a5276', '#7d3c98', '#1e8449', '#b9770e', '#922b21',
  '#117a65', '#6c3483', '#1f618d', '#b7950b', '#943126',
  '#148f77', '#7d6608', '#2e4053', '#884ea0', '#239b56',
];

// ---- Build agenda HTML for a meeting (server-side rendered) ----

function buildAgendaHtml(m) {
  if (!m.items || m.items.length === 0) return '<div class="tv-empty">No agenda data available.</div>';

  let html = '';
  for (const item of m.items) {
    const opened = item.phases?.opened;
    const hasTs = opened != null;
    const tsAttr = hasTs ? ` data-start="${opened * 1000}"` : '';
    const clickable = hasTs ? ' tv-clickable' : '';
    const isSection = item.isSection;
    const cls = isSection ? 'tv-agenda-section' : 'tv-agenda-item';

    html += `<div class="${cls}${clickable}"${tsAttr}>`;

    // Label
    if (item.itemLabel) {
      html += `<span class="tv-agenda-label">${escapeHtml(String(item.itemLabel))}</span>`;
    }

    // Timestamp
    if (hasTs) {
      html += `<span class="tv-ts">${formatSec(opened)}</span>`;
    }

    // Title
    html += `<span class="tv-agenda-title">${escapeHtml(item.title)}</span>`;

    // Action type badge
    if (item.actionType && !isSection) {
      html += `<span class="tv-agenda-type">${escapeHtml(item.actionType)}</span>`;
    }

    // Planned duration for sections
    if (isSection && item.plannedMinutes) {
      html += `<span class="tv-agenda-duration">${item.plannedMinutes >= 60 ? (item.plannedMinutes / 60) + 'hr' : item.plannedMinutes + 'min'}</span>`;
    }

    html += '</div>';

    // Public comments
    if (item.publicComments && item.publicComments.length > 0) {
      html += '<div class="tv-agenda-pc">';
      for (const pc of item.publicComments) {
        const pcTs = pc.startSeconds != null ? ` data-start="${pc.startSeconds * 1000}"` : '';
        const pcClick = pc.startSeconds != null ? ' tv-clickable' : '';
        const dur = pc.endSeconds && pc.startSeconds ? ` (${Math.round((pc.endSeconds - pc.startSeconds) / 60)}min)` : '';
        html += `<div class="tv-agenda-pc-speaker${pcClick}"${pcTs}>`;
        html += `<span class="tv-agenda-pc-name">${escapeHtml(pc.name || 'Speaker')}</span>${dur}`;
        if (pc.summary) html += `<span class="tv-agenda-pc-summary"> &mdash; ${escapeHtml(pc.summary)}</span>`;
        html += '</div>';
      }
      html += '</div>';
    }

    // Attachments
    if (item.attachments && item.attachments.length > 0) {
      html += '<div class="tv-agenda-atts">';
      for (const att of item.attachments) {
        const name = att.title || att.name || 'Attachment';
        const r2Path = att.aid && aidToR2Path[att.aid];
        const href = att.href || (r2Path ? `${R2_BASE}/${r2Path}` : (att.aid ? `https://simbli.eboardsolutions.com/Meetings/Attachment.aspx?S=36030397&AID=${att.aid}&MID=${m.mid}` : '#'));
        html += `<a class="tv-agenda-att" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(name)}</a>`;
      }
      html += '</div>';
    }
  }
  return html;
}

// ---- Build minutes HTML ----

function buildMinutesHtml(m) {
  if (!m.minutes) return '<div class="tv-empty">Minutes not yet approved for this meeting.</div>';

  let html = '<div class="tv-minutes-info">';
  html += `<p>Minutes approved at the ${formatDate(m.minutes.approvedAt)} meeting.</p>`;

  if (m.minutes.documents && m.minutes.documents.length > 0) {
    for (const doc of m.minutes.documents) {
      const href = doc.href || '#';
      const r2Path = doc.aid && aidToR2Path[doc.aid];
      const finalHref = r2Path ? `${R2_BASE}/${r2Path}` : href;
      html += `<a class="tv-minutes-link" href="${escapeHtml(finalHref)}" target="_blank" rel="noopener">${escapeHtml(doc.title || 'Minutes PDF')}</a>`;
    }
  }

  // Embed PDF if available on R2
  const minutesPdf = `${m.date}-minutes.pdf`;
  const minutesR2 = `${R2_BASE}/minutes/${minutesPdf}`;
  try {
    if (existsSync(resolve(ROOT, 'artifacts/minutes', minutesPdf))) {
      html += `<iframe class="tv-minutes-embed" src="${minutesR2}" title="Meeting minutes PDF"></iframe>`;
    }
  } catch {}

  html += '</div>';
  return html;
}

// ---- CSS ----

const pageCSS = `
  .tv-layout {
    max-width: 960px;
    margin: 0 auto;
    padding: 1rem 2rem 2rem;
  }

  .tv-header { margin-bottom: 1rem; }

  .tv-back {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.75rem;
    color: var(--text-muted);
    text-decoration: none;
    display: inline-block;
    margin-bottom: 0.5rem;
  }
  .tv-back:hover { color: var(--green-mid); }

  .tv-title {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--green-deep);
    margin-bottom: 0.25rem;
  }

  .tv-meta {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .tv-meta a { color: var(--green-mid); text-decoration: none; }
  .tv-meta a:hover { text-decoration: underline; }

  .tv-main {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .tv-video-col {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--cream);
    padding-bottom: 0.5rem;
  }

  .tv-video-wrap {
    position: relative;
    padding-bottom: 56.25%;
    height: 0;
    border-radius: 6px;
    overflow: hidden;
    background: #000;
  }

  .tv-video-wrap iframe {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    border: none;
  }

  /* ---- Tab bar ---- */
  .tv-tabs {
    display: flex;
    gap: 0;
    border-bottom: 2px solid var(--rule);
    margin-top: 0.5rem;
  }

  .tv-tab {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.75rem;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    padding: 0.5rem 1rem;
    cursor: pointer;
    border: none;
    background: none;
    color: var(--text-muted);
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    transition: color 0.15s, border-color 0.15s;
  }
  .tv-tab:hover { color: var(--text); }
  .tv-tab.active { color: var(--green-deep); border-bottom-color: var(--green-mid); }
  .tv-tab:disabled { opacity: 0.4; cursor: default; }

  .tv-controls {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
    align-items: center;
  }

  .tv-btn {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--rule);
    border-radius: 4px;
    background: var(--cream);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .tv-btn:hover { background: var(--cream-dark); }
  .tv-btn.active { background: var(--green-pale); border-color: var(--green-mid); color: var(--green-deep); }

  .tv-search {
    flex: 1;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--rule);
    border-radius: 4px;
    background: #fff;
    color: var(--text);
    outline: none;
  }
  .tv-search:focus { border-color: var(--green-mid); }

  /* ---- Tab panels ---- */
  .tv-panel { display: none; }
  .tv-panel.active { display: block; }

  .tv-transcript-panel {
    border: 1px solid var(--rule-light);
    border-radius: 0 0 6px 6px;
    background: #fff;
    border-top: none;
  }

  .tv-utterance {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--rule-light);
    cursor: pointer;
    transition: background 0.15s;
    display: flex;
    gap: 0.5rem;
    /* Per-speaker skim cues: each row carries its diarization color as a left
       border plus a faint wash, so speaker changes read at a glance while
       scrolling. --spk is set per-row by the renderer; rows without it (older
       cached pages) degrade to the plain style. Hover/active/search rules
       below still win on background. */
    border-left: 3px solid var(--spk, transparent);
    background: color-mix(in srgb, var(--spk, transparent) 6%, transparent);
  }
  .tv-utterance:last-child { border-bottom: none; }
  .tv-utterance:hover { background: var(--green-wash); }
  .tv-utterance.active { background: #eef6eb; }
  .tv-utterance.search-match { background: #fef9e7; }

  .tv-ts {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
    color: var(--text-muted);
    flex: 0 0 3.5rem;
    padding-top: 0.15rem;
    text-align: right;
  }

  .tv-speaker {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
    font-weight: 500;
    flex: 0 0 auto;
    max-width: 8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-top: 0.15rem;
  }

  .tv-text {
    font-family: 'Newsreader', serif;
    font-size: 0.85rem;
    line-height: 1.5;
    color: var(--text);
    flex: 1;
    min-width: 0;
  }

  .tv-text mark {
    background: #fde68a;
    padding: 0 2px;
    border-radius: 2px;
  }

  /* ---- Agenda panel ---- */
  .tv-agenda-panel {
    border: 1px solid var(--rule-light);
    border-radius: 0 0 6px 6px;
    background: #fff;
    border-top: none;
    padding: 0.25rem 0;
  }

  .tv-clickable { cursor: pointer; }
  .tv-clickable:hover { background: var(--green-wash); }

  .tv-agenda-section {
    padding: 0.6rem 0.75rem 0.3rem;
    font-family: 'Fraunces', Georgia, serif;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--green-deep);
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    border-top: 1px solid var(--rule-light);
  }
  .tv-agenda-section:first-child { border-top: none; }
  .tv-agenda-section.active { background: #eef6eb; }

  .tv-agenda-item {
    padding: 0.35rem 0.75rem 0.35rem 1.5rem;
    font-family: 'Newsreader', serif;
    font-size: 0.85rem;
    line-height: 1.4;
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    transition: background 0.15s;
  }
  .tv-agenda-item.active { background: #eef6eb; }

  .tv-agenda-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
    color: var(--green-mid);
    font-weight: 500;
    flex: 0 0 2.5rem;
  }

  .tv-agenda-title { flex: 1; min-width: 0; }

  .tv-agenda-type {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.55rem;
    color: var(--text-muted);
    background: var(--cream-dark);
    padding: 0.05rem 0.3rem;
    border-radius: 2px;
    white-space: nowrap;
  }

  .tv-agenda-duration {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    color: var(--text-muted);
  }

  .tv-agenda-atts {
    padding: 0.1rem 0.75rem 0.3rem 3rem;
  }

  .tv-agenda-att {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    color: var(--green-mid);
    text-decoration: none;
    display: block;
    line-height: 1.6;
  }
  .tv-agenda-att:hover { text-decoration: underline; color: var(--green-deep); }

  .tv-agenda-pc {
    padding: 0.1rem 0.75rem 0.3rem 3rem;
    border-left: 2px solid var(--cream-dark);
    margin-left: 1.5rem;
  }

  .tv-agenda-pc-speaker {
    font-size: 0.8rem;
    line-height: 1.5;
    padding: 0.15rem 0;
  }

  .tv-agenda-pc-name {
    font-weight: 600;
    color: var(--green-mid);
  }

  .tv-agenda-pc-summary {
    color: var(--text-secondary);
    font-size: 0.78rem;
  }

  /* ---- Minutes panel ---- */
  .tv-minutes-panel {
    border: 1px solid var(--rule-light);
    border-radius: 0 0 6px 6px;
    background: #fff;
    border-top: none;
    padding: 1rem;
  }

  .tv-minutes-info p {
    font-size: 0.85rem;
    color: var(--text-secondary);
    margin-bottom: 0.75rem;
  }

  .tv-minutes-link {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.75rem;
    color: var(--green-mid);
    text-decoration: none;
    display: block;
    margin-bottom: 0.5rem;
  }
  .tv-minutes-link:hover { text-decoration: underline; }
  .tv-minutes-link::before { content: '\\1F4C4 '; }

  .tv-minutes-embed {
    width: 100%;
    height: 70vh;
    border: 1px solid var(--rule-light);
    border-radius: 4px;
    margin-top: 0.5rem;
  }

  .tv-empty {
    padding: 2rem;
    text-align: center;
    color: var(--text-muted);
    font-style: italic;
  }

  .tv-download {
    text-align: center;
    padding: 0.75rem;
  }
  .tv-download a {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    color: var(--green-mid);
    text-decoration: none;
  }
  .tv-download a:hover { text-decoration: underline; }

  @media (max-width: 640px) {
    .tv-layout { padding: 0.75rem 1rem; }
    .tv-utterance { gap: 0.3rem; }
    .tv-ts { flex: 0 0 2.8rem; font-size: 0.6rem; }
    .tv-speaker { max-width: 5rem; font-size: 0.6rem; }
    .tv-agenda-item { padding-left: 0.75rem; }
    .tv-tab { padding: 0.4rem 0.6rem; font-size: 0.65rem; }
  }
`;

let generated = 0;

// Group meetings by date to detect multi-meeting dates
const meetingsByDate = {};
for (const m of data.meetings) {
  if (!meetingsByDate[m.date]) meetingsByDate[m.date] = [];
  meetingsByDate[m.date].push(m);
}

for (const m of data.meetings) {
  // Generate viewer pages for all meetings (not just those with transcripts)
  // Meetings without video/transcript still get agenda + minutes tabs
  const hasVideo = !!m.youtube;
  const hasTranscript = m.hasTranscript && hasVideo;

  const siblings = meetingsByDate[m.date];
  const isMulti = siblings.length > 1;

  // For multi-meeting dates, use slug-based paths; for single, use date
  const pagePath = isMulti ? m.slug : m.date;
  const outDir = resolve(ROOT, `docs/meetings/${pagePath}`);
  mkdirSync(outDir, { recursive: true });

  const transcriptUrl = hasTranscript ? `${R2_BASE}/transcripts/${m.date}.json` : null;
  const dateFormatted = formatDate(m.date);
  const title = `${m.type} — ${dateFormatted} — RCSD Board Meeting`;
  const description = `Agenda, transcript, and minutes for the RCSD ${m.type} on ${dateFormatted}.`;
  const canonicalPath = `/meetings/${pagePath}/`;

  const hasMinutes = !!(m.minutes && (m.minutes.documents?.length > 0 || existsSync(resolve(ROOT, 'artifacts/minutes', `${m.date}-minutes.pdf`))));
  const hasAgenda = m.items && m.items.length > 0;
  const agendaHtml = buildAgendaHtml(m);
  const minutesHtml = buildMinutesHtml(m);

  // Default tab: agenda if no transcript, otherwise transcript
  const defaultTab = hasTranscript ? 'transcript' : 'agenda';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
${headMeta({
  title,
  description,
  canonical: `https://rcsd.info${canonicalPath}`,
  ogImageKey: `meeting-${m.slug}`,
  pageCSS,
})}
</head>
<body>
${siteNav({ activePage: 'meetings', lang: 'en' })}

<div class="tv-layout">
  <div class="tv-header">
    <a href="/meetings/" class="tv-back">&larr; All Meetings</a>
    <h1 class="tv-title">${escapeHtml(m.type)} &mdash; ${dateFormatted}</h1>
    <div class="tv-meta">
      ${m.duration ? `${m.duration} &middot; ` : ''}
      ${hasVideo ? `<a href="https://www.youtube.com/watch?v=${m.youtube}" target="_blank" rel="noopener">YouTube</a>` : ''}
      ${m.simbli ? `${hasVideo ? ' &middot; ' : ''}<a href="${escapeHtml(m.simbli)}" target="_blank" rel="noopener">Simbli</a>` : ''}
      ${m.boarddocs ? `${hasVideo || m.simbli ? ' &middot; ' : ''}<a href="${escapeHtml(m.boarddocs)}" target="_blank" rel="noopener">BoardDocs</a>` : ''}
    </div>
  </div>

  <div class="tv-main">
    <div class="tv-video-col">
      ${hasVideo ? `<div class="tv-video-wrap"><div id="yt-player"></div></div>` : ''}
      <div class="tv-tabs">
        <button class="tv-tab${defaultTab === 'transcript' ? ' active' : ''}" data-tab="transcript"${hasTranscript ? '' : ' disabled'}>Transcript</button>
        <button class="tv-tab${defaultTab === 'agenda' ? ' active' : ''}" data-tab="agenda"${hasAgenda ? '' : ' disabled'}>Agenda</button>
        <button class="tv-tab" data-tab="minutes"${hasMinutes ? '' : ' disabled'}>Minutes</button>
      </div>
      ${hasTranscript ? `<div class="tv-controls" id="transcript-controls"${defaultTab !== 'transcript' ? ' style="display:none"' : ''}>
        <button class="tv-btn active" id="btn-autoscroll">Auto-scroll</button>
        <button class="tv-btn" id="btn-lang" title="Toggle Spanish translation">ES</button>
        <input class="tv-search" type="text" id="search-input" placeholder="Search transcript...">
      </div>` : ''}
    </div>

    <div class="tv-panel tv-transcript-panel${defaultTab === 'transcript' ? ' active' : ''}" id="panel-transcript">
      ${hasTranscript ? '<div style="padding:1rem;color:var(--text-muted);font-style:italic">Loading transcript...</div>' : '<div class="tv-empty">No transcript available for this meeting.</div>'}
    </div>

    <div class="tv-panel tv-agenda-panel${defaultTab === 'agenda' ? ' active' : ''}" id="panel-agenda">
      ${agendaHtml}
    </div>

    <div class="tv-panel tv-minutes-panel" id="panel-minutes">
      ${minutesHtml}
    </div>
  </div>

  ${transcriptUrl ? `<div class="tv-download"><a href="${transcriptUrl}" target="_blank" rel="noopener" download>Download transcript (JSON)</a></div>` : ''}
</div>

${siteFooter({ lang: 'en' })}

<script>
(function() {
  var videoId = ${JSON.stringify(m.youtube || null)};
  var transcriptUrlEn = ${JSON.stringify(transcriptUrl)};
  var transcriptUrlEs = ${JSON.stringify(transcriptUrl ? transcriptUrl.replace('.json', '-es.json') : null)};
  var transcriptUrl = transcriptUrlEn;
  var speakerColors = ${JSON.stringify(SPEAKER_COLORS)};
  var player = null;
  var utterances = [];
  var utterancesEn = null;
  var utterancesEs = null;
  var speakerMap = {};
  var autoScroll = true;
  var activeIdx = -1;
  var activeTab = ${JSON.stringify(defaultTab)};
  var currentLang = 'en';

  // Load YT IFrame API (only if we have video)
  if (videoId) {
    var tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);

    window.onYouTubeIframeAPIReady = function() {
      player = new YT.Player('yt-player', {
        videoId: videoId,
        playerVars: { rel: 0, modestbranding: 1 },
      });
    };
  }

  // ---- Tab switching ----
  var tabs = document.querySelectorAll('.tv-tab');
  var panels = document.querySelectorAll('.tv-panel');
  var transcriptControls = document.getElementById('transcript-controls');

  tabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      if (tab.disabled) return;
      activeTab = tab.dataset.tab;
      tabs.forEach(function(t) { t.classList.toggle('active', t.dataset.tab === activeTab); });
      panels.forEach(function(p) { p.classList.toggle('active', p.id === 'panel-' + activeTab); });
      transcriptControls.style.display = activeTab === 'transcript' ? '' : 'none';
    });
  });

  // ---- Seek helper ----
  function seekTo(ms) {
    if (player && player.seekTo) {
      player.seekTo(ms / 1000, true);
      player.playVideo();
    }
  }

  // ---- Agenda click-to-seek ----
  document.getElementById('panel-agenda').addEventListener('click', function(e) {
    var el = e.target.closest('.tv-clickable');
    if (!el || !el.dataset.start) return;
    seekTo(parseInt(el.dataset.start));
  });

  // ---- Transcript ----
  function formatTime(ms) {
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
    if (h > 0) return h + ':' + pad(m) + ':' + pad(s);
    return m + ':' + pad(s);
  }

  function speakerName(label) {
    var sp = speakerMap[label];
    return (sp && sp.name) ? sp.name : 'Speaker ' + label;
  }

  function speakerColor(label) {
    return speakerColors[label.charCodeAt(0) % speakerColors.length];
  }

  function renderTranscript() {
    var container = document.getElementById('panel-transcript');
    container.textContent = '';

    utterances.forEach(function(u, i) {
      var row = document.createElement('div');
      row.className = 'tv-utterance';
      row.style.setProperty('--spk', speakerColor(u.speaker));
      row.dataset.idx = i;
      row.dataset.start = u.start;

      var ts = document.createElement('span');
      ts.className = 'tv-ts';
      ts.textContent = formatTime(u.start);
      row.appendChild(ts);

      var sp = document.createElement('span');
      sp.className = 'tv-speaker';
      sp.style.color = speakerColor(u.speaker);
      var name = speakerName(u.speaker);
      sp.textContent = name;
      sp.title = name;
      row.appendChild(sp);

      var text = document.createElement('span');
      text.className = 'tv-text';
      text.textContent = u.text;
      row.appendChild(text);

      container.appendChild(row);
    });

    container.addEventListener('click', function(e) {
      var row = e.target.closest('.tv-utterance');
      if (!row) return;
      seekTo(parseInt(row.dataset.start));
    });
  }

  if (transcriptUrlEn) {
    fetch(transcriptUrlEn)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        utterancesEn = data.utterances;
        utterances = utterancesEn;
        speakerMap = data.speakers || {};
        renderTranscript();
        setInterval(syncHighlight, 250);
      })
      .catch(function() {
        // Friendly fallback: the raw transcript JSON on data.rcsd.info is the
        // canonical artifact, so link it even when this page's fetch fails
        var c = document.getElementById('panel-transcript');
        c.textContent = '';
        var msg = document.createElement('div');
        msg.className = 'tv-empty';
        msg.textContent = 'Sorry — the transcript didn\\u2019t load. Try refreshing the page, or open the raw transcript file directly:';
        var link = document.createElement('a');
        link.href = transcriptUrlEn;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = 'Raw transcript (JSON)';
        msg.appendChild(document.createElement('br'));
        msg.appendChild(link);
        c.appendChild(msg);
      });

    // Pre-fetch Spanish translation
    if (transcriptUrlEs) {
      fetch(transcriptUrlEs)
        .then(function(r) { if (!r.ok) throw new Error(); return r.json(); })
        .then(function(data) {
          utterancesEs = data.utterances;
          // Enable the ES button
          var btn = document.getElementById('btn-lang');
          if (btn) btn.style.opacity = '1';
        })
        .catch(function() {
          // No Spanish translation available — disable button
          var btn = document.getElementById('btn-lang');
          if (btn) { btn.disabled = true; btn.title = 'Spanish translation not yet available'; }
        });
    }
  } else {
    if (videoId) setInterval(syncHighlight, 250);
  }

  // ---- Sync highlight (transcript + agenda) ----
  var activeAgendaEl = null;

  function syncHighlight() {
    if (!player || !player.getCurrentTime) return;
    var currentMs = player.getCurrentTime() * 1000;

    // Transcript sync
    if (activeTab === 'transcript') {
      var newIdx = -1;
      for (var i = utterances.length - 1; i >= 0; i--) {
        if (utterances[i].start <= currentMs) { newIdx = i; break; }
      }
      if (newIdx !== activeIdx) {
        activeIdx = newIdx;
        var rows = document.querySelectorAll('.tv-utterance');
        rows.forEach(function(r, i) { r.classList.toggle('active', i === activeIdx); });

        if (autoScroll && activeIdx >= 0 && rows[activeIdx]) {
          var rect = rows[activeIdx].getBoundingClientRect();
          var videoCol = document.querySelector('.tv-video-col');
          var stickyHeight = videoCol ? videoCol.offsetHeight : 0;
          if (rect.top < stickyHeight + 20 || rect.bottom > window.innerHeight - 40) {
            window.scrollTo({ top: rows[activeIdx].offsetTop - stickyHeight - 20, behavior: 'smooth' });
          }
        }
      }
    }

    // Agenda sync — highlight current agenda item
    if (activeTab === 'agenda') {
      var agendaItems = document.querySelectorAll('#panel-agenda [data-start]');
      var bestEl = null;
      agendaItems.forEach(function(el) {
        var start = parseInt(el.dataset.start);
        if (start <= currentMs) bestEl = el;
      });
      if (bestEl !== activeAgendaEl) {
        if (activeAgendaEl) activeAgendaEl.classList.remove('active');
        activeAgendaEl = bestEl;
        if (activeAgendaEl) {
          activeAgendaEl.classList.add('active');
          if (autoScroll) {
            var rect = activeAgendaEl.getBoundingClientRect();
            var videoCol = document.querySelector('.tv-video-col');
            var stickyHeight = videoCol ? videoCol.offsetHeight : 0;
            if (rect.top < stickyHeight + 20 || rect.bottom > window.innerHeight - 40) {
              window.scrollTo({ top: activeAgendaEl.offsetTop - stickyHeight - 20, behavior: 'smooth' });
            }
          }
        }
      }
    }
  }

  // Auto-scroll toggle
  var autoScrollBtn = document.getElementById('btn-autoscroll');
  if (autoScrollBtn) {
    autoScrollBtn.addEventListener('click', function() {
      autoScroll = !autoScroll;
      this.classList.toggle('active', autoScroll);
    });
  }

  // Language toggle
  var langBtn = document.getElementById('btn-lang');
  if (langBtn) {
    langBtn.addEventListener('click', function() {
      if (currentLang === 'en' && utterancesEs) {
        currentLang = 'es';
        utterances = utterancesEs;
        langBtn.textContent = 'EN';
        langBtn.classList.add('active');
        langBtn.title = 'Switch to English';
      } else {
        currentLang = 'en';
        utterances = utterancesEn;
        langBtn.textContent = 'ES';
        langBtn.classList.remove('active');
        langBtn.title = 'Toggle Spanish translation';
      }
      activeIdx = -1;
      renderTranscript();
    });
  }

  // Search
  var searchInput = document.getElementById('search-input');
  var searchTimeout = null;
  if (!searchInput) return; // no search on agenda-only pages
  searchInput.addEventListener('input', function() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(doSearch, 200);
  });

  function doSearch() {
    var term = searchInput.value.trim().toLowerCase();
    var rows = document.querySelectorAll('.tv-utterance');
    rows.forEach(function(row, i) {
      var textEl = row.querySelector('.tv-text');
      var original = utterances[i].text;
      if (term && original.toLowerCase().indexOf(term) >= 0) {
        row.classList.add('search-match');
        row.style.display = '';
        textEl.textContent = '';
        var remaining = original;
        var lc = remaining.toLowerCase();
        var pos = lc.indexOf(term);
        while (pos >= 0) {
          if (pos > 0) textEl.appendChild(document.createTextNode(remaining.slice(0, pos)));
          var mark = document.createElement('mark');
          mark.textContent = remaining.slice(pos, pos + term.length);
          textEl.appendChild(mark);
          remaining = remaining.slice(pos + term.length);
          lc = remaining.toLowerCase();
          pos = lc.indexOf(term);
        }
        if (remaining) textEl.appendChild(document.createTextNode(remaining));
      } else {
        row.classList.remove('search-match');
        textEl.textContent = original;
        row.style.display = term ? 'none' : '';
      }
    });
  }
})();
</script>
</body>
</html>`;

  writeFileSync(resolve(outDir, 'index.html'), html);
  generated++;
}

// Generate disambiguation pages for multi-meeting dates
const multiDates = Object.entries(meetingsByDate).filter(([, ms]) => ms.length > 1);
for (const [date, meetings] of multiDates) {
  const outDir = resolve(ROOT, `docs/meetings/${date}`);
  mkdirSync(outDir, { recursive: true });
  const dateFormatted = formatDate(date);

  const links = meetings.map(m => {
    const href = `/meetings/${m.slug}/`;
    return `<a href="${href}" class="tv-disambig-link">
      <span class="tv-disambig-type">${escapeHtml(m.type)}</span>
      <span class="tv-disambig-items">${m.items?.length || 0} agenda items</span>
    </a>`;
  }).join('\n');

  const disambigCSS = `
    .tv-disambig { max-width: 600px; margin: 2rem auto; padding: 2rem; }
    .tv-disambig h1 { font-family: 'Fraunces', Georgia, serif; font-size: 1.5rem; color: var(--green-deep); margin-bottom: 1rem; }
    .tv-disambig p { color: var(--text-secondary); margin-bottom: 1.5rem; }
    .tv-disambig-link {
      display: block; padding: 1rem; margin-bottom: 0.75rem;
      border: 1px solid var(--rule); border-radius: 6px;
      text-decoration: none; transition: border-color 0.15s, background 0.15s;
    }
    .tv-disambig-link:hover { border-color: var(--green-mid); background: var(--green-wash); }
    .tv-disambig-type { font-family: 'Fraunces', serif; font-size: 1.1rem; font-weight: 600; color: var(--text); display: block; }
    .tv-disambig-items { font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; color: var(--text-muted); }
  `;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
${headMeta({
  title: `Meetings — ${dateFormatted}`,
  description: `Multiple board meetings on ${dateFormatted}.`,
  canonical: `https://rcsd.info/meetings/${date}/`,
  ogImageKey: 'page-meetings',
  pageCSS: disambigCSS,
})}
</head>
<body>
${siteNav({ activePage: 'meetings', lang: 'en' })}
<div class="tv-disambig">
  <a href="/meetings/" style="font-family:'IBM Plex Mono',monospace;font-size:0.75rem;color:var(--text-muted);text-decoration:none">&larr; All Meetings</a>
  <h1>${dateFormatted}</h1>
  <p>Multiple meetings were held on this date. Select one:</p>
  ${links}
</div>
${siteFooter({ lang: 'en' })}
</body>
</html>`;

  writeFileSync(resolve(outDir, 'index.html'), html);
}

console.log(`Generated ${generated} meeting viewer pages (${multiDates.length} disambiguation pages)`);
