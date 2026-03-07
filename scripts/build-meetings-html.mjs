#!/usr/bin/env node
/**
 * Generate docs/index.html from data/meetings-data.json
 * Run after build-meetings.mjs
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const R2_BASE = 'https://rcsd-files.weekly.org';

const data = JSON.parse(readFileSync(resolve(ROOT, 'data/meetings-data.json'), 'utf-8'));

// Load optional hand-crafted summaries (override auto-generated)
const summariesByLang = {};
for (const [suffix, lang] of [['', 'en'], ['-es', 'es']]) {
  const p = resolve(ROOT, `data/meeting-summaries${suffix}.json`);
  if (existsSync(p)) {
    summariesByLang[lang] = JSON.parse(readFileSync(p, 'utf-8'));
    console.log(`Loaded ${Object.keys(summariesByLang[lang]).length} ${lang} summaries`);
  } else {
    summariesByLang[lang] = {};
  }
}
let manualSummaries = summariesByLang.en;

// Load optional agenda item title translations for Spanish bilingual display
const agendaTitlesEsPath = resolve(ROOT, 'data/agenda-titles-es.json');
let agendaTitlesEs = {};
if (existsSync(agendaTitlesEsPath)) {
  agendaTitlesEs = JSON.parse(readFileSync(agendaTitlesEsPath, 'utf-8'));
  console.log(`Loaded ${Object.keys(agendaTitlesEs).length} agenda title translations`);
}

// Build lookup of available R2 artifacts from local artifacts/ directory
const agendaFiles = new Set();
const minutesFiles = new Set();
const transcriptFiles = new Set();

try {
  for (const f of readdirSync(resolve(ROOT, 'artifacts/agendas'))) {
    if (f.endsWith('.pdf')) agendaFiles.add(f);
  }
} catch {}
try {
  for (const f of readdirSync(resolve(ROOT, 'artifacts/minutes'))) {
    if (f.endsWith('.pdf')) minutesFiles.add(f);
  }
} catch {}
try {
  for (const f of readdirSync(resolve(ROOT, 'artifacts/transcripts'))) {
    if (f.endsWith('.srt')) transcriptFiles.add(f);
  }
} catch {}

// Map meeting date+type to agenda filename slug
function agendaSlug(type) {
  const t = type.toLowerCase();
  if (t.includes('study')) return 'study-session';
  if (t.includes('workshop')) return 'workshop';
  if (t.includes('special') || t.includes('closed')) return 'special';
  if (t.includes('retreat')) return 'retreat';
  return 'regular';
}

// Build document inventory from artifacts/documents/
const documentInventory = { spsa: {}, budget: [], lcap: [], sarc: {} };

function scanDocuments() {
  const docsRoot = resolve(ROOT, 'artifacts/documents');
  // SPSAs: spsa/{year}/{school}.pdf
  try {
    for (const year of readdirSync(resolve(docsRoot, 'spsa')).sort()) {
      documentInventory.spsa[year] = [];
      try {
        for (const f of readdirSync(resolve(docsRoot, 'spsa', year)).sort()) {
          if (f.endsWith('.pdf')) {
            documentInventory.spsa[year].push({
              school: f.replace('.pdf', ''),
              path: `documents/spsa/${year}/${f}`,
            });
          }
        }
      } catch {}
    }
  } catch {}
  // Budget
  try {
    for (const f of readdirSync(resolve(docsRoot, 'budget')).sort()) {
      if (f.endsWith('.pdf')) documentInventory.budget.push({ name: f.replace('.pdf', ''), path: `documents/budget/${f}` });
    }
  } catch {}
  // LCAP
  try {
    for (const f of readdirSync(resolve(docsRoot, 'lcap')).sort()) {
      if (f.endsWith('.pdf')) documentInventory.lcap.push({ name: f.replace('.pdf', ''), path: `documents/lcap/${f}` });
    }
  } catch {}
  // SARCs: sarc/{year}/{lang}/{school}.pdf
  try {
    for (const year of readdirSync(resolve(docsRoot, 'sarc')).sort()) {
      documentInventory.sarc[year] = { english: [], spanish: [] };
      for (const lang of ['english', 'spanish']) {
        try {
          for (const f of readdirSync(resolve(docsRoot, 'sarc', year, lang)).sort()) {
            if (f.endsWith('.pdf')) {
              documentInventory.sarc[year][lang].push({
                school: f.replace('.pdf', ''),
                path: `documents/sarc/${year}/${lang}/${f}`,
              });
            }
          }
        } catch {}
      }
    }
  } catch {}
}
scanDocuments();

// ---- Internationalization ----
const LOCALES = {
  en: {
    lang: 'en',
    monthNames: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    monthFull: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    title: 'RCSD Board Meeting Index',
    headerDistrict: 'Redwood City School District',
    headerTitle: 'Board Meeting Index',
    headerSubtitle: 'Two years of board meetings with agendas, video recordings, and key topics. Data compiled from',
    headerSubtitleAnd: 'and',
    statMeetings: 'Meetings',
    statAgendaItems: 'Agenda items',
    statAttachments: 'Attachments',
    statWithVideo: 'With video',
    statWithTranscript: 'With transcript',
    statWithMinutes: 'With minutes',
    boardOfEd: 'Board of Education',
    president: 'President',
    vicePresident: 'Vice President',
    clerk: 'Clerk',
    disclaimer: 'Not an official District document; independently assembled by',
    disclaimerSuffix: 'May contain errors.',
    navTopics: 'Key Topics',
    navDocuments: 'Documents',
    navResources: 'Resources',
    navSourceCode: 'Source Code',
    threadSectionTitle: 'Key Topics This Year',
    threadSectionSubtitle: 'Click a topic to filter meetings. Click again to show all.',
    sy2526Title: '2025\u201326 School Year',
    sy2526Subtitle: (n) => `${n} meetings from June 2025 to present. Full agendas and video available.`,
    sy2425Title: '2024\u201325 School Year',
    sy2425Subtitle: (n) => `${n} meetings from the BoardDocs archive with full agendas and attachments.`,
    agendaItemsLabel: (n) => `${n} agenda item${n === 1 ? '' : 's'}`,
    otherAttachments: 'Other Attachments',
    video: 'Video',
    agenda: 'Agenda',
    minutes: 'Minutes',
    transcript: 'Transcript',
    joinZoom: 'Join via Zoom',
    rotationTitle: 'Annual Officer Rotation \u00b7 Per Board Bylaws',
    rotationBelow: 'Meetings below:',
    govCalTitle: 'Governance Calendar',
    govCalDesc: (dateStr) => `Planned board agenda items for the school year. From the ${dateStr} agenda.`,
    govCalLink: 'View Schedule (PDF)',
    resourcesTitle: 'Resources',
    resBoardPortalTitle: 'Board Meeting Portal',
    resBoardPortalDesc: 'Current agendas and attachments on GAMUT/Simbli.',
    resBoardDocsTitle: 'BoardDocs Archive',
    resBoardDocsDesc: 'Meeting agendas before June 2025.',
    resYouTubeTitle: 'YouTube Channel',
    resYouTubeDesc: 'Video recordings of public board meetings.',
    resDistrictTitle: 'District Website',
    resDistrictDesc: 'Official RCSD information and announcements.',
    docsTitle: 'District Documents',
    docsSubtitle: 'School plans, budgets, and accountability reports archived from official sources.',
    docsBudget: 'Budget',
    docsLcap: 'LCAP',
    docsSpsa: 'School Plans (SPSA)',
    docsSarc: 'School Report Cards',
    docsEnglish: 'English',
    docsSpanish: 'Espa\u00f1ol',
    footerText: 'Compiled from publicly available RCSD documents. Source documents are available at',
    footerAnd: 'and through the',
    footerPortal: 'GAMUT board portal',
    footerDistrict: 'District Summary',
    footerDistrito: 'Resumen del Distrito',
    meetingTypes: {},
    altLangLink: 'Reuniones (Espa\u00f1ol)',
    altLangHref: 'reuniones/',
    outFile: 'docs/index.html',
    threadLabels: {
      'superintendent-search': 'Superintendent Search',
      'budget': 'Budget & Resource Alignment',
      'parcel-tax': '2026 Parcel Tax',
      'facilities-bond': 'Facilities Bonds (Measure S/T)',
      'policy': 'Policy Updates',
      'charter': 'Charter School Oversight',
    },
  },
  es: {
    lang: 'es',
    monthNames: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
    monthFull: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
    title: '\u00cdndice de Reuniones de la Junta de RCSD',
    headerDistrict: 'Distrito Escolar de Redwood City',
    headerTitle: '\u00cdndice de Reuniones de la Junta',
    headerSubtitle: 'Dos a\u00f1os de reuniones de la junta con agendas, grabaciones de video y temas clave. Datos recopilados de',
    headerSubtitleAnd: 'y',
    statMeetings: 'Reuniones',
    statAgendaItems: 'Puntos de agenda',
    statAttachments: 'Anexos',
    statWithVideo: 'Con video',
    statWithTranscript: 'Con transcripci\u00f3n',
    statWithMinutes: 'Con actas',
    boardOfEd: 'Mesa Directiva',
    president: 'Presidente',
    vicePresident: 'Vicepresidenta',
    clerk: 'Secretaria',
    disclaimer: 'No es un documento oficial del Distrito; compilado independientemente por',
    disclaimerSuffix: 'Puede contener errores.',
    navTopics: 'Temas Clave',
    navDocuments: 'Documentos',
    navResources: 'Recursos',
    navSourceCode: 'C\u00f3digo Fuente',
    threadSectionTitle: 'Temas Clave de Este A\u00f1o',
    threadSectionSubtitle: 'Haga clic en un tema para filtrar las reuniones. Haga clic de nuevo para mostrar todas.',
    sy2526Title: 'A\u00f1o Escolar 2025\u201326',
    sy2526Subtitle: (n) => `${n} reuniones desde junio de 2025 hasta el presente. Agendas completas y video disponibles.`,
    sy2425Title: 'A\u00f1o Escolar 2024\u201325',
    sy2425Subtitle: (n) => `${n} reuniones del archivo de BoardDocs con agendas completas y anexos.`,
    agendaItemsLabel: (n) => `${n} punto${n === 1 ? '' : 's'} de agenda`,
    otherAttachments: 'Otros Anexos',
    video: 'Video',
    agenda: 'Agenda',
    minutes: 'Actas',
    transcript: 'Transcripci\u00f3n',
    joinZoom: 'Unirse por Zoom',
    rotationTitle: 'Rotaci\u00f3n Anual de Oficiales \u00b7 Seg\u00fan Estatutos de la Junta',
    rotationBelow: 'Reuniones a continuaci\u00f3n:',
    govCalTitle: 'Calendario de Gobernanza',
    govCalDesc: (dateStr) => `Puntos de agenda planificados para el a\u00f1o escolar. De la agenda del ${dateStr}.`,
    govCalLink: 'Ver Calendario (PDF)',
    resourcesTitle: 'Recursos',
    resBoardPortalTitle: 'Portal de Reuniones',
    resBoardPortalDesc: 'Agendas actuales y anexos en GAMUT/Simbli.',
    resBoardDocsTitle: 'Archivo de BoardDocs',
    resBoardDocsDesc: 'Agendas de reuniones antes de junio de 2025.',
    resYouTubeTitle: 'Canal de YouTube',
    resYouTubeDesc: 'Grabaciones de video de las reuniones p\u00fablicas de la junta.',
    resDistrictTitle: 'Sitio Web del Distrito',
    resDistrictDesc: 'Informaci\u00f3n oficial y anuncios de RCSD.',
    docsTitle: 'Documentos del Distrito',
    docsSubtitle: 'Planes escolares, presupuestos e informes de rendici\u00f3n de cuentas archivados de fuentes oficiales.',
    docsBudget: 'Presupuesto',
    docsLcap: 'LCAP',
    docsSpsa: 'Planes Escolares (SPSA)',
    docsSarc: 'Boletas de Calificaciones Escolares',
    docsEnglish: 'English',
    docsSpanish: 'Espa\u00f1ol',
    footerText: 'Compilado a partir de documentos p\u00fablicos de RCSD. Los documentos originales est\u00e1n disponibles en',
    footerAnd: 'y a trav\u00e9s del',
    footerPortal: 'portal de la junta GAMUT',
    footerDistrict: 'Resumen del Distrito',
    footerDistrito: 'District Summary (English)',
    meetingTypes: {
      'Regular': 'Reuni\u00f3n Regular',
      'Special': 'Reuni\u00f3n Especial',
      'Study Session': 'Sesi\u00f3n de Estudio',
      'Workshop': 'Taller',
      'Special (Closed)': 'Sesi\u00f3n Especial (Cerrada)',
      'Retreat (Offsite)': 'Retiro',
      'Board Meeting': 'Reuni\u00f3n de la Junta',
    },
    altLangLink: 'Meetings (English)',
    altLangHref: '../',
    outFile: 'docs/reuniones/index.html',
    threadLabels: {
      'superintendent-search': 'B\u00fasqueda de Superintendente',
      'budget': 'Presupuesto y Alineaci\u00f3n de Recursos',
      'parcel-tax': 'Impuesto Parcelario 2026',
      'facilities-bond': 'Bonos de Instalaciones (Medida S/T)',
      'policy': 'Actualizaciones de Pol\u00edticas',
      'charter': 'Supervisi\u00f3n de Escuelas Ch\u00e1rter',
    },
  },
};

// Current locale — set per generation pass
let L = LOCALES.en;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatDateBadge(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return { month: L.monthNames[parseInt(m) - 1].toUpperCase(), day: parseInt(d), year: y };
}

function monthYear(dateStr) {
  const [y, m] = dateStr.split('-');
  return `${L.monthFull[parseInt(m) - 1]} ${y}`;
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
    'superintendent', 'superintendente', 'parcel tax', 'impuesto parcelario',
    'budget reduction', 'reducción de presupuesto', 'strategic resource alignment',
    'Alineación Estratégica de Recursos', 'LCAP', 'Measure S', 'Medida S',
    'Measure T', 'Medida T', 'Measure E', 'Medida E', 'Measure U', 'Medida U',
    'Facilities Master Plan', 'Plan Maestro de Instalaciones', 'Mesa Directiva',
  ];
  for (const term of terms) {
    const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    html = html.replace(re, '<strong>$1</strong>');
  }
  // Highlight Resolution numbers
  html = html.replace(/Resoluci[oó]n\s+(?:No\.?\s*)?\d+/gi, '<strong>$&</strong>');
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

    // Bilingual subtitle on Spanish page
    if (L.lang === 'es' && agendaTitlesEs[title]) {
      itemsHtml += `<div class="agenda-item-es">${escapeHtml(agendaTitlesEs[title])}</div>`;
    }

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
    itemsHtml += `<div class="agenda-item" style="opacity:0.7">${L.otherAttachments}</div>`;
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

  // Check for R2-hosted artifacts
  const slug = agendaSlug(m.type);
  const agendaFile = `${m.date}-${slug}.pdf`;
  const hasR2Agenda = agendaFiles.has(agendaFile);
  const minutesFile = minutesFiles.has(`${m.date}-minutes.pdf`) ? `${m.date}-minutes.pdf` : null;
  const transcriptFile = m.youtube ? `${m.youtube}.en.srt` : null;
  const hasR2Transcript = transcriptFile && transcriptFiles.has(transcriptFile);

  let links = '';
  // Zoom link — hidden by default, shown by client-side JS for upcoming/recent meetings
  if (m.zoom) {
    links += `<a href="${escapeHtml(m.zoom)}" class="meeting-link meeting-link--zoom" data-zoom-date="${m.date}" target="_blank" rel="noopener">&#128247; ${L.joinZoom}</a>`;
  }
  if (m.youtube) {
    links += `<a href="https://www.youtube.com/watch?v=${m.youtube}" class="meeting-link meeting-link--video" target="_blank" rel="noopener">&#9654; ${L.video}</a>`;
  }
  if (hasR2Agenda) {
    links += `<a href="${R2_BASE}/agendas/${agendaFile}" class="meeting-link meeting-link--agenda" target="_blank" rel="noopener">&#128196; ${L.agenda}</a>`;
  } else if (m.simbli) {
    links += `<a href="${escapeHtml(m.simbli)}" class="meeting-link meeting-link--agenda" target="_blank" rel="noopener">&#8599; ${L.agenda}</a>`;
  }
  if (minutesFile) {
    links += `<a href="${R2_BASE}/minutes/${minutesFile}" class="meeting-link meeting-link--minutes" target="_blank" rel="noopener">&#128196; ${L.minutes}</a>`;
  } else if (m.minutes) {
    if (m.minutes.documents && m.minutes.documents.length > 0 && m.minutes.documents[0].href) {
      const doc = m.minutes.documents[0];
      links += `<a href="${escapeHtml(doc.href)}" class="meeting-link meeting-link--minutes" target="_blank" rel="noopener">&#128196; ${L.minutes}</a>`;
    } else if (m.minutes.approvedAt) {
      const approver = data.meetings.find(x => x.date === m.minutes.approvedAt);
      const approverUrl = approver?.simbli || approver?.boarddocs;
      if (approverUrl) {
        links += `<a href="${escapeHtml(approverUrl)}" class="meeting-link meeting-link--minutes" target="_blank" rel="noopener" title="${L.minutes} ${m.minutes.approvedAt}">&#128196; ${L.minutes}</a>`;
      }
    }
  }
  if (hasR2Transcript) {
    links += `<a href="${R2_BASE}/transcripts/${transcriptFile}" class="meeting-link meeting-link--transcript" target="_blank" rel="noopener">&#128221; ${L.transcript}</a>`;
  }
  if (m.boarddocs) {
    links += `<a href="${escapeHtml(m.boarddocs)}" class="meeting-link meeting-link--agenda" target="_blank" rel="noopener">&#8599; ${L.agenda}</a>`;
  }

  let threadTags = '';
  if (m.threads.length) {
    threadTags = '<div class="meeting-threads">' +
      m.threads.map(t => `<span class="meeting-thread-tag" data-thread="${t}">${L.threadLabels[t] || t}</span>`).join('') +
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
    ? `<details class="meeting-details"><summary class="meeting-details-toggle">${L.agendaItemsLabel(itemCount)}</summary>${agendaSection}</details>`
    : '';

  return `    <div class="meeting-row${sparseClass}${typeModifier}"${threadAttrs}>
      <div class="meeting-date">
        <span class="meeting-date-month">${month}</span>
        <span class="meeting-date-day">${day}</span>
        <span class="meeting-date-year">${year}</span>
      </div>
      <div class="meeting-body">
        <div class="meeting-header">
          <span class="meeting-type">${escapeHtml(L.meetingTypes[m.type] || m.type)}</span>${m.duration ? `<span class="meeting-duration">${m.duration}</span>` : ''}
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
        <div class="rotation-divider-label">${L.rotationTitle}</div>
        ${L.rotationBelow} ${officers}${note}
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
  <h2>${L.threadSectionTitle}</h2>
  <p>${L.threadSectionSubtitle}</p>
  <div class="thread-filters">
${threads.map(t => `    <button class="thread-btn" data-filter="${t}">
      <span class="thread-btn-label">${L.threadLabels[t]}</span>
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
    const dateStr = `${L.monthFull[parseInt(m) - 1]} ${parseInt(d)}, ${y}`;
    govCalCard = `
    <div class="resource-card">
      <h3>${L.govCalTitle}</h3>
      <p>${L.govCalDesc(dateStr)}</p>
      <a href="${escapeHtml(govCal.href)}" target="_blank" rel="noopener">${L.govCalLink} &#8599;</a>
    </div>`;
  }

  return `<section class="section" id="resources">
  <div class="section-rule"></div>
  <h2>${L.resourcesTitle}</h2>
  <div class="resource-grid">${govCalCard}
    <div class="resource-card">
      <h3>${L.resBoardPortalTitle}</h3>
      <p>${L.resBoardPortalDesc}</p>
      <a href="https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030397" target="_blank" rel="noopener">simbli.eboardsolutions.com &#8599;</a>
    </div>
    <div class="resource-card">
      <h3>${L.resBoardDocsTitle}</h3>
      <p>${L.resBoardDocsDesc}</p>
      <a href="https://go.boarddocs.com/ca/redwood/Board.nsf/goto?open&id=CVLPDX62089F" target="_blank" rel="noopener">go.boarddocs.com &#8599;</a>
    </div>
    <div class="resource-card">
      <h3>${L.resYouTubeTitle}</h3>
      <p>${L.resYouTubeDesc}</p>
      <a href="https://www.youtube.com/@redwoodcityschooldistrict" target="_blank" rel="noopener">youtube.com &#8599;</a>
    </div>
    <div class="resource-card">
      <h3>${L.resDistrictTitle}</h3>
      <p>${L.resDistrictDesc}</p>
      <a href="https://www.rcsdk8.net" target="_blank" rel="noopener">rcsdk8.net &#8599;</a>
    </div>
  </div>
</section>`;
}

// Prettify school/document names
function prettySchool(slug) {
  const map = {
    'adelante-selby': 'Adelante Selby',
    'clifford': 'Clifford',
    'garfield': 'Garfield',
    'henry-ford': 'Henry Ford',
    'hoover': 'Hoover',
    'kennedy': 'Kennedy',
    'mckinley-mit': 'McKinley MIT',
    'north-star': 'North Star',
    'orion': 'Orion',
    'roosevelt': 'Roosevelt',
    'roy-cloud': 'Roy Cloud',
    'taft': 'Taft',
  };
  return map[slug] || slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

function prettyDocName(slug) {
  return slug
    .replace(/^\d{4}-\d{2}-/, '')  // strip year prefix
    .split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// Documents section — SPSAs, Budget, LCAP, SARCs
function renderDocuments() {
  const inv = documentInventory;
  const hasDocs = inv.budget.length || inv.lcap.length ||
    Object.keys(inv.spsa).length || Object.keys(inv.sarc).length;
  if (!hasDocs) return '';

  let html = `<section class="section" id="documents">
  <div class="section-rule"></div>
  <h2>${L.docsTitle}</h2>
  <p class="section-subtitle">${L.docsSubtitle}</p>
  <div class="doc-tabs">
    <button class="doc-tab active" data-doc-tab="budget">${L.docsBudget}</button>
    <button class="doc-tab" data-doc-tab="lcap">${L.docsLcap}</button>
    <button class="doc-tab" data-doc-tab="spsa">${L.docsSpsa}</button>
    <button class="doc-tab" data-doc-tab="sarc">${L.docsSarc}</button>
  </div>`;

  // Budget panel
  html += `\n  <div class="doc-panel active" data-doc-panel="budget">`;
  // Group budget docs by year
  const budgetByYear = {};
  for (const b of inv.budget) {
    const yearMatch = b.name.match(/^(\d{4}-\d{2})/);
    const year = yearMatch ? yearMatch[1] : 'Other';
    if (!budgetByYear[year]) budgetByYear[year] = [];
    budgetByYear[year].push(b);
  }
  for (const [year, docs] of Object.entries(budgetByYear).sort().reverse()) {
    html += `\n    <h3 class="doc-year-heading">${year}</h3>`;
    html += `\n    <div class="doc-list">`;
    for (const d of docs) {
      html += `\n      <a class="doc-link" href="${R2_BASE}/${d.path}" target="_blank" rel="noopener">${prettyDocName(d.name)}</a>`;
    }
    html += `\n    </div>`;
  }
  html += `\n  </div>`;

  // LCAP panel
  html += `\n  <div class="doc-panel" data-doc-panel="lcap">`;
  const lcapByYear = {};
  for (const l of inv.lcap) {
    const yearMatch = l.name.match(/^(\d{4}-\d{2})/);
    const year = yearMatch ? yearMatch[1] : 'Other';
    if (!lcapByYear[year]) lcapByYear[year] = [];
    lcapByYear[year].push(l);
  }
  for (const [year, docs] of Object.entries(lcapByYear).sort().reverse()) {
    html += `\n    <h3 class="doc-year-heading">${year}</h3>`;
    html += `\n    <div class="doc-list">`;
    for (const d of docs) {
      html += `\n      <a class="doc-link" href="${R2_BASE}/${d.path}" target="_blank" rel="noopener">${prettyDocName(d.name)}</a>`;
    }
    html += `\n    </div>`;
  }
  html += `\n  </div>`;

  // SPSA panel — by year with school grid
  html += `\n  <div class="doc-panel" data-doc-panel="spsa">`;
  for (const year of Object.keys(inv.spsa).sort().reverse()) {
    html += `\n    <h3 class="doc-year-heading">${year}</h3>`;
    html += `\n    <div class="doc-school-grid">`;
    for (const s of inv.spsa[year]) {
      html += `\n      <a class="doc-school-link" href="${R2_BASE}/${s.path}" target="_blank" rel="noopener">${prettySchool(s.school)}</a>`;
    }
    html += `\n    </div>`;
  }
  html += `\n  </div>`;

  // SARC panel — by year with English/Spanish sub-sections
  html += `\n  <div class="doc-panel" data-doc-panel="sarc">`;
  for (const year of Object.keys(inv.sarc).sort().reverse()) {
    const yearData = inv.sarc[year];
    html += `\n    <h3 class="doc-year-heading">${year}</h3>`;
    if (yearData.english.length) {
      html += `\n    <div class="doc-lang-label">${L.docsEnglish}</div>`;
      html += `\n    <div class="doc-school-grid">`;
      for (const s of yearData.english) {
        html += `\n      <a class="doc-school-link" href="${R2_BASE}/${s.path}" target="_blank" rel="noopener">${prettySchool(s.school)}</a>`;
      }
      html += `\n    </div>`;
    }
    if (yearData.spanish.length) {
      html += `\n    <div class="doc-lang-label">${L.docsSpanish}</div>`;
      html += `\n    <div class="doc-school-grid">`;
      for (const s of yearData.spanish) {
        html += `\n      <a class="doc-school-link" href="${R2_BASE}/${s.path}" target="_blank" rel="noopener">${prettySchool(s.school)}</a>`;
      }
      html += `\n    </div>`;
    }
  }
  html += `\n  </div>`;

  html += `\n</section>`;
  return html;
}

function generatePage() {

const html = `<!DOCTYPE html>
<html lang="${L.lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="index, follow">
<title>${L.title}</title>
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

  .lang-switch {
    display: inline-block;
    margin-top: 0.75rem;
    padding: 0.4rem 1rem;
    font-size: 0.8rem;
    font-family: 'IBM Plex Mono', monospace;
    letter-spacing: 0.03em;
    color: #fff;
    background: rgba(255,255,255,0.15);
    border: 1px solid rgba(255,255,255,0.3);
    border-radius: 4px;
    text-decoration: none;
    transition: background 0.2s;
  }
  .lang-switch:hover {
    background: rgba(255,255,255,0.25);
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

  .agenda-item-es {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-style: italic;
    padding: 0 0 0.1rem 1.8rem;
    line-height: 1.35;
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

  .meeting-link--transcript {
    color: #6b7280;
  }

  .meeting-link--transcript:hover {
    color: var(--green-deep);
  }

  .meeting-link--zoom {
    display: none;
    color: #fff;
    background: #2d8cff;
    border-radius: 4px;
    padding: 0.25rem 0.6rem;
    font-weight: 600;
  }

  .meeting-link--zoom:hover {
    background: #1a6fd4;
    color: #fff;
  }

  .meeting-link--zoom.zoom-active {
    display: inline-flex;
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

  /* ---- DOCUMENT TABS ---- */
  .doc-tabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--rule);
    margin-top: 1rem;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .doc-tab {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.68rem;
    letter-spacing: 0.02em;
    padding: 0.7rem 1.2rem;
    border: none;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    white-space: nowrap;
    transition: color 0.15s, border-color 0.15s;
  }

  .doc-tab:hover {
    color: var(--green-mid);
  }

  .doc-tab.active {
    color: var(--green-deep);
    border-bottom-color: var(--green-mid);
  }

  .doc-panel {
    display: none;
    padding-top: 1.2rem;
  }

  .doc-panel.active {
    display: block;
  }

  .doc-year-heading {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
    margin: 1.2rem 0 0.5rem;
  }

  .doc-year-heading:first-child {
    margin-top: 0;
  }

  .doc-list {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .doc-link {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.68rem;
    color: var(--green-mid);
    text-decoration: none;
    padding: 0.25rem 0;
  }

  .doc-link:hover {
    color: var(--green-deep);
    text-decoration: underline;
  }

  .doc-school-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.4rem;
  }

  .doc-school-link {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.68rem;
    color: var(--green-mid);
    text-decoration: none;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--rule-light);
    background: #fff;
    text-align: center;
    transition: all 0.15s;
  }

  .doc-school-link:hover {
    border-color: var(--green-light);
    background: var(--green-wash);
    color: var(--green-deep);
  }

  .doc-lang-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0.8rem 0 0.3rem;
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
    .doc-school-grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
    .doc-tab { padding: 0.6rem 0.8rem; font-size: 0.6rem; }
  }
</style>
</head>
<body>

<header class="site-header">
  <div class="header-inner">
    <div class="header-district">${L.headerDistrict}</div>
    <h1 class="header-title">${L.headerTitle}</h1>
    <p class="header-subtitle">${L.headerSubtitle} <a href="https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030397" style="color:rgba(255,255,255,0.75)">GAMUT/Simbli</a> ${L.headerSubtitleAnd} <a href="https://go.boarddocs.com/ca/redwood/Board.nsf/goto?open&id=CVLPDX62089F" style="color:rgba(255,255,255,0.75)">BoardDocs</a>.</p>
    <a href="${L.altLangHref}" class="lang-switch">${L.altLangLink}</a>
    <div class="header-meta">
      <div class="header-stat">
        <span class="header-stat-value">${data.stats.total}</span>
        <span class="header-stat-label">${L.statMeetings}</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">${data.stats.totalItems || 0}</span>
        <span class="header-stat-label">${L.statAgendaItems}</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">${data.stats.totalAttachments || 0}</span>
        <span class="header-stat-label">${L.statAttachments}</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">${data.stats.withVideo}</span>
        <span class="header-stat-label">${L.statWithVideo}</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">${data.stats.withTranscript || 0}</span>
        <span class="header-stat-label">${L.statWithTranscript}</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">${data.stats.withMinutes || 0}</span>
        <span class="header-stat-label">${L.statWithMinutes}</span>
      </div>
    </div>
    <div class="board-roster">
      <div class="board-roster-label"><a href="https://www.rcsdk8.net/our-district/our-board-of-trustees/meet-the-trustees" style="color:rgba(255,255,255,0.4);text-decoration:none" target="_blank" rel="noopener">${L.boardOfEd}</a></div>
      <ul class="board-roster-list">
        <li>David Weekly <span class="roster-role">${L.president}</span></li>
        <li>Cecilia I. M&aacute;rquez <span class="roster-role">${L.vicePresident}</span></li>
        <li>Jennifer Ng Kwing King <span class="roster-role">${L.clerk}</span></li>
        <li>David Li</li>
        <li>Mike Wells</li>
      </ul>
    </div>
  </div>
</header>

<div class="disclaimer">
  ${L.disclaimer} <a href="https://github.com/dweekly/rcsd-meetings" style="color:#664d03">David Weekly</a>. ${L.disclaimerSuffix}
</div>

<nav class="toc">
  <div class="toc-inner">
    <a href="#threads">${L.navTopics}</a>
    <a href="#sy2526">2025-26</a>
    <a href="#sy2425">2024-25</a>
    <a href="#documents">${L.navDocuments}</a>
    <a href="#resources">${L.navResources}</a>
    <a href="${L.altLangHref}">${L.altLangLink}</a>
    <a href="https://github.com/dweekly/rcsd-meetings">${L.navSourceCode}</a>
  </div>
</nav>

<main class="content">
${renderThreadFilters()}

${renderSchoolYear('sy2526', L.sy2526Title, sy2526, L.sy2526Subtitle(sy2526.length))}

${renderSchoolYear('sy2425', L.sy2425Title, sy2425, L.sy2425Subtitle(sy2425.length))}

${renderDocuments()}

${renderResources(data)}
</main>

<footer class="site-footer">
  ${L.footerText} <a href="https://www.rcsdk8.net">rcsdk8.net</a> ${L.footerAnd} <a href="https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030397">${L.footerPortal}</a>.
  <div class="footer-nav">
    <a href="${L.lang === 'en' ? 'district/' : '../district/'}">${L.footerDistrict} &#8599;</a>
    <a href="${L.lang === 'en' ? 'distrito/' : '../distrito/'}">${L.footerDistrito} &#8599;</a>
    <a href="https://github.com/dweekly/rcsd-meetings">${L.navSourceCode} &#8599;</a>
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

  // Show Zoom links for upcoming meetings or those within 6 hours of start
  var zoomLinks = document.querySelectorAll('.meeting-link--zoom[data-zoom-date]');
  var now = new Date();
  zoomLinks.forEach(function(link) {
    var dateStr = link.dataset.zoomDate; // "2026-03-11"
    // Meetings start at 7 PM Pacific
    var parts = dateStr.split('-');
    var meetingStart = new Date(parts[0] + '-' + parts[1] + '-' + parts[2] + 'T19:00:00-08:00');
    var sixHoursAfter = new Date(meetingStart.getTime() + 6 * 60 * 60 * 1000);
    if (now <= sixHoursAfter) {
      link.classList.add('zoom-active');
    }
  });

  // Document tab switching
  var docTabs = document.querySelectorAll('.doc-tab');
  var docPanels = document.querySelectorAll('.doc-panel');
  docTabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      var target = tab.dataset.docTab;
      docTabs.forEach(function(t) { t.classList.toggle('active', t.dataset.docTab === target); });
      docPanels.forEach(function(p) { p.classList.toggle('active', p.dataset.docPanel === target); });
    });
  });

})();
</script>

</body>
</html>`;

writeFileSync(resolve(ROOT, L.outFile), html);
console.log(`Wrote ${L.outFile}`);

} // end generatePage

// Generate both language versions
for (const locale of ['en', 'es']) {
  L = LOCALES[locale];
  manualSummaries = summariesByLang[locale] || summariesByLang.en;
  generatePage();
}
