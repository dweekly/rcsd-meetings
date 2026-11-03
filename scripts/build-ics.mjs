#!/usr/bin/env node
/**
 * Modular iCalendar (.ics) feed generator.
 *
 * Automatically compiles and generates subscription calendars for:
 *   1. Board Meetings (English + Spanish)
 *   2. School Calendars / Holidays (English + Spanish)
 *   3. School Site Councils (SSC) dynamically discovered per school (English + Spanish)
 *
 * Extensible design: to add another calendar feed, simply add a configuration
 * object to the CALENDARS registry in this script.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  loadParticipationContext,
  extractMeetingTimes,
  extractPublicCommentInfo,
} from './lib/meeting-participation.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---- Helper Functions ----

function toCalDate(dateStr) {
  return dateStr.replace(/-/g, '');
}

function getNextDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0].replace(/-/g, '');
}

function formatTime(dateStr, timeStr) {
  const cleanDate = dateStr.replace(/-/g, '');
  const cleanTime = timeStr.replace(/:/g, '').padEnd(6, '0');
  return `${cleanDate}T${cleanTime}`;
}

function cleanDescription(text) {
  if (!text) return '';
  // Strip HTML to a fixpoint: one pass leaves reassembled tags (<scr<b>ipt>).
  let stripped = text;
  for (let prev = ''; prev !== stripped; ) {
    prev = stripped;
    stripped = stripped.replace(/<[^>]*>/g, '');
  }
  return stripped
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, '\\n')
    .trim();
}

function foldLine(line) {
  const bytes = Buffer.from(line, 'utf-8');
  if (bytes.length <= 75) {
    return line;
  }

  const chunks = [];
  let currentChunk = '';
  let currentByteLength = 0;

  for (const char of line) {
    const charBytes = Buffer.from(char, 'utf-8').length;
    const limit = chunks.length === 0 ? 75 : 74;

    if (currentByteLength + charBytes > limit) {
      chunks.push(currentChunk);
      currentChunk = char;
      currentByteLength = charBytes;
    } else {
      currentChunk += char;
      currentByteLength += charBytes;
    }
  }
  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks.join('\r\n ');
}

/**
 * Compiles events list into RFC 5545 iCalendar format.
 */
function buildCalendar(name, timezone, events) {
  let ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//rcsd.info//RCSD Calendar//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${name}`,
    `X-WR-TIMEZONE:${timezone}`,
  ];

  for (const ev of events) {
    ics.push('BEGIN:VEVENT');
    ics.push(`UID:${ev.uid}`);
    ics.push(`DTSTAMP:${ev.dtstamp || '20260522T200000Z'}`);
    
    if (ev.isAllDay) {
      ics.push(`DTSTART;VALUE=DATE:${ev.dtstart}`);
      ics.push(`DTEND;VALUE=DATE:${ev.dtend}`);
    } else {
      ics.push(`DTSTART;TZID=${timezone}:${ev.dtstart}`);
      ics.push(`DTEND;TZID=${timezone}:${ev.dtend}`);
    }
    
    ics.push(`SUMMARY:${ev.summary}`);
    if (ev.description) ics.push(`DESCRIPTION:${cleanDescription(ev.description)}`);
    if (ev.url) ics.push(`URL:${ev.url}`);
    if (ev.location) ics.push(`LOCATION:${ev.location}`);
    ics.push('END:VEVENT');
  }

  ics.push('END:VCALENDAR');
  const foldedIcs = ics.map(line => foldLine(line));
  return foldedIcs.join('\r\n') + '\r\n';
}

// ---- Calendar Generators ----

function addHoursToTime24(time24, hoursToAdd = 3) {
  const [hStr, mStr] = String(time24 || '19:00').split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr || '0', 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return '22:00';
  const endH = Math.min(23, h + hoursToAdd);
  const endM = h + hoursToAdd > 23 ? 59 : m;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

/**
 * Generates events for Board Meetings (past + upcoming).
 */
function generateBoardMeetings(lang, context) {
  const {
    data,
    districtCalendars,
    provisionalTopics,
    summariesEn,
    summariesEs,
    participationCtx,
  } = context;
  const events = [];
  const processedMeetings = new Set();
  const seenPrimaryDateUid = new Set();

  // A. Published Meetings (with agendas/summaries)
  for (const m of data.meetings) {
    processedMeetings.add(m.date);
    const isPrimaryForDate = !seenPrimaryDateUid.has(m.date);
    seenPrimaryDateUid.add(m.date);

    const summaryEn = summariesEn[m.date] || summariesEn[m.slug] || '';
    const summaryEs = summariesEs[m.date] || summariesEs[m.slug] || '';

    const memo = participationCtx?.memosByDate?.[m.date] || null;
    const times = extractMeetingTimes(m, memo, participationCtx?.announcedIndex || {});
    const publicComment = extractPublicCommentInfo(m, memo);

    const startHour = times.primaryStart?.time24 || '19:00';
    const endHour = addHoursToTime24(startHour, 3);

    // Unify primary meeting UID with provisional date UID so calendar clients
    // update the existing event in place when an agenda is published.
    const uid = isPrimaryForDate
      ? `board-meeting-${m.date}@rcsd.info`
      : `board-meeting-${m.slug}@rcsd.info`;
    const dtstamp = m.scrapedAt ? toCalDate(m.scrapedAt.slice(0, 10)) + 'T200000Z' : '20260522T200000Z';

    const descLines = [];
    const baseSummary = lang === 'en' ? summaryEn : summaryEs;
    if (baseSummary) descLines.push(baseSummary);

    if (times.closedSession && times.openSession) {
      descLines.push(
        lang === 'en'
          ? `Schedule: Closed Session at ${times.closedSession.displayEn}; Open Session at ${times.openSession.displayEn}.`
          : `Horario: Sesión cerrada a las ${times.closedSession.displayEs}; Sesión pública a las ${times.openSession.displayEs}.`
      );
    } else if (times.primaryStart) {
      descLines.push(
        lang === 'en'
          ? `Start time: ${times.primaryStart.displayEn}.`
          : `Hora de inicio: ${times.primaryStart.displayEs}.`
      );
    }

    if (m.zoom) {
      descLines.push(`Zoom: ${m.zoom}`);
    }

    const pc = publicComment?.generalComment || publicComment?.closedSessionComment;
    if (pc) {
      const formUrl = lang === 'en' ? (pc.formUrlEn || pc.formUrlEs) : (pc.formUrlEs || pc.formUrlEn);
      if (formUrl) {
        descLines.push(
          lang === 'en'
            ? `Public Comment (Item ${pc.sectionLabel}) sign-up form: ${formUrl}`
            : `Formulario de Comentario Público (Punto ${pc.sectionLabel}): ${formUrl}`
        );
      }
    }

    descLines.push(
      lang === 'en'
        ? `Full agenda and recordings: https://rcsd.info/meetings/${m.date}/`
        : `Agenda completa y grabaciones: https://rcsd.info/reuniones/${m.date}/`
    );

    events.push({
      uid,
      dtstamp,
      isAllDay: false,
      dtstart: formatTime(m.date, startHour),
      dtend: formatTime(m.date, endHour),
      summary: lang === 'en' ? `RCSD Board Meeting (${m.type})` : `Reunión de la Junta de RCSD (${m.type === 'Regular' ? 'Regular' : m.type === 'Special' ? 'Especial' : 'Estudio'})`,
      description: descLines.join('\n\n'),
      url: lang === 'en' ? `https://rcsd.info/meetings/${m.date}/` : `https://rcsd.info/reuniones/${m.date}/`,
      location: lang === 'en' ? 'District Office, 750 Bradford St, Redwood City, CA 94063' : 'Oficina del Distrito, 750 Bradford St, Redwood City, CA 94063',
    });
  }

  // B. Upcoming Meetings (provisional / scheduled)
  const allProvisionalDates = new Set();
  for (const cal of districtCalendars) {
    for (const evt of cal.events) {
      if (evt.type === 'board-meeting') {
        allProvisionalDates.add(evt.date);
      }
    }
  }

  for (const dateStr of allProvisionalDates) {
    if (processedMeetings.has(dateStr)) continue;

    const topicEntry = provisionalTopics[dateStr];
    const topicEn = topicEntry ? topicEntry.en : 'Scheduled Board Meeting';
    const topicEs = topicEntry ? topicEntry.es : 'Reunión de la Junta Programada';

    const times = extractMeetingTimes(
      { date: dateStr, type: 'Regular' },
      null,
      participationCtx?.announcedIndex || {}
    );
    const startHour = times.primaryStart?.time24 || '19:00';
    const endHour = addHoursToTime24(startHour, 3);

    // Unified UID matches the primary published meeting UID for this date
    const uid = `board-meeting-${dateStr}@rcsd.info`;

    events.push({
      uid,
      isAllDay: false,
      dtstart: formatTime(dateStr, startHour),
      dtend: formatTime(dateStr, endHour),
      summary: lang === 'en' ? 'RCSD Board Meeting' : 'Reunión de la Junta de RCSD',
      description: lang === 'en'
        ? `Planned topics:\n${topicEn}\n\nAgendas are posted 72 hours before meetings at https://rcsd.info/meetings/`
        : `Temas planificados:\n${topicEs}\n\nLas agendas se publican 72 horas antes de las reuniones en https://rcsd.info/reuniones/`,
      url: lang === 'en' ? 'https://rcsd.info/meetings/' : 'https://rcsd.info/reuniones/',
      location: lang === 'en' ? 'District Office, 750 Bradford St, Redwood City, CA 94063' : 'Oficina del Distrito, 750 Bradford St, Redwood City, CA 94063',
    });
  }

  events.sort((a, b) => a.dtstart.localeCompare(b.dtstart));
  return events;
}

/**
 * Generates events for School Milestones and Holidays (excluding board meetings).
 */
function generateSchoolDates(lang, context) {
  const { districtCalendars } = context;
  const events = [];

  for (const cal of districtCalendars) {
    for (const evt of cal.events) {
      if (evt.type === 'board-meeting') continue; // Managed in Board Meetings feed

      const uid = `school-event-${evt.date}-${evt.en.replace(/[^a-zA-Z0-9]/g, '-')}-${cal.schoolYear}@rcsd.info`;
      const isMultiDay = !!evt.dateEnd;
      const dtstart = toCalDate(evt.date);
      const dtend = isMultiDay ? getNextDay(evt.dateEnd) : getNextDay(evt.date);

      events.push({
        uid,
        isAllDay: true,
        dtstart,
        dtend,
        summary: lang === 'en' ? `RCSD: ${evt.en}` : `RCSD: ${evt.es}`,
        description: lang === 'en'
          ? `School Calendar Event for ${cal.schoolYear}\nType: ${evt.type === 'no-school' ? 'Holiday / No School' : evt.type === 'early-release' ? 'Early Release' : 'Milestone'}`
          : `Evento del Calendario Escolar para ${cal.schoolYear}\nTipo: ${evt.type === 'no-school' ? 'Feriado / No Hay Clases' : evt.type === 'early-release' ? 'Salida Temprana' : 'Hito'}`,
        url: cal.calendarUrl || (lang === 'en' ? 'https://rcsd.info/district/' : 'https://rcsd.info/distrito/'),
      });
    }
  }

  events.sort((a, b) => a.dtstart.localeCompare(b.dtstart));
  return events;
}

/**
 * Generates events for a specific school's School Site Council (SSC).
 */
function generateSscCalendar(schoolSlug, schoolName, lang, context) {
  const { sscData } = context;
  const schoolMeetings = sscData[schoolSlug] || {};
  const events = [];

  for (const [year, meetings] of Object.entries(schoolMeetings)) {
    for (const m of meetings) {
      if (!m.date) continue;
      const uid = `ssc-${schoolSlug}-${m.date}-${year}@rcsd.info`;
      const startHour = '15:30'; // standard SSC meeting time e.g., 3:30 PM
      const endHour = '17:00';

      const agendaUrl = m.agendaPdf ? `https://data.rcsd.info/${m.agendaPdf}` : '';
      const minutesUrl = m.minutesPdf ? `https://data.rcsd.info/${m.minutesPdf}` : '';

      const summary = lang === 'en' 
        ? `${schoolName} School Site Council (SSC) Meeting` 
        : `Reunión del Consejo del Sitio Escolar (SSC) de ${schoolName}`;

      let description = lang === 'en'
        ? `School Site Council meeting for ${schoolName} (${year} school year).`
        : `Reunión del Consejo del Sitio Escolar para ${schoolName} (año escolar ${year}).`;

      if (agendaUrl) description += `\nAgenda: ${agendaUrl}`;
      if (minutesUrl) description += `\nMinutes/Actas: ${minutesUrl}`;

      events.push({
        uid,
        isAllDay: false,
        dtstart: formatTime(m.date, startHour),
        dtend: formatTime(m.date, endHour),
        summary,
        description,
        url: agendaUrl || minutesUrl || (lang === 'en' ? `https://rcsd.info/schools/${schoolSlug}/` : `https://rcsd.info/escuelas/${schoolSlug}/`),
        location: `${schoolName} School`,
      });
    }
  }

  events.sort((a, b) => a.dtstart.localeCompare(b.dtstart));
  return events;
}

/**
 * Generates events for a specific district committee (e.g. DELAC, CBOC).
 */
function generateCommitteeCalendar(committee, lang, context) {
  const events = [];
  const committeeId = committee.id;
  const homeUrl = lang === 'en'
    ? `https://rcsd.info/committees/${committeeId}/`
    : `https://rcsd.info/comites/${committeeId}/`;

  for (const m of committee.meetings || []) {
    if (!m.date) continue;
    const uid = `committee-${committeeId}-${m.date}@rcsd.info`;
    const startHour = m.time || '18:00'; // Default to 6:00 PM if unspecified

    // Calculate end time (default to 1.5 hours later)
    let endHour = '19:30';
    const [h, min] = startHour.split(':').map(Number);
    if (!isNaN(h) && !isNaN(min)) {
      const endD = new Date();
      endD.setHours(h);
      endD.setMinutes(min + 90);
      endHour = `${String(endD.getHours()).padStart(2, '0')}:${String(endD.getMinutes()).padStart(2, '0')}`;
    }

    const agendaUrl = m.agendaUrl || (m.agendaPdf ? `https://data.rcsd.info/${m.agendaPdf}` : '');
    const minutesUrl = m.minutesUrl || (m.minutesPdf ? `https://data.rcsd.info/${m.minutesPdf}` : '');
    // Link recorded meetings to their detail page; otherwise to the committee home.
    const detailUrl = m.youtube
      ? `${homeUrl}${m.date}/`
      : (agendaUrl || minutesUrl || homeUrl);
    const location = m.location || (lang === 'en' ? 'District Office' : 'Oficina del Distrito');

    const summary = lang === 'en'
      ? `${committee.nameEn} Meeting`
      : `Reunión de ${committee.nameEs}`;

    let description = lang === 'en'
      ? `Meeting of the ${committee.nameEn}.`
      : `Reunión de ${committee.nameEs}.`;

    if (m.descriptionEn && lang === 'en') description = `${m.descriptionEn}\n\n${description}`;
    if (m.descriptionEs && lang === 'es') description = `${m.descriptionEs}\n\n${description}`;

    if (m.youtube) description += `\nVideo: https://www.youtube.com/watch?v=${m.youtube}`;
    if (agendaUrl) description += `\nAgenda: ${agendaUrl}`;
    if (minutesUrl) description += `\nMinutes/Actas: ${minutesUrl}`;

    events.push({
      uid,
      isAllDay: false,
      dtstart: formatTime(m.date, startHour),
      dtend: formatTime(m.date, endHour),
      summary,
      description,
      url: detailUrl,
      location,
    });
  }

  events.sort((a, b) => a.dtstart.localeCompare(b.dtstart));
  return events;
}

// ---- Main Pipeline ----

function main() {
  const dataPath = resolve(ROOT, 'data/meetings-data.json');
  if (!existsSync(dataPath)) {
    console.error('Error: meetings-data.json not found. Build meetings database first.');
    process.exit(1);
  }

  // Load all databases for context
  const context = {
    data: JSON.parse(readFileSync(dataPath, 'utf-8')),
    districtCalendars: [],
    provisionalTopics: {},
    summariesEn: {},
    summariesEs: {},
    sscData: {},
    schools: {},
    participationCtx: loadParticipationContext(ROOT),
  };

  // Load calendars
  for (const suffix of ['2025-26', '2026-27']) {
    const p = resolve(ROOT, `data/district-calendar-${suffix}.json`);
    if (existsSync(p)) context.districtCalendars.push(JSON.parse(readFileSync(p, 'utf-8')));
  }

  // Load provisional topics
  const govCalPath = resolve(ROOT, 'data/governance-calendar.json');
  if (existsSync(govCalPath)) {
    context.provisionalTopics = JSON.parse(readFileSync(govCalPath, 'utf-8')).provisionalTopics || {};
  }

  // Load summaries
  if (existsSync(resolve(ROOT, 'data/meeting-summaries.json'))) {
    context.summariesEn = JSON.parse(readFileSync(resolve(ROOT, 'data/meeting-summaries.json'), 'utf-8'));
  }
  if (existsSync(resolve(ROOT, 'data/meeting-summaries-es.json'))) {
    context.summariesEs = JSON.parse(readFileSync(resolve(ROOT, 'data/meeting-summaries-es.json'), 'utf-8'));
  }

  // Load SSC data
  const sscPath = resolve(ROOT, 'data/ssc-meetings.json');
  if (existsSync(sscPath)) {
    context.sscData = JSON.parse(readFileSync(sscPath, 'utf-8'));
  }

  // Load schools metadata for proper school names
  const schoolsPath = resolve(ROOT, 'data/schools.json');
  if (existsSync(schoolsPath)) {
    context.schools = JSON.parse(readFileSync(schoolsPath, 'utf-8'));
  }

  // Load committee data: one JSON file per committee in data/committees/.
  const committeesDir = resolve(ROOT, 'data/committees');
  const committees = [];
  if (existsSync(committeesDir)) {
    for (const file of readdirSync(committeesDir).filter(f => f.endsWith('.json'))) {
      try {
        committees.push(JSON.parse(readFileSync(resolve(committeesDir, file), 'utf-8')));
      } catch (e) {
        console.warn(`Warning: Failed to parse committees/${file}:`, e);
      }
    }
  }

  // --- CALENDAR REGISTRY ---
  // Highly modular list of calendars. To publish new calendars (e.g. key committees),
  // simply add a configuration block here.
  const CALENDARS = [
    {
      id: 'board-meetings',
      nameEn: 'RCSD Board Meetings',
      nameEs: 'Reuniones de la Junta de RCSD',
      fileNameEn: 'board-meetings.ics',
      fileNameEs: 'reuniones-junta.ics',
      generator: generateBoardMeetings,
    },
    {
      id: 'school-dates',
      nameEn: 'RCSD School Calendar',
      nameEs: 'Calendario Escolar de RCSD',
      fileNameEn: 'school-dates.ics',
      fileNameEs: 'fechas-escolares.ics',
      generator: generateSchoolDates,
    },
  ];

  // Dynamic discovery: Add an SSC calendar for every school found in ssc-meetings.json
  for (const schoolSlug of Object.keys(context.sscData)) {
    if (schoolSlug === '_metadata') continue;
    const schoolMeta = context.schools.schools?.find(s => s.slug === schoolSlug) || {};
    const schoolName = schoolMeta.name || schoolSlug;
    
    CALENDARS.push({
      id: `ssc-${schoolSlug}`,
      nameEn: `${schoolName} SSC Meetings`,
      nameEs: `Reuniones del SSC de ${schoolName}`,
      fileNameEn: `ssc-${schoolSlug}.ics`,
      fileNameEs: `ssc-${schoolSlug}-es.ics`,
      generator: (lang, ctx) => generateSscCalendar(schoolSlug, schoolName, lang, ctx),
    });
  }

  // Dynamic discovery: one calendar per committee file in data/committees/ that has meetings.
  for (const committee of committees) {
    if (!committee.id || !(committee.meetings || []).length) continue;
    CALENDARS.push({
      id: `committee-${committee.id}`,
      nameEn: committee.nameEn || committee.id,
      nameEs: committee.nameEs || committee.id,
      fileNameEn: `committee-${committee.id}.ics`,
      fileNameEs: `committee-${committee.id}-es.ics`,
      generator: (lang, ctx) => generateCommitteeCalendar(committee, lang, ctx),
    });
  }

  // --- EXECUTE BUILD ---
  console.log(`Executing calendar build registry (${CALENDARS.length} calendars configured)...`);

  for (const cal of CALENDARS) {
    const eventsEn = cal.generator('en', context);
    const eventsEs = cal.generator('es', context);

    const pathEn = resolve(ROOT, 'docs', cal.fileNameEn);
    const pathEs = resolve(ROOT, 'docs', cal.fileNameEs);

    writeFileSync(pathEn, buildCalendar(cal.nameEn, 'America/Los_Angeles', eventsEn));
    writeFileSync(pathEs, buildCalendar(cal.nameEs, 'America/Los_Angeles', eventsEs));

    console.log(`  [+] ${cal.id} -> docs/${cal.fileNameEn} (${eventsEn.length} events)`);
    console.log(`  [+] ${cal.id} -> docs/${cal.fileNameEs} (${eventsEs.length} events)`);
  }

  console.log('Calendar build complete!');
}

main();
