#!/usr/bin/env node
/**
 * Generate docs/index.html (bilingual homepage), docs/404.html,
 * robots.txt, humans.txt, sitemap.xml
 * Run before build-meetings-html.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { headMeta, siteNav, siteFooter } from './html-parts.mjs';
import { policySlug } from './lib/policy-slug.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---- Load data ----
const schools = JSON.parse(readFileSync(resolve(ROOT, 'data/schools.json'), 'utf-8'));
const calendar2526 = JSON.parse(readFileSync(resolve(ROOT, 'data/district-calendar-2025-26.json'), 'utf-8'));
const calendar2627 = JSON.parse(readFileSync(resolve(ROOT, 'data/district-calendar-2026-27.json'), 'utf-8'));
const boardCalendarUrl = 'https://www.rcsdk8.net/our-district/our-board-of-trustees/calendar';

let meetingStats = { total: 0, totalAttachments: 0 };
const meetingsPath = resolve(ROOT, 'data/meetings-data.json');
if (existsSync(meetingsPath)) {
  const mdata = JSON.parse(readFileSync(meetingsPath, 'utf-8'));
  meetingStats = mdata.stats || meetingStats;
}

const totalEnrollment = schools.schools.reduce((sum, s) => sum + s.enrollment, 0);
const numSchools = schools.schools.length;

// ---- Upcoming events (merge both school years, from today forward) ----
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const allEvents = [...calendar2526.events, ...calendar2627.events]
  .sort((a, b) => a.date.localeCompare(b.date));
const upcoming = allEvents
  .filter(e => e.date >= today)
  .slice(0, 12);

// ---- School demographics (from SARC 2024-25) ----
const DEMO = {
  'adelante-selby': { el: 42.4, sed: 62.6 },
  'clifford':       { el: 23.5, sed: 44.2 },
  'garfield':       { el: 68.2, sed: 95.0 },
  'henry-ford':     { el: 36.2, sed: 63.1 },
  'hoover':         { el: 66.9, sed: 96.6 },
  'kennedy':        { el: 25.8, sed: 65.8 },
  'mckinley-mit':   { el: 45.5, sed: 92.6 },
  'north-star':     { el: 2.5,  sed: 8.9 },
  'orion':          { el: 22.8, sed: 31.8 },
  'roosevelt':      { el: 42.6, sed: 69.5 },
  'roy-cloud':      { el: 3.4,  sed: 11.4 },
  'taft':           { el: 65.7, sed: 90.0 },
};

// ---- School cards (sorted alphabetically) ----
const sortedSchools = [...schools.schools].sort((a, b) => a.name.localeCompare(b.name));

function schoolCard(s) {
  const typeBadgeEn = s.type === 'choice' ? 'Choice' : 'Neighborhood';
  const typeBadgeEs = s.type === 'choice' ? 'Elección' : 'Vecindario';
  const typeCls = s.type === 'choice' ? 'school-badge--choice' : 'school-badge--neighborhood';
  const communityBadge = s.communitySchool ? '<span class="school-badge school-badge--community" title="Community School · Escuela Comunitaria">🏫 Community</span>' : '';

  const detailUrl = `/schools/${s.slug}/`;
  const dashboardUrl = `https://www.caschooldashboard.org/reports/${s.cdsCode}/2024`;
  const spsaUrl = `https://data.rcsd.info/documents/spsa/2025-26/${s.slug}.pdf`;
  const el = Math.round(DEMO[s.slug]?.el || 0);
  const frl = Math.round(DEMO[s.slug]?.sed || 0);

  return `
    <div class="school-card">
      <div class="school-card-header">
        <a href="${detailUrl}" class="school-name-link">${s.nameShort} →</a>
        <span class="school-grades">${s.grades}</span>
      </div>
      <div class="school-badges"><span class="school-badge ${typeCls}">${typeBadgeEn} · ${typeBadgeEs}</span>${communityBadge}</div>
      ${s.program ? `<div class="school-program">${s.program}</div>` : ''}
      <div class="school-details">
        <div class="school-detail">${s.enrollment.toLocaleString()} students · ${el}% learning English · ${frl}% free or low-cost lunch</div>
        <div class="school-detail" lang="es">${s.enrollment.toLocaleString()} estudiantes · ${el}% aprendiendo inglés · ${frl}% almuerzo gratis o a bajo costo</div>
      </div>
      <div class="school-links">
        <a href="${s.website}" target="_blank" rel="noopener" title="School website · Sitio web de la escuela">🌐 Web</a>
        <a href="${s.lunchUrl}" target="_blank" rel="noopener" title="Lunch menu · Menú de almuerzo">🍽️ Lunch · Almuerzo</a>
        <a href="${dashboardUrl}" target="_blank" rel="noopener" title="CA School Dashboard · Panel Escolar de CA">📊 State data · Datos del estado</a>
        <a href="${spsaUrl}" target="_blank" rel="noopener" title="School Plan for Student Achievement (SPSA) · Plan Escolar para el Rendimiento Estudiantil (SPSA)">📋 School plan · Plan escolar</a>
        ${s.pto?.url ? `<a href="${s.pto.url}" target="_blank" rel="noopener" title="${s.pto.name || 'PTO/PTA'}">🤝 PTO</a>` : ''}
      </div>
    </div>`;
}


function dateBadge(dateStr, lang) {
  const d = new Date(dateStr + 'T12:00:00');
  const month = d.toLocaleDateString(lang, { month: 'short' }).toUpperCase();
  const dow = d.toLocaleDateString(lang, { weekday: 'short' });
  const day = d.getDate();
  return { month, dow, day };
}

// Load meeting summaries for board meeting annotations
const summariesEn = JSON.parse(readFileSync(resolve(ROOT, 'data/meeting-summaries.json'), 'utf-8'));
const summariesEs = (() => {
  try { return JSON.parse(readFileSync(resolve(ROOT, 'data/meeting-summaries-es.json'), 'utf-8')); }
  catch { return {}; }
})();

// Load governance calendar for provisional topics on future board meetings
const governanceCal = (() => {
  try { return JSON.parse(readFileSync(resolve(ROOT, 'data/governance-calendar.json'), 'utf-8')); }
  catch { return { provisionalTopics: {} }; }
})();

function eventRow(e, lang) {
  const start = dateBadge(e.date, lang);
  const isMulti = !!e.dateEnd;
  const isEn = lang === 'en';

  const typeClass = e.type === 'no-school' ? 'event--no-school'
    : e.type === 'early-release' ? 'event--early-release'
    : e.type === 'board-meeting' ? 'event--board-meeting'
    : 'event--milestone';
  const multiClass = isMulti ? ' event--multi' : '';

  // Date label: "Fri Mar 13" or "Mon–Fri Mar 16–20"
  let dateLabel;
  if (isMulti) {
    const end = dateBadge(e.dateEnd, lang);
    const sameMonth = start.month === end.month;
    dateLabel = sameMonth
      ? `${start.dow}–${end.dow}, ${start.month} ${start.day}–${end.day}`
      : `${start.dow} ${start.month} ${start.day} – ${end.dow} ${end.month} ${end.day}`;
  } else {
    dateLabel = `${start.dow}, ${start.month} ${start.day}`;
  }

  // Board meeting: link + summary (or provisional topics for future meetings)
  let summaryHtml = '';
  if (e.type === 'board-meeting') {
    const summaries = isEn ? summariesEn : summariesEs;
    const summary = summaries[e.date];
    const meetingLink = isEn ? '/meetings/#sy2526' : '/reuniones/#sy2526';
    if (summary) {
      summaryHtml = `<span class="event-summary">${summary}</span>`;
    } else {
      // Show provisional topics from governance calendar for future meetings
      const provisional = governanceCal.provisionalTopics?.[e.date];
      if (provisional) {
        const topicText = isEn ? provisional.en : provisional.es;
        const provLabel = isEn ? 'Planned' : 'Planificado';
        summaryHtml = `<span class="event-summary event-summary--provisional" title="${isEn ? 'Provisional topics from the Schedule of Board Agenda Items' : 'Temas provisionales del calendario de temas de la agenda'}">${provLabel}: ${topicText}</span>`;
      }
    }
  }

  let label = isEn ? e.en : e.es;
  // Strip redundant "— No School" / "— No Hay Clases" text; the red color + emoji convey this
  if (e.type === 'no-school') {
    label = label.replace(/\s*[—–-]\s*No School/i, '').replace(/\s*[—–-]\s*No Hay Clases/i, '');
    label += ' <span class="no-school-icon" aria-label="No School">🏫</span>';
  }
  const meetingLinkWrap = e.type === 'board-meeting'
    ? `<a href="${isEn ? '/meetings/#sy2526' : '/reuniones/#sy2526'}" class="event-label-link">${label}</a>`
    : label;

  return `
        <div class="event-row ${typeClass}${multiClass}">
          <span class="event-date-inline">${dateLabel}</span>
          <span class="event-text">${meetingLinkWrap}${summaryHtml}</span>
        </div>`;
}

// ---- Page-specific CSS (everything not in baseCSS) ----
const homepageCSS = `
  /* ---- BILINGUAL TWO-COLUMN CORE ---- */
  .bi-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
  }
  .bi-en {
    text-align: right;
    padding-right: 2.5rem;
  }
  .bi-es {
    text-align: left;
    padding-left: 2.5rem;
    border-left: 1px solid var(--rule-light);
  }

  /* ---- HERO ---- */
  .hero {
    background: var(--green-deep);
    color: var(--cream);
    position: relative;
    overflow: hidden;
  }
  .hero::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse at 20% 80%, rgba(74,140,106,0.3) 0%, transparent 60%),
      radial-gradient(ellipse at 80% 20%, rgba(196,132,45,0.15) 0%, transparent 50%);
    pointer-events: none;
  }
  .hero-inner {
    max-width: 960px;
    margin: 0 auto;
    padding: 3.5rem 2rem 2.5rem;
    position: relative;
  }
  .hero .bi-es { border-left-color: rgba(255,255,255,0.1); }
  .hero-logo {
    display: block;
    height: 140px;
    width: auto;
    max-width: 520px;
    margin: 0 auto 1.5rem;
    object-fit: contain;
    filter: drop-shadow(0 2px 8px rgba(0,0,0,0.25));
  }
  .hero h1 {
    font-family: 'Fraunces', Georgia, serif;
    font-size: clamp(1.5rem, 3.5vw, 2.2rem);
    font-weight: 300;
    line-height: 1.2;
    color: #fff;
    font-optical-sizing: auto;
  }
  .hero p {
    margin-top: 1rem;
    font-size: 0.95rem;
    color: rgba(255,255,255,0.82);
    line-height: 1.6;
  }
  .hero-stats {
    display: flex;
    gap: 1.5rem;
    flex-wrap: wrap;
    justify-content: center;
    margin-top: 2rem;
    padding-top: 1.5rem;
    border-top: 1px solid rgba(255,255,255,0.1);
  }
  .hero-stat { display: flex; flex-direction: column; text-align: center; }
  .hero-stat-value {
    font-family: 'Fraunces', serif;
    font-size: 1.6rem;
    font-weight: 600;
    color: #fff;
    line-height: 1;
  }
  .hero-stat-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.4);
    margin-top: 0.3rem;
  }

  /* ---- DISCLAIMER ---- */
  .disclaimer {
    background: #fff3cd;
    border-bottom: 1px solid #f0d9a8;
    font-size: 0.75rem;
    color: #664d03;
    font-family: 'IBM Plex Mono', monospace;
    line-height: 1.5;
  }
  .disclaimer .bi-row { max-width: 960px; margin: 0 auto; }
  .disclaimer .bi-en,
  .disclaimer .bi-es { padding-top: 0.6rem; padding-bottom: 0.6rem; }
  .disclaimer .bi-es { border-left-color: rgba(102,77,3,0.15); }
  .disclaimer a { color: #664d03; }

  /* ---- PHONE CTA ---- */
  .phone-cta {
    background: #eef5ef;
    border-bottom: 1px solid #d7e5d9;
    font-size: 0.85rem;
    line-height: 1.6;
  }
  .phone-cta .bi-row { max-width: 960px; margin: 0 auto; }
  .phone-cta .bi-en,
  .phone-cta .bi-es { padding-top: 0.7rem; padding-bottom: 0.7rem; }
  .phone-cta strong { font-family: 'IBM Plex Mono', monospace; }
  .phone-cta .cta-fine { font-size: 0.72rem; color: #4a5d4e; display: block; margin-top: 0.15rem; }

  /* ---- CONTENT ---- */
  .content {
    max-width: 960px;
    margin: 0 auto;
    padding: 0 0 3rem;
  }

  /* ---- SECTION HEADINGS (bilingual) ---- */
  .section-head {
    padding: 2.5rem 0 0;
  }
  .section-head .bi-en,
  .section-head .bi-es { padding-top: 0; padding-bottom: 0; }
  .section-head h2 {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 1.4rem;
    font-weight: 400;
    color: var(--green-deep);
    line-height: 1.3;
  }
  .section-head p {
    color: var(--text-muted);
    font-size: 0.82rem;
    font-style: italic;
    margin-top: 0.3rem;
  }
  .section-rule {
    height: 1px;
    background: var(--rule-light);
    margin-top: 0.8rem;
  }

  /* ---- QUICK LINKS ---- */
  .nav-links {
    padding: 1.5rem 0 0;
  }
  .nav-link-item {
    padding: 0.9rem 0;
    border-bottom: 1px solid var(--rule-light);
  }
  .nav-link-item:first-child { border-top: 1px solid var(--rule-light); }
  .nav-link-item h3 {
    font-family: 'Fraunces', serif;
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 0.2rem;
  }
  .nav-link-item h3 a {
    color: var(--green-deep);
    text-decoration: none;
  }
  .nav-link-item h3 a:hover {
    color: var(--green-mid);
    text-decoration: underline;
  }
  .nav-link-item p {
    font-size: 0.82rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  /* ---- SCHOOL CARDS (full-width) ---- */
  .school-section {
    padding: 1.5rem 2rem 0;
  }
  .school-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 0.8rem;
  }
  .school-card {
    position: relative;
    display: block;
    background: #fff;
    border: 1px solid var(--rule-light);
    padding: 0.8rem 1rem;
    transition: border-color 0.2s, box-shadow 0.2s;
    text-decoration: none;
    color: inherit;
  }
  .school-card:hover {
    border-color: var(--green-light);
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  }
  .school-card:focus-within {
    border-color: var(--green-light);
    box-shadow: 0 0 0 2px var(--green-light);
  }
  .school-card:hover .school-name-link { color: var(--green-mid); }
  .school-card-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.2rem;
  }
  .school-name-link {
    font-family: 'Fraunces', serif;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--green-deep);
    transition: color 0.2s;
  }
  .school-name-link::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 1;
  }
  .school-grades {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    color: var(--text-muted);
  }
  .school-badges {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
    margin-bottom: 0.4rem;
  }
  .school-badge {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    padding: 0.1rem 0.4rem;
    border-radius: 2px;
  }
  .school-badge--neighborhood { background: var(--green-wash); color: var(--green-mid); }
  /* Badge text darkened from var(--amber)/var(--coral): those tokens only hit
     2.27:1 / 3.23:1 on their wash backgrounds; these hit >=4.5:1 (WCAG AA). */
  .school-badge--choice { background: var(--amber-light); color: #7a4f12; }
  .school-badge--community { background: var(--coral-light); color: #9c3f2e; }
  .school-program {
    font-size: 0.72rem;
    color: var(--green-mid);
    font-style: italic;
    margin-bottom: 0.3rem;
  }
  .school-details {
    font-size: 0.72rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }
  .school-detail { margin-bottom: 0.15rem; }
  .school-detail a { color: var(--green-mid); text-decoration: none; }
  .school-detail a:hover { text-decoration: underline; }
  .school-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.58rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
  }
  .school-links {
    position: relative;
    z-index: 2;
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin-top: 0.6rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--rule-light);
  }
  .school-links a {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 30px; /* tap target; raised to 44px on mobile below */
    padding: 0.25rem 0.6rem;
    border: 1px solid var(--rule);
    border-radius: 4px;
    background: var(--cream);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.72rem;
    line-height: 1.3;
    color: var(--green-mid);
    text-decoration: none;
  }
  .school-links a:hover {
    border-color: var(--green-light);
    background: var(--green-wash);
    text-decoration: none;
  }

  /* ---- EVENTS (mirrored bilingual) ---- */
  .events-section { padding-top: 1rem; }
  .events-col { display: flex; flex-direction: column; }
  .event-row {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--rule-light);
  }
  .event-date-inline {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.62rem;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    display: block;
    margin-bottom: 0.15rem;
  }
  .event-text {
    font-size: 0.82rem;
    color: var(--text);
    display: block;
    line-height: 1.4;
  }
  .event-label-link {
    text-decoration: none;
    color: inherit;
  }
  .event-label-link:hover { text-decoration: underline; }
  .event-summary {
    display: block;
    font-size: 0.72rem;
    color: var(--text-secondary);
    margin-top: 0.15rem;
    line-height: 1.35;
  }
  .event-summary--provisional {
    font-style: italic;
    color: var(--text-tertiary, #888);
  }
  .event--multi {
    background: var(--cream-dark, #f5f0e8);
    border-radius: 4px;
    padding: 0.5rem 0.65rem;
    /* No negative horizontal margin: when the bilingual event columns sit at
       the viewport edge (641-1023px widths), -0.65rem bled 11px past it and
       made the whole page pan sideways. */
    margin: 0.15rem 0;
    border-bottom: none;
  }
  /* No school — red */
  .event--no-school .event-date-inline { color: #c0392b; }
  .event--no-school .event-text { color: #c0392b; font-weight: 500; }
  .no-school-icon {
    position: relative;
    font-style: normal;
    margin-left: 0.25rem;
  }
  .no-school-icon::after {
    content: '';
    position: absolute;
    left: -2px;
    right: -2px;
    top: 45%;
    height: 2px;
    background: #c0392b;
    transform: rotate(-45deg);
  }
  /* Early release — yellow/amber */
  .event--early-release .event-date-inline { color: #b8860b; }
  /* Board meeting — blue */
  .event--board-meeting .event-date-inline { color: #2563a0; }
  .event--board-meeting .event-label-link { color: #2563a0; font-weight: 500; }
  .event--board-meeting .event-label-link:hover { color: #1a4570; }
  /* Milestone — green */
  .event--milestone .event-date-inline { color: var(--green-deep); }
  .event--milestone .event-text { color: var(--green-deep); font-weight: 600; }

  /* ---- RESOURCE LINKS (mirrored bilingual) ---- */
  .resource-item {
    padding: 0.7rem 0;
    border-bottom: 1px solid var(--rule-light);
  }
  .resource-item h3 {
    font-family: 'Fraunces', serif;
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--green-deep);
    margin-bottom: 0.15rem;
  }
  .resource-item p {
    font-size: 0.78rem;
    color: var(--text-secondary);
    line-height: 1.4;
    margin-bottom: 0.3rem;
  }
  .resource-item a.resource-url {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.62rem;
    color: var(--green-mid);
    text-decoration: none;
  }
  .resource-item a.resource-url:hover { text-decoration: underline; }

  /* ---- AI SECTION (full-width) ---- */
  .ai-section {
    background: var(--cream-dark);
    border: 1px solid var(--rule);
    padding: 1.5rem 2rem;
    margin: 2.5rem 2rem 0;
    text-align: left;
  }
  .ai-section h2 {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--green-mid);
    margin-bottom: 1rem;
    text-align: center;
  }
  .ai-section pre {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    line-height: 1.7;
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .ai-section pre a {
    color: var(--green-mid);
    text-decoration: underline;
    text-decoration-color: var(--rule);
  }
  .ai-section pre a:hover {
    color: var(--green-deep);
    text-decoration-color: var(--green-mid);
  }
  .ai-section code {
    background: rgba(0,0,0,0.04);
    padding: 0.1rem 0.3rem;
    border-radius: 2px;
  }

  /* ---- RESPONSIVE (page-specific) ---- */
  @media (max-width: 640px) {
    html { font-size: 15px; }
    .bi-row { grid-template-columns: 1fr; }
    .bi-en { text-align: left; padding-right: 1.2rem; padding-left: 1.2rem; }
    .bi-es { border-left: none; padding-left: 1.2rem; padding-right: 1.2rem;
             border-top: 1px solid var(--rule-light); padding-top: 0.8rem; margin-top: 0.5rem; }
    .hero .bi-es { border-top-color: rgba(255,255,255,0.1); }
    .disclaimer .bi-es { border-top-color: rgba(102,77,3,0.15); }
    .hero-inner { padding: 2.5rem 1.2rem 2rem; }
    .hero-stats { justify-content: center; }
    .content { padding-bottom: 2rem; }
    .school-section { padding: 1rem 1.2rem 0; }
    .school-grid { grid-template-columns: 1fr; }
    /* Full-size tap targets: two buttons per row, >=44px tall */
    .school-links a {
      flex: 1 1 calc(50% - 0.4rem);
      justify-content: center;
      text-align: center;
      min-height: 44px;
      font-size: 0.8rem;
    }
    .ai-section { margin: 2rem 1.2rem 0; }
    .events-col .event-row { text-align: left; }
  }`;

// ---- JSON-LD ----
const jsonLdBlocks = `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "RCSD Open Data",
  "url": "https://rcsd.info/",
  "description": "Open data portal for the Redwood City School District",
  "publisher": {
    "@type": "Person",
    "name": "David Weekly",
    "url": "https://david.weekly.org"
  }
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "name": "RCSD Schools",
  "numberOfItems": ${numSchools},
  "itemListElement": [
${sortedSchools.map((s, i) => `    {
      "@type": "ListItem",
      "position": ${i + 1},
      "item": {
        "@type": "School",
        "name": "${s.name}",
        "address": "${s.address}",
        "telephone": "${s.phone}",
        "url": "${s.website}"
      }
    }`).join(',\n')}
  ]
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Dataset",
  "name": "RCSD Open Data",
  "description": "Structured open data for the Redwood City School District (RCSD) — a TK-8 public school district in Redwood City, California serving ${totalEnrollment.toLocaleString()} students across ${numSchools} schools. Includes school directory, board meeting archives with transcripts, district calendars, special education enrollment, SARC reports, demographics, and live lunch menus.",
  "url": "https://rcsd.info/",
  "license": "https://creativecommons.org/licenses/by/4.0/",
  "creator": {
    "@type": "Person",
    "name": "David Weekly",
    "url": "https://david.weekly.org"
  },
  "about": {
    "@type": "GovernmentOrganization",
    "name": "Redwood City School District",
    "url": "https://www.rcsdk8.net",
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "Redwood City",
      "addressRegion": "CA",
      "addressCountry": "US"
    }
  },
  "spatialCoverage": {
    "@type": "Place",
    "name": "Redwood City, California"
  },
  "temporalCoverage": "2018/..",
  "distribution": [
    {
      "@type": "DataDownload",
      "encodingFormat": "application/json",
      "contentUrl": "https://data.rcsd.info/json/schools.json",
      "name": "School Directory",
      "description": "All ${numSchools} schools with addresses, principals, bell schedules, enrollment, and parent resources"
    },
    {
      "@type": "DataDownload",
      "encodingFormat": "application/json",
      "contentUrl": "https://data.rcsd.info/json/meetings-data.json",
      "name": "Board Meeting Archive",
      "description": "Board meetings with agendas, agenda items, attachments, timestamps, and transcripts"
    },
    {
      "@type": "DataDownload",
      "encodingFormat": "application/json",
      "contentUrl": "https://data.rcsd.info/json/district-calendar-2025-26.json",
      "name": "District Calendar 2025-26",
      "description": "School year calendar with holidays, early release days, and board meetings"
    },
    {
      "@type": "DataDownload",
      "encodingFormat": "application/json",
      "contentUrl": "https://data.rcsd.info/json/district-calendar-2026-27.json",
      "name": "District Calendar 2026-27",
      "description": "School year calendar with holidays, early release days, and board meetings"
    },
    {
      "@type": "DataDownload",
      "encodingFormat": "application/json",
      "contentUrl": "https://data.rcsd.info/json/sped-enrollment.json",
      "name": "Special Education Enrollment",
      "description": "IEP student counts per school per grade (CDE 2024-25)"
    },
    {
      "@type": "DataDownload",
      "encodingFormat": "application/json",
      "contentUrl": "https://data.rcsd.info/json/sarc/sarc-summary.json",
      "name": "SARC Summary",
      "description": "School Accountability Report Card data: demographics, test scores, expenditures per school"
    }
  ],
  "keywords": ["education", "school district", "open data", "Redwood City", "California", "TK-8", "board meetings", "school demographics", "CAASPP", "special education"]
}
</script>`;

// ---- Generate homepage HTML ----
const ogDesc = 'Open data portal for RCSD: board meetings, school directory, district overview, and key documents.';
const html = `<!DOCTYPE html>
<html lang="en">
<head>
${headMeta({
  title: 'RCSD Open Data — Redwood City School District Public Records',
  description: `Open data portal for the Redwood City School District. ${numSchools} schools, ${totalEnrollment.toLocaleString()} students, ${meetingStats.total} board meetings with agendas, minutes, and video. Bilingual English/Spanish.`,
  canonical: 'https://rcsd.info/',
  ogLocale: 'en_US',
  ogImageKey: 'page-home',
  hreflang: [
    { lang: 'x-default', href: 'https://rcsd.info/' },
    { lang: 'en', href: 'https://rcsd.info/' },
    { lang: 'es', href: 'https://rcsd.info/' },
  ],
  jsonLd: jsonLdBlocks,
  extraHead: '<meta property="og:locale:alternate" content="es_US">\n<link rel="describedby" href="/llms.txt" type="text/markdown">',
  pageCSS: homepageCSS,
})}
</head>
<body>

${siteNav({ activePage: 'home', lang: 'en' })}

<header class="hero">
  <div class="hero-inner">
    <img src="https://data.rcsd.info/logos/district.jpg" alt="Redwood City School District" class="hero-logo" width="1200" height="451" fetchpriority="high">
    <div class="bi-row">
      <div class="bi-en">
        <h1>Open Data for Redwood City School District</h1>
        <p>Check lunch menus, follow school board meetings, and see how each school is doing — public records and school data for Redwood City families, all in one place.</p>
      </div>
      <div class="bi-es" lang="es">
        <h1>Datos Abiertos para el Distrito Escolar de Redwood City</h1>
        <p>Mira los menús de almuerzo, sigue las reuniones de la mesa directiva y ve cómo va cada escuela — registros públicos y datos escolares para las familias de Redwood City, todo en un solo lugar.</p>
      </div>
    </div>
    <div class="hero-stats">
      <div class="hero-stat">
        <span class="hero-stat-value">${numSchools}</span>
        <span class="hero-stat-label">Schools · Escuelas</span>
      </div>
      <div class="hero-stat">
        <span class="hero-stat-value">${totalEnrollment.toLocaleString()}</span>
        <span class="hero-stat-label">Students · Estudiantes</span>
      </div>
      <div class="hero-stat">
        <span class="hero-stat-value">${meetingStats.total}</span>
        <span class="hero-stat-label">Meetings · Reuniones</span>
      </div>
      <div class="hero-stat">
        <span class="hero-stat-value">${meetingStats.totalAttachments?.toLocaleString() || 0}</span>
        <span class="hero-stat-label">Attachments · Anexos</span>
      </div>
    </div>
  </div>
</header>

<div class="disclaimer">
  <div class="bi-row">
    <div class="bi-en">Not an official RCSD product. For official info visit <a href="https://www.rcsdk8.net">rcsdk8.net</a>. Questions? <a href="mailto:team@rcsd.info">team@rcsd.info</a></div>
    <div class="bi-es" lang="es">No es un producto oficial de RCSD. Para información oficial visite <a href="https://www.rcsdk8.net">rcsdk8.net</a>. ¿Preguntas? <a href="mailto:team@rcsd.info">team@rcsd.info</a></div>
  </div>
</div>

<div class="phone-cta">
  <div class="bi-row">
    <div class="bi-en">
      📞 <strong>Call or text the rcsd.info info line: <a href="tel:+16504828912">(650) 482-8912</a></strong> — ask about calendars, lunch menus, schools, or board meetings and an AI assistant answers from public data.
      <span class="cta-fine">By texting you agree to receive an automated informational reply. Msg &amp; data rates may apply. Message frequency varies. Reply STOP to opt out, HELP for help. <a href="/terms/">Terms</a> · <a href="/privacy/">Privacy</a>. A service of Primatech Paper Co LLC, independent of RCSD.</span>
    </div>
    <div class="bi-es" lang="es">
      📞 <strong>Llama o manda texto a la línea de rcsd.info: <a href="tel:+16503997203">(650) 399-7203</a></strong> — pregunta sobre calendarios, menús de almuerzo, escuelas o reuniones de la mesa directiva y un asistente de AI te contesta con datos públicos.
      <span class="cta-fine">Al mandar texto aceptas recibir una respuesta informativa automática. Pueden aplicar tarifas de mensajes y datos. La frecuencia de mensajes varía. Responde STOP para cancelar, HELP para ayuda. <a href="/terminos/">Términos</a> · <a href="/privacidad/">Privacidad</a>. Un servicio de Primatech Paper Co LLC, independiente de RCSD.</span>
    </div>
  </div>
</div>

<main class="content">

  <!-- EXPLORE -->
  <div class="section-head bi-row">
    <div class="bi-en"><h2>Explore</h2></div>
    <div class="bi-es" lang="es"><h2>Explorar</h2></div>
  </div>
  <div class="section-rule"></div>
  <div class="bi-row nav-links">
    <div class="bi-en">
      <div class="nav-link-item">
        <h3><a href="/meetings/">Board Meetings &#8599;</a></h3>
        <p>Agendas, video, minutes, and transcripts for ${meetingStats.total} board meetings.</p>
      </div>
      <div class="nav-link-item">
        <h3><a href="/district/">District Overview &#8599;</a></h3>
        <p>Budget, performance, enrollment trends, and governance in plain language.</p>
      </div>
      <div class="nav-link-item">
        <h3><a href="/meetings/#documents">Key Documents &#8599;</a></h3>
        <p>Budget reports, LCAP, school plans (SPSA), and school report cards (SARC).</p>
      </div>
      <div class="nav-link-item">
        <h3><a href="/policies/">Board Policies &#8599;</a></h3>
        <p>Interactive catalog of all active school board policies, bylaws, and administrative regulations.</p>
      </div>
      <div class="nav-link-item">
        <h3><a href="/committees/">Committees &#8599;</a></h3>
        <p>Bond oversight (CBOC), English learner parent advisory (DELAC), and other district committees — members, meetings, and recordings.</p>
      </div>
      <div class="nav-link-item">
        <h3><a href="https://github.com/dweekly/rcsd-meetings">Source Code &#8599;</a></h3>
        <p>Open source on GitHub. Data pipeline, scraping tools, and website code.</p>
      </div>
    </div>
    <div class="bi-es" lang="es">
      <div class="nav-link-item">
        <h3><a href="/reuniones/">Reuniones de la Junta &#8599;</a></h3>
        <p>Agendas, video, actas y transcripciones de ${meetingStats.total} reuniones.</p>
      </div>
      <div class="nav-link-item">
        <h3><a href="/distrito/">Resumen del Distrito &#8599;</a></h3>
        <p>Presupuesto, rendimiento, tendencias de inscripción y gobernanza en lenguaje sencillo.</p>
      </div>
      <div class="nav-link-item">
        <h3><a href="/reuniones/#documents">Documentos Clave &#8599;</a></h3>
        <p>Informes de presupuesto, LCAP, planes escolares (SPSA) y boletas de calificaciones (SARC).</p>
      </div>
      <div class="nav-link-item">
        <h3><a href="/politicas/">Políticas de la Junta &#8599;</a></h3>
        <p>Catálogo interactivo de todas las políticas, reglamentos y estatutos vigentes de la mesa directiva.</p>
      </div>
      <div class="nav-link-item">
        <h3><a href="/comites/">Comités &#8599;</a></h3>
        <p>Supervisión del bono (CBOC), comité de padres de aprendices de inglés (DELAC) y otros comités del distrito — miembros, reuniones y grabaciones.</p>
      </div>
      <div class="nav-link-item">
        <h3><a href="https://github.com/dweekly/rcsd-meetings">Código Fuente &#8599;</a></h3>
        <p>Código abierto en GitHub. Pipeline de datos, herramientas y código del sitio.</p>
      </div>
    </div>
  </div>

  <!-- SCHOOL DIRECTORY (full-width, data is bilingual within cards) -->
  <div class="section-head bi-row">
    <div class="bi-en"><h2>Our ${numSchools} Schools</h2><p>7 neighborhood + 5 choice</p></div>
    <div class="bi-es" lang="es"><h2>Nuestras ${numSchools} Escuelas</h2><p>7 de vecindario + 5 de elección</p></div>
  </div>
  <div class="section-rule"></div>
  <div class="school-section">
    <div class="school-grid">
${sortedSchools.map(s => schoolCard(s)).join('\n')}
    </div>
  </div>

  <!-- KEY DATES -->
  <div class="section-head bi-row">
    <div class="bi-en"><h2>Upcoming Key Dates</h2><p><a href="${calendar2526.calendarUrl}" target="_blank" rel="noopener">${calendar2526.schoolYear} Calendar &#8599;</a> · <a href="${calendar2627.calendarUrl}" target="_blank" rel="noopener">${calendar2627.schoolYear} Calendar &#8599;</a> · <a href="${boardCalendarUrl}" target="_blank" rel="noopener">Board Meetings &#8599;</a></p></div>
    <div class="bi-es" lang="es"><h2>Fechas Importantes</h2><p><a href="${calendar2526.calendarUrl}" target="_blank" rel="noopener">Calendario ${calendar2526.schoolYear} &#8599;</a> · <a href="${calendar2627.calendarUrl}" target="_blank" rel="noopener">Calendario ${calendar2627.schoolYear} &#8599;</a> · <a href="${boardCalendarUrl}" target="_blank" rel="noopener">Junta &#8599;</a></p></div>
  </div>
  <div class="section-rule"></div>
${upcoming.length > 0 ? `  <div class="bi-row events-section">
    <div class="bi-en events-col">
${upcoming.map(e => eventRow(e, 'en')).join('\n')}
    </div>
    <div class="bi-es events-col" lang="es">
${upcoming.map(e => eventRow(e, 'es')).join('\n')}
    </div>
  </div>` : ''}

  <!-- OFFICIAL SOURCES -->
  <div class="section-head bi-row">
    <div class="bi-en"><h2>Official Sources</h2><p>Authoritative sources for RCSD information</p></div>
    <div class="bi-es" lang="es"><h2>Fuentes Oficiales</h2><p>Fuentes oficiales de información de RCSD</p></div>
  </div>
  <div class="section-rule"></div>
  <div class="bi-row" style="padding-top:0.5rem">
    <div class="bi-en">
      <div class="resource-item">
        <h3>District Website</h3>
        <p>Official RCSD information, news, and announcements.</p>
        <a class="resource-url" href="https://www.rcsdk8.net" target="_blank" rel="noopener">rcsdk8.net &#8599;</a>
      </div>
      <div class="resource-item">
        <h3>Board Meeting Portal</h3>
        <p>Current agendas and attachments on GAMUT/Simbli.</p>
        <a class="resource-url" href="https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030397" target="_blank" rel="noopener">GAMUT/Simbli &#8599;</a>
      </div>
      <div class="resource-item">
        <h3>YouTube Channel</h3>
        <p>Video recordings of public board meetings.</p>
        <a class="resource-url" href="https://www.youtube.com/@RedwoodCitySchoolDistrict" target="_blank" rel="noopener">YouTube &#8599;</a>
      </div>
      <div class="resource-item">
        <h3>CA School Dashboard</h3>
        <p>State performance data and accountability metrics.</p>
        <a class="resource-url" href="https://www.caschooldashboard.org/reports/41690050000000/2024" target="_blank" rel="noopener">caschooldashboard.org &#8599;</a>
      </div>
    </div>
    <div class="bi-es" lang="es">
      <div class="resource-item">
        <h3>Sitio del Distrito</h3>
        <p>Información oficial, noticias y anuncios de RCSD.</p>
        <a class="resource-url" href="https://www.rcsdk8.net" target="_blank" rel="noopener">rcsdk8.net &#8599;</a>
      </div>
      <div class="resource-item">
        <h3>Portal de Reuniones</h3>
        <p>Agendas actuales y anexos en GAMUT/Simbli.</p>
        <a class="resource-url" href="https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030397" target="_blank" rel="noopener">GAMUT/Simbli &#8599;</a>
      </div>
      <div class="resource-item">
        <h3>Canal de YouTube</h3>
        <p>Grabaciones de video de reuniones públicas de la junta.</p>
        <a class="resource-url" href="https://www.youtube.com/@RedwoodCitySchoolDistrict" target="_blank" rel="noopener">YouTube &#8599;</a>
      </div>
      <div class="resource-item">
        <h3>Panel Escolar de CA</h3>
        <p>Datos de rendimiento estatal y métricas de rendición de cuentas.</p>
        <a class="resource-url" href="https://www.caschooldashboard.org/reports/41690050000000/2024" target="_blank" rel="noopener">caschooldashboard.org &#8599;</a>
      </div>
    </div>
  </div>

  <!-- CLAUDE CODE PLUGIN (primary AI integration) -->
  <div class="ai-section">
    <h2>Claude Code Plugin</h2>
    <pre>
Install the rcsd-info plugin for <a href="https://claude.com/claude-code">Claude Code</a> to query RCSD data
from your terminal. The plugin teaches Claude about every data file,
schema, and analysis pattern — so it can answer arbitrary questions,
compare schools, cross-reference datasets, and track board topics
over time. No pre-built queries needed; ask anything.

  <code>/plugin marketplace add dweekly/rcsd-meetings</code>
  <code>/plugin install rcsd-info@rcsd-info</code>

Optional: create <code>~/.claude/rcsd-info.local.md</code> to personalize queries:

  <code>---</code>
  <code>children:</code>
  <code>  - name: Jill</code>
  <code>    grade: 2</code>
  <code>    school: orion</code>
  <code>    program: Mandarin Immersion</code>
  <code>---</code>

Then ask: "What's Jill having for lunch tomorrow?"</pre>
  </div>

  <!-- OPEN DATA / MCP -->
  <div class="ai-section" style="margin-top:1rem">
    <h2>Open Data &amp; MCP</h2>
    <pre>
RCSD Open Data — structured JSON for the Redwood City School District

GitHub:  <code><a href="https://github.com/dweekly/rcsd-meetings">https://github.com/dweekly/rcsd-meetings</a></code>
Website: <code><a href="https://rcsd.info">https://rcsd.info</a></code>
CDN:     <code><a href="https://data.rcsd.info">https://data.rcsd.info</a></code>
MCP:     <code>https://mcp.rcsd.info/mcp</code>  <a href="/mcp/">Setup instructions &#8599;</a>

DATA FILES (<a href="https://data.rcsd.info/json/">data.rcsd.info/json/</a>):
  <a href="https://data.rcsd.info/json/meetings-data.json">meetings-data.json</a>       All meetings with agendas, items, attachments, timestamps
  <a href="https://data.rcsd.info/json/meeting-summaries.json">meeting-summaries.json</a>   Curated English summaries per meeting
  <a href="https://data.rcsd.info/json/meeting-summaries-es.json">meeting-summaries-es.json</a>  Curated Spanish summaries
  <a href="https://data.rcsd.info/json/schools.json">schools.json</a>             School directory (12 schools, addresses, principals, bell schedules)
  <a href="https://data.rcsd.info/json/district-calendar-2025-26.json">district-calendar-2025-26.json</a>  Key dates for 2025-26
  <a href="https://data.rcsd.info/json/district-calendar-2026-27.json">district-calendar-2026-27.json</a>  Key dates for 2026-27
  <a href="https://data.rcsd.info/json/youtube-index.json">youtube-index.json</a>       YouTube video metadata
  <a href="https://data.rcsd.info/json/agenda-attachments.json">agenda-attachments.json</a>  Attachment metadata with R2 URLs

R2 CDN DOCUMENT URLS:
  https://data.rcsd.info/agendas/{YYYY-MM-DD}-agenda.pdf
  https://data.rcsd.info/minutes/{YYYY-MM-DD}-minutes.pdf
  https://data.rcsd.info/board-packets/{AID}.pdf
  https://data.rcsd.info/documents/{type}/{filename}
    types: spsa, budget, lcap, sarc

STRUCTURED PAGES:
  /                 Homepage (bilingual EN/ES)
  /meetings/        Meeting archive (EN)
  /reuniones/       Meeting archive (ES)
  /district/        District overview (EN)
  /distrito/        District overview (ES)

Contact: team@rcsd.info</pre>
  </div>

</main>

${siteFooter({ lang: 'en' })}

</body>
</html>`;

// ---- Write homepage ----
writeFileSync(resolve(ROOT, 'docs/index.html'), html);
console.log('Wrote docs/index.html (homepage)');

// ---- 404 page ----
const fourOhFourCSS = `
  body {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .content {
    max-width: 960px;
    margin: 0 auto;
    padding: 6rem 2rem;
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
  }
  .code {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 5rem;
    font-weight: 300;
    color: var(--green-deep);
    line-height: 1;
    opacity: 0.3;
  }
  h1 {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 1.6rem;
    font-weight: 400;
    color: var(--green-deep);
    margin-top: 1rem;
  }
  .subtitle {
    color: var(--text-muted);
    font-style: italic;
    font-size: 0.92rem;
    margin-top: 0.5rem;
  }
  .links {
    margin-top: 2rem;
    display: flex;
    gap: 1.5rem;
    flex-wrap: wrap;
    justify-content: center;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.75rem;
  }
  .links a { text-decoration: none; }
  .links a:hover { text-decoration: underline; }
  .bi {
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--rule);
    color: var(--text-muted);
    font-style: italic;
    font-size: 0.85rem;
  }
  .site-footer { width: 100%; }
  @media (max-width: 640px) {
    html { font-size: 15px; }
    .content { padding: 4rem 1.2rem; }
    .code { font-size: 3.5rem; }
  }`;

const fourOhFour = `<!DOCTYPE html>
<html lang="en">
<head>
${headMeta({
  title: 'Page Not Found — RCSD Open Data',
  description: 'The page you are looking for does not exist.',
  robots: 'noindex',
  pageCSS: fourOhFourCSS,
})}
</head>
<body>

${siteNav({ lang: 'en' })}

<main class="content">
  <div class="code">404</div>
  <h1>Page Not Found</h1>
  <p class="subtitle">The page you're looking for doesn't exist or may have moved.</p>
  <div class="links">
    <a href="/">Home</a>
    <a href="/meetings/">Meetings</a>
    <a href="/district/">District</a>
    <a href="https://data.rcsd.info">Data</a>
  </div>
  <div class="bi" lang="es">
    Pagina no encontrada. <a href="/">Volver al inicio</a>
  </div>
</main>

<footer class="site-footer">
  <p><a href="mailto:team@rcsd.info">team@rcsd.info</a> · <a href="/mcp/">API &amp; data for developers</a></p>
</footer>

</body>
</html>`;

writeFileSync(resolve(ROOT, 'docs/404.html'), fourOhFour);
console.log('Wrote docs/404.html');

// ---- Template helper ----
function renderTemplate(name, vars = {}) {
  let tmpl = readFileSync(resolve(ROOT, 'templates', name), 'utf-8');
  for (const [key, val] of Object.entries(vars)) {
    tmpl = tmpl.replaceAll(`{{${key}}}`, val);
  }
  return tmpl;
}

const templateVars = {
  date: new Date().toISOString().slice(0, 10),
  totalEnrollment: totalEnrollment.toLocaleString(),
  numSchools: String(numSchools),
  schoolSlugs: sortedSchools.map(s =>
    `- \`${s.slug}\` — ${s.name} (${s.grades}, ${s.type === 'choice' ? 'Choice' : 'Neighborhood'})`
  ).join('\n'),
};

// ---- robots.txt ----
writeFileSync(resolve(ROOT, 'docs/robots.txt'), renderTemplate('robots.txt', templateVars));
console.log('Wrote docs/robots.txt');

// ---- humans.txt ----
writeFileSync(resolve(ROOT, 'docs/humans.txt'), renderTemplate('humans.txt', templateVars));
console.log('Wrote docs/humans.txt');

// ---- llms.txt (generated from sources of truth, never hand-maintained) ----
// The previous templates/llms.txt drifted: it listed 7 of 10 deployed MCP
// tools and omitted newer data files. Tools and data files are now derived at
// build time so additions show up on the next build automatically.

// CONSTRAINT: this is a regex over the server.tool("name", "description", ...)
// registration calls in workers/mcp-server/src/index.ts. It requires the first
// two arguments to be double-quoted string literals (true for every tool
// today). If the worker migrates to another registration style (template
// literals, registerTool(), an SDK upgrade), update this parser to match.
function parseMcpTools() {
  const src = readFileSync(resolve(ROOT, 'workers/mcp-server/src/index.ts'), 'utf-8');
  const tools = [];
  const re = /server\.tool\(\s*"((?:[^"\\]|\\.)+)",\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    tools.push({ name: m[1], description: m[2].replace(/\\"/g, '"') });
  }
  // Sanity floor: the server has shipped 10 tools since 2026-06. Finding fewer
  // than 5 means the regex no longer matches the source — fail the build
  // loudly instead of silently publishing a gutted tool list.
  if (tools.length < 5) {
    throw new Error(`parseMcpTools: only ${tools.length} tools matched in workers/mcp-server/src/index.ts — parser out of sync with tool registration style`);
  }
  return tools;
}

// One-line descriptions for known data files. Everything in data/*.json ships
// to https://data.rcsd.info/json/ (see upload-to-r2.mjs), so any file NOT in
// this map is still listed — plainly — rather than silently omitted.
const DATA_FILE_DESCRIPTIONS = {
  'agenda-attachments.json': 'Board meeting attachment metadata with R2 CDN URLs',
  'agenda-titles-es.json': 'Spanish translations of board agenda item titles',
  'blog-posts.json': 'Index of rcsd.info blog posts (EN/ES slugs, dates)',
  'boarddocs-scraped.json': 'Legacy board meeting data scraped from the retired BoardDocs portal',
  'chapter-markers.json': 'YouTube chapter markers (agenda item → video offset) per board meeting',
  'charters.json': 'Directory of RCSD-authorized charter schools — names, addresses, leaders, enrollment, CDS codes',
  'district-calendar-2025-26.json': '2025-26 school year calendar (holidays, early release, board meetings)',
  'district-calendar-2026-27.json': '2026-27 school year calendar',
  'document-index.json': 'Index of board documents — titles mapped to direct file URLs',
  'governance-calendar.json': 'Provisional topics planned for upcoming board meetings',
  'linked-documents.json': 'Curated district documents referenced in agenda memos but hosted off the board portal',
  'meeting-summaries.json': 'Curated English summaries of each board meeting',
  'meeting-summaries-es.json': 'Spanish translations of meeting summaries',
  'meeting-titles.json': 'Display titles for board meetings keyed by meeting slug',
  'meetings-data.json': 'Comprehensive board meeting archive with agendas, agenda items, attachments, timestamps, and transcripts',
  'minutes-aids.json': 'Per-meeting minutes notes (motions, votes, attendees) keyed by date',
  'policies-index.json': 'Global catalog of all board policies, bylaws, and administrative regulations',
  'policy-summaries.json': 'AI-generated one-sentence summaries of every board policy, English and Spanish, keyed by `{code}-{type}`',
  'policy-titles-es.json': 'Spanish translations of board policy titles',
  'properties.json': 'Inventory of district real estate that is not an operating school — admin buildings, leased campuses',
  'school-board-summaries.json': 'Board agenda items tagged to specific schools',
  'schools.json': 'Directory of all district schools — names, addresses, principals, bell schedules, enrollment, lunch menu URLs, PTO/PTA info, CDS codes',
  'sped-categories.json': 'Special education disability categories and LRE placement per school (CDE 2024-25)',
  'sped-enrollment.json': 'Special education (IEP) student counts per school per grade (CDE 2024-25)',
  'spsa-budgets.json': 'SPSA budget summaries extracted from each school plan',
  'ssc-meetings.json': 'School Site Council meeting agendas and minutes per school',
  'ssc-membership.json': 'School Site Council member rosters per school',
  'timestamp-map.json': 'Agenda item → video timestamp mapping per board meeting',
  'trustees.json': 'Board of Trustees roster with superintendent and cabinet',
  'youtube-index.json': 'YouTube video metadata for board meeting recordings',
};
// Development scratch samples — shipped by the blanket *.json upload rule but
// useless to readers, so explicitly excluded (new files are NOT excluded).
const DATA_FILE_SKIP = new Set(['sample-detail.json', 'sample-policies.json']);

function buildLlmsTxt() {
  const tools = parseMcpTools();
  const toolLines = tools
    .map(t => `- \`${t.name}\`: ${t.description}`)
    .join('\n');

  const dataLines = readdirSync(resolve(ROOT, 'data'))
    .filter(f => f.endsWith('.json') && !DATA_FILE_SKIP.has(f))
    .sort()
    .map(f => `- [${f}](https://data.rcsd.info/json/${f}): ${DATA_FILE_DESCRIPTIONS[f] || 'Data file (no description yet — see the GitHub repo)'}`);
  // Datasets published under json/ from outside the top-level data/*.json glob:
  dataLines.push('- [sarc/sarc-summary.json](https://data.rcsd.info/json/sarc/sarc-summary.json): SARC data — demographics, CAASPP test scores, expenditures per school');
  dataLines.push('- [board-policies/](https://data.rcsd.info/json/board-policies/): Directory of per-policy JSON files (e.g. `0100-BP.json`) with full HTML content, plain-text body, legal references, and cross-references');
  dataLines.push('- [board-policies-es/](https://data.rcsd.info/json/board-policies-es/): Spanish machine-translations of each policy body (same `{code}-{type}.json` filenames as board-policies/); the English version on Simbli is the only official text');

  return `# RCSD Open Data

> Open data portal for the Redwood City School District (RCSD) — a TK-8 public school district in Redwood City, California serving ${templateVars.totalEnrollment} students across ${templateVars.numSchools} schools. Independently compiled public records, meeting archives, and school data.

This site publishes structured JSON data files covering school directory information, board meeting archives with transcripts and video, district calendars, special education enrollment, school accountability reports (SARCs), demographics, and live lunch menus.

## Data Files

All data is available as JSON at [data.rcsd.info/json/](https://data.rcsd.info/json/).

${dataLines.join('\n')}

## School Slugs

${templateVars.schoolSlugs}

## Website Pages

- [/](https://rcsd.info/): Homepage (bilingual English/Spanish)
- [/meetings/](https://rcsd.info/meetings/): Board meeting archive (English)
- [/reuniones/](https://rcsd.info/reuniones/): Board meeting archive (Spanish)
- [/district/](https://rcsd.info/district/): District overview (English)
- [/distrito/](https://rcsd.info/distrito/): District overview (Spanish)
- [/schools/{slug}/](https://rcsd.info/schools/): Individual school pages (English)
- [/escuelas/{slug}/](https://rcsd.info/escuelas/): Individual school pages (Spanish)
- [/budget/](https://rcsd.info/budget/): District budget visualization (English)
- [/presupuesto/](https://rcsd.info/presupuesto/): District budget visualization (Spanish)
- [/policies/](https://rcsd.info/policies/): Board Policies Manual index — number, title, one-sentence summary per policy (English)
- [/politicas/](https://rcsd.info/politicas/): Board Policies Manual index (Spanish)
- [/policies/{code}-{type}/](https://rcsd.info/policies/): Individual policy pages — full text with hyperlinked cross-references. The slug is the policy code plus the type (bp or ar; exhibit entries use slugs like 6174-e-pdf-1-ar), lowercased, e.g. \`/policies/5144.1-ar/\` (English)
- [/politicas/{code}-{type}/](https://rcsd.info/politicas/): Individual policy pages, same slugs, machine-translated body (Spanish; the English Simbli version is the only official text)
- [/committees/](https://rcsd.info/committees/): District committees — members, meetings, recordings (English)
- [/comites/](https://rcsd.info/comites/): District committees (Spanish)
- [/search/](https://rcsd.info/search/): Site search (English)
- [/buscar/](https://rcsd.info/buscar/): Site search (Spanish)

## MCP Server

A remote [Model Context Protocol](https://modelcontextprotocol.io) server is available at:

\`\`\`
https://mcp.rcsd.info/mcp
\`\`\`

Connect it to Claude Desktop, claude.ai, VS Code, Cursor, or any MCP-compatible client. No authentication required. Setup instructions: [rcsd.info/mcp/](https://rcsd.info/mcp/)

### Tools

${toolLines}

## Claude Code Plugin

Install the [rcsd-info plugin](https://github.com/dweekly/rcsd-meetings/tree/main/plugin) for [Claude Code](https://claude.com/claude-code) to query RCSD data from the terminal:

\`\`\`
/plugin marketplace add dweekly/rcsd-meetings
/plugin install rcsd-info@rcsd-info
\`\`\`

The plugin provides school info, live lunch menus, calendars, board meetings, demographics, and special education stats.

## Documents on CDN

- Agendas: \`https://data.rcsd.info/agendas/{YYYY-MM-DD}-agenda.pdf\`
- Minutes: \`https://data.rcsd.info/minutes/{YYYY-MM-DD}-minutes.pdf\`
- Board packets: \`https://data.rcsd.info/board-packets/{AID}.pdf\`
- SARCs: \`https://data.rcsd.info/documents/sarc/2024-25/{slug}-sarc-2024-25.pdf\`
- SPSAs: \`https://data.rcsd.info/documents/spsa/2025-26/{slug}.pdf\`

## Contact

- Email: team@rcsd.info
- Source: https://github.com/dweekly/rcsd-meetings
- Not an official RCSD product. For official info visit [rcsdk8.net](https://www.rcsdk8.net).
`;
}

writeFileSync(resolve(ROOT, 'docs/llms.txt'), buildLlmsTxt());
console.log('Wrote docs/llms.txt');

// ---- sitemap.xml ----
// Google best practices: use xhtml:link hreflang for bilingual pages,
// accurate lastmod dates, NO changefreq or priority (Google ignores them).
const blogPosts = JSON.parse(readFileSync(resolve(ROOT, 'data/blog-posts.json'), 'utf-8'));
const sitemapDate = new Date().toISOString().slice(0, 10);

// Helper: bilingual URL pair with hreflang annotations
function bilingualUrl(enPath, esPath, lastmod) {
  const en = `https://rcsd.info${enPath}`;
  const es = `https://rcsd.info${esPath}`;
  return `  <url>
    <loc>${en}</loc>
    <lastmod>${lastmod}</lastmod>
    <xhtml:link rel="alternate" hreflang="en" href="${en}"/>
    <xhtml:link rel="alternate" hreflang="es" href="${es}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${en}"/>
  </url>
  <url>
    <loc>${es}</loc>
    <lastmod>${lastmod}</lastmod>
    <xhtml:link rel="alternate" hreflang="en" href="${en}"/>
    <xhtml:link rel="alternate" hreflang="es" href="${es}"/>
  </url>`;
}

// Helper: single-language URL
function singleUrl(path, lastmod) {
  return `  <url>
    <loc>https://rcsd.info${path}</loc>
    <lastmod>${lastmod}</lastmod>
  </url>`;
}

const schoolUrls = schools.schools.map(s =>
  bilingualUrl(`/schools/${s.slug}/`, `/escuelas/${s.slug}/`, sitemapDate)
).join('\n');

let charterUrls = '';
try {
  const charters = JSON.parse(readFileSync(resolve(ROOT, 'data/charters.json'), 'utf-8'));
  charterUrls = charters.charters.map(c =>
    bilingualUrl(`/schools/charters/${c.slug}/`, `/escuelas/charter/${c.slug}/`, sitemapDate)
  ).join('\n');
} catch {}

// Meeting viewer pages
let meetingUrls = '';
try {
  const meetings = JSON.parse(readFileSync(resolve(ROOT, 'data/meetings-data.json'), 'utf-8'));
  const byDate = {};
  for (const m of meetings.meetings) {
    if (!byDate[m.date]) byDate[m.date] = [];
    byDate[m.date].push(m);
  }
  meetingUrls = meetings.meetings.map(m => {
    const isMulti = byDate[m.date].length > 1;
    const path = isMulti ? m.slug : m.date;
    return bilingualUrl(`/meetings/${path}/`, `/reuniones/${path}/`, m.date);
  }).join('\n');
} catch {}

// Committee pages: landing, per-committee home, and recorded-meeting detail pages
let committeeUrls = '';
try {
  const dir = resolve(ROOT, 'data/committees');
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  const rows = [bilingualUrl('/committees/', '/comites/', sitemapDate)];
  for (const f of files) {
    const c = JSON.parse(readFileSync(resolve(dir, f), 'utf-8'));
    rows.push(bilingualUrl(`/committees/${c.id}/`, `/comites/${c.id}/`, sitemapDate));
    for (const m of (c.meetings || [])) {
      if (m.youtube) rows.push(bilingualUrl(`/committees/${c.id}/${m.date}/`, `/comites/${c.id}/${m.date}/`, m.date));
    }
  }
  committeeUrls = rows.join('\n');
} catch {}

// Per-policy pages: /policies/{slug}/ (EN) + /politicas/{slug}/ (ES), one pair
// per entry in the board policy manual catalog. Slugs MUST come from the
// shared policySlug() helper so the sitemap and build-policies.mjs page
// emission always agree — drift here means 1,200+ sitemap URLs that 404.
// No try/catch: policies-index.json is committed to git, so a load failure is
// a build bug and should fail loudly rather than silently gut the sitemap.
const policiesIndex = JSON.parse(readFileSync(resolve(ROOT, 'data/policies-index.json'), 'utf-8'));

// Simbli reports lastRevised as MM/DD/YYYY; sitemap lastmod wants YYYY-MM-DD.
// Missing or unparseable dates fall back to the build date.
function policyLastmod(usDate) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(usDate || '');
  if (!m) return sitemapDate;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

const policyUrls = policiesIndex.policies.map(p => {
  const slug = policySlug(p.code, p.type);
  return bilingualUrl(`/policies/${slug}/`, `/politicas/${slug}/`, policyLastmod(p.lastRevised));
}).join('\n');

// Homepage is a single bilingual page at one URL: emit ONE entry (the usual
// bilingualUrl() helper would duplicate the <loc>) and skip the
// self-referencing `es` alternate — just en + x-default.
const homepageEntry = `  <url>
    <loc>https://rcsd.info/</loc>
    <lastmod>${sitemapDate}</lastmod>
    <xhtml:link rel="alternate" hreflang="en" href="https://rcsd.info/"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://rcsd.info/"/>
  </url>`;

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${homepageEntry}
${bilingualUrl('/schools/', '/escuelas/', sitemapDate)}
${schoolUrls}
${charterUrls}
${bilingualUrl('/meetings/', '/reuniones/', sitemapDate)}
${bilingualUrl('/district/', '/distrito/', sitemapDate)}
${bilingualUrl('/budget/', '/presupuesto/', sitemapDate)}
${bilingualUrl('/policies/', '/politicas/', sitemapDate)}
${policyUrls}
${bilingualUrl('/mcp/', '/mcp/es/', sitemapDate)}
${bilingualUrl('/blog/', '/blog/es/', sitemapDate)}
${blogPosts.map(p => bilingualUrl(`/blog/${p.slug}/`, `/blog/${p.slugEs}/`, p.date)).join('\n')}
${meetingUrls}
${committeeUrls}
${singleUrl('/llms.txt', sitemapDate)}
</urlset>
`;
writeFileSync(resolve(ROOT, 'docs/sitemap.xml'), sitemap);
console.log('Wrote docs/sitemap.xml');
