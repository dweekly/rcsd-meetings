#!/usr/bin/env node
/**
 * Generate docs/index.html from data/meetings-data.json
 * Run after build-meetings.mjs
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { headMeta, siteNav, siteFooter } from './html-parts.mjs';
import { prettySchool } from './document-inventory.mjs';
import { isSubstantiveItem, formatDate } from './meeting-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const R2_BASE = 'https://data.rcsd.info';

const data = JSON.parse(readFileSync(resolve(ROOT, 'data/meetings-data.json'), 'utf-8'));

// Load district calendars to find board meeting dates
const districtCalendars = [];
for (const suffix of ['2025-26', '2026-27']) {
  const p = resolve(ROOT, `data/district-calendar-${suffix}.json`);
  if (existsSync(p)) {
    districtCalendars.push(JSON.parse(readFileSync(p, 'utf-8')));
  }
}

// Load governance calendar for provisional topic descriptions
const govCalPath = resolve(ROOT, 'data/governance-calendar.json');
let govCalTopics = {};
if (existsSync(govCalPath)) {
  const gc = JSON.parse(readFileSync(govCalPath, 'utf-8'));
  govCalTopics = gc.provisionalTopics || {};
  console.log(`Loaded ${Object.keys(govCalTopics).length} provisional topic entries`);
}

// Today's date string (YYYY-MM-DD) for upcoming meeting logic
const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

// Collect all board meeting dates from district calendars that are today or in the future
const futureBoardMeetingDates = [];
for (const cal of districtCalendars) {
  for (const evt of cal.events) {
    if (evt.type === 'board-meeting' && evt.date >= todayStr) {
      futureBoardMeetingDates.push(evt.date);
    }
  }
}
futureBoardMeetingDates.sort(); // chronological

// Build a Set of meeting dates that exist in meetings-data.json (agenda published)
const publishedMeetingDates = new Set(data.meetings.map(m => m.date));

// Categorize upcoming meetings into two tiers
const upcomingPublished = []; // meetings with agendas in meetings-data.json
const upcomingProvisional = []; // calendar dates without published agendas
for (const dateStr of futureBoardMeetingDates) {
  if (publishedMeetingDates.has(dateStr)) {
    // Find the actual meeting objects for this date
    const meetings = data.meetings.filter(m => m.date === dateStr);
    upcomingPublished.push(...meetings);
  } else {
    upcomingProvisional.push(dateStr);
  }
}

// Set of all upcoming meeting dates (both tiers) to exclude from school year sections
const upcomingDates = new Set(futureBoardMeetingDates);

console.log(`Upcoming meetings: ${upcomingPublished.length} published, ${upcomingProvisional.length} provisional`);

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

// Load optional short meeting titles (2-5 words per meeting)
const meetingTitlesPath = resolve(ROOT, 'data/meeting-titles.json');
let meetingTitles = {};
if (existsSync(meetingTitlesPath)) {
  meetingTitles = JSON.parse(readFileSync(meetingTitlesPath, 'utf-8'));
  console.log(`Loaded ${Object.keys(meetingTitles).length} meeting titles`);
}

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
// Build AID → R2 path lookup from board-memo JSON files
// Maps attachment AID to "board-packets/{date}/{filename}" for R2-hosted PDFs
const aidToR2Path = {};
const memoDir = resolve(ROOT, 'data/board-memos');
try {
  for (const f of readdirSync(memoDir)) {
    if (!f.endsWith('.json')) continue;
    const memo = JSON.parse(readFileSync(resolve(memoDir, f), 'utf-8'));
    for (const item of memo.items) {
      for (const att of item.attachments) {
        if (att.aid && att.filename) {
          aidToR2Path[att.aid] = `board-packets/${memo.date}/${att.filename}`;
        }
      }
    }
  }
  console.log(`Loaded ${Object.keys(aidToR2Path).length} board-packet R2 paths from memo files`);
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

// ---- Internationalization ----
const LOCALES = {
  en: {
    lang: 'en',
    ogLocale: 'en_US',
    metaDescription: 'Searchable archive of Redwood City School District board meetings with agendas, video, minutes, and transcripts.',
    canonicalUrl: 'https://rcsd.info/meetings/',
    hreflangAlt: 'https://rcsd.info/reuniones/',
    hreflangAltLang: 'es',
    monthNames: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    monthFull: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    title: 'RCSD Board Meeting Index',
    headerDistrict: 'Redwood City School District',
    headerTitle: 'Board Meeting Index',
    headerSubtitle: null, // set dynamically
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
    disclaimerSuffix: 'May contain errors. Questions?',
    disclaimerContact: 'Contact us',
    aiSummaryNote: 'AI-generated summary — may contain errors. Not an official record.',
    siteNavHome: 'Home',
    siteNavMeetings: 'Meetings',
    siteNavDistrict: 'District',
    siteNavCode: 'Code',
    navTopics: 'Key Topics',
    navResources: 'Resources',
    navSourceCode: 'Source Code',
    threadSectionTitle: 'Key Topics This Year',
    threadSectionSubtitle: 'Click a topic to filter meetings. Click again to show all.',
    schoolYearTitle: (sy) => `${sy.slice(0,4)}\u2013${sy.slice(4)} School Year`,
    schoolYearSubtitle: (sy, n) => {
      if (sy === '202526') return `${n} meetings from June 2025 to present. Full agendas and video available.`;
      return `${n} meetings from the BoardDocs archive.`;
    },
    agendaItemsLabel: (n) => `${n} agenda item${n === 1 ? '' : 's'}`,
    agendaItemsLink: 'agenda items',
    meetingsPath: 'meetings',
    otherAttachments: 'Other Attachments',
    video: 'Video',
    agenda: 'Agenda',
    minutes: 'Minutes',
    transcript: 'Transcript',
    joinZoom: 'Join via Zoom',
    rotationTitle: 'Annual Officer Rotation \u00b7 Per Board Bylaws',
    rotationBelow: 'Rotated to:',
    govCalTitle: 'Governance Calendar',
    govCalDesc: (dateStr) => `Planned board agenda items for the school year. From the ${dateStr} agenda.`,
    govCalLink: 'View Schedule (PDF)',
    tipSpeakTitle: 'Want to speak at a board meeting?',
    tipSpeakBody: `Anyone can address the Board during the Public Comment period at the start of each meeting. You get <strong>3 minutes</strong> to speak on any topic within the Board's jurisdiction.<br><br>
<strong>In person:</strong> Pick up a speaker card at the entrance and hand it to the Board Secretary before the meeting starts.<br>
<strong>On Zoom:</strong> Submit a digital speaker card using the links in the agenda, or use the "Raise Hand" feature. Speaker card links are posted with each meeting's agenda.<br><br>
Comments in Spanish are welcome — an interpreter is available at every meeting.`,
    tipTopicTitle: 'Want a topic discussed at a future meeting?',
    tipTopicBody: `There are several ways to get an item on a future Board agenda:<br><br>
<strong>Submit a proposed agenda item:</strong> The most direct way. At least 10 days before a meeting, email your proposed item to the Board President and Superintendent. They set the agenda collaboratively.<br>
<strong>Public Comment:</strong> Raise the topic during Public Comment at any meeting — Board members often follow up on community concerns.<br>
<strong>Contact a Board Member:</strong> Email any Trustee directly. Contact info is on <a href="https://www.rcsdk8.net/domain/12" target="_blank" rel="noopener">the district website</a>.<br>
<strong>"Other Business" section:</strong> Near the end of each meeting, the Board discusses suggested items for future agendas.<br>
<strong>Written communication:</strong> Send a letter or email to the Board Secretary at the District Office (750 Bradford St, Redwood City, CA 94063).`,
    resourcesTitle: 'Resources',
    resCalMeetingsTitle: 'Board Meetings Feed',
    resCalMeetingsDesc: 'Subscribe to automatic updates of all school board meetings in Apple Calendar, Google Calendar, or Outlook.',
    resCalSchoolTitle: 'School Calendar Feed',
    resCalSchoolDesc: 'Subscribe to key school dates, milestones, holidays, and minimum days in Apple Calendar, Google Calendar, or Outlook.',
    resBoardPortalTitle: 'Board Meeting Portal',
    resBoardPortalDesc: 'Current agendas and attachments on GAMUT/Simbli.',
    resBoardDocsTitle: 'BoardDocs Archive',
    resBoardDocsDesc: 'Meeting agendas before June 2025.',
    resYouTubeTitle: 'YouTube Channel',
    resYouTubeDesc: 'Video recordings of public board meetings.',
    resDistrictTitle: 'District Website',
    resDistrictDesc: 'Official RCSD information and announcements.',
    footerText: 'Compiled from publicly available RCSD documents. Source documents are available at',
    footerAnd: 'and through the',
    footerPortal: 'GAMUT board portal',
    footerDistrict: 'District Summary',
    footerDistrito: 'Resumen del Distrito',
    meetingTypes: {},
    upcomingTitle: 'Upcoming Meetings',
    upcomingSubtitle: 'Board meetings scheduled for the coming weeks.',
    badgeAgendaPosted: 'Agenda Posted',
    badgeUpcoming: 'Upcoming',
    plannedPrefix: 'Planned:',
    altLangLink: 'Reuniones (Espa\u00f1ol)',
    altLangHref: '/reuniones/',
    outFile: 'docs/meetings/index.html',
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
    ogLocale: 'es_US',
    metaDescription: 'Archivo de reuniones de la Junta del Distrito Escolar de Redwood City con agendas, video, actas y transcripciones.',
    canonicalUrl: 'https://rcsd.info/reuniones/',
    hreflangAlt: 'https://rcsd.info/meetings/',
    hreflangAltLang: 'en',
    monthNames: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
    monthFull: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
    title: '\u00cdndice de Reuniones de la Junta de RCSD',
    headerDistrict: 'Distrito Escolar de Redwood City',
    headerTitle: '\u00cdndice de Reuniones de la Junta',
    headerSubtitle: null, // set dynamically
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
    disclaimerContact: 'Cont\u00e1ctenos',
    aiSummaryNote: 'Resumen generado por inteligencia artificial (IA) \u2014 puede contener errores. No es un acta oficial.',
    siteNavHome: 'Inicio',
    siteNavMeetings: 'Reuniones',
    siteNavDistrict: 'Distrito',
    siteNavCode: 'C\u00f3digo',
    navTopics: 'Temas Clave',
    navResources: 'Recursos',
    navSourceCode: 'C\u00f3digo Fuente',
    threadSectionTitle: 'Temas Clave de Este A\u00f1o',
    threadSectionSubtitle: 'Haga clic en un tema para filtrar las reuniones. Haga clic de nuevo para mostrar todas.',
    schoolYearTitle: (sy) => `A\u00f1o Escolar ${sy.slice(0,4)}\u2013${sy.slice(4)}`,
    schoolYearSubtitle: (sy, n) => {
      if (sy === '202526') return `${n} reuniones desde junio de 2025 hasta el presente. Agendas completas y video disponibles.`;
      return `${n} reuniones del archivo de BoardDocs.`;
    },
    agendaItemsLabel: (n) => `${n} punto${n === 1 ? '' : 's'} de agenda`,
    agendaItemsLink: 'puntos de agenda',
    meetingsPath: 'reuniones',
    otherAttachments: 'Otros Anexos',
    video: 'Video',
    agenda: 'Agenda',
    minutes: 'Actas',
    transcript: 'Transcripci\u00f3n',
    joinZoom: 'Unirse por Zoom',
    rotationTitle: 'Rotaci\u00f3n Anual de Oficiales \u00b7 Seg\u00fan Estatutos de la Junta',
    rotationBelow: 'Rotaci\u00f3n a:',
    govCalTitle: 'Calendario de Gobernanza',
    govCalDesc: (dateStr) => `Puntos de agenda planificados para el a\u00f1o escolar. De la agenda del ${dateStr}.`,
    govCalLink: 'Ver Calendario (PDF)',
    tipSpeakTitle: '\u00bfQuieres hablar en una reuni\u00f3n de la junta?',
    tipSpeakBody: `Cualquier persona puede dirigirse a la Junta durante el periodo de Comentario P\u00fablico al inicio de cada reuni\u00f3n. Tienes <strong>3 minutos</strong> para hablar sobre cualquier tema dentro de la jurisdicci\u00f3n de la Junta.<br><br>
<strong>En persona:</strong> Recoge una tarjeta de orador en la entrada y entr\u00e9gala a la Secretaria de la Junta antes de que comience la reuni\u00f3n.<br>
<strong>Por Zoom:</strong> Env\u00eda una tarjeta digital usando los enlaces en la agenda, o usa la funci\u00f3n "Levantar la mano". Los enlaces se publican con la agenda de cada reuni\u00f3n.<br><br>
Los comentarios en espa\u00f1ol son bienvenidos \u2014 hay un int\u00e9rprete disponible en cada reuni\u00f3n.`,
    tipTopicTitle: '\u00bfQuieres que se discuta un tema en una reuni\u00f3n futura?',
    tipTopicBody: `Hay varias formas de poner un tema en la agenda de una reuni\u00f3n futura:<br><br>
<strong>Proponer un tema para la agenda:</strong> La forma m\u00e1s directa. Al menos 10 d\u00edas antes de una reuni\u00f3n, env\u00eda tu propuesta por email al Presidente de la Junta y al Superintendente. Ellos establecen la agenda juntos.<br>
<strong>Comentario P\u00fablico:</strong> Menciona el tema durante el Comentario P\u00fablico en cualquier reuni\u00f3n \u2014 los miembros de la Junta frecuentemente dan seguimiento a las preocupaciones de la comunidad.<br>
<strong>Contacta a un miembro de la Junta:</strong> Env\u00eda un email directamente a cualquier miembro. La informaci\u00f3n de contacto est\u00e1 en <a href="https://www.rcsdk8.net/domain/12" target="_blank" rel="noopener">el sitio web del distrito</a>.<br>
<strong>Secci\u00f3n "Otros asuntos":</strong> Cerca del final de cada reuni\u00f3n, la Junta discute temas sugeridos para futuras agendas.<br>
<strong>Comunicaci\u00f3n escrita:</strong> Env\u00eda una carta o email a la Secretaria de la Junta en la Oficina del Distrito (750 Bradford St, Redwood City, CA 94063).`,
    resourcesTitle: 'Recursos',
    resCalMeetingsTitle: 'Calendario de Reuniones',
    resCalMeetingsDesc: 'Suscríbase a las actualizaciones automáticas de las reuniones de la junta en Apple Calendar, Google Calendar u Outlook.',
    resCalSchoolTitle: 'Calendario Escolar',
    resCalSchoolDesc: 'Suscríbase a las fechas clave, vacaciones, feriados y días de salida temprana en Apple Calendar, Google Calendar u Outlook.',
    resBoardPortalTitle: 'Portal de Reuniones',
    resBoardPortalDesc: 'Agendas actuales y anexos en GAMUT/Simbli.',
    resBoardDocsTitle: 'Archivo de BoardDocs',
    resBoardDocsDesc: 'Agendas de reuniones antes de junio de 2025.',
    resYouTubeTitle: 'Canal de YouTube',
    resYouTubeDesc: 'Grabaciones de video de las reuniones p\u00fablicas de la junta.',
    resDistrictTitle: 'Sitio Web del Distrito',
    resDistrictDesc: 'Informaci\u00f3n oficial y anuncios de RCSD.',
    footerText: 'Compilado a partir de documentos p\u00fablicos de RCSD. Los documentos originales est\u00e1n disponibles en',
    footerAnd: 'y a trav\u00e9s del',
    footerPortal: 'portal de la junta GAMUT',
    footerDistrict: 'Resumen del Distrito',
    footerDistrito: 'District Summary (English)',
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
    upcomingTitle: 'Pr\u00f3ximas Reuniones',
    upcomingSubtitle: 'Reuniones de la junta programadas para las pr\u00f3ximas semanas.',
    badgeAgendaPosted: 'Agenda Publicada',
    badgeUpcoming: 'Pr\u00f3xima',
    plannedPrefix: 'Planificado:',
    altLangLink: 'Meetings (English)',
    altLangHref: '/meetings/',
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

function fmtNum(n) {
  return (n || 0).toLocaleString('en-US');
}

function formatTS(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDuration(seconds) {
  if (seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
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

// ---- School and topic tagging ----
const SCHOOL_NAME_PATTERNS = [
  { slug: 'adelante-selby', patterns: ['Adelante Selby', 'Adelante'] },
  { slug: 'clifford', patterns: ['Clifford'] },
  { slug: 'garfield', patterns: ['Garfield'] },
  { slug: 'henry-ford', patterns: ['Henry Ford'] },
  { slug: 'hoover', patterns: ['Hoover'] },
  { slug: 'kennedy', patterns: ['Kennedy'] },
  { slug: 'mckinley-mit', patterns: ['McKinley'] },
  { slug: 'north-star', patterns: ['North Star'] },
  { slug: 'orion', patterns: ['Orion'] },
  { slug: 'roosevelt', patterns: ['Roosevelt'] },
  { slug: 'roy-cloud', patterns: ['Roy Cloud'] },
  { slug: 'taft', patterns: ['Taft'] },
];

const TOPIC_PATTERNS = [
  { id: 'solar', label: 'Solar', labelEs: 'Solar', patterns: ['Solar'] },
  { id: 'hvac', label: 'HVAC / Air Conditioning', labelEs: 'HVAC / Aire Acondicionado', patterns: ['HVAC', 'Air Conditioning', 'air conditioning'] },
  { id: 'sped', label: 'Special Education', labelEs: 'Educación Especial', patterns: ['SPED', 'SpEd', 'Special Education', 'special education'] },
  { id: 'el', label: 'English Learners', labelEs: 'Estudiantes de Inglés', patterns: ['English Learner', 'ELD '] },
];

function matchSchoolSlugs(text) {
  const normalized = text.replace(/Roosevelt\s+Ave(nue)?/gi, '___');
  const matches = new Set();
  for (const { slug, patterns } of SCHOOL_NAME_PATTERNS) {
    for (const p of patterns) {
      if (normalized.includes(p)) { matches.add(slug); break; }
    }
  }
  return [...matches];
}

function matchTopics(text) {
  const matches = new Set();
  for (const { id, patterns } of TOPIC_PATTERNS) {
    for (const p of patterns) {
      if (text.includes(p)) { matches.add(id); break; }
    }
  }
  return [...matches];
}

// Tag each meeting with schools and topics mentioned in its items
const meetingSchools = {};  // date → Set of slugs
const meetingTopics = {};   // date → Set of topic ids
const schoolCounts = {};
const topicCounts = {};

for (const m of data.meetings) {
  const schools = new Set();
  const topics = new Set();
  const allText = (m.items || []).map(i => i.title || '').join(' ');
  // Also check summary/topics
  const summaryText = (m.topics || []).join(' ');
  const combined = allText + ' ' + summaryText;

  for (const slug of matchSchoolSlugs(combined)) schools.add(slug);
  for (const topic of matchTopics(combined)) topics.add(topic);

  meetingSchools[m.date] = schools;
  meetingTopics[m.date] = topics;

  for (const s of schools) schoolCounts[s] = (schoolCounts[s] || 0) + 1;
  for (const t of topics) topicCounts[t] = (topicCounts[t] || 0) + 1;
}

console.log(`Tagged meetings: ${Object.keys(schoolCounts).length} schools, ${Object.keys(topicCounts).length} topics`);

// Count threads
const threadCounts = {};
data.meetings.forEach(m => m.threads.forEach(t => {
  threadCounts[t] = (threadCounts[t] || 0) + 1;
}));

// Split into school years dynamically.
// Fiscal school year N starts July 1 of year N-1 and ends June 30 of year N.
function getSchoolYear(dateStr) {
  const y = parseInt(dateStr.slice(0, 4));
  const m = parseInt(dateStr.slice(5, 7));
  // July (7) or later starts the next school year
  if (m >= 7) return `${y}${(y + 1).toString().slice(2)}`;
  return `${y - 1}${y.toString().slice(2)}`;
}

const schoolYearMap = new Map(); // e.g. '2526' -> [meetings]
for (const m of data.meetings) {
  const sy = getSchoolYear(m.date);
  if (!schoolYearMap.has(sy)) schoolYearMap.set(sy, []);
  schoolYearMap.get(sy).push(m);
}
// Sort school years descending
const schoolYears = [...schoolYearMap.entries()].sort((a, b) => b[0].localeCompare(a[0]));

// Dynamic header subtitle based on actual date range
function headerSubtitleText(lang) {
  const years = schoolYears.length;
  const oldest = schoolYears[schoolYears.length - 1][0]; // e.g. '201920'
  const newest = schoolYears[0][0]; // e.g. '202526'
  const range = `${oldest.slice(0,4)}\u2013${newest.slice(4)}`;
  if (lang === 'es') {
    return `${data.meetings.length} reuniones de la junta (${range}) con agendas, grabaciones de video y temas clave. Datos recopilados de`;
  }
  return `${data.meetings.length} board meetings (${range}) with agendas, video recordings, and key topics. Data compiled from`;
}

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

// Returns { text, ai } — `ai: true` means the text came from
// generate-meeting-summaries.mjs (Claude-written prose) and MUST carry a
// visible AI label when rendered. Topic/item fallbacks are quoted from the
// official agenda listings, so they are not labeled as AI.
function generateSummary(m) {
  // AI-written summary first
  if (manualSummaries[m.date]) return { text: manualSummaries[m.date], ai: true };

  // Use topics (already curated for Simbli, auto-extracted for BoardDocs)
  if (m.topics && m.topics.length > 0 && m.topics[0]) {
    return { text: m.topics.join('; '), ai: false };
  }

  // Fallback: generate from substantive items
  if (!m.items || m.items.length === 0) return null;
  const sub = m.items.filter(isSubstantiveItem);
  if (sub.length === 0) return null;
  return { text: sub.slice(0, 5).map(it => it.title).join('; '), ai: false };
}

function highlightSummary(text) {
  let html = escapeHtml(text);
  // Preserve <strong> tags that the summary-generation prompt emits.
  html = html.replace(/&lt;(\/?strong)&gt;/g, '<$1>');
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


// isSubstantiveItem imported from meeting-utils.mjs

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
  const mSchools = meetingSchools[m.date] || new Set();
  const mTopics = meetingTopics[m.date] || new Set();
  const schoolAttrs = mSchools.size ? ` data-schools="${[...mSchools].join(' ')}"` : '';
  const topicAttrs = mTopics.size ? ` data-topics="${[...mTopics].join(' ')}"` : '';
  const sparseClass = isSparse ? ' meeting-row--sparse' : '';
  const typeClass = meetingTypeClass(m.type);
  const typeModifier = typeClass ? ` meeting-row--${typeClass}` : '';

  // Check for R2-hosted artifacts
  const slug = agendaSlug(m.type);
  const agendaFile = `${m.date}-${slug}.pdf`;
  const hasR2Agenda = agendaFiles.has(agendaFile);
  const minutesFile = minutesFiles.has(`${m.date}-minutes.pdf`) ? `${m.date}-minutes.pdf` : null;

  let links = '';
  // Zoom link — hidden by default, shown by client-side JS for upcoming/recent meetings
  if (m.zoom) {
    links += `<a href="${escapeHtml(m.zoom)}" class="meeting-link meeting-link--zoom" data-zoom-date="${m.date}" target="_blank" rel="noopener">&#9678; ${L.joinZoom}</a>`;
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
      const docAid = doc.aid || doc.href.match(/AID=(\d+)/)?.[1];
      const r2Min = docAid && aidToR2Path[docAid];
      const minHref = r2Min ? `${R2_BASE}/${r2Min}` : doc.href;
      links += `<a href="${escapeHtml(minHref)}" class="meeting-link meeting-link--minutes" target="_blank" rel="noopener">&#128196; ${L.minutes}</a>`;
    } else if (m.minutes.approvedAt) {
      const approver = data.meetings.find(x => x.date === m.minutes.approvedAt);
      const approverUrl = approver?.simbli || approver?.boarddocs;
      if (approverUrl) {
        links += `<a href="${escapeHtml(approverUrl)}" class="meeting-link meeting-link--minutes" target="_blank" rel="noopener" title="${L.minutes} ${m.minutes.approvedAt}">&#128196; ${L.minutes}</a>`;
      }
    }
  }
  if (m.hasTranscript) {
    links += `<a href="/${L.meetingsPath}/${m.date}/" class="meeting-link meeting-link--transcript">&#128221; ${L.transcript}</a>`;
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

  // Short meeting title (2-5 words capturing the main topic)
  // Look up by slug first (for multi-meeting dates), then by date
  const titleEntry = meetingTitles[m.slug] || meetingTitles[m.date];
  const titleText = titleEntry ? (titleEntry[L.lang] || titleEntry.en) : '';
  const titleHtml = titleText
    ? `<span class="meeting-title">${escapeHtml(titleText)}</span>`
    : '';

  // Summary paragraph (replaces topic bullets)
  const summary = generateSummary(m);
  const summaryHtml = summary
    ? `<p class="meeting-summary">${highlightSummary(summary.text)}${summary.ai ? ` <span class="ai-label">${L.aiSummaryNote}</span>` : ''}</p>`
    : '';

  // Linked item count (detail page has full agenda)
  const itemCount = (m.items || []).filter(isSubstantiveItem).length;

  // For multi-meeting dates, link to slug-based path; for single, use date
  const sameDateCount = data.meetings.filter(x => x.date === m.date).length;
  const viewerHref = sameDateCount > 1 ? `/${L.meetingsPath}/${m.slug}/` : `/${L.meetingsPath}/${m.date}/`;
  const itemCountHtml = itemCount > 0
    ? `<a href="${viewerHref}#agenda" class="meeting-item-count">${itemCount} ${L.agendaItemsLink} &#8594;</a>`
    : '';

  return `    <div class="meeting-row${sparseClass}${typeModifier}"${threadAttrs}${schoolAttrs}${topicAttrs}>
      <a href="${viewerHref}" class="meeting-date">
        <span class="meeting-date-month">${month}</span>
        <span class="meeting-date-day">${day}</span>
        <span class="meeting-date-year">${year}</span>
      </a>
      <div class="meeting-body">
        <div class="meeting-header">
          <a href="${viewerHref}" class="meeting-type">${escapeHtml(L.meetingTypes[m.type] || m.type)}</a>${titleHtml}${m.duration ? `<span class="meeting-duration">${m.duration}</span>` : ''}
          <div class="meeting-links">${links}</div>
        </div>
        ${threadTags}
        ${summaryHtml}
        ${itemCountHtml}
      </div>
    </div>`;
}

// Officer rotation annotations
// `date` = the meeting where rotation occurred
// `officers` = the NEW officers after rotation (per Board Bylaw 9100, rotation by seniority)
// TODO: Pre-2025 data needs verification against approved minutes. Will be replaced
// by a proper entity/role registry (see ROADMAP: Key Parties Roster).
const OFFICER_ROTATIONS = [
  {
    afterDate: '2025-12-17',
    previous: { president: 'David Weekly', vp: 'Cecilia I. Márquez', clerk: 'Ng Kwing King' },
    // Verified from meeting summary and transcript
  },
  {
    afterDate: '2024-12-17',
    previous: { president: 'Mike Wells', vp: 'David Weekly', clerk: 'Cecilia I. Márquez' },
    note: 'Trustees Lawson (9 yrs) and MacAvoy (17 yrs) departed; Li and Ng Kwing King sworn in',
    // Wells confirmed as incoming president from transcript [149]: "honored to step into this role as board president"
  },
  {
    afterDate: '2023-12-06',
    previous: { president: 'Janet Lawson', vp: 'Mike Wells', clerk: 'Alisa MacAvoy' },
    // Outgoing president was Márquez (per agenda Welcome item). Needs verification.
  },
  {
    afterDate: '2022-12-14',
    previous: { president: 'Cecilia I. Márquez', vp: 'Janet Lawson', clerk: 'Mike Wells' },
    note: 'Trustee Díaz-Slocum departed; Weekly and Márquez sworn in',
    // Outgoing president was Díaz-Slocum (per agenda Welcome item). Needs verification.
  },
  {
    afterDate: '2021-12-15',
    previous: { president: 'María Díaz-Slocum', vp: 'Cecilia I. Márquez', clerk: 'Janet Lawson' },
    // Outgoing president was MacAvoy (per agenda Welcome item). Needs verification.
  },
  {
    afterDate: '2020-12-11',
    previous: { president: 'Alisa MacAvoy', vp: 'María Díaz-Slocum', clerk: 'Cecilia I. Márquez' },
    note: 'Trustee McBride departed; Wells, MacAvoy, and Lawson sworn in',
    // Needs verification.
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

// "At a glance" — surface the two things people come for (what happened at the
// last meeting, and when the next one is / what it covers) at the very top,
// above the topic filters and the archive.
function renderAtAGlance() {
  const past = data.meetings
    .filter(m => m.date <= todayStr)
    .sort((a, b) => b.date.localeCompare(a.date));
  const last = past[0];
  const nextDate = futureBoardMeetingDates[0];
  const nextMeeting = nextDate ? data.meetings.find(m => m.date === nextDate) : null;
  if (!last && !nextDate) return '';

  const cards = [];

  if (last) {
    cards.push(`    <div class="glance-card">
      <div class="glance-label">${L.lang === 'es' ? 'Última reunión' : 'Latest meeting'}</div>
${renderMeeting(last)}
    </div>`);
  }

  if (nextDate) {
    let body;
    if (nextMeeting) {
      body = renderMeeting(nextMeeting);
    } else {
      const { month, day, year } = formatDateBadge(nextDate);
      const topics = govCalTopics[nextDate];
      const topicText = topics ? topics[L.lang] || topics.en : null;
      const noAgenda = L.lang === 'es'
        ? 'La agenda se publica unas 72 horas antes de la reunión.'
        : 'Agenda is posted about 72 hours before the meeting.';
      body = `    <div class="meeting-row">
      <div class="meeting-date meeting-date--static">
        <span class="meeting-date-month">${month}</span>
        <span class="meeting-date-day">${day}</span>
        <span class="meeting-date-year">${year}</span>
      </div>
      <div class="meeting-body">
        <div class="meeting-header">
          <span class="meeting-type">${escapeHtml(L.meetingTypes['Board Meeting'] || 'Board Meeting')}</span>
        </div>
        <p class="meeting-summary">${topicText ? escapeHtml(topicText) + ' ' : ''}${noAgenda}</p>
      </div>
    </div>`;
    }
    cards.push(`    <div class="glance-card">
      <div class="glance-label">${L.lang === 'es' ? 'Próxima reunión' : 'Next meeting'}</div>
${body}
    </div>`);
  }

  return `<section class="glance-section" id="glance">
  <div class="glance-grid">
${cards.join('\n')}
  </div>
</section>`;
}

// Render the "Upcoming Meetings" section with two tiers
function renderUpcomingSection() {
  if (upcomingPublished.length === 0 && upcomingProvisional.length === 0) return '';

  const simbliListingUrl = 'https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030397';

  let cards = '';

  // Tier 1: Published meetings (agenda available) — render like regular meeting cards with badge
  for (const m of upcomingPublished) {
    const { month, day, year } = formatDateBadge(m.date);
    const threadAttrs = m.threads.length ? ` data-threads="${m.threads.join(' ')}"` : '';
    const mSchools = meetingSchools[m.date] || new Set();
    const mTopics = meetingTopics[m.date] || new Set();
    const schoolAttrs = mSchools.size ? ` data-schools="${[...mSchools].join(' ')}"` : '';
    const topicAttrs = mTopics.size ? ` data-topics="${[...mTopics].join(' ')}"` : '';
    const typeClass = meetingTypeClass(m.type);
    const typeModifier = typeClass ? ` meeting-row--${typeClass}` : '';

    // Build links (same as renderMeeting)
    const slug = agendaSlug(m.type);
    const agendaFile = `${m.date}-${slug}.pdf`;
    const hasR2Agenda = agendaFiles.has(agendaFile);
    const minutesFile = minutesFiles.has(`${m.date}-minutes.pdf`) ? `${m.date}-minutes.pdf` : null;

    let links = '';
    if (m.zoom) {
      links += `<a href="${escapeHtml(m.zoom)}" class="meeting-link meeting-link--zoom" data-zoom-date="${m.date}" target="_blank" rel="noopener">&#9678; ${L.joinZoom}</a>`;
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
    }
    if (m.hasTranscript) {
      links += `<a href="/${L.meetingsPath}/${m.date}/" class="meeting-link meeting-link--transcript">&#128221; ${L.transcript}</a>`;
    }

    const summary = generateSummary(m);
    const summaryHtml = summary
      ? `<p class="meeting-summary">${highlightSummary(summary.text)}${summary.ai ? ` <span class="ai-label">${L.aiSummaryNote}</span>` : ''}</p>`
      : '';

    const itemCount = (m.items || []).filter(isSubstantiveItem).length;

    const sameDateCount = data.meetings.filter(x => x.date === m.date).length;
    const viewerHref = sameDateCount > 1 ? `/${L.meetingsPath}/${m.slug}/` : `/${L.meetingsPath}/${m.date}/`;
    const itemCountHtml = itemCount > 0
      ? `<a href="${viewerHref}#agenda" class="meeting-item-count">${itemCount} ${L.agendaItemsLink} &#8594;</a>`
      : '';

    cards += `    <div class="meeting-row${typeModifier}"${threadAttrs}${schoolAttrs}${topicAttrs}>
      <a href="${viewerHref}" class="meeting-date">
        <span class="meeting-date-month">${month}</span>
        <span class="meeting-date-day">${day}</span>
        <span class="meeting-date-year">${year}</span>
      </a>
      <div class="meeting-body">
        <div class="meeting-header">
          <a href="${viewerHref}" class="meeting-type">${escapeHtml(L.meetingTypes[m.type] || m.type)}</a>
          <span class="upcoming-badge upcoming-badge--published">${L.badgeAgendaPosted}</span>
          ${m.duration ? `<span class="meeting-duration">${m.duration}</span>` : ''}
          <div class="meeting-links">${links}</div>
        </div>
        ${summaryHtml}
        ${itemCountHtml}
      </div>
    </div>`;
  }

  // Tier 2: Board-adopted future dates (no agenda posted yet). These are the
  // formally approved calendar, so they render as a compact, fully-visible date
  // grid — no accordion, no per-row "Board Meeting" repetition. A date carrying a
  // specific planned topic surfaces it on hover.
  let provisionalHtml = '';
  if (upcomingProvisional.length > 0) {
    const cells = upcomingProvisional.map(dateStr => {
      const [yStr, mStr, dStr] = dateStr.split('-');
      const monthIdx = parseInt(mStr, 10) - 1;
      const dayVal = parseInt(dStr, 10);
      const dateLabel = L.lang === 'es'
        ? `${dayVal} ${L.monthFull[monthIdx].slice(0, 3).toLowerCase()} ${yStr}`
        : `${L.monthFull[monthIdx].slice(0, 3)} ${dayVal}, ${yStr}`;

      const topics = govCalTopics[dateStr];
      const topicText = topics ? topics[L.lang] || topics.en : null;
      const titleAttr = topicText ? ` title="${escapeHtml(topicText)}"` : '';
      const topicMark = topicText ? '<span class="cal-cell-dot" aria-hidden="true">•</span>' : '';

      return `        <li class="cal-cell"${titleAttr}>${dateLabel}${topicMark}</li>`;
    }).join('\n');

    const noteText = L.lang === 'es'
      ? 'Reuniones ordinarias de la Junta adoptadas para 2026–27. Las agendas se publican unas 72 horas antes de cada reunión.'
      : 'Regular Board meetings adopted for 2026–27. Agendas post about 72 hours before each meeting.';

    provisionalHtml = `
    <div class="upcoming-provisional-section">
      <h3 class="upcoming-provisional-title">${L.lang === 'es' ? 'Calendario de Reuniones Aprobado' : 'Approved Meeting Calendar'}</h3>
      <p class="upcoming-provisional-note">${noteText}</p>
      <ul class="cal-grid">
${cells}
      </ul>
    </div>`;
  }

  return `<section class="section upcoming-section" id="upcoming">
  <div class="section-rule"></div>
  <h2>${L.upcomingTitle}</h2>
  <p class="section-subtitle">${L.upcomingSubtitle}</p>
  <div class="meeting-list">
${cards}
  </div>
  ${provisionalHtml}
</section>`;
}

// Render a school year section
function renderSchoolYear(id, title, meetings, subtitle, collapsed = false) {
  const meetingRows = [];
  for (const m of meetings) {
    // Insert rotation divider before the meeting where rotation occurred
    for (const rot of OFFICER_ROTATIONS) {
      if (m.date === rot.afterDate) {
        meetingRows.push(renderRotationDivider(rot));
      }
    }
    meetingRows.push(renderMeeting(m));
  }

  if (collapsed) {
    return `<details class="section section-collapsible" id="${id}">
  <div class="section-rule"></div>
  <summary><h2>${title}</h2></summary>
  ${subtitle ? `<p class="section-subtitle">${subtitle}</p>` : ''}
  <div class="meeting-list">
${meetingRows.join('\n')}
  </div>
</details>`;
  }

  return `<section class="section" id="${id}">
  <div class="section-rule"></div>
  <h2>${title}</h2>
  ${subtitle ? `<p class="section-subtitle">${subtitle}</p>` : ''}
  <div class="meeting-list">
${meetingRows.join('\n')}
  </div>
</section>`;
}

// ---- JSON-LD: ItemList of Event entries for the index page ----
// Field mapping mirrors meetingJsonLd() in build-meeting-pages.mjs (same
// @id per meeting, name formula, times, location, organizer) so search
// engines see the index entries and detail pages as the same entities.

// Lowercase full months to match formatDateEs in build-meeting-pages.mjs
// (L.monthFull is capitalized for section headings)
const MONTHS_ES_LONG = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function formatDateEsLong(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${parseInt(d)} de ${MONTHS_ES_LONG[parseInt(m) - 1]} de ${y}`;
}

function meetingsIndexJsonLd() {
  const isEs = L.lang === 'es';
  const prefix = isEs ? 'reuniones' : 'meetings';
  const organizer = {
    "@type": "GovernmentOrganization",
    "name": isEs
      ? 'Distrito Escolar de Redwood City - Mesa Directiva'
      : 'Redwood City School District Board of Trustees',
    "url": "https://www.rcsdk8.net",
    "sameAs": "https://rcsd.info/"
  };
  const location = {
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
  };

  // Newest first, matching the page's display order
  const sorted = [...data.meetings].sort((a, b) => b.date.localeCompare(a.date));
  const itemListElement = sorted.map((m, i) => {
    const isMulti = data.meetings.filter(x => x.date === m.date).length > 1;
    const pagePath = isMulti ? m.slug : m.date;
    const typeLabel = isEs ? (L.meetingTypes[m.type] || m.type) : m.type;
    const name = isEs
      ? `Reunión de la Junta de RCSD: Sesión ${typeLabel} (${formatDateEsLong(m.date)})`
      : `RCSD School Board Meeting: ${typeLabel} Session (${formatDate(m.date)})`;
    return {
      "@type": "ListItem",
      "position": i + 1,
      "item": {
        "@type": "Event",
        "@id": `https://rcsd.info/meetings/${m.slug}/#meeting`,
        "name": name,
        "startDate": `${m.date}T19:00:00-07:00`,
        "endDate": `${m.date}T22:00:00-07:00`,
        "eventStatus": "https://schema.org/EventScheduled",
        "eventAttendanceMode": "https://schema.org/MixedEventAttendanceMode",
        "url": `https://rcsd.info/${prefix}/${pagePath}/`,
        "location": location,
        "organizer": organizer
      }
    };
  });

  const list = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${L.canonicalUrl}#meetings`,
    "name": isEs ? 'Reuniones de la Junta de RCSD' : 'RCSD Board Meetings',
    "description": L.metaDescription,
    "url": L.canonicalUrl,
    "inLanguage": L.lang,
    "numberOfItems": itemListElement.length,
    "itemListElement": itemListElement,
  };

  // Minified: ~190 events would add ~100KB extra if pretty-printed
  return `<script type="application/ld+json">${JSON.stringify(list)}</script>`;
}

// Thread filter section — now includes schools and topics
function renderThreadFilters() {
  const threads = ['superintendent-search', 'budget', 'parcel-tax', 'facilities-bond', 'policy'];

  // School buttons sorted by count (descending)
  const schoolList = SCHOOL_NAME_PATTERNS
    .filter(s => schoolCounts[s.slug] > 0)
    .sort((a, b) => (schoolCounts[b.slug] || 0) - (schoolCounts[a.slug] || 0));

  // Topic buttons
  const topicList = TOPIC_PATTERNS.filter(t => topicCounts[t.id] > 0);

  const schoolFilterLabel = L.lang === 'es' ? 'Escuelas' : 'Schools';
  const topicFilterLabel = L.lang === 'es' ? 'Temas' : 'Topics';

  return `<section class="section" id="threads">
  <div class="section-rule"></div>
  <h2>${L.threadSectionTitle}</h2>
  <p>${L.threadSectionSubtitle}</p>
  <div class="thread-filters">
${threads.map(t => `    <button class="thread-btn" data-filter="${t}" data-filter-type="thread">
      <span class="thread-btn-label">${L.threadLabels[t]}</span>
      <span class="thread-btn-count">${threadCounts[t] || 0}</span>
    </button>`).join('\n')}
  </div>
  <h3 style="margin-top:1.5rem; font-family:'IBM Plex Mono',monospace; font-size:0.7rem; letter-spacing:0.06em; text-transform:uppercase; color:var(--text-muted)">${schoolFilterLabel}</h3>
  <div class="thread-filters" style="margin-top:0.5rem">
${schoolList.map(s => `    <button class="thread-btn" data-filter="${s.slug}" data-filter-type="school">
      <span class="thread-btn-label">${prettySchool(s.slug)}</span>
      <span class="thread-btn-count">${schoolCounts[s.slug] || 0}</span>
    </button>`).join('\n')}
  </div>
  <h3 style="margin-top:1.5rem; font-family:'IBM Plex Mono',monospace; font-size:0.7rem; letter-spacing:0.06em; text-transform:uppercase; color:var(--text-muted)">${topicFilterLabel}</h3>
  <div class="thread-filters" style="margin-top:0.5rem">
${topicList.map(t => `    <button class="thread-btn" data-filter="${t.id}" data-filter-type="topic">
      <span class="thread-btn-label">${L.lang === 'es' ? t.labelEs : t.label}</span>
      <span class="thread-btn-count">${topicCounts[t.id] || 0}</span>
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

  const r2Path = latest.aid && aidToR2Path[latest.aid];
  const href = latest.href || (r2Path ? `${R2_BASE}/${r2Path}` : (latest.aid ? `https://simbli.eboardsolutions.com/Meetings/Attachment.aspx?S=36030397&AID=${latest.aid}&MID=${latest.mid}` : null));
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
      <h3>${L.resCalMeetingsTitle}</h3>
      <p>${L.resCalMeetingsDesc}</p>
      <div class="calendar-links">
        <a href="webcal://rcsd.info/${L.lang === 'en' ? 'board-meetings' : 'reuniones-junta'}.ics" class="calendar-btn">Apple / Outlook</a>
        <a href="https://calendar.google.com/calendar/r?cid=http%3A%2F%2Frcsd.info%2F${L.lang === 'en' ? 'board-meetings' : 'reuniones-junta'}.ics" class="calendar-btn" target="_blank" rel="noopener">Google Calendar</a>
        <a href="/${L.lang === 'en' ? 'board-meetings' : 'reuniones-junta'}.ics" class="calendar-btn" download>Download ICS</a>
      </div>
    </div>
    <div class="resource-card">
      <h3>${L.resCalSchoolTitle}</h3>
      <p>${L.resCalSchoolDesc}</p>
      <div class="calendar-links">
        <a href="webcal://rcsd.info/${L.lang === 'en' ? 'school-dates' : 'fechas-escolares'}.ics" class="calendar-btn">Apple / Outlook</a>
        <a href="https://calendar.google.com/calendar/r?cid=http%3A%2F%2Frcsd.info%2F${L.lang === 'en' ? 'school-dates' : 'fechas-escolares'}.ics" class="calendar-btn" target="_blank" rel="noopener">Google Calendar</a>
        <a href="/${L.lang === 'en' ? 'school-dates' : 'fechas-escolares'}.ics" class="calendar-btn" download>Download ICS</a>
      </div>
    </div>
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

function generatePage() {

const pageCSS = `
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

  .calendar-links {
    margin-top: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .calendar-btn {
    display: inline-block;
    padding: 5px 10px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.72rem;
    letter-spacing: 0.02em;
    background: var(--cream-dark);
    color: var(--green-deep) !important;
    text-decoration: none !important;
    border-radius: 4px;
    border: 1px solid var(--rule);
    transition: background 0.15s, border-color 0.15s;
  }
  .calendar-btn:hover {
    background: var(--green-pale);
    border-color: var(--green-light);
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
    padding: 2.5rem 2rem 2rem;
    position: relative;
  }

  .header-district {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    /* lightened from --green-light (3.12:1) for WCAG AA 4.5:1 on --green-deep */
    color: #73b390;
    margin-bottom: 0.7rem;
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
    margin-top: 0.9rem;
    font-size: 0.9rem;
    color: rgba(255,255,255,0.6);
    line-height: 1.55;
    max-width: 520px;
    font-style: italic;
  }

  .header-meta {
    margin-top: 1.1rem;
    display: flex;
    align-items: baseline;
    gap: 0.5rem 1.4rem;
    flex-wrap: wrap;
  }

  .header-stat {
    display: flex;
    align-items: baseline;
    gap: 0.35rem;
  }

  .header-stat-value {
    font-family: 'Fraunces', serif;
    font-size: 1.05rem;
    font-weight: 600;
    color: #fff;
    line-height: 1;
  }

  .header-stat-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    /* raised from 0.45 alpha (3.85:1) for WCAG AA 4.5:1 on --green-deep */
    color: rgba(255,255,255,0.62);
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

  .toc-year-select {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
    background: transparent;
    border: 1px solid var(--rule);
    border-radius: 3px;
    padding: 0.35rem 0.4rem;
    margin: 0.55rem 0.4rem;
    cursor: pointer;
  }

  .toc-year-select:hover {
    color: var(--green-mid);
    border-color: var(--green-light);
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

  .tip-boxes {
    display: flex;
    gap: 1rem;
    margin: 1.5rem 0;
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .tip-box {
    flex: 1;
    min-width: 280px;
    background: #fefbf0;
    border: 1px solid #e8dfc0;
    border-radius: 8px;
    padding: 0;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.05);
  }

  .tip-box-title {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--green-deep);
    padding: 0.75rem 1rem;
    cursor: pointer;
    list-style: none;
  }

  .tip-box-title::-webkit-details-marker { display: none; }

  .tip-box-title::before {
    content: '+ ';
    font-weight: 400;
    /* darkened from #c0a030 for WCAG AA 4.5:1 on the #fefbf0 tip-box bg */
    color: #8f6010;
  }

  .tip-box[open] .tip-box-title::before {
    content: '\\2212  ';
  }

  .tip-box[open] {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06);
  }

  .tip-box-body {
    font-family: 'Newsreader', serif;
    font-size: 0.85rem;
    line-height: 1.6;
    color: var(--text-secondary);
    padding: 0 1rem 1rem;
    border-top: 1px solid #e8dfc0;
  }

  .tip-box-body a {
    color: var(--green-mid);
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

  /* Collapsible school year sections */
  .section-collapsible {
    border: none;
  }
  .section-collapsible summary {
    cursor: pointer;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .section-collapsible summary::-webkit-details-marker { display: none; }
  .section-collapsible summary::before {
    content: '\u25B6';
    font-size: 0.7em;
    color: var(--green-deep);
    transition: transform 0.2s ease;
    flex-shrink: 0;
  }
  .section-collapsible[open] > summary::before {
    transform: rotate(90deg);
  }
  .section-collapsible summary h2 {
    margin-bottom: 0;
    display: inline;
  }
  .section-collapsible summary:hover h2 {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .section-collapsible > .section-subtitle {
    margin-top: 0.5rem;
  }
  .section-collapsible > .meeting-list {
    margin-top: 1rem;
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
    /* darkened from #7c6caf (4.28:1) for WCAG AA 4.5:1 on cream */
    color: #655494;
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
    /* darkened from --amber (2.96:1) for WCAG AA 4.5:1 on cream */
    color: #8f6010;
  }

  .meeting-row--special .meeting-type {
    /* darkened from #9a6a1e (4.44:1, just under AA) */
    color: #8f6010;
  }

  /* Retreat / offsite: teal accent */
  .meeting-row--offsite {
    border-left: 3px solid #3d8b8b;
    padding-left: 1rem;
  }

  .meeting-row--offsite .meeting-date-month {
    /* darkened from #3d8b8b (3.76:1) for WCAG AA 4.5:1 on cream */
    color: #2f7070;
  }

  .meeting-row--offsite .meeting-type {
    color: #2d6b6b;
  }

  /* ---- AGENDA ITEM COUNT LINK ---- */
  .meeting-item-count {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    color: var(--text-muted);
    text-decoration: none;
    display: block;
    margin-top: 0.3rem;
  }
  .meeting-item-count:hover {
    color: var(--green-mid);
    text-decoration: underline;
  }

  .meeting-date {
    flex-shrink: 0;
    width: 3rem;
    text-align: center;
    padding-top: 0.15rem;
    text-decoration: none;
    display: block;
  }

  .meeting-date:hover .meeting-date-day {
    color: var(--green-mid);
  }

  .meeting-date-month {
    display: block;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
    font-weight: 500;
    letter-spacing: 0.12em;
    /* darkened from --green-light (3.7:1) for WCAG AA 4.5:1 on cream + #f0f9f4 */
    color: #2f7050;
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
    /* was --text-muted at opacity .5 (1.7:1, invisible); WCAG AA needs 4.5:1 */
    color: var(--text-secondary);
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
    text-decoration: none;
  }

  .meeting-type:hover {
    color: var(--green-mid);
  }

  .meeting-title {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 0.03em;
    color: var(--text-secondary);
    margin-left: 0.5rem;
  }

  .meeting-duration {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
    color: var(--green-mid);
  }

  /* ---- BOARD ROSTER ---- */
  .board-roster {
    margin-top: 1.3rem;
    padding-top: 1rem;
    border-top: 1px solid rgba(255,255,255,0.12);
  }

  .board-roster-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    /* raised from 0.4 alpha (3.36:1) for WCAG AA 4.5:1 on --green-deep */
    color: rgba(255,255,255,0.62);
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
    /* raised from 0.4 alpha (3.36:1) for WCAG AA 4.5:1 on --green-deep */
    color: rgba(255,255,255,0.62);
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
    /* darkened from --coral (3.95:1) for WCAG AA 4.5:1 on cream */
    color: #b0492f;
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
    /* darkened from --amber (2.96:1) for WCAG AA 4.5:1 on cream */
    color: #8f6010;
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
    /* darkened from #2d8cff (3.14:1) for WCAG AA 4.5:1 on cream */
    color: #1668c8;
  }

  .meeting-link--zoom:hover {
    color: #0d4f9e;
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

  /* AI-provenance label: --text-muted clears 4.5:1 on cream (5.06:1) and on
     the #f0f9f4 upcoming-section background (5.00:1) */
  .ai-label {
    display: block;
    margin-top: 0.25rem;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.62rem;
    letter-spacing: 0.04em;
    color: var(--text-muted);
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

  /* ---- RESPONSIVE (page-specific) ---- */
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

  /* ---- UPCOMING MEETINGS SECTION ---- */
  .upcoming-section {
    background: #f0f9f4;
    border-radius: 8px;
    padding: 2rem 1.5rem 1.5rem;
    margin-top: 2rem;
  }

  .upcoming-section .section-rule {
    display: none;
  }

  .upcoming-badge {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 0.15rem 0.5rem;
    border-radius: 3px;
    font-weight: 600;
    white-space: nowrap;
  }

  .upcoming-badge--published {
    background: #d1fae5;
    color: #065f46;
    border: 1px solid #a7f3d0;
  }

  .upcoming-badge--provisional {
    background: #fef3c7;
    color: #92400e;
    border: 1px solid #fde68a;
  }

  .upcoming-provisional-section {
    margin-top: 1.5rem;
    border-top: 1px solid rgba(0, 128, 0, 0.1);
    padding-top: 1.2rem;
  }

  .upcoming-provisional-title {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--green-deep);
    margin: 0 0 0.8rem;
  }

  .upcoming-provisional-note {
    font-size: 0.82rem;
    color: var(--text-secondary);
    margin: 0 0 0.75rem;
    line-height: 1.45;
    max-width: 46rem;
  }

  .cal-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(116px, 1fr));
    gap: 0.4rem;
  }

  .cal-cell {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--green-deep);
    background: rgba(255, 255, 255, 0.65);
    border: 1px solid rgba(0, 128, 0, 0.14);
    border-radius: 5px;
    padding: 0.4rem 0.55rem;
    text-align: center;
    white-space: nowrap;
  }

  .cal-cell-dot {
    color: var(--green-mid);
    margin-left: 0.25rem;
  }

  /* ---- AT A GLANCE (latest + next meeting) ---- */
  .glance-section {
    margin-top: 1.75rem;
  }

  .glance-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    align-items: start;
  }

  .glance-card {
    border: 1px solid var(--rule-light);
    border-radius: 8px;
    padding: 0.55rem 1.1rem 0.35rem;
    background: rgba(255, 255, 255, 0.5);
  }

  .glance-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.62rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--green-mid);
    margin: 0.15rem 0 0.15rem;
  }

  /* Meeting rows sit flush inside the glance cards (no list separators). */
  .glance-card .meeting-row {
    border-bottom: none;
    padding-left: 0;
    padding-right: 0;
  }

  .meeting-date--static {
    cursor: default;
    text-decoration: none;
  }

  @media (max-width: 720px) {
    .glance-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 640px) {
    .cal-grid {
      grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
    }
  }

  /* page-specific footer overrides */
  .site-footer { font-size: 0.8rem; text-align: left; }
  .footer-nav { margin-top: 1rem; }
  .footer-nav a { font-size: 0.68rem; margin: 0 1.5rem 0 0; }
`;

const html = `<!DOCTYPE html>
<html lang="${L.lang}">
<head>
${headMeta({
  title: L.title,
  description: L.metaDescription,
  canonical: L.canonicalUrl,
  ogLocale: L.ogLocale,
  ogImageKey: `page-meetings${L.lang === 'es' ? '-es' : ''}`,
  hreflang: [
    { lang: L.lang, href: L.canonicalUrl },
    { lang: L.hreflangAltLang, href: L.hreflangAlt },
  ],
  jsonLd: meetingsIndexJsonLd(),
  pageCSS,
})}
</head>
<body>

${siteNav({ activePage: 'meetings', lang: L.lang, altLangHref: L.altLangHref })}

<header class="site-header">
  <div class="header-inner">
    <div class="header-district">${L.headerDistrict}</div>
    <h1 class="header-title">${L.headerTitle}</h1>
    <p class="header-subtitle">${headerSubtitleText(L.lang)} <a href="https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030397" style="color:rgba(255,255,255,0.75)">GAMUT/Simbli</a> ${L.headerSubtitleAnd} <a href="https://go.boarddocs.com/ca/redwood/Board.nsf/goto?open&id=CVLPDX62089F" style="color:rgba(255,255,255,0.75)">BoardDocs</a>.</p>
    <div class="header-meta">
      <div class="header-stat">
        <span class="header-stat-value">${fmtNum(data.stats.total)}</span>
        <span class="header-stat-label">${L.statMeetings}</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">${fmtNum(data.stats.totalItems)}</span>
        <span class="header-stat-label">${L.statAgendaItems}</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">${fmtNum(data.stats.totalAttachments)}</span>
        <span class="header-stat-label">${L.statAttachments}</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">${fmtNum(data.stats.withVideo)}</span>
        <span class="header-stat-label">${L.statWithVideo}</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">${fmtNum(data.stats.withTranscript)}</span>
        <span class="header-stat-label">${L.statWithTranscript}</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">${data.stats.withMinutes || 0}</span>
        <span class="header-stat-label">${L.statWithMinutes}</span>
      </div>
    </div>
    <div class="board-roster">
      <div class="board-roster-label"><a href="https://www.rcsdk8.net/our-district/our-board-of-trustees/meet-the-trustees" style="color:rgba(255,255,255,0.62);text-decoration:none" target="_blank" rel="noopener">${L.boardOfEd}</a></div>
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
  ${L.disclaimer} <a href="https://github.com/dweekly/rcsd-meetings" style="color:#664d03">David Weekly</a>. ${L.disclaimerSuffix} <a href="mailto:team@rcsd.info" style="color:#664d03">${L.disclaimerContact}</a>.
</div>

<nav class="toc">
  <div class="toc-inner">
    <a href="#threads">${L.navTopics}</a>
    ${(upcomingPublished.length > 0 || upcomingProvisional.length > 0) ? '<a href="#upcoming">' + L.upcomingTitle + '</a>\n    ' : ''}<select id="toc-year-select" name="year" class="toc-year-select" aria-label="${L.lang === 'es' ? 'Año escolar' : 'School year'}">
      <option value="">${L.lang === 'es' ? 'Año escolar' : 'School year'}…</option>
      ${schoolYears.map(([sy]) => `<option value="#sy${sy}">${sy.slice(0,4)}-${sy.slice(4)}</option>`).join('\n      ')}
    </select>
    <a href="#resources">${L.navResources}</a>
  </div>
</nav>

<main class="content">
${renderAtAGlance()}

${renderUpcomingSection()}

${renderThreadFilters()}

<div class="tip-boxes">
  <details class="tip-box">
    <summary class="tip-box-title">${L.tipSpeakTitle}</summary>
    <div class="tip-box-body">${L.tipSpeakBody}</div>
  </details>
  <details class="tip-box">
    <summary class="tip-box-title">${L.tipTopicTitle}</summary>
    <div class="tip-box-body">${L.tipTopicBody}</div>
  </details>
</div>

${schoolYears.map(([sy, meetings]) => {
  // Filter out meetings that appear in the Upcoming section to avoid duplication
  const filtered = meetings.filter(m => !upcomingDates.has(m.date));
  if (filtered.length === 0) return '';
  const expanded = sy === '202526' || sy === '202425';
  return renderSchoolYear(`sy${sy}`, L.schoolYearTitle(sy), filtered, L.schoolYearSubtitle(sy, filtered.length), !expanded);
}).filter(Boolean).join('\n\n')}

${renderResources(data)}
</main>

${siteFooter({ lang: L.lang })}

<script>
(function() {
  var activeFilter = null;
  var activeType = null;
  var btns = document.querySelectorAll('.thread-btn');
  var allRows = document.querySelectorAll('.meeting-row');
  var dividers = document.querySelectorAll('.rotation-divider');

  btns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var filter = btn.dataset.filter;
      var type = btn.dataset.filterType;
      if (activeFilter === filter && activeType === type) {
        activeFilter = null;
        activeType = null;
        btns.forEach(function(b) { b.classList.remove('active'); });
        allRows.forEach(function(r) {
          if (!r.closest('#upcoming, #glance')) {
            r.classList.remove('hidden');
          }
        });
        dividers.forEach(function(d) { d.classList.remove('hidden'); });
      } else {
        activeFilter = filter;
        activeType = type;
        btns.forEach(function(b) { b.classList.toggle('active', b.dataset.filter === filter && b.dataset.filterType === type); });
        allRows.forEach(function(r) {
          if (r.closest('#upcoming, #glance')) return;
          var match = false;
          if (type === 'thread') {
            var threads = r.dataset.threads || '';
            match = threads.indexOf(filter) !== -1;
          } else if (type === 'school') {
            var schools = r.dataset.schools || '';
            match = schools.indexOf(filter) !== -1;
          } else if (type === 'topic') {
            var topics = r.dataset.topics || '';
            match = topics.indexOf(filter) !== -1;
          }
          r.classList.toggle('hidden', !match);
        });
        dividers.forEach(function(d) { d.classList.add('hidden'); });
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

  // School-year dropdown: navigate + auto-expand the target <details>
  var yearSelect = document.querySelector('.toc-year-select');
  if (yearSelect) {
    yearSelect.addEventListener('change', function() {
      var hash = yearSelect.value;
      if (!hash) return;
      var target = document.querySelector(hash);
      if (target && target.tagName === 'DETAILS' && !target.open) target.open = true;
      window.location.hash = hash;
      yearSelect.value = '';
    });
  }

  // Also handle direct URL hash on page load
  if (window.location.hash && window.location.hash.startsWith('#sy')) {
    var target = document.querySelector(window.location.hash);
    if (target && target.tagName === 'DETAILS' && !target.open) {
      target.open = true;
    }
  }

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
