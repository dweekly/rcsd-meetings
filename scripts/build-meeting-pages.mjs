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
import { escapeHtml, formatSec, formatDate, R2_BASE, buildAidToR2Path } from './meeting-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const data = JSON.parse(readFileSync(resolve(ROOT, 'data/meetings-data.json'), 'utf-8'));

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

  const startTime = '19:00:00-07:00';
  const endTime = '22:00:00-07:00';
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
    font-size: 0.6rem;
    color: var(--green-mid);
    text-decoration: none;
    display: block;
    line-height: 1.6;
  }
  .tv-agenda-att:hover { text-decoration: underline; color: var(--green-deep); }

  .tv-agenda-content {
    padding: 0.1rem 0.75rem 0.4rem 3rem;
    font-size: 0.72rem;
  }
  .tv-agenda-content > summary {
    cursor: pointer;
    color: var(--green-mid);
    font-size: 0.62rem;
    font-family: 'IBM Plex Mono', monospace;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    list-style-position: inside;
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
`;

let generated = 0;

// Group meetings by date to detect multi-meeting dates
const meetingsByDate = {};
for (const m of data.meetings) {
  if (!meetingsByDate[m.date]) meetingsByDate[m.date] = [];
  meetingsByDate[m.date].push(m);
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

<div class="tv-layout">
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
</div>

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
<div class="tv-disambig">
  <a href="${L.backHref}" style="font-family:'IBM Plex Mono',monospace;font-size:0.75rem;color:var(--text-muted);text-decoration:none">${L.backLabel}</a>
  <h1>${dateFormatted}</h1>
  <p>${L.disambigMultiple}</p>
  ${links}
</div>
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
