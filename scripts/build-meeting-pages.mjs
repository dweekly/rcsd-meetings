#!/usr/bin/env node
/**
 * Generate per-meeting viewer pages with tabbed Transcript / Agenda / Minutes.
 *
 * All three tabs sync with the embedded YouTube player:
 * - Transcript: auto-scrolls to current utterance, click to seek
 * - Agenda: highlights current agenda item based on chapter markers, click to seek
 * - Minutes: links to approved minutes PDF (static, no sync)
 *
 * Output:
 *   English: docs/meetings/{date}/index.html
 *   Spanish: docs/reuniones/{date}/index.html
 *
 * Security note: all user-facing text is rendered via textContent or
 * pre-escaped at build time. No dynamic innerHTML from untrusted sources.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { headMeta, siteNav, siteFooter } from './html-parts.mjs';
import { expandItemLabels } from './lib/docket-brief.mjs';

// Agenda items covered by spotlight cards: one card can cover a range such as
// "10.12–10.22", so count distinct item labels, not cards.
function spotlightedCount(cs) {
  const labels = new Set();
  for (const s of cs.spotlightItems || []) for (const l of expandItemLabels(String(s.itemLabel || ''))) labels.add(l);
  return labels.size;
}
import { escapeHtml, formatSec, formatDate, R2_BASE, buildAidToR2Path } from './meeting-utils.mjs';
import {
  loadParticipationContext,
  extractMeetingTimes,
  extractPublicCommentInfo,
  extractTopHeadlines,
  buildWhatsAppNotice,
} from './lib/meeting-participation.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const data = JSON.parse(readFileSync(resolve(ROOT, 'data/meetings-data.json'), 'utf-8'));
const participationCtx = loadParticipationContext(ROOT);

// Load Pre-Meeting Packet Digests (data/docket-briefs/*.json)
const docketBriefsByDate = {};
const docketBriefsDir = resolve(ROOT, 'data/docket-briefs');
if (existsSync(docketBriefsDir)) {
  for (const f of readdirSync(docketBriefsDir).filter((file) => file.endsWith('.json') && file !== 'index.json')) {
    try {
      const b = JSON.parse(readFileSync(resolve(docketBriefsDir, f), 'utf-8'));
      if (b.date) docketBriefsByDate[b.date] = b;
    } catch {}
  }
}

// Load Evidence-Typed Post-Meeting Deliberation Recaps (data/deliberation-recaps/*.json)
const deliberationRecapsByDate = {};
const deliberationRecapsDir = resolve(ROOT, 'data/deliberation-recaps');
if (existsSync(deliberationRecapsDir)) {
  for (const f of readdirSync(deliberationRecapsDir).filter((file) => file.endsWith('.json') && file !== 'index.json')) {
    try {
      const r = JSON.parse(readFileSync(resolve(deliberationRecapsDir, f), 'utf-8'));
      if (r.date) deliberationRecapsByDate[r.date] = r;
    } catch {}
  }
}

// Build AID -> R2 path lookup for attachment links
const memoDir = resolve(ROOT, 'data/board-memos');
const memoDirEs = resolve(ROOT, 'data/board-memos-es');
const aidToR2Path = buildAidToR2Path(memoDir);

// Per-item content (Quick Summary/Abstract, Recommendation, Rationale, Financial
// Impact, …) lives in board-memos, not meetings-data — folding 8k+ items' prose
// into the browser-loaded meetings-data.json (already ~9MB) would bloat it. We
// render it server-side from the memos instead. parseSimbliAgenda emits items
// 1:1 positionally with the memo's items array, so content is keyed by date and
// matched by index in buildAgendaHtml (guarded on length parity).
const SKIP_CONTENT_FIELDS = new Set(['Speaker']);
function buildMemoContentByDate(dir) {
  const byDate = {};
  let files;
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return byDate; }
  for (const f of files) {
    let memo;
    try { memo = JSON.parse(readFileSync(resolve(dir, f), 'utf-8')); } catch { continue; }
    if (!memo.date || !Array.isArray(memo.items)) continue;
    byDate[memo.date] = memo.items.map((it) =>
      Object.entries(it.memo || {})
        .filter(([k, v]) => !SKIP_CONTENT_FIELDS.has(k) && v && String(v).trim())
        .map(([label, text]) => ({ label, text: String(text) }))
    );
  }
  return byDate;
}
// English content from board-memos; Spanish from board-memos-es (translate-memos.mjs).
const memoContentByDate = { en: buildMemoContentByDate(memoDir), es: buildMemoContentByDate(memoDirEs) };

// BoardDocs (2020–2025) meetings carry their item content in a `body` HTML field
// in boarddocs-scraped.json (already captured — just dropped by
// parseBoarddocsAgenda). Surface it the same way as the Simbli memos, matched by
// item order (which parseBoarddocsAgenda uses as itemLabel). Keyed by the
// BoardDocs goto-URL id (stable; unlike date it disambiguates the 8 dates that
// have two meetings). Spanish bodies live in data/boarddocs-es.json as
// { id: { order: text } }.
function boardDocsId(url) {
  const m = String(url || '').match(/id=([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}
function htmlToPlainText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'").replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&ndash;|&mdash;/gi, '-')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ').trim();
}
function buildBoardDocsEnContent(file) {
  const byId = {};
  if (!existsSync(file)) return byId;
  let j; try { j = JSON.parse(readFileSync(file, 'utf-8')); } catch { return byId; }
  for (const m of (j.meetings || j)) {
    const id = boardDocsId(m.url);
    if (!id) continue;
    const map = new Map();
    for (const it of m.items || []) {
      const text = htmlToPlainText(it.body);
      if (it.order != null && text) map.set(String(it.order), text);
    }
    if (map.size) byId[id] = map;
  }
  return byId;
}
function buildBoardDocsEsContent(file) {
  const byId = {};
  if (!existsSync(file)) return byId;
  let j; try { j = JSON.parse(readFileSync(file, 'utf-8')); } catch { return byId; }
  for (const [id, orders] of Object.entries(j)) {
    const map = new Map();
    for (const [order, text] of Object.entries(orders || {})) {
      if (text && String(text).trim()) map.set(String(order), String(text));
    }
    if (map.size) byId[id] = map;
  }
  return byId;
}
const boardDocsContentByDate = {
  en: buildBoardDocsEnContent(resolve(ROOT, 'data/boarddocs-scraped.json')),
  es: buildBoardDocsEsContent(resolve(ROOT, 'data/boarddocs-es.json')),
};

// Resolve the displayable content fields for one agenda item, language-aware.
// Returns { fields:[{label,text}], usedFallback } or null. Simbli matches by
// position (parseSimbliAgenda is 1:1 with the memo); BoardDocs matches by order.
function itemContentFor(m, item, idx, lang) {
  if (item.isSection) return null;
  if (m.source === 'boarddocs') {
    const bid = boardDocsId(m.boarddocs);
    const enText = boardDocsContentByDate.en[bid]?.get(String(item.itemLabel));
    const esText = boardDocsContentByDate.es[bid]?.get(String(item.itemLabel));
    if (lang !== 'en' && esText) return { fields: [{ label: '', text: esText }], usedFallback: false };
    if (enText) return { fields: [{ label: '', text: enText }], usedFallback: lang !== 'en' };
    return null;
  }
  const enArr = memoContentByDate.en[m.date];
  if (!enArr || enArr.length !== m.items.length) return null; // parity guard
  const langFields = memoContentByDate[lang]?.[m.date]?.[idx];
  const enFields = enArr[idx];
  if (lang !== 'en' && langFields?.length) return { fields: langFields, usedFallback: false };
  if (enFields?.length) return { fields: enFields, usedFallback: lang !== 'en' };
  return null;
}

// Load meeting summaries for both languages
const summariesByLang = {};
for (const [suffix, lang] of [['', 'en'], ['-es', 'es']]) {
  const p = resolve(ROOT, `data/meeting-summaries${suffix}.json`);
  if (existsSync(p)) {
    summariesByLang[lang] = JSON.parse(readFileSync(p, 'utf-8'));
  } else {
    summariesByLang[lang] = {};
  }
}

// Dark, high-contrast colors for speaker labels (A, B, C...)
const SPEAKER_COLORS = [
  '#2a2a28', '#4a3728', '#28382a', '#2a2838', '#382a28',
  '#283a38', '#38282a', '#2a3828', '#382838', '#283828',
  '#2a2838', '#382a38', '#283828', '#2a3828', '#38282a',
];

// ---- Localization ----
const LOCALES = {
  en: {
    lang: 'en',
    prefix: 'meetings',
    backLabel: '&larr; All Meetings',
    backHref: '/meetings/',
    tabTranscript: 'Transcript',
    tabAgenda: 'Agenda',
    tabMinutes: 'Minutes',
    autoScroll: 'Auto-scroll',
    esToggle: 'ES',
    searchPlaceholder: 'Search transcript...',
    noAgenda: 'No agenda data available.',
    noMinutes: 'Minutes not yet approved for this meeting.',
    itemDetailsLabel: 'Item details',
    itemDetailsEnNote: 'Shown in the original English.',
    noTranscript: 'No transcript available for this meeting.',
    loadingTranscript: 'Loading transcript...',
    minutesApprovedAt: (dateStr) => `Minutes approved at the ${dateStr} meeting.`,
    minutesPdf: 'Minutes PDF',
    downloadTranscript: 'Download transcript (JSON)',
    meetingTitle: (type, dateFormatted) => `${type} &mdash; ${dateFormatted}`,
    pageTitle: (type, dateFormatted) => `${type} — ${dateFormatted} — RCSD Board Meeting`,
    pageDesc: (type, dateFormatted) => `Agenda, transcript, and minutes for the RCSD ${type} on ${dateFormatted}.`,
    failedTranscript: 'Sorry — the transcript didn’t load. Try refreshing the page, or open the raw transcript file directly:',
    failedTranscriptLink: 'Raw transcript (JSON)',
    switchToEn: 'Switch to English',
    toggleSpanish: 'Toggle Spanish translation',
    disambigMultiple: 'Multiple meetings were held on this date. Select one:',
    disambigItemCount: (n) => `${n} agenda items`,
    summaryLabel: 'Summary',
    aiSummaryNote: 'AI-generated summary — may contain errors. Not an official record.',
    disclaimer: 'Not an official District document; independently assembled by',
    disclaimerSuffix: 'May contain errors. Questions?',
    disclaimerContact: 'Contact us',
    meetingTypes: {},
  },
  es: {
    lang: 'es',
    prefix: 'reuniones',
    backLabel: '&larr; Todas las Reuniones',
    backHref: '/reuniones/',
    tabTranscript: 'Transcripci\u00f3n',
    tabAgenda: 'Agenda',
    tabMinutes: 'Actas',
    autoScroll: 'Auto-desplazamiento',
    esToggle: 'EN',
    searchPlaceholder: 'Buscar en la transcripci\u00f3n...',
    noAgenda: 'No hay datos de agenda disponibles.',
    noMinutes: 'Las actas a\u00fan no han sido aprobadas para esta reuni\u00f3n.',
    itemDetailsLabel: 'Detalles del punto',
    itemDetailsEnNote: 'Se muestra en el ingl\u00e9s original.',
    noTranscript: 'No hay transcripci\u00f3n disponible para esta reuni\u00f3n.',
    loadingTranscript: 'Cargando transcripci\u00f3n...',
    minutesApprovedAt: (dateStr) => `Actas aprobadas en la reuni\u00f3n del ${dateStr}.`,
    minutesPdf: 'Actas PDF',
    downloadTranscript: 'Descargar transcripci\u00f3n (JSON)',
    meetingTitle: (type, dateFormatted) => `${type} &mdash; ${dateFormatted}`,
    pageTitle: (type, dateFormatted) => `${type} — ${dateFormatted} — Reuni\u00f3n de la Junta de RCSD`,
    pageDesc: (type, dateFormatted) => `Agenda, transcripci\u00f3n y actas de la ${type} de RCSD del ${dateFormatted}.`,
    failedTranscript: 'No se pudo cargar la transcripci\u00f3n en este momento. Intenta recargar la p\u00e1gina o abre el archivo original directamente:',
    failedTranscriptLink: 'Transcripci\u00f3n original (JSON, en ingl\u00e9s)',
    switchToEn: 'Switch to English',
    toggleSpanish: 'Cambiar a traducci\u00f3n en espa\u00f1ol',
    disambigMultiple: 'Se realizaron m\u00faltiples reuniones en esta fecha. Seleccione una:',
    disambigItemCount: (n) => `${n} puntos de agenda`,
    summaryLabel: 'Resumen',
    aiSummaryNote: 'Resumen generado por inteligencia artificial (IA) \u2014 puede contener errores. No es un acta oficial.',
    disclaimer: 'No es un documento oficial del Distrito; compilado independientemente por',
    disclaimerSuffix: 'Puede contener errores.',
    disclaimerContact: 'Cont\u00e1ctenos',
    meetingTypes: {
      'Regular': 'Reuni\u00f3n Regular',
      'Special': 'Reuni\u00f3n Especial',
      'Special Meeting': 'Reuni\u00f3n Especial',
      'Study Session': 'Sesi\u00f3n de Estudio',
      'Workshop': 'Taller',
      'Special (Closed)': 'Sesi\u00f3n Especial (Cerrada)',
      'Retreat (Offsite)': 'Retiro',
      'Board Meeting': 'Reuni\u00f3n de la Junta',
    },
  },
};

// Spanish date formatter
const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function formatDateEs(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${parseInt(d)} de ${MONTHS_ES[parseInt(m) - 1]} de ${y}`;
}

// ---- Build agenda HTML for a meeting (server-side rendered) ----

function buildAgendaHtml(m, L) {
  if (!m.items || m.items.length === 0) return `<div class="tv-empty">${L.noAgenda}</div>`;

  let html = '';
  let idx = -1;
  for (const item of m.items) {
    idx++;
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

    // Item content: the prose the board reads (Quick Summary, Recommendation,
    // Rationale, Financial Impact for Simbli; the item body for BoardDocs).
    // Rendered server-side so it is visible and Pagefind-indexed; collapsible to
    // keep the agenda list scannable.
    const ic = itemContentFor(m, item, idx, L.lang);
    if (ic && ic.fields.length > 0) {
      html += `<details class="tv-agenda-content"><summary>${escapeHtml(L.itemDetailsLabel)}</summary>`;
      if (ic.usedFallback) html += `<p class="tv-agenda-content-note">${escapeHtml(L.itemDetailsEnNote)}</p>`;
      for (const f of ic.fields) {
        html += '<div class="tv-agenda-field">';
        if (f.label) html += `<span class="tv-agenda-field-label">${escapeHtml(f.label)}</span>`;
        html += `<span class="tv-agenda-field-text">${escapeHtml(f.text)}</span>`;
        html += '</div>';
      }
      html += '</details>';
    }
  }
  return html;
}

// ---- Build minutes HTML ----

function buildMinutesHtml(m, L) {
  if (!m.minutes) return `<div class="tv-empty">${L.noMinutes}</div>`;

  const approvedDate = L.lang === 'es' ? formatDateEs(m.minutes.approvedAt) : formatDate(m.minutes.approvedAt);
  let html = '<div class="tv-minutes-info">';
  html += `<p>${L.minutesApprovedAt(approvedDate)}</p>`;

  if (m.minutes.documents && m.minutes.documents.length > 0) {
    for (const doc of m.minutes.documents) {
      const href = doc.href || '#';
      const r2Path = doc.aid && aidToR2Path[doc.aid];
      const finalHref = r2Path ? `${R2_BASE}/${r2Path}` : href;
      html += `<a class="tv-minutes-link" href="${escapeHtml(finalHref)}" target="_blank" rel="noopener">${escapeHtml(doc.title || L.minutesPdf)}</a>`;
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

// ---- JSON-LD Generator ----

// Strip inline HTML from summaries, looping to a fixpoint so split
// constructions (<scr<b>ipt>) can't reassemble into a tag after one pass.
function stripTags(s) {
  let out = s || '';
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(/<[^>]+>/g, '');
  }
  return out;
}

function meetingJsonLd(m, lang) {
  const isEs = lang === 'es';
  const summaries = summariesByLang[lang] || summariesByLang.en || {};
  const summary = summaries[m.date] || '';
  const cleanSummary = stripTags(summary);

  const memo = participationCtx.memosByDate[m.date] || null;
  const times = extractMeetingTimes(m, memo, participationCtx.announcedIndex);
  const start24 = times.primaryStart?.time24 || '19:00';
  const [startH, startM] = start24.split(':').map(Number);
  const endH = Math.min(23, (Number.isNaN(startH) ? 19 : startH) + 3);
  const end24 = `${String(endH).padStart(2, '0')}:${String(Number.isNaN(startM) ? 0 : startM).padStart(2, '0')}`;

  const startTime = `${start24}:00-07:00`;
  const endTime = `${end24}:00-07:00`;
  const startDate = `${m.date}T${startTime}`;
  const endDate = `${m.date}T${endTime}`;

  const prefix = isEs ? 'reuniones' : 'meetings';
  const isMulti = meetingsByDate[m.date].length > 1;
  const pagePath = isMulti ? m.slug : m.date;
  const canonicalUrl = `https://rcsd.info/${prefix}/${pagePath}/`;

  const meetingTypeLabel = isEs ? (LOCALES.es.meetingTypes[m.type] || m.type) : m.type;
  const name = isEs
    ? `Reunión de la Junta de RCSD: Sesión ${meetingTypeLabel} (${formatDateEs(m.date)})`
    : `RCSD School Board Meeting: ${meetingTypeLabel} Session (${formatDate(m.date)})`;

  const description = cleanSummary || (isEs
    ? `Agenda, transcripción y actas de la reunión ${meetingTypeLabel} del Distrito Escolar de Redwood City del ${formatDateEs(m.date)}.`
    : `Agenda, transcript, and minutes for the Redwood City School District ${m.type} board meeting on ${formatDate(m.date)}.`);

  const organizerName = isEs
    ? 'Distrito Escolar de Redwood City - Mesa Directiva'
    : 'Redwood City School District Board of Trustees';

  const meetingId = `https://rcsd.info/meetings/${m.slug}/#meeting`;
  const pageId = `https://rcsd.info/${prefix}/${pagePath}/#webpage`;

  const eventSchema = {
    "@type": "Event",
    "@id": meetingId,
    "name": name,
    "description": description,
    "startDate": startDate,
    "endDate": endDate,
    "eventStatus": "https://schema.org/EventScheduled",
    "eventAttendanceMode": "https://schema.org/MixedEventAttendanceMode",
    "url": canonicalUrl,
    "organizer": {
      "@type": "GovernmentOrganization",
      "name": organizerName,
      "url": "https://www.rcsdk8.net",
      "sameAs": "https://rcsd.info/"
    },
    "location": [
      {
        "@type": "Place",
        "name": isEs ? "Oficina del Distrito Escolar de Redwood City" : "Redwood City School District Office",
        "address": {
          "@type": "PostalAddress",
          "streetAddress": "750 Bradford Street",
          "addressLocality": "Redwood City",
          "addressRegion": "CA",
          "postalCode": "94063",
          "addressCountry": "US"
        }
      }
    ]
  };

  if (m.zoom) {
    eventSchema.location.push({
      "@type": "VirtualLocation",
      "name": "Zoom Webinar",
      "url": m.zoom
    });
  } else if (m.youtube) {
    eventSchema.location.push({
      "@type": "VirtualLocation",
      "name": "YouTube Live Stream",
      "url": `https://www.youtube.com/watch?v=${m.youtube}`
    });
  }

  if (m.youtube) {
    eventSchema.recordedIn = {
      "@type": "VideoObject",
      "name": isEs ? `Grabación de la reunión de la junta - ${formatDateEs(m.date)}` : `School Board Meeting Recording - ${formatDate(m.date)}`,
      "description": description,
      "uploadDate": `${m.date}T19:00:00-07:00`,
      "thumbnailUrl": `https://img.youtube.com/vi/${m.youtube}/maxresdefault.jpg`,
      "embedUrl": `https://www.youtube.com/embed/${m.youtube}`
    };
  }

  const subjectOf = [];
  const minutesPdf = `${m.date}-minutes.pdf`;
  if (existsSync(resolve(ROOT, 'artifacts/minutes', minutesPdf))) {
    subjectOf.push({
      "@type": "DigitalDocument",
      "name": isEs ? "Actas de la reunión (PDF)" : "Official Meeting Minutes (PDF)",
      "url": `${R2_BASE}/minutes/${minutesPdf}`,
      "encodingFormat": "application/pdf"
    });
  } else if (m.minutes && m.minutes.documents && m.minutes.documents.length > 0) {
    for (const doc of m.minutes.documents) {
      const r2Path = doc.aid && aidToR2Path[doc.aid];
      const url = r2Path ? `${R2_BASE}/${r2Path}` : doc.href;
      if (url && url !== '#') {
        subjectOf.push({
          "@type": "DigitalDocument",
          "name": doc.title || (isEs ? "Actas aprobadas" : "Approved Minutes Document"),
          "url": url,
          "encodingFormat": "application/pdf"
        });
      }
    }
  }

  const agendaPdf = `${m.date}-agenda.pdf`;
  if (existsSync(resolve(ROOT, 'artifacts/agendas', agendaPdf))) {
    subjectOf.push({
      "@type": "DigitalDocument",
      "name": isEs ? "Agenda oficial (PDF)" : "Official Meeting Agenda (PDF)",
      "url": `${R2_BASE}/agendas/${agendaPdf}`,
      "encodingFormat": "application/pdf"
    });
  }

  if (subjectOf.length > 0) {
    eventSchema.subjectOf = subjectOf;
  }

  // Construct ItemPage container pointing to the meeting event as its main subject
  const pageSchema = {
    "@context": "https://schema.org",
    "@type": "ItemPage",
    "@id": pageId,
    "url": canonicalUrl,
    "name": name,
    "description": description,
    "inLanguage": isEs ? "es" : "en",
    "about": eventSchema
  };

  const enUrl = `https://rcsd.info/meetings/${pagePath}/`;
  const esUrl = `https://rcsd.info/reuniones/${pagePath}/`;

  if (isEs) {
    pageSchema.translationOfWork = {
      "@type": "ItemPage",
      "@id": `${enUrl}#webpage`,
      "url": enUrl,
      "inLanguage": "en"
    };
  } else {
    pageSchema.workTranslation = {
      "@type": "ItemPage",
      "@id": `${esUrl}#webpage`,
      "url": esUrl,
      "inLanguage": "es"
    };
  }

  return `<script type="application/ld+json">\n${JSON.stringify(pageSchema, null, 2)}\n</script>`;
}

// ---- CSS ----

const pageCSS = `
  /* Same unofficial-site banner pattern as the meetings index pages */
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

  .tv-summary {
    font-family: 'Newsreader', serif;
    font-size: 0.9rem;
    line-height: 1.55;
    color: var(--text-secondary);
    margin-top: 0.5rem;
    max-width: 640px;
  }

  /* AI-provenance label: --text-muted is 5.06:1 on cream (WCAG AA) */
  .ai-label {
    display: block;
    margin-top: 0.25rem;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.62rem;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

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
    font-size: 0.6rem;
    font-weight: 400;
    flex: 0 0 auto;
    width: 1rem;
    /* was 0.5 (≈3.0:1 on white); 0.75 keeps the near-black speaker colors ≥6:1 */
    opacity: 0.75;
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
    font-size: 0.68rem;
    color: var(--green-mid);
    text-decoration: none;
    display: block;
    line-height: 1.6;
    padding: 0.25rem 0;
    min-block-size: 26px;
  }
  .tv-agenda-att:hover { text-decoration: underline; color: var(--green-deep); }

  .tv-agenda-content {
    padding: 0.1rem 0.75rem 0.4rem 3rem;
    font-size: 0.72rem;
  }
  .tv-agenda-content > summary {
    cursor: pointer;
    color: var(--green-mid);
    font-size: 0.68rem;
    font-family: 'IBM Plex Mono', monospace;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    list-style-position: inside;
    padding: 0.25rem 0;
    min-block-size: 26px;
  }
  .tv-agenda-content[open] > summary { margin-bottom: 0.3rem; }
  .tv-agenda-content-note {
    font-size: 0.62rem;
    font-style: italic;
    color: #888;
    margin: 0 0 0.3rem 0;
  }
  .tv-agenda-field { margin-bottom: 0.35rem; line-height: 1.5; }
  .tv-agenda-field-label {
    display: block;
    font-weight: 600;
    color: var(--green-deep);
    font-size: 0.66rem;
  }
  .tv-agenda-field-text { color: #333; white-space: pre-wrap; }

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
    .tv-speaker { width: 0.8rem; font-size: 0.55rem; }
    .tv-agenda-item { padding-left: 0.75rem; }
    .tv-tab { padding: 0.4rem 0.6rem; font-size: 0.65rem; }
  }

  /* ---- Senior-Friendly (55+) Participation Banner, Packet Digest & Deliberation Recap ---- */
  .tv-participation-card,
  .tv-digest-section,
  .tv-recap-section {
    background: #fff;
    border: 1.5px solid var(--rule);
    border-radius: 8px;
    padding: 1.25rem 1.5rem;
    margin-bottom: 1.25rem;
    color: var(--text);
  }

  .tv-participation-card {
    border-left: 5px solid var(--green-deep);
    background: linear-gradient(180deg, #ffffff 0%, #f9fbf8 100%);
  }

  .tv-section-eyebrow {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--green-deep);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.35rem;
  }

  .tv-section-heading {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--green-deep);
    margin: 0 0 0.5rem 0;
    line-height: 1.3;
  }

  .tv-section-lead {
    font-family: 'Newsreader', Georgia, serif;
    font-size: 1rem;
    line-height: 1.6;
    color: var(--text);
    max-width: 72ch;
    margin: 0 0 1rem 0;
  }

  .tv-logistics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .tv-logistics-box {
    background: var(--cream);
    border: 1.5px solid var(--rule);
    border-radius: 6px;
    padding: 0.9rem 1rem;
  }

  .tv-logistics-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--green-deep);
    display: block;
    margin-bottom: 0.35rem;
  }

  .tv-logistics-value {
    font-family: 'Newsreader', Georgia, serif;
    font-size: 1.02rem;
    line-height: 1.5;
    color: var(--text);
    font-weight: 500;
  }

  .tv-logistics-sub {
    font-family: 'Newsreader', Georgia, serif;
    font-size: 0.92rem;
    line-height: 1.5;
    color: var(--text-secondary);
    margin-top: 0.35rem;
  }

  .tv-action-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem;
    align-items: center;
    margin-top: 0.75rem;
  }

  .tv-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    min-block-size: 48px;
    padding: 0.6rem 1rem;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.84rem;
    font-weight: 600;
    line-height: 1.3;
    text-decoration: none;
    border-radius: 6px;
    border: 1.5px solid var(--green-deep);
    background: var(--green-deep);
    color: #fff;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .tv-action-btn:hover {
    background: var(--green-mid);
    border-color: var(--green-mid);
    color: #fff;
    text-decoration: none;
  }
  .tv-action-btn--secondary {
    background: #fff;
    color: var(--green-deep);
    border-color: var(--green-deep);
  }
  .tv-action-btn--secondary:hover {
    background: var(--green-wash);
    color: var(--green-deep);
  }
  .tv-action-btn--whatsapp {
    background: #14532d;
    border-color: #14532d;
    color: #fff;
  }
  .tv-action-btn--whatsapp:hover {
    background: #166534;
    border-color: #166534;
  }

  .tv-action-btn:focus-visible,
  .tv-seek-btn:focus-visible,
  .tv-tab:focus-visible,
  .tv-btn:focus-visible,
  .tv-notice-preview summary:focus-visible,
  .tv-digest-details summary:focus-visible {
    outline: 3px solid var(--green-deep);
    outline-offset: 2px;
  }

  .tv-copy-status {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--green-deep);
  }

  .tv-notice-preview {
    margin-top: 0.75rem;
    border: 1px solid var(--rule);
    border-radius: 6px;
    background: var(--cream);
    padding: 0.5rem 0.85rem;
  }
  .tv-notice-preview > summary {
    cursor: pointer;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--green-deep);
    min-block-size: 36px;
    display: flex;
    align-items: center;
  }
  .tv-notice-pre {
    margin: 0.5rem 0 0.25rem;
    padding: 0.75rem;
    background: #fff;
    border: 1px solid var(--rule-light);
    border-radius: 4px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.82rem;
    line-height: 1.55;
    white-space: pre-wrap;
    color: var(--text);
  }

  .tv-schedule-callout {
    background: #fff8e6;
    border: 1.5px solid #d9a441;
    border-left: 4px solid #9a6700;
    border-radius: 6px;
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
    font-family: 'Newsreader', Georgia, serif;
    font-size: 0.96rem;
    line-height: 1.55;
    color: #4d3800;
  }

  .tv-digest-card,
  .tv-recap-card {
    border: 1.5px solid var(--rule);
    border-radius: 6px;
    padding: 1rem 1.15rem;
    margin-bottom: 0.9rem;
    background: #fcfcfa;
  }

  .tv-card-header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: baseline;
    margin-bottom: 0.5rem;
  }

  .tv-item-pill {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.8rem;
    font-weight: 600;
    padding: 0.15rem 0.55rem;
    border-radius: 4px;
    background: var(--green-pale);
    border: 1.5px solid var(--green-mid);
    color: var(--green-deep);
  }

  .tv-status-pill {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.78rem;
    font-weight: 600;
    padding: 0.15rem 0.55rem;
    border-radius: 4px;
    background: var(--cream);
    border: 1.5px solid var(--rule);
    color: var(--text);
  }
  .tv-status-pill--provisional {
    background: #fff8e6;
    border-color: #9a6700;
    color: #5c3d00;
  }
  .tv-status-pill--reconciled {
    background: #eef6eb;
    border-color: var(--green-mid);
    color: var(--green-deep);
  }

  .tv-card-title {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 1.08rem;
    font-weight: 600;
    color: var(--text);
    margin: 0.15rem 0 0.45rem 0;
    line-height: 1.35;
  }

  .tv-card-body {
    font-family: 'Newsreader', Georgia, serif;
    font-size: 1rem;
    line-height: 1.6;
    color: var(--text);
    max-width: 72ch;
    margin: 0 0 0.6rem 0;
  }

  .tv-baseline-box {
    background: var(--cream);
    border-left: 3px solid var(--green-mid);
    padding: 0.6rem 0.85rem;
    margin: 0.6rem 0;
    font-family: 'Newsreader', Georgia, serif;
    font-size: 0.94rem;
    line-height: 1.55;
    color: var(--text-secondary);
  }

  .tv-citation-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.6rem;
  }

  .tv-citation-link {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-block-size: 40px;
    padding: 0.35rem 0.7rem;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.78rem;
    color: var(--green-deep);
    background: #fff;
    border: 1.5px solid var(--rule);
    border-radius: 4px;
    text-decoration: none;
  }
  .tv-citation-link:hover {
    border-color: var(--green-mid);
    background: var(--green-wash);
    text-decoration: underline;
  }

  .tv-evidence-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.75rem;
    margin-top: 0.65rem;
  }

  .tv-evidence-block {
    border: 1px solid var(--rule);
    border-left: 4px solid var(--green-mid);
    border-radius: 6px;
    padding: 0.75rem 0.95rem;
    background: #fff;
  }
  .tv-evidence-block--discussion { border-left-color: #1d4ed8; }
  .tv-evidence-block--motion { border-left-color: #9a6700; }
  .tv-evidence-block--minutes { border-left-color: var(--green-deep); }

  .tv-evidence-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-secondary);
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.35rem;
  }

  .tv-highlight-list {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 0 0;
  }

  .tv-highlight-item {
    padding: 0.6rem 0;
    border-top: 1px solid var(--rule-light);
    font-family: 'Newsreader', Georgia, serif;
    font-size: 0.98rem;
    line-height: 1.58;
  }

  .tv-seek-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-block-size: 38px;
    padding: 0.25rem 0.6rem;
    margin-right: 0.45rem;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--green-deep);
    background: var(--green-pale);
    border: 1.5px solid var(--green-mid);
    border-radius: 4px;
    cursor: pointer;
  }
  .tv-seek-btn:hover {
    background: var(--green-deep);
    color: #fff;
  }

  .tv-digest-details {
    margin-top: 0.85rem;
    border: 1.5px solid var(--rule);
    border-radius: 6px;
    background: #fff;
    padding: 0.6rem 1rem;
  }
  .tv-digest-details > summary {
    cursor: pointer;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.86rem;
    font-weight: 600;
    color: var(--green-deep);
    min-block-size: 44px;
    display: flex;
    align-items: center;
  }

  @media (pointer: coarse) {
    .tv-action-btn { min-block-size: 52px; }
    .tv-seek-btn { min-block-size: 44px; }
  }

  @media (forced-colors: active) {
    .tv-participation-card,
    .tv-digest-section,
    .tv-recap-section,
    .tv-digest-card,
    .tv-recap-card,
    .tv-evidence-block,
    .tv-action-btn,
    .tv-seek-btn,
    .tv-item-pill,
    .tv-status-pill {
      border: 2px solid ButtonText;
    }
  }
`;

let generated = 0;

// Group meetings by date to detect multi-meeting dates
const meetingsByDate = {};
for (const m of data.meetings) {
  if (!meetingsByDate[m.date]) meetingsByDate[m.date] = [];
  meetingsByDate[m.date].push(m);
}

/**
 * Stage 1: Build Sourced Participation & Community Share Banner HTML.
 * Rendered for Simbli-era meetings with structured board memos.
 */
function buildParticipationBannerHtml(m, L, pagePath) {
  const memo = participationCtx.memosByDate[m.date] || null;
  if (!memo && m.source !== 'simbli') return '';

  const isEs = L.lang === 'es';
  const memoEs = participationCtx.memosEsByDate[m.date] || null;
  const times = extractMeetingTimes(m, memo, participationCtx.announcedIndex);
  const publicComment = extractPublicCommentInfo(m, memo);
  const topHeadlines = extractTopHeadlines(m, memoEs, participationCtx.agendaTitlesEs, 3);

  const dateFormattedEn = formatDate(m.date);
  const dateFormattedEs = formatDateEs(m.date);
  const localTypeEn = m.type;
  const localTypeEs = LOCALES.es.meetingTypes[m.type] || m.type;

  const wa = buildWhatsAppNotice({
    meeting: m,
    dateFormattedEn,
    dateFormattedEs,
    localTypeEn,
    localTypeEs,
    canonicalUrlEn: `https://rcsd.info/meetings/${pagePath}/`,
    canonicalUrlEs: `https://rcsd.info/reuniones/${pagePath}/`,
    times,
    publicComment,
    topHeadlines,
    lang: L.lang,
  });

  // Session schedule text
  const openDisplay = isEs ? times.openSession?.displayEs : times.openSession?.displayEn;
  const closedDisplay = isEs ? times.closedSession?.displayEs : times.closedSession?.displayEn;
  let schedulePrimary = '';
  if (closedDisplay && openDisplay) {
    schedulePrimary = isEs
      ? `Sesión pública: <strong>${escapeHtml(openDisplay)}</strong> &middot; Sesión cerrada: <strong>${escapeHtml(closedDisplay)}</strong>`
      : `Open Session: <strong>${escapeHtml(openDisplay)}</strong> &middot; Closed Session: <strong>${escapeHtml(closedDisplay)}</strong>`;
  } else {
    const startStr = isEs ? times.primaryStart?.displayEs : times.primaryStart?.displayEn;
    schedulePrimary = isEs
      ? `Hora de inicio: <strong>${escapeHtml(startStr || '7:00 p. m.')}</strong>`
      : `Start time: <strong>${escapeHtml(startStr || '7:00 PM')}</strong>`;
  }

  let timeSourceNote = '';
  if (times.timeSource === 'agenda-item') {
    timeSourceNote = isEs
      ? 'Verificado en los puntos de apertura de la agenda oficial.'
      : 'Verified from the official agenda session items.';
  } else if (times.timeSource === 'board-calendar-memo') {
    timeSourceNote = isEs
      ? `Verificado en el Calendario de Reuniones de la Junta (${escapeHtml(times.sourceDetail || 'Simbli')}).`
      : `Verified from the official Board Meeting Calendar (${escapeHtml(times.sourceDetail || 'Simbli')}).`;
  } else {
    timeSourceNote = isEs
      ? 'Horario estándar según el tipo de sesión (el orden de los puntos puede variar en vivo).'
      : 'Standard schedule by session type (live agenda order and duration may vary).';
  }

  // Public comment details
  const pc = publicComment.generalComment || publicComment.closedSessionComment;
  let pcBoxHtml = '';
  let pcButtonsHtml = '';
  if (pc) {
    const secBadge = isEs ? `Punto ${escapeHtml(pc.sectionLabel)}` : `Section ${escapeHtml(pc.sectionLabel)}`;
    const modalityText =
      pc.modality === 'in-person-only'
        ? (isEs ? 'Solo en persona (tarjetas en la entrada)' : 'In-person only (speaker cards at entrance)')
        : (isEs ? 'En persona o por Zoom' : 'In person or via Zoom');
    const scopeText =
      pc.scope === 'closed-session-only'
        ? (isEs ? 'Temas de sesión cerrada' : 'Closed Session items only')
        : pc.scope === 'agenda-only'
          ? (isEs ? 'Temas de la agenda únicamente' : 'Agenda items only')
          : (isEs ? 'Temas dentro o fuera de la agenda' : 'Agenda & non-agenda topics');

    pcBoxHtml = `<div class="tv-logistics-box">
      <span class="tv-logistics-label">${isEs ? `Comentario Público (${secBadge})` : `Public Comment (${secBadge})`}</span>
      <div class="tv-logistics-value">${escapeHtml(modalityText)} &middot; ${pc.minutesPerSpeaker} min</div>
      <div class="tv-logistics-sub">${escapeHtml(scopeText)}. ${isEs ? 'Intérprete en español disponible.' : 'Spanish interpretation available.'}</div>
    </div>`;

    if (pc.formUrlEn) {
      pcButtonsHtml += `<a href="${escapeHtml(pc.formUrlEn)}" class="tv-action-btn tv-action-btn--secondary" target="_blank" rel="noopener">&#9997; ${isEs ? 'Tarjeta de Orador (Inglés)' : 'Speaker Sign-Up Form (English)'}</a>`;
    }
    if (pc.formUrlEs) {
      pcButtonsHtml += `<a href="${escapeHtml(pc.formUrlEs)}" class="tv-action-btn tv-action-btn--secondary" target="_blank" rel="noopener">&#9997; ${isEs ? 'Formulario de Orador (Español)' : 'Speaker Sign-Up Form (Español)'}</a>`;
    }
  }

  const zoomBtnHtml = m.zoom
    ? `<a href="${escapeHtml(m.zoom)}" class="tv-action-btn" target="_blank" rel="noopener">&#128187; ${isEs ? 'Unirse por Zoom' : 'Join Meeting on Zoom'}</a>`
    : '';

  const simbliSourceUrl = m.simbli || 'https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030397';
  const scrapedDate = (memo?.scrapedAt || m.scrapedAt || m.date).slice(0, 10);

  return `
  <section class="tv-participation-card" aria-labelledby="participation-heading">
    <div class="tv-section-eyebrow">
      <span>&#128227; ${isEs ? 'Participación Comunitaria y Acceso Verificado' : 'Verified Attendance & Public Comment Guide'}</span>
    </div>
    <h2 class="tv-section-heading" id="participation-heading">${isEs ? 'Cómo asistir, hablar y compartir esta reunión' : 'How to Attend, Speak & Share This Meeting'}</h2>
    <div class="tv-logistics-grid">
      <div class="tv-logistics-box">
        <span class="tv-logistics-label">${isEs ? 'Horario Oficial de la Sesión' : 'Official Session Start Times'}</span>
        <div class="tv-logistics-value">${schedulePrimary}</div>
        <div class="tv-logistics-sub">${timeSourceNote} ${isEs ? 'No se predicen horas exactas por punto porque la Junta puede cambiar el orden en vivo.' : 'Individual item clock times are not predicted because the Board may reorder items live.'}</div>
      </div>
      <div class="tv-logistics-box">
        <span class="tv-logistics-label">${isEs ? 'Ubicación y Transmisión' : 'In-Person Location & Remote Access'}</span>
        <div class="tv-logistics-value">750 Bradford St, Redwood City, CA 94063</div>
        <div class="tv-logistics-sub">${isEs ? 'Sala de la Mesa Directiva en la Oficina del Distrito' : 'District Office Board Room'}${m.zoom ? (isEs ? ' y seminario web por Zoom.' : ' & Zoom Webinar.') : '.'}</div>
      </div>
      ${pcBoxHtml}
    </div>
    <div class="tv-action-row">
      ${zoomBtnHtml}
      ${pcButtonsHtml}
      <a href="${escapeHtml(wa.whatsappUrl)}" class="tv-action-btn tv-action-btn--whatsapp" target="_blank" rel="noopener">&#128172; ${isEs ? 'Compartir aviso por WhatsApp' : 'Share Notice on WhatsApp'}</a>
      <button type="button" class="tv-action-btn tv-action-btn--secondary tv-copy-notice-btn" data-copy-label="${isEs ? 'Copiar texto del aviso' : 'Copy Notice Text'}" data-copied-label="${isEs ? '¡Aviso copiado!' : 'Notice copied!'}">&#128203; ${isEs ? 'Copiar texto del aviso' : 'Copy Notice Text'}</button>
      <output class="tv-copy-status" aria-live="polite"></output>
    </div>
    <details class="tv-notice-preview">
      <summary>${isEs ? 'Ver texto del aviso para padres y grupos de WhatsApp' : 'Preview formatted notice text for parent groups & WhatsApp'}</summary>
      <pre class="tv-notice-pre" id="whatsapp-notice-text">${escapeHtml(wa.text)}</pre>
    </details>
    <p class="tv-logistics-sub" style="margin-top:0.65rem;margin-bottom:0">
      ${isEs ? 'Fuente oficial:' : 'Official source:'} <a href="${escapeHtml(simbliSourceUrl)}" target="_blank" rel="noopener" style="color:var(--green-deep)">Simbli / GAMUT</a> (${isEs ? 'verificado el' : 'checked'} ${escapeHtml(scrapedDate)}).
    </p>
  </section>`;
}

/**
 * Stage 2: Build Reviewed Pre-Meeting Packet Digest & 100% Consent Calendar Screening HTML.
 */
function buildDocketBriefHtml(m, L) {
  const brief = docketBriefsByDate[m.date];
  if (!brief) return '';

  const isEs = L.lang === 'es';
  const overview = isEs ? brief.overviewEs : brief.overviewEn;
  const scheduleNote = isEs ? brief.scheduleChangesNoteEs : brief.scheduleChangesNoteEn;
  const stageBadge =
    brief.meetingStage === 'proposed'
      ? (isEs ? 'Propuestas en el Paquete — Antes de la Votación' : 'Proposed in Board Packet — Pre-Meeting Digest')
      : (isEs ? 'Análisis del Paquete de la Agenda' : 'Board Packet Digest & Baseline Analysis');

  const scheduleHtml = scheduleNote
    ? `<div class="tv-schedule-callout"><strong>${isEs ? 'Nota sobre el calendario y orden del día:' : 'Schedule & Docket Note:'}</strong> ${escapeHtml(scheduleNote)}</div>`
    : '';

  const topCardsHtml = (brief.topItems || [])
    .map((item) => {
      const title = isEs ? item.titleEs : item.titleEn;
      const badge = isEs ? item.proposalStatusBadgeEs : item.proposalStatusBadgeEn;
      const whatText = isEs ? item.whatIsProposedEs : item.whatIsProposedEn;
      const whyText = isEs ? item.whyItMattersEs : item.whyItMattersEn;
      const minBadge = item.allocatedMinutes
        ? `<span class="tv-status-pill">${item.allocatedMinutes} ${isEs ? 'min asignados' : 'min allocated'}</span>`
        : '';

      let baselineHtml = '';
      if (item.baselineContext) {
        const bc = item.baselineContext;
        const metricLabel = isEs ? bc.metricNameEs : bc.metricNameEn;
        const noteText = isEs ? bc.priorBaselineNoteEs : bc.priorBaselineNoteEn;
        baselineHtml = `<div class="tv-baseline-box">
          <strong>${isEs ? 'Base comparativa y estado de certificación' : 'Comparable Baseline & Certification Context'} (${escapeHtml(metricLabel)}):</strong><br>
          ${isEs ? 'Fecha de corte:' : 'Census / Cut Date:'} <code>${escapeHtml(bc.censusDate)}</code> &middot;
          ${isEs ? 'Periodo fiscal:' : 'Fiscal Period:'} <code>${escapeHtml(bc.fiscalPeriod)}</code><br>
          ${escapeHtml(noteText)}
        </div>`;
      }

      const citationsHtml = (item.citations || [])
        .map((cit) => {
          const label = isEs ? (cit.labelEs || cit.labelEn) : cit.labelEn;
          const href = cit.r2Url || cit.url || '#';
          const pageSuffix = cit.pageRange ? ` (${cit.pageRange})` : '';
          return `<a href="${escapeHtml(href)}" class="tv-citation-link" target="_blank" rel="noopener">&#128196; ${escapeHtml(label + pageSuffix)}</a>`;
        })
        .join('');

      return `<article class="tv-digest-card">
        <div class="tv-card-header">
          <span class="tv-item-pill">${isEs ? 'Punto' : 'Item'} ${escapeHtml(item.itemLabel)}</span>
          ${minBadge}
          <span class="tv-status-pill tv-status-pill--provisional">${escapeHtml(badge)}</span>
        </div>
        <h3 class="tv-card-title">${escapeHtml(title)}</h3>
        <p class="tv-card-body"><strong>${isEs ? 'Lo que propone el paquete:' : 'What the packet proposes:'}</strong> ${escapeHtml(whatText)}</p>
        <p class="tv-card-body"><strong>${isEs ? 'Por qué es importante:' : 'Why it matters:'}</strong> ${escapeHtml(whyText)}</p>
        ${baselineHtml}
        <div class="tv-citation-list">${citationsHtml}</div>
      </article>`;
    })
    .join('\n');

  const cs = brief.consentScreening;
  let consentHtml = '';
  if (cs && cs.totalConsentItems > 0) {
    const spotlightCards = (cs.spotlightItems || [])
      .map((sp) => {
        const title = isEs ? sp.titleEs : sp.titleEn;
        const summary = isEs ? sp.summaryEs : sp.summaryEn;
        const funding = isEs ? sp.fundingSourceEs : sp.fundingSourceEn;
        const cits = (sp.citations || [])
          .map((cit) => {
            const label = isEs ? (cit.labelEs || cit.labelEn) : cit.labelEn;
            const href = cit.r2Url || cit.url || '#';
            return `<a href="${escapeHtml(href)}" class="tv-citation-link" target="_blank" rel="noopener">&#128196; ${escapeHtml(label)}</a>`;
          })
          .join('');
        return `<div class="tv-digest-card">
          <div class="tv-card-header">
            <span class="tv-item-pill">${isEs ? 'Consentimiento' : 'Consent'} ${escapeHtml(sp.itemLabel)}</span>
            <span class="tv-status-pill"><strong>${escapeHtml(sp.amountDisplay || '')}</strong></span>
          </div>
          <h4 class="tv-card-title">${escapeHtml(title)}</h4>
          <p class="tv-card-body">${escapeHtml(summary)}</p>
          <p class="tv-logistics-sub" style="margin:0 0 0.4rem 0"><strong>${isEs ? 'Fuente de financiamiento:' : 'Funding source:'}</strong> ${escapeHtml(funding || 'N/A')}</p>
          <div class="tv-citation-list">${cits}</div>
        </div>`;
      })
      .join('\n');

    const extractionNotesHtml =
      cs.extractionNotes && cs.extractionNotes.length > 0
        ? `<div class="tv-baseline-box" style="margin-top:0.75rem">
            <strong>${isEs ? 'Notas de transparencia sobre documentos escaneados o enlaces externos:' : 'Document Extraction & Scanned-PDF Provenance Notes:'}</strong>
            <ul style="margin:0.35rem 0 0 1.2rem;padding:0">
              ${cs.extractionNotes
                .map(
                  (n) =>
                    `<li><strong>${isEs ? 'Punto' : 'Item'} ${escapeHtml(n.itemLabel)}:</strong> ${escapeHtml(isEs ? n.noteEs : n.noteEn)}</li>`
                )
                .join('')}
            </ul>
          </div>`
        : '';

    const routineSummary = isEs ? cs.routineSummaryEs : cs.routineSummaryEn;

    consentHtml = `
      <details class="tv-digest-details" open>
        <summary>${
          isEs
            ? `Revisión del 100% del Calendario de Consentimiento (${spotlightedCount(cs)} de ${cs.totalConsentItems} puntos destacados ≥ $50K, Políticas o Medida U)`
            : `100% Consent Calendar Screening (${spotlightedCount(cs)} of ${cs.totalConsentItems} items spotlighted ≥ $50K, Policy Revisions, or Measure U)`
        }</summary>
        <div style="margin-top:0.75rem">
          ${spotlightCards}
          <p class="tv-card-body" style="margin-top:0.75rem"><strong>${isEs ? 'Puntos de consentimiento de rutina restantes:' : 'Remaining routine consent items:'}</strong> ${escapeHtml(routineSummary)}</p>
          ${extractionNotesHtml}
        </div>
      </details>`;
  }

  const checkedDate = (brief._metadata?.generatedAt || brief._metadata?.scrapedAt || brief.date).slice(0, 10);

  return `
  <section class="tv-digest-section" id="packet-digest" aria-labelledby="digest-heading">
    <div class="tv-section-eyebrow">
      <span>&#128209; ${escapeHtml(stageBadge)}</span>
    </div>
    <h2 class="tv-section-heading" id="digest-heading">${isEs ? 'Resumen Verificado del Paquete de la Junta y Calendario de Consentimiento' : 'Reviewed Board Packet Digest & Consent Calendar Spotlight'}</h2>
    <p class="tv-section-lead">${escapeHtml(overview)}</p>
    ${scheduleHtml}
    ${topCardsHtml}
    ${consentHtml}
    <p class="tv-logistics-sub" style="margin-top:0.75rem;margin-bottom:0">
      ${isEs ? 'Metodología y procedencia:' : 'Provenance & methodology:'} ${
        isEs
          ? 'Verificado a partir del memorando oficial en Simbli y los PDFs archivados en R2'
          : 'Verified against official Simbli board memos and R2-archived packet PDFs'
      } (<a href="${escapeHtml(brief._metadata?.source || '#')}" target="_blank" rel="noopener" style="color:var(--green-deep)">Simbli</a>, ${isEs ? 'actualizado el' : 'checked'} ${escapeHtml(checkedDate)}).
    </p>
  </section>`;
}

/**
 * Stage 3: Build Evidence-Typed Post-Meeting Deliberation Recap HTML.
 */
function buildDeliberationRecapHtml(m, L) {
  const recap = deliberationRecapsByDate[m.date];
  if (!recap) return '';

  const isEs = L.lang === 'es';
  const overview = isEs ? recap.overviewEs : recap.overviewEn;
  const reorderNote = isEs ? recap.agendaReorderNoteEs : recap.agendaReorderNoteEn;

  const reorderHtml = reorderNote
    ? `<div class="tv-schedule-callout"><strong>${isEs ? 'Cambio en el orden de la agenda durante la transmisión:' : 'Live Agenda Reorder on Video:'}</strong> ${escapeHtml(reorderNote)}</div>`
    : '';

  const itemsHtml = (recap.items || [])
    .map((item) => {
      const title = isEs ? item.titleEs : item.titleEn;
      const propText = isEs ? item.proposal.textEs : item.proposal.textEn;
      const discSummary = isEs ? item.discussion.summaryEs : item.discussion.summaryEn;
      const motionText = isEs ? item.motion_recorded.textEs : item.motion_recorded.textEn;
      const minutesText = isEs ? item.minutes_reconciled.textEs : item.minutes_reconciled.textEn;

      const propCitations = (item.proposal.citations || [])
        .map((cit) => {
          const label = isEs ? (cit.labelEs || cit.labelEn) : cit.labelEn;
          const href = cit.r2Url || cit.url || '#';
          return `<a href="${escapeHtml(href)}" class="tv-citation-link" target="_blank" rel="noopener">&#128196; ${escapeHtml(label)}</a>`;
        })
        .join('');

      const highlightsHtml = (item.discussion.highlights || [])
        .map((hl) => {
          const speaker = isEs ? hl.speakerLabelEs : hl.speakerLabelEn;
          const text = isEs ? hl.textEs : hl.textEn;
          return `<li class="tv-highlight-item">
            <button type="button" class="tv-seek-btn" data-seek-sec="${hl.startSeconds}" title="${isEs ? 'Saltar a este momento en el video' : 'Seek video player to this timestamp'}">&#9654; ${escapeHtml(hl.timestampDisplay)}</button>
            <strong>${escapeHtml(speaker)}:</strong> ${escapeHtml(text)}
          </li>`;
        })
        .join('\n');

      const motionSeekBtn =
        item.motion_recorded.startSeconds != null && item.motion_recorded.timestampDisplay
          ? `<button type="button" class="tv-seek-btn" data-seek-sec="${item.motion_recorded.startSeconds}">&#9654; ${escapeHtml(item.motion_recorded.timestampDisplay)}</button>`
          : '';

      const minutesBadgeClass =
        item.minutes_reconciled.status === 'reconciled'
          ? 'tv-status-pill tv-status-pill--reconciled'
          : 'tv-status-pill tv-status-pill--provisional';
      const minutesBadgeLabel =
        item.minutes_reconciled.status === 'reconciled'
          ? (isEs ? 'Actas Oficiales Aprobadas' : 'Official Minutes Approved')
          : item.minutes_reconciled.status === 'draft-in-subsequent-packet'
            ? (isEs ? 'Borrador de Actas Publicado' : 'Draft Minutes in Subsequent Packet')
            : (isEs ? 'Actas Oficiales Pendientes' : 'Formal Minutes Pending Approval');

      const minutesLinkHtml = item.minutes_reconciled.minutesUrl
        ? `<div class="tv-citation-list"><a href="${escapeHtml(item.minutes_reconciled.minutesUrl)}" class="tv-citation-link" target="_blank" rel="noopener">&#128196; ${isEs ? 'Ver PDF de Actas' : 'View Minutes PDF'}</a></div>`
        : '';

      const reportSubject = encodeURIComponent(
        `Correction request: RCSD Meeting ${recap.date} Item ${item.itemLabel}`
      );

      return `<article class="tv-recap-card">
        <div class="tv-card-header">
          <span class="tv-item-pill">${isEs ? 'Punto' : 'Item'} ${escapeHtml(item.itemLabel)}</span>
          ${item.motion_recorded.tally ? `<span class="tv-status-pill">${escapeHtml(item.motion_recorded.tally)}</span>` : ''}
          <span class="${minutesBadgeClass}">${escapeHtml(minutesBadgeLabel)}</span>
        </div>
        <h3 class="tv-card-title">${escapeHtml(title)}</h3>

        <div class="tv-evidence-grid">
          <div class="tv-evidence-block">
            <div class="tv-evidence-label">
              <span>1. ${isEs ? 'Propuesta en el Paquete Oficial' : 'Packet Proposal (Staff Memo & Attachments)'}</span>
            </div>
            <p class="tv-card-body" style="margin-bottom:0.35rem">${escapeHtml(propText)}</p>
            <div class="tv-citation-list">${propCitations}</div>
          </div>

          <div class="tv-evidence-block tv-evidence-block--discussion">
            <div class="tv-evidence-label">
              <span>2. ${isEs ? 'Deliberación en Video y Comentarios Públicos' : 'Video Discussion & Public Testimony (Interval-Verified)'}</span>
            </div>
            <p class="tv-card-body" style="margin-bottom:0.35rem">${escapeHtml(discSummary)}</p>
            <ul class="tv-highlight-list">
              ${highlightsHtml}
            </ul>
          </div>

          <div class="tv-evidence-block tv-evidence-block--motion">
            <div class="tv-evidence-label">
              <span>3. ${isEs ? 'Moción y Votación en Video (Registro Provisional)' : 'Spoken Motion & Vote on Video (Provisional Record)'}</span>
            </div>
            <p class="tv-card-body" style="margin-bottom:0">${motionSeekBtn}${escapeHtml(motionText)}</p>
          </div>

          <div class="tv-evidence-block tv-evidence-block--minutes">
            <div class="tv-evidence-label">
              <span>4. ${isEs ? 'Conciliación con Actas Oficiales' : 'Official Minutes Reconciliation'}</span>
              <a href="mailto:team@rcsd.info?subject=${reportSubject}" style="color:var(--green-deep);text-decoration:underline;text-transform:none">${isEs ? 'Solicitar corrección' : 'Report an error'}</a>
            </div>
            <p class="tv-card-body" style="margin-bottom:0">${escapeHtml(minutesText)}</p>
            ${minutesLinkHtml}
          </div>
        </div>
      </article>`;
    })
    .join('\n');

  return `
  <section class="tv-recap-section" id="deliberation-recap" aria-labelledby="recap-heading">
    <div class="tv-section-eyebrow">
      <span>&#9878; ${isEs ? 'Recapitulación Post-Reunión con Evidencia Separada' : 'Evidence-Typed Post-Meeting Deliberation Recap'}</span>
    </div>
    <h2 class="tv-section-heading" id="recap-heading">${isEs ? 'Lo que se propuso, lo que se discutió y cómo votó la Junta' : 'What Was Proposed, What Was Said & How the Board Voted'}</h2>
    <p class="tv-section-lead">${escapeHtml(overview)}</p>
    ${reorderHtml}
    ${itemsHtml}
    <p class="tv-logistics-sub" style="margin-top:0.75rem;margin-bottom:0">
      ${
        isEs
          ? 'Nota de integridad probatoria: Cada punto distingue entre (1) la propuesta del paquete, (2) las intervenciones en video con marca de tiempo verificada por intervalo, (3) la votación hablada en video (provisional) y (4) las actas oficiales aprobadas.'
          : 'Evidentiary integrity note: Every item strictly separates (1) the pre-meeting packet proposal, (2) interval-verified video discussion timestamps, (3) provisional spoken votes on video, and (4) formally approved minutes.'
      }
      <a href="mailto:team@rcsd.info?subject=${encodeURIComponent(`Correction request: RCSD Meeting ${recap.date}`)}" style="color:var(--green-deep);text-decoration:underline">${isEs ? 'Reportar un error o solicitar corrección' : 'Report an error or request a correction'}</a>.
    </p>
  </section>`;
}

/**
 * Generate a single meeting detail page.
 * @param {Object} m - meeting data object
 * @param {Object} L - locale strings
 */
function generateMeetingPage(m, L) {
  const hasVideo = !!m.youtube;
  const hasTranscript = m.hasTranscript && hasVideo;

  const siblings = meetingsByDate[m.date];
  const isMulti = siblings.length > 1;

  // For multi-meeting dates, use slug-based paths; for single, use date
  const pagePath = isMulti ? m.slug : m.date;
  const outDir = resolve(ROOT, `docs/${L.prefix}/${pagePath}`);
  mkdirSync(outDir, { recursive: true });

  const transcriptUrl = hasTranscript ? `${R2_BASE}/transcripts/${m.date}.json` : null;
  const dateFormatted = L.lang === 'es' ? formatDateEs(m.date) : formatDate(m.date);
  const localType = L.meetingTypes[m.type] || m.type;
  const title = L.pageTitle(localType, dateFormatted);
  const description = L.pageDesc(localType, dateFormatted);
  const canonicalPath = `/${L.prefix}/${pagePath}/`;

  const hasMinutes = !!(m.minutes && (m.minutes.documents?.length > 0 || existsSync(resolve(ROOT, 'artifacts/minutes', `${m.date}-minutes.pdf`))));
  const hasAgenda = m.items && m.items.length > 0;
  const agendaHtml = buildAgendaHtml(m, L);
  const minutesHtml = buildMinutesHtml(m, L);

  // Default tab: agenda if no transcript, otherwise transcript
  const defaultTab = hasTranscript ? 'transcript' : 'agenda';

  // Summary for this meeting (Claude-written prose from
  // generate-meeting-summaries.mjs — must carry a visible AI label)
  const summaries = summariesByLang[L.lang] || summariesByLang.en || {};
  const summary = summaries[m.date] || null;
  const summaryHtml = summary
    ? `<p class="tv-summary">${escapeHtml(summary).replace(/&lt;(\/?strong)&gt;/g, '<$1>')}</p>
    <p class="ai-label">${L.aiSummaryNote}</p>`
    : '';

  // Same page path in the other language (EN /meetings/ ↔ ES /reuniones/)
  const altLangHref = `/${L.lang === 'es' ? 'meetings' : 'reuniones'}/${pagePath}/`;

  const participationBannerHtml = buildParticipationBannerHtml(m, L, pagePath);
  const docketBriefHtml = buildDocketBriefHtml(m, L);
  const deliberationRecapHtml = buildDeliberationRecapHtml(m, L);

  const html = `<!DOCTYPE html>
<html lang="${L.lang}">
<head>
${headMeta({
  title,
  description,
  canonical: `https://rcsd.info${canonicalPath}`,
  ogLocale: L.lang === 'es' ? 'es_US' : 'en_US',
  ogImageKey: `meeting-${m.slug}${L.lang === 'es' ? '-es' : ''}`,
  hreflang: [
    { lang: L.lang, href: `https://rcsd.info${canonicalPath}` },
    { lang: L.lang === 'es' ? 'en' : 'es', href: `https://rcsd.info${altLangHref}` },
  ],
  jsonLd: meetingJsonLd(m, L.lang),
  pageCSS,
})}
</head>
<body>
${siteNav({ activePage: 'meetings', lang: L.lang, altLangHref })}

<div class="disclaimer">
  ${L.disclaimer} <a href="https://github.com/dweekly/rcsd-meetings" style="color:#664d03">David Weekly</a>. ${L.disclaimerSuffix} <a href="mailto:team@rcsd.info" style="color:#664d03">${L.disclaimerContact}</a>.
</div>

<main class="tv-layout">
  <div class="tv-header">
    <a href="${L.backHref}" class="tv-back">${L.backLabel}</a>
    <h1 class="tv-title">${L.meetingTitle(escapeHtml(localType), dateFormatted)}</h1>
    <div class="tv-meta">
      ${m.duration ? `${m.duration} &middot; ` : ''}
      ${hasVideo ? `<a href="https://www.youtube.com/watch?v=${m.youtube}" target="_blank" rel="noopener">YouTube</a>` : ''}
      ${m.simbli ? `${hasVideo ? ' &middot; ' : ''}<a href="${escapeHtml(m.simbli)}" target="_blank" rel="noopener">Simbli</a>` : ''}
      ${m.boarddocs ? `${hasVideo || m.simbli ? ' &middot; ' : ''}<a href="${escapeHtml(m.boarddocs)}" target="_blank" rel="noopener">BoardDocs</a>` : ''}
    </div>
    ${summaryHtml}
  </div>

  ${participationBannerHtml}
  ${deliberationRecapHtml}
  ${docketBriefHtml}

  <div class="tv-main">
    <div class="tv-video-col">
      ${hasVideo ? `<div class="tv-video-wrap"><div id="yt-player"></div></div>` : ''}
      <div class="tv-tabs">
        <button class="tv-tab${defaultTab === 'transcript' ? ' active' : ''}" data-tab="transcript"${hasTranscript ? '' : ' disabled'}>${L.tabTranscript}</button>
        <button class="tv-tab${defaultTab === 'agenda' ? ' active' : ''}" data-tab="agenda"${hasAgenda ? '' : ' disabled'}>${L.tabAgenda}</button>
        <button class="tv-tab" data-tab="minutes"${hasMinutes ? '' : ' disabled'}>${L.tabMinutes}</button>
      </div>
      ${hasTranscript ? `<div class="tv-controls" id="transcript-controls"${defaultTab !== 'transcript' ? ' style="display:none"' : ''}>
        <button class="tv-btn active" id="btn-autoscroll">${L.autoScroll}</button>
        <button class="tv-btn" id="btn-lang" title="${L.toggleSpanish}">${L.esToggle}</button>
        <input class="tv-search" type="text" id="search-input" placeholder="${L.searchPlaceholder}">
      </div>` : ''}
    </div>

    <div class="tv-panel tv-transcript-panel${defaultTab === 'transcript' ? ' active' : ''}" id="panel-transcript">
      ${hasTranscript ? `<div style="padding:1rem;color:var(--text-muted);font-style:italic">${L.loadingTranscript}</div>` : `<div class="tv-empty">${L.noTranscript}</div>`}
    </div>

    <div class="tv-panel tv-agenda-panel${defaultTab === 'agenda' ? ' active' : ''}" id="panel-agenda">
      ${agendaHtml}
    </div>

    <div class="tv-panel tv-minutes-panel" id="panel-minutes">
      ${minutesHtml}
    </div>
  </div>

  ${transcriptUrl ? `<div class="tv-download"><a href="${transcriptUrl}" target="_blank" rel="noopener" download>${L.downloadTranscript}</a></div>` : ''}
</main>

${siteFooter({ lang: L.lang })}

<script>
(function() {
  var videoId = ${JSON.stringify(m.youtube || null)};
  var transcriptUrlEn = ${JSON.stringify(transcriptUrl)};
  var transcriptUrlEs = ${JSON.stringify(transcriptUrl ? transcriptUrl.replace('.json', '-es.json') : null)};
  var defaultLangEs = ${L.lang === 'es' ? 'true' : 'false'};
  var transcriptUrl = defaultLangEs ? transcriptUrlEs : transcriptUrlEn;
  var speakerColors = ${JSON.stringify(SPEAKER_COLORS)};
  var player = null;
  var utterances = [];
  var utterancesEn = null;
  var utterancesEs = null;
  var speakerMap = {};
  var autoScroll = true;
  var activeIdx = -1;
  var renderedUtterances = [];
  var activeTab = ${JSON.stringify(defaultTab)};
  var currentLang = defaultLangEs ? 'es' : 'en';

  // Handle #hash on load to activate the corresponding tab
  function activateTabFromHash() {
    var hash = location.hash.replace('#', '');
    if (!hash) return;
    var tab = document.querySelector('.tv-tab[data-tab="' + hash + '"]');
    if (tab && !tab.disabled) {
      tab.click();
    }
  }

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
      if (transcriptControls) transcriptControls.style.display = activeTab === 'transcript' ? '' : 'none';
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

  // ---- Deliberation Recap timestamp seek buttons ----
  document.querySelectorAll('.tv-seek-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var sec = parseInt(btn.dataset.seekSec, 10);
      if (isNaN(sec)) return;
      if (player && player.seekTo) {
        seekTo(sec * 1000);
        var videoEl = document.querySelector('.tv-video-col');
        if (videoEl && videoEl.scrollIntoView) {
          videoEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      } else if (videoId) {
        window.open('https://www.youtube.com/watch?v=' + videoId + '&t=' + sec + 's', '_blank', 'noopener');
      }
    });
  });

  // ---- Copy WhatsApp Notice button ----
  var copyNoticeBtn = document.querySelector('.tv-copy-notice-btn');
  var noticePre = document.getElementById('whatsapp-notice-text');
  var copyStatus = document.querySelector('.tv-copy-status');
  if (copyNoticeBtn && noticePre) {
    copyNoticeBtn.addEventListener('click', function() {
      var textToCopy = noticePre.textContent || '';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(textToCopy).then(function() {
          if (copyStatus) copyStatus.textContent = copyNoticeBtn.dataset.copiedLabel || 'Copied!';
          setTimeout(function() {
            if (copyStatus) copyStatus.textContent = '';
          }, 4000);
        });
      }
    });
  }

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
    return label;
  }

  function speakerColor(label) {
    return speakerColors[label.charCodeAt(0) % speakerColors.length];
  }

  // Split long utterances into ~3-sentence paragraphs with interpolated timestamps
  function splitUtterance(u) {
    var text = u.text || '';
    if (text.length < 300) return [u];

    // Split on sentence boundaries (period/question/exclamation followed by space and capital).
    // This code is emitted inside a JS template literal, so the regex backslash must be
    // double-escaped (\\s) or it cooks to the literal "s" in the published HTML and
    // silently drops nearly all text of every utterance >= 300 chars.
    var sentences = text.match(/[^.!?]*[.!?]+(?:\\s+|$)/g) || [text];
    var chunks = [];
    var current = '';
    var sentenceCount = 0;
    var chunkStart = 0;

    for (var s = 0; s < sentences.length; s++) {
      current += sentences[s];
      sentenceCount++;
      if (sentenceCount >= 3 || s === sentences.length - 1) {
        var fraction = chunks.length / Math.max(1, Math.ceil(sentences.length / 3));
        var startMs = Math.round(u.start + (u.end - u.start) * (chunkStart / sentences.length));
        chunks.push({ start: startMs, end: u.end, speaker: u.speaker, text: current.trim() });
        current = '';
        chunkStart = s + 1;
        sentenceCount = 0;
      }
    }
    return chunks.length > 0 ? chunks : [u];
  }

  function renderTranscript() {
    var container = document.getElementById('panel-transcript');
    container.textContent = '';

    // Flatten utterances into smaller chunks for readability
    renderedUtterances = [];
    utterances.forEach(function(u) {
      var parts = splitUtterance(u);
      for (var p = 0; p < parts.length; p++) renderedUtterances.push(parts[p]);
    });

    renderedUtterances.forEach(function(u, i) {
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
    // Fetch primary transcript (ES for Spanish pages, EN otherwise)
    var primaryUrl = defaultLangEs ? transcriptUrlEs : transcriptUrlEn;
    var secondaryUrl = defaultLangEs ? transcriptUrlEn : transcriptUrlEs;

    fetch(primaryUrl)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (defaultLangEs) { utterancesEs = data.utterances; } else { utterancesEn = data.utterances; }
        utterances = data.utterances;
        speakerMap = data.speakers || {};
        renderTranscript();
        setInterval(syncHighlight, 250);
        // Update lang button to reflect current state
        var btn = document.getElementById('btn-lang');
        if (btn) btn.textContent = defaultLangEs ? 'EN' : 'ES';
      })
      .catch(function() {
        // Friendly fallback: the raw EN transcript JSON on data.rcsd.info is
        // the canonical artifact, so link it even when this page's fetch fails
        var c = document.getElementById('panel-transcript');
        c.textContent = '';
        var msg = document.createElement('div');
        msg.className = 'tv-empty';
        msg.textContent = ${JSON.stringify(L.failedTranscript)};
        var link = document.createElement('a');
        link.href = transcriptUrlEn;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = ${JSON.stringify(L.failedTranscriptLink)};
        msg.appendChild(document.createElement('br'));
        msg.appendChild(link);
        c.appendChild(msg);
      });

    // Pre-fetch secondary language
    if (secondaryUrl) {
      fetch(secondaryUrl)
        .then(function(r) { if (!r.ok) throw new Error(); return r.json(); })
        .then(function(data) {
          if (defaultLangEs) { utterancesEn = data.utterances; } else { utterancesEs = data.utterances; }
          // Enable the lang toggle button
          var btn = document.getElementById('btn-lang');
          if (btn) btn.style.opacity = '1';
        })
        .catch(function() {
          // No Spanish translation available -- disable button
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
      for (var i = renderedUtterances.length - 1; i >= 0; i--) {
        if (renderedUtterances[i].start <= currentMs) { newIdx = i; break; }
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

    // Agenda sync -- highlight current agenda item
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
        langBtn.title = ${JSON.stringify(L.switchToEn)};
      } else {
        currentLang = 'en';
        utterances = utterancesEn;
        langBtn.textContent = 'ES';
        langBtn.classList.remove('active');
        langBtn.title = ${JSON.stringify(L.toggleSpanish)};
      }
      activeIdx = -1;
      renderTranscript();
    });
  }

  // Search
  var searchInput = document.getElementById('search-input');
  var searchTimeout = null;
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(doSearch, 200);
    });
  }

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

  // Activate tab from URL hash on load
  activateTabFromHash();
  window.addEventListener('hashchange', activateTabFromHash);
})();
</script>
</body>
</html>`;

  writeFileSync(resolve(outDir, 'index.html'), html);
  generated++;
}

// ---- Disambiguation page CSS ----
const disambigCSS = `
  /* Same unofficial-site banner pattern as the meetings index pages */
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

/**
 * Generate disambiguation page for dates with multiple meetings.
 * @param {string} date - YYYY-MM-DD
 * @param {Array} meetings - array of meeting objects for that date
 * @param {Object} L - locale strings
 */
function generateDisambigPage(date, meetings, L) {
  const outDir = resolve(ROOT, `docs/${L.prefix}/${date}`);
  mkdirSync(outDir, { recursive: true });
  const dateFormatted = L.lang === 'es' ? formatDateEs(date) : formatDate(date);
  const altLangHref = `/${L.lang === 'es' ? 'meetings' : 'reuniones'}/${date}/`;

  const links = meetings.map(m => {
    const href = `/${L.prefix}/${m.slug}/`;
    const localType = L.meetingTypes[m.type] || m.type;
    return `<a href="${href}" class="tv-disambig-link">
      <span class="tv-disambig-type">${escapeHtml(localType)}</span>
      <span class="tv-disambig-items">${L.disambigItemCount(m.items?.length || 0)}</span>
    </a>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="${L.lang}">
<head>
${headMeta({
  title: `${L.lang === 'es' ? 'Reuniones' : 'Meetings'} — ${dateFormatted}`,
  description: `${L.disambigMultiple}`,
  canonical: `https://rcsd.info/${L.prefix}/${date}/`,
  ogLocale: L.lang === 'es' ? 'es_US' : 'en_US',
  ogImageKey: `page-meetings${L.lang === 'es' ? '-es' : ''}`,
  hreflang: [
    { lang: L.lang, href: `https://rcsd.info/${L.prefix}/${date}/` },
    { lang: L.lang === 'es' ? 'en' : 'es', href: `https://rcsd.info${altLangHref}` },
  ],
  pageCSS: disambigCSS,
})}
</head>
<body>
${siteNav({ activePage: 'meetings', lang: L.lang, altLangHref })}
<div class="disclaimer">
  ${L.disclaimer} <a href="https://github.com/dweekly/rcsd-meetings" style="color:#664d03">David Weekly</a>. ${L.disclaimerSuffix} <a href="mailto:team@rcsd.info" style="color:#664d03">${L.disclaimerContact}</a>.
</div>
<main class="tv-disambig">
  <a href="${L.backHref}" style="font-family:'IBM Plex Mono',monospace;font-size:0.75rem;color:var(--text-muted);text-decoration:none">${L.backLabel}</a>
  <h1>${dateFormatted}</h1>
  <p>${L.disambigMultiple}</p>
  ${links}
</main>
${siteFooter({ lang: L.lang })}
</body>
</html>`;

  writeFileSync(resolve(outDir, 'index.html'), html);
}

// ---- Main: generate all pages for both languages ----

for (const locale of ['en', 'es']) {
  const L = LOCALES[locale];

  for (const m of data.meetings) {
    generateMeetingPage(m, L);
  }

  // Generate disambiguation pages for multi-meeting dates
  const multiDates = Object.entries(meetingsByDate).filter(([, ms]) => ms.length > 1);
  for (const [date, meetings] of multiDates) {
    generateDisambigPage(date, meetings, L);
  }
}

console.log(`Generated ${generated} meeting detail pages (${Object.entries(meetingsByDate).filter(([,ms]) => ms.length > 1).length} disambiguation pages, both EN + ES)`);
