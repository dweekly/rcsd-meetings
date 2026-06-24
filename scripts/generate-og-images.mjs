#!/usr/bin/env node
/**
 * Generate per-page OpenGraph images for rcsd.info.
 *
 * Cream-on-deep-green editorial design matching the site palette:
 *   - Fraunces (serif) for the headline
 *   - IBM Plex Mono for the date stamp and badge row
 *   - Amber accent rule
 *
 * Output: artifacts/og/<kind>-<slug>.png at 1200x630.
 *
 * Templates (each rendered in EN and ES; -es suffix for Spanish variant):
 *   meeting-{slug}[-es]   Board meeting detail card
 *   school-{slug}[-es]    Per-school card (12 schools)
 *   charter-{slug}[-es]   Charter school card (3 charters)
 *   blog-{slug}           Blog post card (ES posts have their own ES slug)
 *   page-{name}[-es]      Top-level page (home, meetings, schools, district, budget, blog)
 *
 * Caching: skips regeneration if the output PNG is newer than this script
 * AND newer than the upstream data file.
 *
 * Usage:
 *   node scripts/generate-og-images.mjs              # all out-of-date images
 *   node scripts/generate-og-images.mjs --force      # regenerate everything
 *   node scripts/generate-og-images.mjs --kind meeting --slug 2026-05-13-regular
 */

import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, 'artifacts/og');
const FONT_DIR = resolve(ROOT, 'node_modules/@fontsource');

const PALETTE = {
  green: '#1a3a2a',
  cream: '#faf8f4',
  creamDim: 'rgba(250, 248, 244, 0.78)',
  creamFaint: 'rgba(250, 248, 244, 0.45)',
  amber: '#c4842d',
  amberLight: '#f0d9a8',
};

// ---- font loading (satori supports OTF/TTF/WOFF, not WOFF2) ----

function loadFont(family, weight) {
  const dir = family === 'IBM Plex Mono' ? 'ibm-plex-mono' : family.toLowerCase();
  const stem = dir;
  const path = resolve(FONT_DIR, dir, 'files', `${stem}-latin-${weight}-normal.woff`);
  return { name: family, data: readFileSync(path), weight, style: 'normal' };
}

const FONTS = [
  loadFont('Fraunces', 400),
  loadFont('Fraunces', 600),
  loadFont('Fraunces', 700),
  loadFont('IBM Plex Mono', 400),
  loadFont('IBM Plex Mono', 500),
];

// ---- localization ----
//
// Sixth-grade Californian Spanish — prefer colloquial / borrowed English
// terms over literary Spanish (e.g. "blog" not "bitácora"). Matches
// established RCSD-family voice on the rest of the site.

const STRINGS = {
  en: {
    tagline: 'Open Data',
    district: 'Redwood City School District',
    rcsdShort: 'RCSD',
    meetingTitles: {
      'Regular': { headline: 'Board of Trustees', sub: 'Regular Meeting' },
      'Special': { headline: 'Special Session', sub: '' },
      'Special (Closed)': { headline: 'Closed Session', sub: '' },
      'Retreat (Offsite)': { headline: 'Board Retreat', sub: 'Offsite' },
      'Workshop': { headline: 'Workshop', sub: '' },
      'Study Session': { headline: 'Study Session', sub: '' },
      _default: { headline: 'Board Meeting', sub: '' },
    },
    plannedMins: (h, m) => h ? (m ? `${h}h ${m}m planned` : `${h}h planned`) : `${m}m planned`,
    agendaItems: n => `${n} agenda items`,
    videoTranscript: 'Video + Transcript',
    video: 'Video',
    liveZoom: 'Live on Zoom',
    grades: span => `Grades ${span.replace(/^Grades?\s+/i, '')}`,
    principal: name => `Principal ${name}`,
    students: n => `${n} students`,
    highNeed: pct => `${pct}% high-need`,
    charterEyebrow: 'CHARTER SCHOOL',
    schoolEyebrowFallback: 'REDWOOD CITY SCHOOL DISTRICT',
    dateLocale: 'en-US',
  },
  es: {
    tagline: 'Datos Abiertos',
    district: 'Distrito Escolar de Redwood City',
    rcsdShort: 'RCSD',
    meetingTitles: {
      'Regular': { headline: 'Junta de Síndicos', sub: 'Reunión Regular' },
      'Special': { headline: 'Sesión Especial', sub: '' },
      'Special (Closed)': { headline: 'Sesión Cerrada', sub: '' },
      'Retreat (Offsite)': { headline: 'Retiro de la Junta', sub: 'Fuera del distrito' },
      'Workshop': { headline: 'Taller', sub: '' },
      'Study Session': { headline: 'Sesión de Estudio', sub: '' },
      _default: { headline: 'Reunión de la Junta', sub: '' },
    },
    plannedMins: (h, m) => h ? (m ? `${h}h ${m}m planeado` : `${h}h planeado`) : `${m}m planeado`,
    agendaItems: n => `${n} puntos en la agenda`,
    videoTranscript: 'Video + Transcripción',
    video: 'Video',
    liveZoom: 'En vivo por Zoom',
    grades: span => `Grados ${span.replace(/^Grados?\s+/i, '').replace(/^Grades?\s+/i, '')}`,
    principal: name => `Director(a) ${name}`,
    students: n => `${n} estudiantes`,
    highNeed: pct => `${pct}% alta necesidad`,
    charterEyebrow: 'ESCUELA AUTÓNOMA (CHARTER)',
    schoolEyebrowFallback: 'DISTRITO ESCOLAR DE REDWOOD CITY',
    dateLocale: 'es-MX', // Mexican Spanish — most common Californian variant
  },
};

// ---- shared layout helpers ----
//
// In Satori, every container that holds laid-out children must have
// display: 'flex'. Single-text divs ("flex item with text") work as
// flex items themselves and inherit normal text rendering.

function el(style, children) {
  return { type: 'div', props: { style: { display: 'flex', ...style }, children } };
}

function row(style, children) {
  return el({ flexDirection: 'row', ...style }, children);
}

function col(style, children) {
  return el({ flexDirection: 'column', ...style }, children);
}

function text(style, children) {
  return { type: 'div', props: { style, children } };
}

// ---- pieces ----

function frame(children) {
  return col({
    width: '1200px',
    height: '630px',
    background: PALETTE.green,
    color: PALETTE.cream,
    fontFamily: 'Fraunces',
    padding: '60px 72px 0 72px',
    position: 'relative',
  }, children);
}

function eyebrow(s) {
  return text({
    fontFamily: 'IBM Plex Mono',
    fontSize: 22,
    fontWeight: 500,
    letterSpacing: 4,
    textTransform: 'uppercase',
    color: PALETTE.amberLight,
  }, s);
}

function headline(s, fontSize) {
  return text({
    fontFamily: 'Fraunces',
    fontWeight: 700,
    fontSize,
    lineHeight: 1.04,
    letterSpacing: -1.5,
    color: PALETTE.cream,
    marginTop: 14,
  }, s);
}

function subhead(s) {
  return text({
    fontFamily: 'Fraunces',
    fontWeight: 400,
    fontSize: 30,
    lineHeight: 1.25,
    color: PALETTE.creamDim,
    marginTop: 10,
  }, s);
}

function rule(width = 200, mt = 26, mb = 0, color = PALETTE.amber) {
  return el({ width, height: 3, background: color, marginTop: mt, marginBottom: mb });
}

function bullets(items, opts = {}) {
  return col({ gap: 10, marginTop: 22 }, items.slice(0, 3).map(s =>
    row({ gap: 14, alignItems: 'baseline' }, [
      text({ color: PALETTE.amber, fontFamily: 'Fraunces', fontWeight: 700, fontSize: 28 }, '•'),
      text({
        fontFamily: 'Fraunces', fontSize: 26, lineHeight: 1.3,
        color: PALETTE.cream, ...(opts.style || {}),
      }, s),
    ])
  ));
}

function badges(parts) {
  const children = [];
  parts.forEach((p, i) => {
    children.push(text({ color: PALETTE.creamDim }, p));
    if (i < parts.length - 1) {
      children.push(text({ color: PALETTE.amber, padding: '0 14px' }, '·'));
    }
  });
  return row({
    fontFamily: 'IBM Plex Mono',
    fontSize: 21,
    fontWeight: 500,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    marginTop: 26,
    alignItems: 'baseline',
  }, children);
}

function footer(lang = 'en') {
  const S = STRINGS[lang] || STRINGS.en;
  return col({
    position: 'absolute',
    bottom: 48,
    left: 72,
    right: 72,
  }, [
    el({ width: 1056, height: 2, background: PALETTE.amber, marginBottom: 16 }),
    row({
      justifyContent: 'space-between',
      alignItems: 'baseline',
      fontFamily: 'IBM Plex Mono',
      fontSize: 21,
      letterSpacing: 1.8,
    }, [
      row({ gap: 14, alignItems: 'baseline' }, [
        text({ color: PALETTE.cream, fontWeight: 500 }, 'rcsd.info'),
        text({ color: PALETTE.amber }, '—'),
        text({
          color: PALETTE.creamDim,
          textTransform: 'uppercase',
          letterSpacing: 3,
        }, S.tagline),
      ]),
      text({
        color: PALETTE.creamFaint,
        fontSize: 17,
        letterSpacing: 1.5,
      }, S.district),
    ]),
  ]);
}

// ---- helpers ----

function fitHeadline(s, max = 72, min = 44) {
  // Choose a font size that lets the line fit the 1056px content width.
  // Rough Fraunces 700 measure: ~0.55em per char average.
  const avg = 0.55;
  const widthAt = px => s.length * px * avg;
  const targetWidth = 1056;
  // Try sizes from max down to min in 4pt steps
  for (let px = max; px >= min; px -= 4) {
    if (widthAt(px) <= targetWidth) return px;
  }
  return min;
}

// Split a comma-separated topic string into short bullets, respecting
// nested parentheses (so "EV chargers (Hoover, Roy Cloud)" stays as one).
function splitTopics(s, maxBullets = 3, maxLen = 56) {
  if (!s) return [];
  const out = [];
  let buf = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      const item = buf.trim();
      if (item) out.push(item);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  // Truncate each at a word boundary; prefer the headline / lead clause
  return out.slice(0, maxBullets).map(t => {
    if (t.length <= maxLen) return t;
    const cut = t.slice(0, maxLen);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > 30 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\-—\s]+$/, '') + '…';
  });
}

// ---- per-template renderers ----

function meetingTemplate({ date, type, topics, items, planned, hasVideo, hasZoom, hasTranscript, lang = 'en' }) {
  const S = STRINGS[lang] || STRINGS.en;
  const dateObj = new Date(date + 'T12:00:00');
  const dateStr = dateObj.toLocaleDateString(S.dateLocale, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).toUpperCase();

  const titles = S.meetingTitles[type] || S.meetingTitles._default;
  const title = titles.headline;
  const subParts = [];
  if (titles.sub) subParts.push(titles.sub);
  if (planned) {
    const h = Math.floor(planned / 60);
    const m = planned % 60;
    subParts.push(S.plannedMins(h, m));
  }

  const topicList = Array.isArray(topics) ? topics : [topics];
  const topicString = topicList.filter(Boolean).join(', ');
  const bulletItems = splitTopics(topicString);

  const badgeParts = [];
  if (items) badgeParts.push(S.agendaItems(items));
  if (hasVideo) badgeParts.push(hasTranscript ? S.videoTranscript : S.video);
  else if (hasZoom) badgeParts.push(S.liveZoom);

  return frame([
    eyebrow(dateStr),
    headline(title, fitHeadline(title, 72, 56)),
    subParts.length ? subhead(subParts.join(' · ')) : null,
    rule(220),
    bulletItems.length ? bullets(bulletItems) : null,
    badgeParts.length ? badges(badgeParts) : null,
    footer(lang),
  ].filter(Boolean));
}

function schoolTemplate({ name, gradeSpan, program, enrollment, highNeedPct, principal, isCharter = false, lang = 'en' }) {
  const S = STRINGS[lang] || STRINGS.en;
  let eyebrowText;
  if (isCharter) eyebrowText = S.charterEyebrow;
  else if (program) eyebrowText = program.toUpperCase();
  else eyebrowText = S.schoolEyebrowFallback;

  const subParts = [];
  if (gradeSpan) subParts.push(S.grades(gradeSpan));
  if (principal) subParts.push(S.principal(principal));

  const badgeParts = [];
  if (enrollment) badgeParts.push(S.students(enrollment));
  if (highNeedPct != null) badgeParts.push(S.highNeed(highNeedPct));
  badgeParts.push('rcsdk8.net');

  return frame([
    eyebrow(eyebrowText),
    headline(name, fitHeadline(name, 88, 52)),
    subParts.length ? subhead(subParts.join(' · ')) : null,
    rule(220),
    badges(badgeParts),
    footer(lang),
  ].filter(Boolean));
}

function blogTemplate({ title, date, excerpt, lang = 'en' }) {
  const S = STRINGS[lang] || STRINGS.en;
  const dateStr = date
    ? new Date(date + 'T12:00:00').toLocaleDateString(S.dateLocale, {
        month: 'long', day: 'numeric', year: 'numeric',
      }).toUpperCase()
    : (lang === 'es' ? 'NOTAS DE RCSD.INFO' : 'NOTES FROM RCSD.INFO');
  return frame([
    eyebrow(dateStr),
    headline(title, fitHeadline(title, 72, 44)),
    rule(220),
    excerpt ? subhead(excerpt.length > 200 ? excerpt.slice(0, 197) + '…' : excerpt) : null,
    footer(lang),
  ].filter(Boolean));
}

function pageTemplate({ kicker, title, tagline, badgeParts = [], lang = 'en' }) {
  return frame([
    eyebrow(kicker),
    headline(title, fitHeadline(title, 96, 56)),
    tagline ? subhead(tagline) : null,
    rule(220),
    badgeParts.length ? badges(badgeParts) : null,
    footer(lang),
  ].filter(Boolean));
}

// ---- catalog builders ----

function loadMeetingsCatalog() {
  const path = resolve(ROOT, 'data/meetings-data.json');
  const data = JSON.parse(readFileSync(path, 'utf-8'));
  const out = [];
  for (const m of data.meetings) {
    const props = {
      date: m.date,
      type: m.type,
      topics: m.topics || [],
      items: (m.items || []).filter(it => !it.isSection).length,
      planned: (m.items || []).reduce((s, it) => s + (it.plannedMinutes || 0), 0) || null,
      hasVideo: !!m.youtube,
      hasZoom: !!m.zoom,
      hasTranscript: m.hasTranscript,
    };
    for (const lang of ['en', 'es']) {
      const suffix = lang === 'es' ? '-es' : '';
      out.push({
        slug: `${m.slug}${suffix}`,
        sources: [path],
        render: () => meetingTemplate({ ...props, lang }),
        output: resolve(OUT_DIR, `meeting-${m.slug}${suffix}.png`),
      });
    }
  }
  return out;
}

function loadSchoolsCatalog() {
  const out = [];
  const schoolsPath = resolve(ROOT, 'data/schools.json');
  const chartersPath = resolve(ROOT, 'data/charters.json');

  if (existsSync(schoolsPath)) {
    const schools = JSON.parse(readFileSync(schoolsPath, 'utf-8')).schools || [];
    for (const s of schools) {
      if (!s.slug) continue;
      // School program label is bilingual ("Spanish · Español") — pick the half matching the lang.
      const splitProgram = s.program ? s.program.split('·').map(t => t.trim()) : [];
      const programEn = splitProgram[0] || null;
      const programEs = splitProgram[1] || splitProgram[0] || null;
      for (const lang of ['en', 'es']) {
        const suffix = lang === 'es' ? '-es' : '';
        out.push({
          slug: `${s.slug}${suffix}`,
          sources: [schoolsPath],
          render: () => schoolTemplate({
            name: (lang === 'es' && s.nameEs) ? s.nameEs : (s.nameShort || s.name || s.slug),
            gradeSpan: s.grades || null,
            program: lang === 'es' ? programEs : programEn,
            enrollment: s.enrollment || null,
            highNeedPct: s.highNeedPct ?? null,
            principal: s.principal || null,
            isCharter: false,
            lang,
          }),
          output: resolve(OUT_DIR, `school-${s.slug}${suffix}.png`),
        });
      }
    }
  }

  if (existsSync(chartersPath)) {
    const charters = JSON.parse(readFileSync(chartersPath, 'utf-8')).charters || [];
    for (const c of charters) {
      if (!c.slug) continue;
      const leader = Array.isArray(c.schoolLeaders) && c.schoolLeaders.length
        ? c.schoolLeaders[0].name : null;
      for (const lang of ['en', 'es']) {
        const suffix = lang === 'es' ? '-es' : '';
        out.push({
          slug: `${c.slug}${suffix}`,
          sources: [chartersPath],
          render: () => schoolTemplate({
            name: (lang === 'es' && c.nameEs) ? c.nameEs : (c.nameShort || c.name || c.slug),
            gradeSpan: c.grades || null,
            program: null,
            isCharter: true,
            enrollment: c.enrollment || null,
            highNeedPct: null,
            principal: leader,
            lang,
          }),
          output: resolve(OUT_DIR, `charter-${c.slug}${suffix}.png`),
        });
      }
    }
  }
  return out;
}

function loadBlogCatalog() {
  // Blog posts have separate per-language slugs (e.g. "open-data-for-rcsd"
  // vs "datos-abiertos-para-rcsd") — so the filename already carries the
  // language signal. No -es suffix needed here; the right card is selected
  // by the page builder via ogImageKey: `blog-${slug}`.
  const path = resolve(ROOT, 'data/blog-posts.json');
  if (!existsSync(path)) return [];
  const posts = JSON.parse(readFileSync(path, 'utf-8'));
  const out = [];
  for (const p of posts) {
    if (p.slug && p.title?.en) {
      out.push({
        slug: p.slug,
        sources: [path],
        render: () => blogTemplate({ title: p.title.en, date: p.date, excerpt: p.description?.en, lang: 'en' }),
        output: resolve(OUT_DIR, `blog-${p.slug}.png`),
      });
    }
    if (p.slugEs && p.title?.es) {
      out.push({
        slug: p.slugEs,
        sources: [path],
        render: () => blogTemplate({ title: p.title.es, date: p.date, excerpt: p.description?.es, lang: 'es' }),
        output: resolve(OUT_DIR, `blog-${p.slugEs}.png`),
      });
    }
  }
  return out;
}

// One entry per top-level page, with EN and ES copy. The page-builder
// chooses which to reference via ogImageKey.
const TOP_LEVEL_PAGES = [
  {
    name: 'home',
    en: {
      kicker: 'RCSD · OPEN DATA',
      title: 'Redwood City School District',
      tagline: 'Public records, board meetings, and school data — searchable and translated.',
      badgeParts: ['200+ meetings', '15 schools', 'EN · ES'],
    },
    es: {
      kicker: 'RCSD · DATOS ABIERTOS',
      title: 'Distrito Escolar de Redwood City',
      tagline: 'Documentos públicos, reuniones de la junta y datos de las escuelas — todo en un sitio.',
      badgeParts: ['200+ reuniones', '15 escuelas', 'EN · ES'],
    },
  },
  {
    name: 'meetings',
    en: {
      kicker: 'BOARD OF TRUSTEES',
      title: 'Meetings & Minutes',
      tagline: 'Every board meeting since 2020 — agendas, minutes, and AI-assisted transcripts.',
      badgeParts: ['200+ meetings', '8,000 agenda items'],
    },
    es: {
      kicker: 'JUNTA DE SÍNDICOS',
      title: 'Reuniones y Actas',
      tagline: 'Todas las reuniones de la junta desde 2020 — con agendas, actas y transcripciones.',
      badgeParts: ['200+ reuniones', '8,000 puntos de agenda'],
    },
  },
  {
    name: 'schools',
    en: {
      kicker: 'SCHOOLS',
      title: 'Schools at a Glance',
      tagline: 'Enrollment, demographics, programs, and contact info for every RCSD school.',
      badgeParts: ['12 RCSD + 3 Charter', 'TK – 8'],
    },
    es: {
      kicker: 'ESCUELAS',
      title: 'Las Escuelas en Resumen',
      tagline: 'Inscripción, demografía, programas e información de contacto de cada escuela.',
      badgeParts: ['12 RCSD + 3 Charter', 'TK – 8'],
    },
  },
  {
    name: 'district',
    en: {
      kicker: 'GOVERNANCE',
      title: 'District & Board',
      tagline: 'Trustees, policies, leadership, and the bodies that run RCSD.',
    },
    es: {
      kicker: 'GOBERNANZA',
      title: 'El Distrito y la Junta',
      tagline: 'Síndicos, pólizas, liderazgo y los organismos que dirigen RCSD.',
    },
  },
  {
    name: 'vendors',
    en: {
      kicker: 'DISTRICT SPENDING',
      title: 'Vendor Spending',
      tagline: 'Every check the district has written since 2020 — searchable by vendor and fiscal year.',
      badgeParts: ['$560M tracked', '76 warrant registers'],
    },
    es: {
      kicker: 'GASTOS DEL DISTRITO',
      title: 'Gastos a Proveedores',
      tagline: 'Cada cheque que el distrito ha emitido desde 2020 — por proveedor y año fiscal.',
      badgeParts: ['$560M registrados', '76 registros de cheques'],
    },
  },
  {
    name: 'budget',
    en: {
      kicker: 'FINANCE',
      title: 'District Budget',
      tagline: 'Where the money comes from and where it goes — with sources cited.',
    },
    es: {
      kicker: 'FINANZAS',
      title: 'Presupuesto del Distrito',
      tagline: 'De dónde viene el dinero y a dónde va — con fuentes citadas.',
    },
  },
  {
    name: 'blog',
    en: {
      kicker: 'NOTES',
      title: 'Blog',
      tagline: 'Notes on data, methodology, and what we are learning building this site.',
    },
    es: {
      kicker: 'NOTAS',
      title: 'Blog',
      tagline: 'Notas sobre los datos, la metodología y lo que vamos aprendiendo en este sitio.',
    },
  },
  {
    name: 'committees',
    en: {
      kicker: 'GOVERNANCE · OVERSIGHT',
      title: 'Committees',
      tagline: 'District and school committees — meetings, members, and recordings where available.',
      badgeParts: ['CBOC', 'DELAC', 'Video + Transcript'],
    },
    es: {
      kicker: 'GOBERNANZA · SUPERVISIÓN',
      title: 'Comités',
      tagline: 'Comités del distrito y de las escuelas — reuniones, miembros y grabaciones cuando hay.',
      badgeParts: ['CBOC', 'DELAC', 'Video + Transcripción'],
    },
  },
];

// Per-committee home card (page-<id>) and per-recorded-meeting card (<transcriptKey>).
function committeeHomeTemplate({ committee, lang }) {
  const name = lang === 'es' ? committee.nameEs : committee.nameEn;
  const desc = (lang === 'es' ? committee.descriptionEs : committee.descriptionEn) || '';
  const kicker = (committee.scope === 'school' ? 'SCHOOL COMMITTEE' : 'DISTRICT COMMITTEE');
  return frame([
    eyebrow(lang === 'es' ? (committee.scope === 'school' ? 'COMITÉ ESCOLAR' : 'COMITÉ DEL DISTRITO') : kicker),
    headline(name, fitHeadline(name, 88, 48)),
    desc ? subhead(desc.slice(0, 140)) : null,
    rule(220),
    footer(lang),
  ].filter(Boolean));
}

function committeeMeetingTemplate({ committee, date, duration, lang }) {
  const S = STRINGS[lang] || STRINGS.en;
  const name = lang === 'es' ? committee.nameEs : committee.nameEn;
  const dateStr = new Date(date + 'T12:00:00').toLocaleDateString(S.dateLocale, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).toUpperCase();
  const badgeParts = [duration, lang === 'es' ? 'Video + Transcripción' : 'Video + Transcript'].filter(Boolean);
  return frame([
    eyebrow(dateStr),
    headline(name, fitHeadline(name, 72, 44)),
    rule(220),
    badges(badgeParts),
    footer(lang),
  ].filter(Boolean));
}

function loadCommitteesCatalog() {
  const dir = resolve(ROOT, 'data/committees');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const path = resolve(dir, file);
    const c = JSON.parse(readFileSync(path, 'utf-8'));
    for (const lang of ['en', 'es']) {
      const suffix = lang === 'es' ? '-es' : '';
      out.push({
        slug: `page-${c.id}${suffix}`,
        sources: [path],
        render: () => committeeHomeTemplate({ committee: c, lang }),
        output: resolve(OUT_DIR, `page-${c.id}${suffix}.png`),
      });
      for (const m of (c.meetings || [])) {
        if (!m.youtube) continue;
        const key = m.transcriptKey || `${c.id}-${m.date}`;
        out.push({
          slug: `${key}${suffix}`,
          sources: [path],
          render: () => committeeMeetingTemplate({ committee: c, date: m.date, duration: m.duration, lang }),
          output: resolve(OUT_DIR, `${key}${suffix}.png`),
        });
      }
    }
  }
  return out;
}

function loadPagesCatalog() {
  const out = [];
  for (const p of TOP_LEVEL_PAGES) {
    for (const lang of ['en', 'es']) {
      const suffix = lang === 'es' ? '-es' : '';
      const copy = p[lang];
      out.push({
        slug: `${p.name}${suffix}`,
        sources: [],
        render: () => pageTemplate({ ...copy, lang }),
        output: resolve(OUT_DIR, `page-${p.name}${suffix}.png`),
      });
    }
  }
  return out;
}

// ---- render pipeline ----

async function renderPNG(node, outputPath) {
  const svg = await satori(node, { width: 1200, height: 630, fonts: FONTS });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, png);
}

function isUpToDate(outputPath, sources) {
  if (!existsSync(outputPath)) return false;
  const outMtime = statSync(outputPath).mtimeMs;
  if (statSync(__filename).mtimeMs > outMtime) return false;
  for (const src of sources) {
    if (existsSync(src) && statSync(src).mtimeMs > outMtime) return false;
  }
  return true;
}

// ---- main ----

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const kindFilter = args.find((_, i) => args[i - 1] === '--kind');
  const slugFilter = args.find((_, i) => args[i - 1] === '--slug');

  const catalogs = [
    { kind: 'meeting', items: loadMeetingsCatalog() },
    { kind: 'school',  items: loadSchoolsCatalog() },
    { kind: 'blog',    items: loadBlogCatalog() },
    { kind: 'committee', items: loadCommitteesCatalog() },
    { kind: 'page',    items: loadPagesCatalog() },
  ];

  let generated = 0, skipped = 0, failed = 0;
  for (const { kind, items } of catalogs) {
    if (kindFilter && kindFilter !== kind) continue;
    for (const it of items) {
      if (slugFilter && it.slug !== slugFilter) continue;
      if (!force && isUpToDate(it.output, it.sources)) {
        skipped++;
        continue;
      }
      try {
        await renderPNG(it.render(), it.output);
        generated++;
        if (generated % 25 === 0) console.log(`  ${generated} generated...`);
      } catch (e) {
        failed++;
        console.warn(`  FAIL ${kind} ${it.slug}: ${e.message}`);
      }
    }
  }
  console.log(`OG images: ${generated} generated, ${skipped} cached, ${failed} failed`);
  console.log(`Output: ${OUT_DIR}`);
}

main().catch(e => { console.error(e); process.exit(1); });
