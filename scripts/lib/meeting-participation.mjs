/**
 * Extract verified meeting participation logistics (session start times,
 * physical/Zoom access, dynamic public-comment section numbers, English/Spanish
 * speaker sign-up forms, top substantive agenda items, and concise language-specific
 * WhatsApp share notices) from official board memos and parsed meeting records.
 *
 * Design invariants (see decision-litigation-log.md D-001, D-002):
 * 1. Never fabricate wall-clock arrival times for individual agenda items.
 *    Only official session start times (Closed Session / Open Session) and
 *    official section duration allocations are surfaced.
 * 2. Never hardcode "Item 8" for Public Comment. Always extract the actual
 *    section label (e.g. Section 5 on 2026-10-28, Section 9 on 2026-06-24)
 *    and modality (Zoom + in-person vs. in-person only) from that meeting's memo.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { rankItems } from './agenda-weight.mjs';

const PROCEDURAL_TITLE_RE =
  /^(call to order|roll call|welcome|notification of meeting recording|pledge of allegiance|changes to the agenda|approval of (the )?agenda|adjournment|reconvene to open session|announcement of closed session|report out on closed session)/i;

const CLOSED_SESSION_TITLE_RE =
  /(\bgovernment code\s*§?\s*5495|\bclosed session\b|\bpublic employee (?:performance evaluation|discipline|dismissal|release|appointment|employment)\b|\bconference with (?:legal counsel|labor negotiator|real property negotiator))/i;

export function isClosedSessionAgendaItem(item) {
  if (!item) return false;
  const title = String(item.title || '').trim();
  return CLOSED_SESSION_TITLE_RE.test(title);
}

export function isProceduralAgendaItem(item) {
  if (!item) return true;
  if (item.actionType === 'Procedural') return true;
  const title = String(item.title || '').trim();
  if (PROCEDURAL_TITLE_RE.test(title)) return true;
  if (/^(public comment|oral communication|labor association comments|correspondence|other business|board of trustees meeting (reflection|calendar)|board and superintendent reports)/i.test(title)) {
    return true;
  }
  return false;
}

const MONTH_MAP = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

/**
 * Normalize a 12-hour time string like "7:00 PM", "6:20 p.m.", "5:50 PM"
 * into { displayEn: "7:00 PM", displayEs: "7:00 p. m.", time24: "19:00" }.
 */
export function parseTimeToken(raw) {
  if (!raw) return null;
  const m = String(raw)
    .trim()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)$/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  const isPm = m[3].toLowerCase().startsWith('p');
  const hour24 = isPm ? (hour === 12 ? 12 : hour + 12) : (hour === 12 ? 0 : hour);
  const minStr = String(minute).padStart(2, '0');
  const hr24Str = String(hour24).padStart(2, '0');
  return {
    displayEn: `${hour}:${minStr} ${isPm ? 'PM' : 'AM'}`,
    displayEs: `${hour}:${minStr} ${isPm ? 'p. m.' : 'a. m.'}`,
    time24: `${hr24Str}:${minStr}`,
  };
}

/**
 * The start-time token in an agenda title. A range is read first, so
 * "Closed Session - 5:30 - 6:00 PM" starts at 5:30 PM (the start borrows the end's
 * AM/PM when it has none), and "8 AM - 5 PM" at 8 AM. Otherwise the first single
 * time, hour-only allowed ("6:40 PM", "8 AM"). Durations like "15 min" never match.
 */
export function sessionStartToken(title) {
  const MER = '(a\\.?m\\.?|p\\.?m\\.?)';
  const range = String(title).match(
    new RegExp(`(\\d{1,2}(?::\\d{2})?)\\s*${MER}?\\s*[-–—]\\s*\\d{1,2}(?::\\d{2})?\\s*${MER}`, 'i'),
  );
  if (range) return `${range[1]} ${range[2] || range[3]}`;
  const single = String(title).match(new RegExp(`(\\d{1,2}(?::\\d{2})?\\s*${MER})`, 'i'));
  return single ? single[1] : null;
}

/**
 * Scan "Board of Trustees Meeting Calendar" items across all board memos to build
 * a lookup of official announced start times by YYYY-MM-DD date.
 *
 * Example memo text:
 *   "Upcoming Board Meetings: Date/ Time Meeting Type Wednesday, November 4, 2026 | 7:00 PM Regular"
 *   "Monday, August 10, 2026 | 6:20 PM Closed Session Monday, August 10, 2026 | 7:00 PM Regular"
 */
export function buildAnnouncedScheduleIndex(memosByDate) {
  const byDate = {};
  const sortedDates = Object.keys(memosByDate || {}).sort();

  const rowRe =
    /(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,\s*(\d{4}))?\s*[|/]\s*(\d{1,2}:\d{2}\s*(?:AM|PM|a\.m\.|p\.m\.))\s*(Closed(?:\s+Session)?|Regular(?:\s+Meeting)?|Special(?:\s+Meeting)?(?:\s*\([^)]+\))?|Study\s+Session|Workshop|Board\s+Retreat)/gi;

  for (const memoDate of sortedDates) {
    const memo = memosByDate[memoDate];
    if (!memo || !Array.isArray(memo.items)) continue;
    const defaultYear = memoDate.slice(0, 4);

    for (const item of memo.items) {
      if (!/meeting calendar|meetings calendar/i.test(item.title || '')) continue;
      const summary = item.memo?.['Quick Summary / Abstract'] || '';
      if (!summary) continue;

      let match;
      rowRe.lastIndex = 0;
      while ((match = rowRe.exec(summary)) !== null) {
        const monthNum = MONTH_MAP[match[1].toLowerCase()];
        const dayNum = String(parseInt(match[2], 10)).padStart(2, '0');
        let yearStr = match[3];
        if (!yearStr) {
          // If month is earlier than memoDate's month by >6 months, it's next calendar year
          const memoMonth = parseInt(memoDate.slice(5, 7), 10);
          const targetMonth = parseInt(monthNum, 10);
          yearStr = targetMonth < memoMonth - 3
            ? String(parseInt(defaultYear, 10) + 1)
            : defaultYear;
        }
        const isoDate = `${yearStr}-${monthNum}-${dayNum}`;
        const parsedTime = parseTimeToken(match[4]);
        if (!parsedTime) continue;
        const kindRaw = match[5].toLowerCase();

        if (!byDate[isoDate]) {
          byDate[isoDate] = { closed: null, open: null, sourceMemoDate: memoDate };
        }
        if (kindRaw.includes('closed')) {
          byDate[isoDate].closed = parsedTime;
          byDate[isoDate].sourceMemoDate = memoDate;
        } else {
          byDate[isoDate].open = parsedTime;
          byDate[isoDate].sourceMemoDate = memoDate;
        }
      }
    }
  }

  return byDate;
}

/**
 * Extract verified session times for a single meeting from its own agenda items
 * first, then from the announced Board Meeting Calendar index, and finally fall
 * back to standard meeting-type conventions (explicitly marked as inferred).
 */
export function extractMeetingTimes(meeting, memo, announcedIndex = {}) {
  let closedSession = null;
  let openSession = null;
  let timeSource = null;
  let sourceDetail = null;

  // 1. Check the meeting's own agenda items (highest authority)
  const items = memo?.items || meeting?.items || [];
  for (const it of items) {
    const title = String(it.title || '');
    if (/closed session/i.test(title) && !/public comment|announcement|report out/i.test(title)) {
      const token = sessionStartToken(title);
      if (token) {
        const parsed = parseTimeToken(token);
        if (parsed) {
          closedSession = parsed;
          timeSource = 'agenda-item';
          sourceDetail = title;
        }
      }
    }
    if (/reconvene to open session/i.test(title)) {
      const m = title.match(/(\d{1,2}:\d{2}\s*(?:AM|PM|a\.m\.|p\.m\.))/i);
      if (m) {
        const parsed = parseTimeToken(m[1]);
        if (parsed) {
          openSession = parsed;
          timeSource = 'agenda-item';
          sourceDetail = title;
        }
      }
    }
  }

  // 2. Check the Board of Trustees Meeting Calendar announcements across memos
  const announced = announcedIndex[meeting?.date];
  if (announced) {
    if (!closedSession && announced.closed) {
      closedSession = announced.closed;
      if (!timeSource) {
        timeSource = 'board-calendar-memo';
        sourceDetail = `Board Calendar (${announced.sourceMemoDate} agenda)`;
      }
    }
    if (!openSession && announced.open) {
      openSession = announced.open;
      if (!timeSource) {
        timeSource = 'board-calendar-memo';
        sourceDetail = `Board Calendar (${announced.sourceMemoDate} agenda)`;
      }
    }
  }

  // 3. Fallback to standard RCSD Bylaw schedule if not explicitly stated
  if (!openSession && !closedSession) {
    const typeLower = String(meeting?.type || 'Regular').toLowerCase();
    const isStudyOrWorkshop = typeLower.includes('study') || typeLower.includes('workshop') || typeLower.includes('special');
    openSession = parseTimeToken(isStudyOrWorkshop ? '6:00 PM' : '7:00 PM');
    timeSource = 'inferred-type';
    sourceDetail = 'Standard Board schedule';
  } else if (!openSession && closedSession) {
    // Closed-session-only special meeting or regular meeting with only closed time stated
    const typeLower = String(meeting?.type || '').toLowerCase();
    if (!typeLower.includes('closed')) {
      openSession = parseTimeToken('7:00 PM');
    }
  }

  const primaryStart = openSession || closedSession || parseTimeToken('7:00 PM');
  const earliestStart = closedSession || openSession || primaryStart;

  return {
    closedSession,
    openSession,
    primaryStart,
    earliestStart,
    timeSource,
    sourceDetail,
  };
}

/**
 * Extract Public Comment sections, rules, and English/Spanish speaker sign-up forms
 * from the meeting's memo.
 */
export function extractPublicCommentInfo(meeting, memo) {
  const rawItems = memo?.items || [];
  const parsedItems = meeting?.items || [];

  let generalComment = null;
  let closedSessionComment = null;

  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i];
    const parsed = parsedItems[i];
    const title = String(raw.title || '');
    if (!/public comment|oral communication/i.test(title)) continue;

    // Extract section/item number as printed on the agenda
    const prefixMatch = title.match(/^(\d+)\.\s*(.+)$/);
    const sectionLabel = parsed?.itemLabel || (prefixMatch ? prefixMatch[1] : String(raw.order || i + 1));
    const cleanTitle = (parsed?.title || (prefixMatch ? prefixMatch[2] : title))
      .replace(/\s*-\s*\d+\s*(?:min|hr|hour)s?\s*$/i, '')
      .trim();

    const abstract = String(raw.memo?.['Quick Summary / Abstract'] || '').trim();
    const rationale = String(raw.memo?.Rationale || '').trim();
    const combinedText = `${abstract} ${rationale}`;

    // Parse English and Spanish Google Forms from Rationale or memoLinks
    let formUrlEn = null;
    let formUrlEs = null;

    // Zero-width characters (U+200B-U+200D, U+FEFF) end a URL: memos sometimes carry one
    // right after the link, and String.trim() does not remove it.
    const enMatch = rationale.match(/Comment in English:\s*(https?:\/\/[^\s<"\u200B-\u200D\uFEFF]+)/i);
    const esMatch = rationale.match(/Comentario en Espa(?:ñ|&ntilde;)ol:\s*(https?:\/\/[^\s<"\u200B-\u200D\uFEFF]+)/i);
    if (enMatch) formUrlEn = enMatch[1].trim();
    if (esMatch) formUrlEs = esMatch[1].trim();

    const formLinks = (raw.memoLinks || []).filter(
      (l) => l.kind === 'form' || /forms\.gle|docs\.google\.com\/forms/i.test(l.url || '')
    );
    if (!formUrlEn && formLinks[0]) formUrlEn = formLinks[0].url;
    if (!formUrlEs && formLinks[1]) formUrlEs = formLinks[1].url;

    const isInPersonOnly = /in[- ]person only|only be accepted in person/i.test(combinedText);
    const isAgendaOnly = /limit comments to items on the agenda|directly related to items on the .* agenda|closed session items/i.test(combinedText);
    const timeLimitMatch = combinedText.match(/(\d+)\s*minutes?\s+per\s+(?:speaker|person)/i);
    const minutesPerSpeaker = timeLimitMatch ? parseInt(timeLimitMatch[1], 10) : 3;

    const entry = {
      sectionLabel,
      title: cleanTitle,
      abstract,
      rationale,
      formUrlEn,
      formUrlEs,
      modality: isInPersonOnly ? 'in-person-only' : (formUrlEn || formUrlEs || meeting?.zoom || memo?.zoom ? 'hybrid' : 'in-person-only'),
      scope: /closed session/i.test(title)
        ? 'closed-session-only'
        : isAgendaOnly
          ? 'agenda-only'
          : 'agenda-and-non-agenda',
      minutesPerSpeaker,
    };

    if (/closed session/i.test(title)) {
      closedSessionComment = entry;
    } else if (!generalComment) {
      generalComment = entry;
    }
  }

  return {
    generalComment,
    closedSessionComment,
    hasOnlineForms: Boolean(generalComment?.formUrlEn || generalComment?.formUrlEs),
  };
}

/**
 * Strip leading item number prefix ("1. ") and trailing duration (" - 35 min")
 * from a memo item title.
 */
function cleanItemTitle(rawTitle) {
  return String(rawTitle || '')
    .replace(/^\d+\.\s*/, '')
    .replace(/\s*-\s*\d+\s*(?:min|hr|hour)s?\s*$/i, '')
    .trim();
}

/**
 * Extract the top N substantive agenda items ranked by official time allocation,
 * paired with Spanish titles when available.
 */
export function extractTopHeadlines(meeting, memoEs = null, agendaTitlesEs = {}, maxItems = 3) {
  const items = meeting?.items || [];
  if (!items.length) return { headlines: [], consentCount: 0, totalSubstantiveCount: 0 };

  const { ranked, unranked, consent } = rankItems(items, isProceduralAgendaItem);
  const allCandidates = [...ranked, ...unranked];

  // Prefer Open Session substantive items over Closed Session items (e.g. Gov Code 54957),
  // falling back to Closed Session items only when the entire meeting is a Closed Session.
  const openSessionCandidates = allCandidates.filter((entry) => !isClosedSessionAgendaItem(entry.item));
  const candidates = openSessionCandidates.length > 0 ? openSessionCandidates : allCandidates;

  // Build positional Spanish title map if memoEs has same item count
  const esItems = Array.isArray(memoEs?.items) && memoEs.items.length === items.length
    ? memoEs.items
    : null;
  const itemIndexMap = new Map();
  items.forEach((it, idx) => itemIndexMap.set(it, idx));

  const headlines = [];
  for (const entry of candidates) {
    if (headlines.length >= maxItems) break;
    const it = entry.item;
    if (!it || !it.title) continue;
    const idx = itemIndexMap.get(it);
    const titleEn = it.title;
    let titleEs = agendaTitlesEs[titleEn] || null;
    if (!titleEs && esItems && idx != null && esItems[idx]?.title) {
      const candidateEs = cleanItemTitle(esItems[idx].title);
      // Only use if it was actually translated
      if (candidateEs && candidateEs !== titleEn) titleEs = candidateEs;
    }

    headlines.push({
      itemLabel: it.itemLabel || null,
      titleEn,
      titleEs: titleEs || titleEn,
      titleEsTranslated: Boolean(titleEs && titleEs !== titleEn),
      allocatedMinutes: entry.minutes != null ? Math.round(entry.minutes) : (it.plannedMinutes || null),
      actionType: it.actionType || null,
    });
  }

  return {
    headlines,
    consentCount: consent.length,
    totalSubstantiveCount: candidates.length,
  };
}

/**
 * Build a concise, single-language WhatsApp share message and wa.me URL.
 * Designed for 1-tap forwarding into school parent WhatsApp groups.
 */
export function buildWhatsAppNotice({
  meeting,
  dateFormattedEn,
  dateFormattedEs,
  localTypeEn,
  localTypeEs,
  canonicalUrlEn,
  canonicalUrlEs,
  times,
  publicComment,
  topHeadlines,
  lang = 'en',
}) {
  const isEs = lang === 'es';
  const lines = [];

  const dateStr = isEs ? dateFormattedEs : dateFormattedEn;
  const typeStr = isEs ? localTypeEs : localTypeEn;
  const url = isEs ? canonicalUrlEs : canonicalUrlEn;

  lines.push(
    isEs
      ? `*Reunión de la Junta Escolar de RCSD (${typeStr})*`
      : `*RCSD School Board Meeting (${typeStr})*`
  );

  // Date & verified start time
  const openTime = isEs ? times.primaryStart?.displayEs : times.primaryStart?.displayEn;
  const closedTime = isEs ? times.closedSession?.displayEs : times.closedSession?.displayEn;
  if (closedTime && times.openSession) {
    lines.push(
      isEs
        ? `📅 ${dateStr} · Sesión pública: ${openTime} (Sesión cerrada: ${closedTime})`
        : `📅 ${dateStr} · Open Session: ${openTime} (Closed Session: ${closedTime})`
    );
  } else {
    lines.push(`📅 ${dateStr}${openTime ? ` · ${openTime}` : ''}`);
  }

  // Location & Zoom
  lines.push(
    isEs
      ? `📍 En persona: 750 Bradford St, Redwood City`
      : `📍 In person: 750 Bradford St, Redwood City`
  );
  if (meeting.zoom) {
    lines.push(isEs ? `💻 Zoom: ${meeting.zoom}` : `💻 Zoom: ${meeting.zoom}`);
  }

  // Public comment instructions
  const pc = publicComment?.generalComment || publicComment?.closedSessionComment;
  if (pc) {
    const secNum = pc.sectionLabel;
    const formUrl = isEs ? (pc.formUrlEs || pc.formUrlEn) : (pc.formUrlEn || pc.formUrlEs);
    if (formUrl) {
      lines.push(
        isEs
          ? `🗣️ Comentario público (Punto ${secNum}): regístrese antes o al inicio de la reunión: ${formUrl}`
          : `🗣️ Public comment (Item ${secNum}): sign up before or at the start of the meeting: ${formUrl}`
      );
    } else if (pc.modality === 'in-person-only') {
      lines.push(
        isEs
          ? `🗣️ Comentario público (Punto ${secNum}): tarjetas de orador en persona en la entrada antes de iniciar.`
          : `🗣️ Public comment (Item ${secNum}): in-person speaker cards available at the entrance before the meeting.`
      );
    }
  }

  // Top 2-3 substantive items
  const items = (topHeadlines?.headlines || []).slice(0, 3);
  if (items.length > 0) {
    lines.push('');
    lines.push(isEs ? `*Temas principales en la agenda:*` : `*Key agenda topics:*`);
    for (const h of items) {
      const labelPrefix = h.itemLabel ? `${h.itemLabel}: ` : '';
      const title = isEs ? h.titleEs : h.titleEn;
      lines.push(`• ${labelPrefix}${title}`);
    }
  }

  lines.push('');
  lines.push(
    isEs
      ? `Agenda completa y actualizaciones oficiales: ${url}`
      : `Full agenda & latest official updates: ${url}`
  );

  const text = lines.join('\n');
  return {
    text,
    whatsappUrl: `https://wa.me/?text=${encodeURIComponent(text)}`,
  };
}

/**
 * Load all board memos (EN and ES) and build a complete participation lookup
 * for all meetings.
 */
export function loadParticipationContext(rootDir) {
  const memoDir = resolve(rootDir, 'data/board-memos');
  const memoDirEs = resolve(rootDir, 'data/board-memos-es');
  const memosByDate = {};
  const memosEsByDate = {};

  if (existsSync(memoDir)) {
    for (const f of readdirSync(memoDir).filter((file) => file.endsWith('.json'))) {
      try {
        const m = JSON.parse(readFileSync(resolve(memoDir, f), 'utf-8'));
        if (m.date) memosByDate[m.date] = m;
      } catch {}
    }
  }

  if (existsSync(memoDirEs)) {
    for (const f of readdirSync(memoDirEs).filter((file) => file.endsWith('.json'))) {
      try {
        const m = JSON.parse(readFileSync(resolve(memoDirEs, f), 'utf-8'));
        if (m.date) memosEsByDate[m.date] = m;
      } catch {}
    }
  }

  let agendaTitlesEs = {};
  const titlesEsPath = resolve(rootDir, 'data/agenda-titles-es.json');
  if (existsSync(titlesEsPath)) {
    try {
      agendaTitlesEs = { ...JSON.parse(readFileSync(titlesEsPath, 'utf-8')) };
    } catch {}
  }

  // Merge verified Spanish item titles from data/docket-briefs/*.json and data/deliberation-recaps/*.json
  // so upcoming meetings have Spanish WhatsApp share headlines even before full memo translation runs.
  const briefDir = resolve(rootDir, 'data/docket-briefs');
  if (existsSync(briefDir)) {
    for (const f of readdirSync(briefDir).filter((file) => file.endsWith('.json') && file !== 'index.json')) {
      try {
        const b = JSON.parse(readFileSync(resolve(briefDir, f), 'utf-8'));
        for (const it of b.topItems || []) {
          if (it.titleEn && it.titleEs) agendaTitlesEs[it.titleEn] = it.titleEs;
        }
        for (const sp of b.consentScreening?.spotlightItems || []) {
          if (sp.titleEn && sp.titleEs) agendaTitlesEs[sp.titleEn] = sp.titleEs;
        }
      } catch {}
    }
  }
  const recapDir = resolve(rootDir, 'data/deliberation-recaps');
  if (existsSync(recapDir)) {
    for (const f of readdirSync(recapDir).filter((file) => file.endsWith('.json') && file !== 'index.json')) {
      try {
        const r = JSON.parse(readFileSync(resolve(recapDir, f), 'utf-8'));
        for (const it of r.items || []) {
          if (it.titleEn && it.titleEs) agendaTitlesEs[it.titleEn] = it.titleEs;
        }
      } catch {}
    }
  }

  const announcedIndex = buildAnnouncedScheduleIndex(memosByDate);

  return {
    memosByDate,
    memosEsByDate,
    agendaTitlesEs,
    announcedIndex,
  };
}
