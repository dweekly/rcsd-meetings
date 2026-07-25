#!/usr/bin/env node
/**
 * Generate individual school pages at docs/schools/{slug}/index.html
 * and Spanish versions at docs/escuelas/{slug}/index.html.
 *
 * Data hardcoded from:
 *   - data/schools.json (directory info)
 *   - 2024-25 SARCs (CAASPP proficiency, demographics, staffing credentials)
 *   - 2025-26 SPSAs (site budgets, funding sources)
 *   - 2025-26 LCAP and school-level board presentations (student outcomes)
 *
 * NOTE (2026-04-22): the `growth` field on each school is currently unverified.
 * The original numbers were copied from a local working doc that was never
 * checked in, and the labeling as "CDE Growth Model" is incorrect — the
 * district's LCAP-tracked growth metric is i-Ready Expected Growth, not CAASPP.
 * See ROADMAP.md "Data Attribution" for the rebuild plan.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { headMeta, siteNav, siteFooter } from './html-parts.mjs';
import { charterSummaries } from './build-charters.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---- Read JPEG/PNG height from file header ----
function jpegHeight(filePath) {
  try {
    const buf = readFileSync(filePath);
    for (let i = 0; i < buf.length - 9; i++) {
      if (buf[i] === 0xFF && (buf[i + 1] === 0xC0 || buf[i + 1] === 0xC2)) {
        return buf.readUInt16BE(i + 5);
      }
    }
  } catch { /* fall through */ }
  return 400; // fallback
}

// ---- School logo dimensions (all 1200px wide, heights from R2 originals) ----
const LOGO_DIMS = {
  'adelante-selby': { w: 1200, h: 450 },
  'clifford':       { w: 1200, h: 494 },
  'garfield':       { w: 1200, h: 434 },
  'henry-ford':     { w: 1200, h: 500 },
  'hoover':         { w: 1200, h: 444 },
  'kennedy':        { w: 1200, h: 462 },
  'mckinley-mit':   { w: 1200, h: 372 },
  'north-star':     { w: 1200, h: 451 },
  'orion':          { w: 1200, h: 424 },
  'roosevelt':      { w: 1200, h: 424 },
  'roy-cloud':      { w: 1200, h: 421 },
  'taft':           { w: 1200, h: 400 },
};

// ---- Load schools.json for base directory data ----
const schoolsData = JSON.parse(readFileSync(resolve(ROOT, 'data/schools.json'), 'utf-8'));

// ---- Load properties.json (district-owned properties that aren't schools/charters) ----
let propertiesData = { properties: [] };
try {
  propertiesData = JSON.parse(readFileSync(resolve(ROOT, 'data/properties.json'), 'utf-8'));
} catch {
  console.warn('data/properties.json not found — district properties section will be empty');
}

// ---- Load SARC data (expenditures per pupil) ----
const SARC_DATA = {};
for (const school of schoolsData.schools) {
  const sarcPath = resolve(ROOT, 'data/sarc', `${school.slug}.json`);
  if (existsSync(sarcPath)) {
    SARC_DATA[school.slug] = JSON.parse(readFileSync(sarcPath, 'utf-8'));
  }
}

// ---- Compute district average per-pupil expenditure from SARC data ----
const sarcSlugs = Object.keys(SARC_DATA);
const DISTRICT_AVG_PER_PUPIL = sarcSlugs.length > 0
  ? Math.round(sarcSlugs.reduce((s, k) => s + (SARC_DATA[k].expenditures?.schoolSite?.totalPerPupil || 0), 0) / sarcSlugs.length)
  : 0;

// ---- Load SpEd data ----
const SPED_ENROLLMENT = (() => { try { return JSON.parse(readFileSync(resolve(ROOT, 'data/sped-enrollment.json'), 'utf-8')); } catch { return {}; } })();
const SPED_CATEGORIES = (() => { try { return JSON.parse(readFileSync(resolve(ROOT, 'data/sped-categories.json'), 'utf-8')); } catch { return {}; } })();
const SSC_DATA = (() => { try { return JSON.parse(readFileSync(resolve(ROOT, 'data/ssc-membership.json'), 'utf-8')); } catch { return {}; } })();
const SSC_MEETINGS = (() => { try { return JSON.parse(readFileSync(resolve(ROOT, 'data/ssc-meetings.json'), 'utf-8')); } catch { return {}; } })();

// ---- Load CDE data ----
const CDE_ABSENT = (() => { try { return JSON.parse(readFileSync(resolve(ROOT, 'data/cde/absenteeism-2024-25.json'), 'utf-8')); } catch { return {}; } })();
const CDE_LTEL = (() => { try { return JSON.parse(readFileSync(resolve(ROOT, 'data/cde/ltel-2024-25.json'), 'utf-8')); } catch { return {}; } })();
const CDE_STAFF_ETH = (() => { try { return JSON.parse(readFileSync(resolve(ROOT, 'data/cde/staff-ethnicity-2024-25.json'), 'utf-8')); } catch { return {}; } })();
const CDE_STAFF_EXP = (() => { try { return JSON.parse(readFileSync(resolve(ROOT, 'data/cde/staff-experience-2024-25.json'), 'utf-8')); } catch { return {}; } })();
const CDE_RATIOS = (() => { try { return JSON.parse(readFileSync(resolve(ROOT, 'data/cde/staff-ratios-2024-25.json'), 'utf-8')); } catch { return {}; } })();


// i-Ready Expected Growth data, extracted from each school's 25-26 Board of
// Trustees data presentation PDF. See scripts/extract-ireadyu-growth.mjs.
// Schools without a 25-26 presentation yet have a pending-status record.
const IREADYU_DATA = (() => {
  const out = {};
  try {
    const dir = resolve(ROOT, 'data/ireadyu-growth');
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json') || f.startsWith('_')) continue;
      out[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(resolve(dir, f), 'utf-8'));
    }
  } catch { /* missing dir -> empty */ }
  return out;
})();

// District-wide i-Ready Expected Growth from 2025-26 LCAP Mid-Year Report
// (data.rcsd.info/board-packets/2026-02-11/Mid-year-LCAP-2025-2026-1.pdf, p.22-23).
const DISTRICT_IREADYU = {
  reading: 60.7,
  math: 56.4,
  year: '2025-26 Winter',
  pdfUrl: 'https://data.rcsd.info/board-packets/2026-02-11/Mid-year-LCAP-2025-2026-1.pdf',
};

const ABSENT_LABELS = {
  TA: 'All Students', RH: 'Hispanic/Latino', RW: 'White', RA: 'Asian',
  RB: 'African American', RF: 'Filipino', RI: 'American Indian', RP: 'Pacific Islander',
  RT: 'Two or More Races', RD: 'Not Reported',
  SE: 'English Learners', SD: 'Students with Disabilities',
  SS: 'Socioeconomically Disadvantaged', SH: 'Homeless', SF: 'Foster Youth', SM: 'Migrant',
  GF: 'Female', GM: 'Male', GX: 'Non-Binary',
};
const ABSENT_LABELS_ES = {
  TA: 'Todos los Estudiantes', RH: 'Hispano/Latino', RW: 'Blanco', RA: 'Asiático',
  RB: 'Afroamericano', RF: 'Filipino', RI: 'Indígena Americano', RP: 'Isleño del Pacífico',
  RT: 'Dos o Más Razas', RD: 'No Reportado',
  SE: 'Estudiantes de Inglés', SD: 'Estudiantes con Discapacidades',
  SS: 'Desventaja Socioeconómica', SH: 'Sin Hogar', SF: 'Jóvenes de Crianza', SM: 'Migrante',
  GF: 'Femenino', GM: 'Masculino', GX: 'No Binario',
};

// Compute district-wide SpEd averages
const districtSpedPct = SPED_ENROLLMENT.district
  ? (() => {
      const totalEnroll = Object.values(SPED_ENROLLMENT.schools || {}).reduce((s, sc) => s + (sc.totalEnrollment || 0), 0);
      const totalIep = SPED_ENROLLMENT.district.total || 0;
      return totalEnroll > 0 ? Math.round(totalIep / totalEnroll * 1000) / 10 : 0;
    })()
  : 0;
const districtInclusionPct = SPED_CATEGORIES.district?.placement
  ? Math.round(SPED_CATEGORIES.district.placement.regularGt80 / SPED_CATEGORIES.district.placement.total * 1000) / 10
  : 0;

// ---- CSSP (Comprehensive School Safety Plan) 2025-26 — board-approved Feb 4, 2026 ----
const CSSP_URLS = {
  'adelante-selby': 'https://data.rcsd.info/board-packets/2026-02-04/2025_Comprehensive_School_Safety_Plan-_Pt._1_-Public-_Adelante_Selby_Spanish_Imm.pdf',
  'clifford': 'https://data.rcsd.info/board-packets/2026-02-04/2025_Comprehensive_School_Safety_Plan-_Pt._1_-Public-_Clifford_Elementary_School.pdf',
  'garfield': 'https://data.rcsd.info/board-packets/2026-02-04/2025_Comprehensive_School_Safety_Plan__Pt._1_-Public-_Garfield_Elementary_School.pdf',
  'henry-ford': 'https://data.rcsd.info/board-packets/2026-02-04/2025_Comprehensive_School_Safety_Plan-_Pt._1_-Public-_Henry_Ford_Elementary_Scho.pdf',
  'hoover': 'https://data.rcsd.info/board-packets/2026-02-04/2025_Comprehensive_School_Safety_Plan-_Pt._1_-Public-_Hoover_Community_School_20.pdf',
  'kennedy': 'https://data.rcsd.info/board-packets/2026-02-04/2025_Comprehensive_School_Safety_Plan__Pt._1_-Public-_John_F._Kennedy_Middle_Sch.pdf',
  'mckinley-mit': 'https://data.rcsd.info/board-packets/2026-02-04/2025_Comprehensive_School_Safety_Plan-_Pt._1_-Public-_McKinley_Institute_of_Tech.pdf',
  'north-star': 'https://data.rcsd.info/board-packets/2026-02-04/2025_Comprehensive_School_Safety_Plan-_Pt._1_-Public-_North_Star_Academy_2026012.pdf',
  'orion': 'https://data.rcsd.info/board-packets/2026-02-04/2025_Comprehensive_School_Safety_Plan__Pt._1_-Public-_Orion_Alternative_School_2.pdf',
  'roosevelt': 'https://data.rcsd.info/board-packets/2026-02-04/2025_Comprehensive_School_Safety_Plan-_Pt._1_-Public-_Roosevelt_Elementary_Schoo.pdf',
  'roy-cloud': 'https://data.rcsd.info/board-packets/2026-02-04/2025_Comprehensive_School_Safety_Plan__Pt._1_-Public-_Roy_Cloud_Elementary_Schoo.pdf',
  'taft': 'https://data.rcsd.info/board-packets/2026-02-04/2025_Comprehensive_School_Safety_Plan__Pt._1_-Public-_Taft_Elementary_School_202.pdf',
};

// ---- School board site presentations (last 3 years per school) ----
// Built by scripts/build-site-presentations.mjs from data/document-index.json;
// each school's decks are an array sorted newest school-year first, every
// pdfUrl mirrored to R2 (data.rcsd.info). See data/site-presentations.json.
const SITE_PRESENTATIONS = (() => {
  try { return JSON.parse(readFileSync(resolve(ROOT, 'data/site-presentations.json'), 'utf-8')).schools; }
  catch { return {}; }
})();

// ---- Load board meeting summaries (concise per-school EN/ES) ----
const BOARD_SUMMARIES = (() => { try { return JSON.parse(readFileSync(resolve(ROOT, 'data/school-board-summaries.json'), 'utf-8')); } catch { return {}; } })();

// ---- Load board meeting items and match to schools ----
const R2_BASE = 'https://data.rcsd.info';
const meetingsData = JSON.parse(readFileSync(resolve(ROOT, 'data/meetings-data.json'), 'utf-8'));
const timestampMap = (() => { try { return JSON.parse(readFileSync(resolve(ROOT, 'data/timestamp-map.json'), 'utf-8')); } catch { return {}; } })();
const agendaAttachments = (() => { try { return JSON.parse(readFileSync(resolve(ROOT, 'data/agenda-attachments.json'), 'utf-8')); } catch { return {}; } })();

// Build AID → R2 path lookup from board-memo JSON files
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
} catch {}

// Build AID → Simbli URL lookup from agenda-attachments.json
const aidToSimbliUrl = {};
for (const [, entry] of Object.entries(agendaAttachments)) {
  const atts = entry.attachments || entry;
  if (Array.isArray(atts)) {
    for (const att of atts) {
      if (att.aid && att.url) aidToSimbliUrl[att.aid] = att.url;
    }
  }
}

function attachmentUrl(aid) {
  if (aidToR2Path[aid]) return `${R2_BASE}/${aidToR2Path[aid]}`;
  if (aidToSimbliUrl[aid]) return aidToSimbliUrl[aid];
  return `https://simbli.eboardsolutions.com//Meetings/Attachment.aspx?S=36030397&AID=${aid}`;
}

// School name patterns for matching agenda item titles
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

function matchSchoolSlugs(title) {
  // Exclude false positive: "Roosevelt Avenue"
  const normalized = title.replace(/Roosevelt\s+Ave(nue)?/gi, '___');
  const matches = new Set();
  for (const { slug, patterns } of SCHOOL_NAME_PATTERNS) {
    for (const p of patterns) {
      if (normalized.includes(p)) { matches.add(slug); break; }
    }
  }
  return [...matches];
}

// Build per-school board items: slug → [{date, type, title, attachments, videoId, timestampSeconds, meetingSlug}]
const SCHOOL_BOARD_ITEMS = {};
for (const s of schoolsData.schools) SCHOOL_BOARD_ITEMS[s.slug] = [];

for (const meeting of meetingsData.meetings) {
  const tsData = timestampMap[meeting.date];
  const videoId = tsData?.videoId || meeting.youtube;
  const meetingSlug = meeting.slug;

  for (let i = 0; i < (meeting.items || []).length; i++) {
    const item = meeting.items[i];
    const slugs = matchSchoolSlugs(item.title);
    if (slugs.length === 0) continue;

    const ts = tsData?.items?.[i];
    const entry = {
      date: meeting.date,
      type: meeting.type,
      title: item.title,
      attachments: (item.attachments || []).filter(a => a.aid || a.href).map(a => ({
        title: a.title,
        url: a.href || attachmentUrl(a.aid),
      })),
      videoId: videoId || null,
      timestampSeconds: ts?.timestampSeconds || null,
      meetingSlug,
    };

    for (const slug of slugs) {
      SCHOOL_BOARD_ITEMS[slug].push(entry);
    }
  }
}

// Sort each school's items newest-first
for (const slug of Object.keys(SCHOOL_BOARD_ITEMS)) {
  SCHOOL_BOARD_ITEMS[slug].sort((a, b) => b.date.localeCompare(a.date));
}

console.log(`Tagged ${Object.values(SCHOOL_BOARD_ITEMS).reduce((s, arr) => s + arr.length, 0)} board items across ${Object.keys(SCHOOL_BOARD_ITEMS).length} schools`);

// ---- Per-school enrichment data ----
// Primary sources: 2024-25 SARCs (data/sarc/), 2025-26 SPSAs, 2025-26 LCAP,
// and each school's 2025-26 Board of Trustees data presentation.
// The `growth` field is currently unverified (see file header note).

const SCHOOL_DATA = {
  'adelante-selby': {
    description: 'At Adelante Selby, students learn in two languages: Spanish and English. The school uses SEAL, a teaching approach that builds both languages at once. Any family in the district can apply to attend, not just neighbors. It is also a Community School, which means it connects families with extra services and support.',
    descriptionEs: 'En Adelante Selby, los estudiantes aprenden en dos idiomas: español e inglés. La escuela usa SEAL, un método de enseñanza que desarrolla los dos idiomas a la vez. Cualquier familia del distrito puede aplicar, no solo los vecinos. También es una Escuela Comunitaria, o sea que conecta a las familias con servicios y apoyo extra.',
    caaspp: { ela: 34, math: 36 },
    demographics: { sed: 62.6, el: 42.4, chronicAbsent: 15.4, suspension: 0.00 },
    funding: {
      spsaTotal: 854000, perPupil: 1356,
      titleI: 73000, district: 383000, ptoPta: 165000, measureU: 147000, prop28: 86000,
      titleISchool: true, atsi: false,
    },
    staffing: { credentialed: 90.5, misassigned: 0, elMisassigned: 0 },
    teacherDemo: { hispanicStaff: 66.7, whiteStaff: null, over55: 33.3, under35: null },
    notes: 'Zero suspensions. Best teacher staffing in the district: 91% fully credentialed and no teachers placed outside their subject area. Uses the SEAL bilingual teaching model. Two parent groups raise money for the school: the PTO ($150K) and Unidos PTO ($15K).',
    notesEs: 'Cero suspensiones. El mejor personal docente del distrito: 91% con credencial completa y ningún maestro asignado fuera de su materia. Usa el modelo de enseñanza bilingüe SEAL. Dos grupos de padres recaudan fondos para la escuela: el PTO ($150K) y Unidos PTO ($15K).',
  },
  'clifford': {
    description: 'Clifford is a TK-8 neighborhood school and one of the larger schools in the district. Families here come from a wide mix of income levels. One challenge: a notable group of students has been learning English for six or more years without reaching fluency — the state calls them long-term English Learners.',
    descriptionEs: 'Clifford es una escuela de vecindario de TK a 8º y una de las más grandes del distrito. Las familias aquí vienen de una gran mezcla de niveles de ingresos. Un reto: un grupo notable de estudiantes lleva seis años o más aprendiendo inglés sin llegar a dominarlo — el estado los llama estudiantes de inglés a largo plazo.',
    caaspp: { ela: 55, math: 45 },
    demographics: { sed: 44.2, el: 23.5, chronicAbsent: 20.7, suspension: 1.39 },
    funding: {
      spsaTotal: 665000, perPupil: 1001,
      titleI: 73000, district: 129000, ptoPta: 196000, measureU: 173000, prop28: 93000,
      titleISchool: true, atsi: false,
    },
    staffing: { credentialed: 86.1, misassigned: 0, elMisassigned: null },
    teacherDemo: { hispanicStaff: null, whiteStaff: 75.0, over55: null, under35: null },
    notes: 'Parents raise the second-largest PTO total in the district ($196K, after North Star). A serious challenge: none (0%) of its long-term English Learners — students learning English for 6+ years — are at grade level. The share of White teachers has been rising (75%, up 8.3 points over 4 years).',
    notesEs: 'Los padres recaudan la segunda mayor cantidad de PTO del distrito ($196K, después de North Star). Un reto serio: ninguno (0%) de sus estudiantes de inglés a largo plazo — estudiantes que llevan 6+ años aprendiendo inglés — está al nivel de grado. La proporción de maestros blancos ha ido subiendo (75%, +8.3 puntos en 4 años).',
  },
  'garfield': {
    description: 'Garfield is a K-5 neighborhood school where students learn in both Spanish and English, splitting the day 50:50. It serves more high-need families than almost any other school in the district, and enrollment has fallen a lot. The bright spot: even with low test scores, Garfield students improve in reading faster than at any other school in the district. It is also a Community School, with extra family services on site.',
    descriptionEs: 'Garfield es una escuela de vecindario de K a 5º donde los estudiantes aprenden en español y en inglés, mitad y mitad. Atiende a más familias de alta necesidad que casi cualquier otra escuela del distrito, y su inscripción ha bajado mucho. Lo bueno: aunque los puntajes son bajos, los estudiantes de Garfield mejoran en lectura más rápido que en cualquier otra escuela del distrito. También es una Escuela Comunitaria, con servicios extra para las familias allí mismo.',
    caaspp: { ela: 12, math: 8 },
    demographics: { sed: 95.0, el: 68.2, chronicAbsent: 28.8, suspension: 3.23 },
    funding: {
      spsaTotal: 243000, perPupil: 936,
      titleI: 55000, district: 19000, ptoPta: 0, measureU: 79000, prop28: 90000,
      titleISchool: true, atsi: false,
    },
    staffing: { credentialed: 87.4, misassigned: 0.3, elMisassigned: null },
    teacherDemo: { hispanicStaff: 52.6, whiteStaff: null, over55: null, under35: null },
    notes: '#1 in the district for reading growth (49% of students hit their yearly goal). Came off the state\'s list of lowest-performing schools (called CSI) in 2024. Enrollment fell from 515 to 279. No PTO money. Hispanic teachers grew from 35% to 52.6% of staff over 4 years.',
    notesEs: 'N.º 1 del distrito en crecimiento en lectura (49% de los estudiantes alcanzaron su meta anual). Salió de la lista estatal de escuelas de más bajo rendimiento (llamada CSI) en 2024. La inscripción bajó de 515 a 279. Sin dinero de PTO. Los maestros hispanos subieron del 35% al 52.6% del personal en 4 años.',
  },
  'henry-ford': {
    description: 'Henry Ford is a TK-5 neighborhood school and a Community School, with extra services for families on site. Many students come from lower-income homes. Its teachers are well-credentialed, but the staff looks very different from the students: about 3 in 4 teachers are White, while 2 in 3 students are Hispanic — the widest gap in the district.',
    descriptionEs: 'Henry Ford es una escuela de vecindario de TK a 5º y una Escuela Comunitaria, con servicios extra para las familias allí mismo. Muchos estudiantes vienen de hogares de bajos ingresos. Sus maestros tienen buenas credenciales, pero el personal se ve muy diferente a los estudiantes: como 3 de cada 4 maestros son blancos, mientras que 2 de cada 3 estudiantes son hispanos — la brecha más grande del distrito.',
    caaspp: { ela: 46, math: 38 },
    demographics: { sed: 63.1, el: 36.2, chronicAbsent: 24.8, suspension: 1.00 },
    funding: {
      spsaTotal: 681000, perPupil: 1476,
      titleI: 61000, district: 324000, ptoPta: 75000, measureU: 147000, prop28: 75000,
      titleISchool: true, atsi: false,
    },
    staffing: { credentialed: 90.6, misassigned: 1.7, elMisassigned: null },
    teacherDemo: { hispanicStaff: 7.7, whiteStaff: 76.9, over55: null, under35: null },
    notes: 'Widest staff-student demographic gap in the district: 77% White staff serving 67% Hispanic students. One in five students receives special education services. In the last 3 years the school has not lost a single teacher it wanted to keep.',
    notesEs: 'La brecha demográfica más grande del distrito entre personal y estudiantes: 77% del personal es blanco y 67% de los estudiantes son hispanos. Uno de cada cinco estudiantes recibe servicios de educación especial. En los últimos 3 años la escuela no ha perdido a ningún maestro que quería conservar.',
  },
  'hoover': {
    description: 'Hoover is a TK-8 neighborhood school serving one of the highest-need communities in the district. Its teachers are the youngest in the district and many are still finishing their teaching credentials — yet Hoover students improve in reading and math faster than at almost any other school (second-highest growth in both). Students get a full K-8 music program plus hands-on science and technology (STEAM). It is also a Community School, with extra family services on site.',
    descriptionEs: 'Hoover es una escuela de vecindario de TK a 8º que atiende a una de las comunidades con más necesidad del distrito. Sus maestros son los más jóvenes del distrito y muchos todavía están terminando su credencial — aun así, los estudiantes de Hoover mejoran en lectura y matemáticas más rápido que en casi cualquier otra escuela (el segundo mayor crecimiento en ambas materias). Hay un programa completo de música de K a 8º y clases prácticas de ciencia y tecnología (STEAM). También es una Escuela Comunitaria, con servicios extra para las familias allí mismo.',
    caaspp: { ela: 17, math: 13 },
    demographics: { sed: 96.6, el: 66.9, chronicAbsent: 28.5, suspension: 4.79 },
    funding: {
      spsaTotal: 734000, perPupil: 1114,
      titleI: 128000, district: 307000, ptoPta: 0, measureU: 183000, prop28: 116000,
      titleISchool: true, atsi: false,
    },
    staffing: { credentialed: 52.0, misassigned: 36.7, elMisassigned: 35.2 },
    teacherDemo: { hispanicStaff: 37.5, whiteStaff: null, over55: null, under35: 47.5 },
    notes: 'Youngest staff in the district (47.5% under 35). Lowest share of fully credentialed teachers (52%), yet #2 in student growth for both reading and math. 10% of students are experiencing homelessness. Zero teacher resignations in 2024-25.',
    notesEs: 'El personal más joven del distrito (47.5% menor de 35 años). La proporción más baja de maestros con credencial completa (52%), pero N.º 2 en crecimiento estudiantil en lectura y matemáticas. El 10% de los estudiantes no tiene vivienda fija. Cero renuncias de maestros en 2024-25.',
  },
  'kennedy': {
    description: 'Kennedy is the district\'s biggest school: a 6-8 neighborhood middle school and a Community School, with extra services for families. Test scores show a wide gap inside the school — White students score much higher than Hispanic students. The school has also been through several principal changes recently, and many teachers have left.',
    descriptionEs: 'Kennedy es la escuela más grande del distrito: una secundaria de vecindario de 6º a 8º y una Escuela Comunitaria, con servicios extra para las familias. Los exámenes muestran una brecha grande dentro de la escuela — los estudiantes blancos sacan puntajes mucho más altos que los hispanos. La escuela también ha pasado por varios cambios de director últimamente, y muchos maestros se han ido.',
    caaspp: { ela: 49, math: 30 },
    demographics: { sed: 65.8, el: 25.8, chronicAbsent: 23.8, suspension: 2.97 },
    funding: {
      spsaTotal: 563000, perPupil: 714,
      titleI: 76000, district: 159000, ptoPta: 20000, measureU: 192000, prop28: 117000,
      titleISchool: true, atsi: false,
    },
    staffing: { credentialed: 60.5, misassigned: 22.3, elMisassigned: 16.7 },
    teacherDemo: { hispanicStaff: null, whiteStaff: null, over55: null, under35: null },
    notes: 'A stark gap inside the school on the state English test: 81% of White students meet grade level vs. 38% of Hispanic students and 4% of students learning English. More teachers have left here over the last 3 years than at any other school (20 departures). Largest teaching staff in the district (30 evaluated teachers).',
    notesEs: 'Una brecha marcada dentro de la escuela en el examen estatal de inglés: 81% de los estudiantes blancos están al nivel de grado vs. 38% de los hispanos y 4% de los que están aprendiendo inglés. En los últimos 3 años se han ido más maestros que de cualquier otra escuela (20 salidas). El personal docente más grande del distrito (30 maestros evaluados).',
  },
  'mckinley-mit': {
    description: 'McKinley MIT is a 6-8 middle school with a technology focus; any family in the district can apply. The state has flagged it as needing extra help (a designation called ATSI), and the district puts more money into it than any other school — $610K for tutoring and support programs. Right now it has the lowest state test scores and the highest suspension rate in the district. It is also a Community School, with extra family services on site.',
    descriptionEs: 'McKinley MIT es una secundaria de 6º a 8º enfocada en tecnología; cualquier familia del distrito puede aplicar. El estado la marcó como escuela que necesita ayuda extra (una designación llamada ATSI), y el distrito le invierte más dinero que a ninguna otra escuela — $610K para tutoría y programas de apoyo. Por ahora tiene los puntajes más bajos del distrito en los exámenes estatales y la tasa de suspensión más alta. También es una Escuela Comunitaria, con servicios extra para las familias allí mismo.',
    caaspp: { ela: 10, math: 7 },
    demographics: { sed: 92.6, el: 45.5, chronicAbsent: 0, suspension: 10.78 },
    funding: {
      spsaTotal: 795000, perPupil: 1656,
      titleI: 27000, district: 610000, ptoPta: 0, measureU: 75000, prop28: 77000,
      titleISchool: true, atsi: true,
    },
    staffing: { credentialed: 56.5, misassigned: 22.9, elMisassigned: 22.9 },
    teacherDemo: { hispanicStaff: 16.7, whiteStaff: null, over55: null, under35: null },
    notes: 'Flagged by the state for extra support (ATSI). Gets the district\'s largest single investment ($610K for intervention programs). Lowest scores in the district on the CAASPP state test. Highest suspension rate (10.78%). Students are 94.4% Hispanic but teachers are 16.7% Hispanic — a 78-point gap. Chronic absenteeism reported as 0% — likely a data error.',
    notesEs: 'Marcada por el estado para recibir apoyo extra (ATSI). Recibe la mayor inversión individual del distrito ($610K para programas de intervención). Los puntajes más bajos del distrito en el examen estatal CAASPP. La tasa de suspensión más alta (10.78%). Los estudiantes son 94.4% hispanos pero los maestros son 16.7% hispanos — una brecha de 78 puntos. La ausencia crónica reportada como 0% — probablemente un error de datos.',
  },
  'north-star': {
    description: 'North Star Academy is a 3-8 school that any family in the district can apply to. Its students post the highest state test scores in the district — but they also improve the least from year to year. Because few students qualify for need-based federal money (Title I), it gets the least public funding per student. Parents fill the gap: the PTA raises $326K, more than half of the school\'s extra (supplemental) budget.',
    descriptionEs: 'North Star Academy es una escuela de 3º a 8º a la que cualquier familia del distrito puede aplicar. Sus estudiantes sacan los puntajes más altos del distrito en los exámenes estatales — pero también son los que menos mejoran de un año a otro. Como pocos estudiantes califican para fondos federales por necesidad (Título I), recibe el menor financiamiento público por estudiante. Los papás llenan ese hueco: el PTA recauda $326K, más de la mitad del presupuesto extra (suplementario) de la escuela.',
    caaspp: { ela: 96, math: 96 },
    demographics: { sed: 8.9, el: 2.5, chronicAbsent: 3.2, suspension: 0.19 },
    funding: {
      spsaTotal: 564000, perPupil: 1020,
      titleI: 0, district: 44000, ptoPta: 326000, measureU: 135000, prop28: 59000,
      titleISchool: false, atsi: false,
    },
    staffing: { credentialed: 79.7, misassigned: 0, elMisassigned: 0 },
    teacherDemo: { hispanicStaff: 19.0, whiteStaff: null, over55: 42.9, under35: null },
    notes: 'Highest retirement risk in the district: 42.9% of staff are over 55. Lowest reading growth (9.6% of students hit their yearly goal) despite the highest test scores. Every student group does well — 81% of Hispanic students and 72% of students with disabilities meet grade level. The PTA provides $326K, 58% of the site budget.',
    notesEs: 'El mayor riesgo de jubilación del distrito: 42.9% del personal tiene más de 55 años. El menor crecimiento en lectura (9.6% de los estudiantes alcanzaron su meta anual) a pesar de los puntajes más altos. A todos los grupos de estudiantes les va bien — 81% de los hispanos y 72% de los estudiantes con discapacidades están al nivel de grado. El PTA aporta $326K, el 58% del presupuesto del sitio.',
  },
  'orion': {
    description: 'At Orion, students learn in two languages: English and Mandarin. It is a TK-5 school that any family in the district can apply to, and parents pitch in regularly in the classroom — a setup often called a co-op. It is the most ethnically diverse school in the district, though White students currently score well above Hispanic students on state tests.',
    descriptionEs: 'En Orion, los estudiantes aprenden en dos idiomas: inglés y mandarín. Es una escuela de TK a 5º a la que cualquier familia del distrito puede aplicar, y los papás ayudan seguido en el salón — un modelo que llaman co-op. Es la escuela con más diversidad étnica del distrito, aunque por ahora los estudiantes blancos sacan puntajes bastante más altos que los hispanos en los exámenes estatales.',
    caaspp: { ela: 53, math: 51 },
    demographics: { sed: 31.8, el: 22.8, chronicAbsent: 12.6, suspension: 0.21 },
    funding: {
      spsaTotal: 1062000, perPupil: 1934,
      titleI: 0, district: 150000, ptoPta: 721000, measureU: 131000, prop28: 59000,
      titleISchool: false, atsi: false,
    },
    staffing: { credentialed: 68.4, misassigned: 14.6, elMisassigned: 14.6 },
    teacherDemo: { hispanicStaff: null, whiteStaff: null, over55: null, under35: null },
    notes: 'Most ethnically diverse school in the district (35% Hispanic, 23% multiracial, 21% White, 18% Asian). On the state English test, 77% of White students meet grade level vs. 29% of Hispanic students. A third of teachers are Chinese (for the Mandarin program). Parents are highly involved through the co-op model.',
    notesEs: 'La escuela con más diversidad étnica del distrito (35% hispanos, 23% multirraciales, 21% blancos, 18% asiáticos). En el examen estatal de inglés, 77% de los estudiantes blancos están al nivel de grado vs. 29% de los hispanos. Un tercio de los maestros son chinos (por el programa de mandarín). Los papás participan mucho gracias al modelo co-op.',
  },
  'roosevelt': {
    description: 'Roosevelt is a TK-5 neighborhood school and a Community School, with extra services for families on site. It has lost more students than any other school in the district and recently shrank from K-8 down to K-5. It also struggles to put fully qualified teachers in every classroom — especially teachers certified to teach students who are learning English.',
    descriptionEs: 'Roosevelt es una escuela de vecindario de TK a 5º y una Escuela Comunitaria, con servicios extra para las familias allí mismo. Ha perdido más estudiantes que cualquier otra escuela del distrito y hace poco pasó de K-8 a K-5. También le cuesta tener maestros con todas sus credenciales en cada salón — sobre todo maestros certificados para enseñar a estudiantes que están aprendiendo inglés.',
    caaspp: { ela: 16, math: 18 },
    demographics: { sed: 69.5, el: 42.6, chronicAbsent: 26.9, suspension: 3.11 },
    funding: {
      spsaTotal: 410000, perPupil: 1192,
      titleI: 55000, district: 158000, ptoPta: 0, measureU: 109000, prop28: 88000,
      titleISchool: true, atsi: false,
    },
    staffing: { credentialed: 56.5, misassigned: 28.1, elMisassigned: 28.1 },
    teacherDemo: { hispanicStaff: null, whiteStaff: null, over55: null, under35: null },
    notes: 'Steepest enrollment decline in the district (529 down to 344). Shrank from K-8 to K-5. Only 6.8% of students meet grade level in science. Lost 3 teachers it wanted to keep over 3 years (tied with McKinley for the most).',
    notesEs: 'La mayor caída de inscripción del distrito (de 529 a 344). Pasó de K-8 a K-5. Solo el 6.8% de los estudiantes está al nivel de grado en ciencias. Perdió 3 maestros que quería conservar en 3 años (empatada con McKinley en lo más alto).',
  },
  'roy-cloud': {
    description: 'Roy Cloud is a TK-8 neighborhood school where most families are not low-income, and it is one of the higher-scoring schools in the district. But its students who are still learning English — including those who have been at it for six-plus years — are struggling enough that the state\'s school report card (the California Dashboard) rates those groups RED, the lowest level.',
    descriptionEs: 'Roy Cloud es una escuela de vecindario de TK a 8º donde la mayoría de las familias no son de bajos ingresos, y es una de las escuelas con mejores puntajes del distrito. Pero a sus estudiantes que todavía están aprendiendo inglés — incluyendo los que llevan seis años o más — les va lo bastante mal como para que la boleta estatal de las escuelas (el California Dashboard) ponga a esos grupos en ROJO, el nivel más bajo.',
    caaspp: { ela: 67, math: 59 },
    demographics: { sed: 11.4, el: 3.4, chronicAbsent: 8.0, suspension: 1.75 },
    funding: {
      spsaTotal: 695000, perPupil: 1046,
      titleI: 0, district: 292000, ptoPta: 215000, measureU: 117000, prop28: 71000,
      titleISchool: false, atsi: false,
    },
    staffing: { credentialed: 79.7, misassigned: 8.3, elMisassigned: null },
    teacherDemo: { hispanicStaff: 13.5, whiteStaff: 70.3, over55: 29.7, under35: null },
    notes: 'Students learning English — including long-term English Learners — are rated RED (the lowest level) on the California Dashboard, the state\'s school report card, despite strong overall scores. Runs a $33K "Literature Lift" program to bring more diverse books into classrooms. Has a student LGBTQ+ club, Rainbow Cloud. Hispanic teachers grew from 9% to 13.5% of staff over 4 years.',
    notesEs: 'Los estudiantes que están aprendiendo inglés — incluyendo los de largo plazo — están en ROJO (el nivel más bajo) en el California Dashboard, la boleta estatal de las escuelas, a pesar de puntajes generales fuertes. Tiene un programa de $33K llamado "Literature Lift" para traer libros más diversos a los salones. Tiene un club estudiantil LGBTQ+, Rainbow Cloud. Los maestros hispanos subieron del 9% al 13.5% del personal en 4 años.',
  },
  'taft': {
    description: 'Taft is a TK-5 neighborhood school where K-3 students learn in both Spanish and English, splitting the day 50:50. Even though it serves one of the highest-need communities in the district, it runs on one of the smallest budgets. Its young teaching staff gets results: Taft students improve in math faster than at any other school in the district. It is also a Community School, with extra family services on site.',
    descriptionEs: 'Taft es una escuela de vecindario de TK a 5º donde los estudiantes de K a 3º aprenden en español y en inglés, mitad y mitad. Aunque atiende a una de las comunidades con más necesidad del distrito, funciona con uno de los presupuestos más chicos. Su personal docente joven da resultados: los estudiantes de Taft mejoran en matemáticas más rápido que en cualquier otra escuela del distrito. También es una Escuela Comunitaria, con servicios extra para las familias allí mismo.',
    caaspp: { ela: 19, math: 13 },
    demographics: { sed: 90.0, el: 65.7, chronicAbsent: 26.7, suspension: 0.51 },
    funding: {
      spsaTotal: 238000, perPupil: 733,
      titleI: 69000, district: 0, ptoPta: 0, measureU: 97000, prop28: 72000,
      titleISchool: true, atsi: false,
    },
    staffing: { credentialed: 56.3, misassigned: 15.6, elMisassigned: 15.6 },
    teacherDemo: { hispanicStaff: 29.2, whiteStaff: null, over55: null, under35: 41.7 },
    notes: '#1 in the district for math growth (27.6%), #3 for reading growth. Youngest staff in the district alongside Hoover (41.7% under 35). Smallest supplemental (SPSA) budget ($238K). Came off the state\'s extra-support list (ATSI) in 2024-25. 7% of students are experiencing homelessness.',
    notesEs: 'N.º 1 del distrito en crecimiento en matemáticas (27.6%), N.º 3 en lectura. El personal más joven del distrito junto con Hoover (41.7% menor de 35). El presupuesto suplementario (SPSA) más pequeño ($238K). Salió de la lista estatal de apoyo extra (ATSI) en 2024-25. El 7% de los estudiantes no tiene vivienda fija.',
  },
};

// ---- Page-specific CSS ----
const schoolCSS = `
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
    padding: 3.5rem 2rem 3rem;
    position: relative;
  }

  .header-district {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--green-light);
    margin-bottom: 0.5rem;
  }

  .header-district a {
    color: var(--green-light);
    text-decoration: none;
    transition: color 0.2s;
  }
  .header-district a:hover {
    color: #fff;
  }

  .header-logo {
    height: 120px;
    width: auto;
    max-width: 480px;
    margin-bottom: 1.2rem;
    object-fit: contain;
    background: #fff;
    padding: 14px 24px;
    border-radius: 12px;
  }

  .header-title {
    font-family: 'Fraunces', Georgia, serif;
    font-size: clamp(1.8rem, 4.5vw, 2.8rem);
    font-weight: 300;
    line-height: 1.15;
    color: #fff;
    max-width: 600px;
    font-optical-sizing: auto;
  }

  .header-subtitle {
    margin-top: 1rem;
    font-size: 0.92rem;
    color: rgba(255,255,255,0.6);
    line-height: 1.6;
    max-width: 520px;
    font-style: italic;
  }

  .header-meta {
    margin-top: 1.8rem;
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
    font-size: 1.6rem;
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

  /* ---- SCHOOL TYPE BADGE ---- */
  .school-badge {
    display: inline-block;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.25rem 0.6rem;
    border-radius: 3px;
    margin-top: 1rem;
  }
  .school-badge.neighborhood {
    background: rgba(255,255,255,0.12);
    color: rgba(255,255,255,0.7);
  }
  .school-badge.choice {
    background: rgba(196,132,45,0.25);
    color: var(--amber-light);
  }
  .school-badge.community {
    background: rgba(74,140,106,0.25);
    color: var(--green-pale);
    margin-left: 0.4rem;
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

  /* ---- LANG SWITCH ---- */
  .lang-switch {
    background: var(--cream-dark);
    border-bottom: 1px solid var(--rule);
    text-align: center;
    padding: 0.5rem 1rem;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
  }
  .lang-switch a {
    color: var(--green-mid);
    text-decoration: none;
  }
  .lang-switch a:hover {
    text-decoration: underline;
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

  .section-num {
    font-family: 'Fraunces', serif;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--green-light);
    display: inline-block;
    margin-bottom: 0.3rem;
    letter-spacing: 0.02em;
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

  h3 {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--text);
    margin-top: 2.5rem;
    margin-bottom: 0.8rem;
    line-height: 1.3;
  }

  p {
    margin-bottom: 1rem;
    max-width: 640px;
  }

  .wide p {
    max-width: none;
  }

  .source {
    font-size: 0.8rem;
    color: var(--text-muted);
    font-style: italic;
  }
  .source a {
    color: var(--text-muted);
    text-decoration: underline;
    text-decoration-color: var(--rule-light);
    text-underline-offset: 2px;
  }
  .source a:hover {
    color: var(--green-mid);
    text-decoration-color: var(--green-mid);
  }

  /* ---- TABLES ---- */
  .table-wrap {
    overflow-x: auto;
    margin: 1.2rem 0 1.5rem;
    -webkit-overflow-scrolling: touch;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
    line-height: 1.45;
  }

  thead th {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
    text-align: left;
    padding: 0.6rem 0.8rem;
    border-bottom: 2px solid var(--green-deep);
    white-space: nowrap;
  }

  thead th.num {
    text-align: right;
  }

  tbody td {
    padding: 0.55rem 0.8rem;
    border-bottom: 1px solid var(--rule-light);
    vertical-align: top;
  }

  tbody td.num {
    text-align: right;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.82rem;
    white-space: nowrap;
  }

  tbody td.label-cell {
    font-weight: 500;
    white-space: nowrap;
  }

  tbody tr:last-child td {
    border-bottom: 2px solid var(--rule);
  }

  tbody tr.total-row td {
    font-weight: 500;
    border-top: 2px solid var(--green-deep);
    border-bottom: 2px solid var(--green-deep);
    background: var(--green-wash);
  }

  tbody tr:hover td {
    background: var(--green-wash);
  }

  /* Visual bar inside table cells */
  .bar-cell {
    position: relative;
    min-width: 100px;
  }

  .bar {
    display: inline-block;
    height: 6px;
    border-radius: 3px;
    margin-right: 0.5rem;
    vertical-align: middle;
    transition: width 0.4s ease;
  }

  .bar-green { background: var(--green-light); }
  .bar-amber { background: var(--amber); }
  .bar-coral { background: var(--coral); }

  /* ---- CALLOUT BOXES ---- */
  .callout {
    background: var(--green-wash);
    border-left: 3px solid var(--green-light);
    padding: 1.2rem 1.5rem;
    margin: 1.5rem 0;
    font-size: 0.92rem;
    max-width: none;
  }

  .callout p {
    max-width: none;
    margin-bottom: 0.5rem;
  }

  .callout p:last-child { margin-bottom: 0; }

  .callout-amber {
    background: #fef8ee;
    border-left-color: var(--amber);
  }

  /* ---- STAT GRID ---- */
  .stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1rem;
    margin: 1.5rem 0;
  }

  .stat-card {
    background: #fff;
    border: 1px solid var(--rule-light);
    padding: 1.2rem;
  }

  .stat-card-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: 0.3rem;
  }

  .stat-card-value {
    font-family: 'Fraunces', serif;
    font-size: 1.5rem;
    font-weight: 600;
    line-height: 1.1;
    color: var(--green-deep);
  }

  .stat-card-note {
    font-size: 0.78rem;
    color: var(--text-secondary);
    margin-top: 0.3rem;
    line-height: 1.4;
  }
  .stat-card-source { margin-top: 0.4rem; font-size: 0.72rem; }
  .stat-card-source a.source-link {
    color: var(--green-mid);
    text-decoration: underline;
    text-decoration-color: var(--rule);
    text-underline-offset: 2px;
  }
  .stat-card-source a.source-link:hover {
    color: var(--green-deep);
    text-decoration-color: var(--green-mid);
  }
  .info-bubble { position:relative; display:inline-flex; align-items:center; margin-left:0.25rem; vertical-align:middle; }
  .info-bubble-icon { font-family:'IBM Plex Mono',monospace; font-size:0.55rem; color:var(--text-muted); cursor:pointer; width:14px; height:14px; display:inline-flex; align-items:center; justify-content:center; border:1px solid var(--rule); border-radius:50%; line-height:1; transition:border-color 0.2s,color 0.2s; }
  .info-bubble-icon:hover { border-color:var(--green-mid); color:var(--green-mid); }
  .info-bubble-tip { display:none; position:absolute; bottom:calc(100% + 6px); left:50%; transform:translateX(-50%); width:max-content; max-width:min(260px, calc(100vw - 2rem)); background:var(--green-deep); color:rgba(255,255,255,0.9); padding:0.4rem 0.7rem; border-radius:4px; font-family:'IBM Plex Mono',monospace; font-size:0.6rem; line-height:1.35; text-align:left; white-space:normal; z-index:100; pointer-events:auto; box-shadow:0 2px 8px rgba(0,0,0,0.15); }
  .info-bubble-tip::after { content:''; position:absolute; top:100%; left:50%; transform:translateX(-50%); border:5px solid transparent; border-top-color:var(--green-deep); }
  .info-bubble-tip a { color:#fff; text-decoration:underline; }
  .info-bubble-tip a:hover { color:var(--green-pale); }
  .info-bubble:hover .info-bubble-tip, .info-bubble:focus-within .info-bubble-tip { display:block; }

  /* ---- RESOURCE CARDS ---- */
  .resource-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1rem;
    margin: 1.5rem 0;
  }

  .resource-card {
    background: #fff;
    border: 1px solid var(--rule-light);
    /* min-width:0 removes the grid item's automatic min-content floor —
       without it one long unbreakable line (e.g. a PDF filename) widens the
       shared track past a 320-360px viewport and the whole page pans. */
    min-width: 0;
    overflow-wrap: anywhere;
    padding: 1.2rem 1.5rem;
    transition: border-color 0.2s;
  }

  .resource-card:hover {
    border-color: var(--green-light);
  }

  .resource-card h3 {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--green-mid);
    /* margin-top/line-height cancel the generic h3 rule above; these cards
       were h4 (skipping h2 -> h4) and keep the old h4 rendering exactly */
    margin-top: 0;
    margin-bottom: 0.4rem;
    line-height: 1.65;
  }

  .resource-card p {
    font-size: 0.85rem;
    color: var(--text-secondary);
    max-width: none;
    margin-bottom: 0;
    line-height: 1.5;
  }

  .resource-card a {
    color: var(--green-mid);
    text-decoration: none;
    font-weight: 500;
  }
  .resource-card a:hover {
    text-decoration: underline;
  }

  .resource-card .coming-soon {
    font-style: italic;
    color: var(--text-muted);
  }

  .calendar-links {
    margin-top: 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .calendar-btn {
    display: inline-block;
    padding: 3px 8px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.68rem;
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

  /* ---- SSC MEMBERSHIP ---- */
  .ssc-members {
    font-size: 0.85rem;
    line-height: 1.5;
    margin-top: 0.4rem;
  }
  .ssc-role {
    color: var(--text-muted);
    font-size: 0.8rem;
  }

  /* ---- BELL SCHEDULE ---- */
  .resource-card.bell-card {
    grid-column: 1 / -1;
    background: var(--green-wash);
    border-color: var(--green-pale);
  }
  .resource-card.bell-card:hover {
    border-color: var(--green-light);
  }

  .bell-supervision {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-bottom: 0.6rem;
    letter-spacing: 0.02em;
  }

  .bell-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
    line-height: 1.4;
  }

  .bell-table thead th {
    text-align: left;
    padding: 0.35rem 0.6rem;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.68rem;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--green-mid);
    border-bottom: 2px solid var(--green-pale);
    vertical-align: bottom;
  }

  .bell-col-label {
    display: block;
  }

  .bell-col-sub {
    display: block;
    font-family: 'Newsreader', Georgia, serif;
    font-size: 0.72rem;
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text-muted);
    margin-top: 0.1rem;
  }

  .bell-table tbody td {
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid rgba(0,0,0,0.06);
    color: var(--text);
    white-space: nowrap;
  }

  .bell-table tbody tr:last-child td {
    border-bottom: none;
  }

  .bell-table tbody tr:hover td {
    background: rgba(45,90,63,0.06);
  }

  .bell-grade {
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 500;
    font-size: 0.8rem;
    color: var(--green-deep);
    min-width: 3.5em;
  }

  .bell-time-range {
    letter-spacing: 0.01em;
  }

  .bell-dash {
    color: var(--text-muted);
    padding: 0 0.1em;
  }

  .bell-card-inner {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  @media (max-width: 600px) {
    .bell-table { font-size: 0.8rem; }
    .bell-table thead th { font-size: 0.62rem; padding: 0.3rem 0.4rem; }
    .bell-table tbody td { padding: 0.35rem 0.4rem; }
  }

  /* ---- BACK LINK ---- */
  .back-link {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.7rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    margin-bottom: 2rem;
    transition: color 0.2s;
  }
  .back-link:hover {
    color: var(--green-mid);
  }

  /* ---- FUNDING BREAKDOWN ---- */
  .funding-bar {
    display: flex;
    height: 18px;
    border-radius: 4px;
    overflow: hidden;
    margin: 1rem 0 0.8rem;
    background: var(--rule-light);
  }
  .funding-bar-segment {
    height: 100%;
    transition: width 0.4s ease;
  }
  .funding-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem 1.5rem;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
    color: var(--text-secondary);
    margin-bottom: 1rem;
  }
  .funding-legend-item {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .funding-legend-swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    flex-shrink: 0;
  }

  /* ---- RESPONSIVE ---- */
  /* ---- PRINCIPAL + TABLE LAYOUT ---- */
  .principal-row {
    display: flex;
    gap: 2rem;
    margin: 2rem 0 1.5rem;
    align-items: flex-start;
  }

  @media (max-width: 640px) {
    html { font-size: 15px; }
    .header-inner { padding: 2.5rem 1.2rem 2rem; }
    .content { padding: 0 1.2rem 4rem; }
    .header-meta { gap: 1.5rem; }
    .stat-grid { grid-template-columns: 1fr 1fr; }
    .resource-grid { grid-template-columns: 1fr; }
    .toc a { padding: 0.8rem 0.6rem; font-size: 0.6rem; }
    .principal-row { flex-direction: column; align-items: center; gap: 1rem; }
  }

  /* page-specific footer overrides */
  .site-footer { font-size: 0.8rem; text-align: left; }
  .footer-nav { margin-top: 1rem; }
  .footer-nav a { font-size: 0.68rem; margin: 0 1.5rem 0 0; }`;


// ---- Helpers ----

function fmt(n) {
  if (n === null || n === undefined) return '--';
  return n.toLocaleString('en-US');
}

function fmtDollar(n) {
  if (!n) return '--';
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n}`;
}

function fmtPct(n) {
  if (n === null || n === undefined) return '--';
  return `${n}%`;
}

function barClass(pct) {
  if (pct >= 50) return 'bar-green';
  if (pct >= 25) return 'bar-amber';
  return 'bar-coral';
}

function barWidth(pct, max = 60) {
  return Math.max(1, Math.round((pct / 100) * max));
}

function rctStatusNote(pto, isEs) {
  if (!pto?.rctStatus || pto.rctStatus === 'current') return '';
  const labels = {
    'not-registered': isEs
      ? 'No registrado en el Registro de Fideicomisos Caritativos de CA'
      : 'Not registered with CA Registry of Charitable Trusts',
    'delinquency-notice': isEs
      ? 'Aviso de morosidad en el Registro de CA'
      : 'Delinquency notice on file with CA Registry',
    'missing-documents': isEs
      ? 'Documentos faltantes en el Registro de CA'
      : 'Missing documents on file with CA Registry',
    'current-in-process': isEs
      ? 'Registro de CA en proceso de revisión'
      : 'CA Registry filing under review',
  };
  const text = labels[pto.rctStatus];
  if (!text) return '';
  const isWarning = ['not-registered', 'delinquency-notice', 'missing-documents'].includes(pto.rctStatus);
  const color = isWarning ? 'var(--coral)' : 'var(--text-muted)';
  return `<p style="font-size:0.75rem; color:${color}; margin-top:0.3rem">${text}</p>`;
}

// ---- Funding bar colors ----
const FUNDING_COLORS = {
  titleI: '#4a8c6a',     // green-light
  district: '#1a3a2a',   // green-deep
  ptoPta: '#c4842d',     // amber
  measureU: '#5b9bd5',   // blue
  prop28: '#9b7cb8',     // purple
};

// ---- Labels ----
const LABELS = {
  en: {
    overview: 'Overview',
    academics: 'Academic Performance',
    demographics: 'Student Demographics',
    funding: 'Funding',
    staffing: 'Who Teaches Here',
    resources: 'Documents & Resources',
    grades: 'Grades',
    csppNote: '+ California State Preschool →',
    csppUrl: 'https://www.rcsdk8.net/our-programs-and-services/educational-services/instructional-programs/california-state-preschool-program/preschool-enrollment-office',
    enrollment: 'Enrollment',
    principal: 'Principal',
    highNeed: 'High-need',
    schoolType: 'School type',
    neighborhood: 'Neighborhood',
    choice: 'School of Choice',
    choiceTip: 'Families from anywhere in the district can apply to attend a School of Choice through the open enrollment process.',
    neighborhoodTip: 'A neighborhood school enrolls students who live within its attendance area boundaries. Families can also apply through open enrollment.',
    communitySchool: 'Community School',
    program: 'Special program',
    studentGrowth: 'Student Growth',
    growthNote: 'Growth measures how much students are learning each year, regardless of their starting point. A school with low proficiency but high growth is accelerating learning. Proficiency measures how many students are at or above grade level right now.',
    growthFinePrint: 'Growth = % of students meeting their annual i-Ready Expected Growth target on the mid-year diagnostic. i-Ready is the district\u2019s local K\u20138 literacy and math assessment; the LCAP goal is to raise this by 4 percentage points each year. Proficiency = % meeting or exceeding grade-level standards on the CAASPP (the California state test, given in spring of grades 3\u20138).',
    elaGrowth: 'English growth',
    mathGrowth: 'Math growth',
    districtAvg: 'District-wide:',
    growthYearMidYear: '2025-26 mid-year',
    growthYearY1Actual: '2024-25 actual',
    ireadyuSourceLabel: (date) => `Board presentation ${date}`,
    sourceLinkLabel: (date, page) => page ? `Source: board presentation ${date}, slide ${page}` : `Source: board presentation ${date}`,
    growthPendingHeadline: 'Awaiting 2025-26 board presentation.',
    growthPendingBody: (date, url) => `This school has not yet presented 2025-26 growth data to the Board of Trustees. Their most recent deck is from <a href="${url}" target="_blank">${date}</a>; we\u2019ll publish updated growth numbers here once a 2025-26 presentation is posted.`,
    caasppProficiency: 'CA State Testing (2023-24)',
    elaProficiency: 'English Proficiency',
    mathProficiency: 'Math Proficiency',
    districtAvgEla: 'District avg: 42%',
    districtAvgMath: 'District avg: 35%',
    teachersEvaluated: 'teachers evaluated',
    sed: 'Socioeconomically Disadvantaged',
    sedNote: 'Mostly students who qualify for free or low-cost school lunch',
    el: 'English Learners',
    elNote: 'Students still learning English',
    chronicAbsent: 'Chronic Absenteeism',
    chronicAbsentTip: 'A student is chronically absent if they miss 10% or more of school days — about 18 days a year.',
    suspension: 'Suspension Rate',
    iepRate: 'Students with IEPs',
    inclusionRate: 'Inclusive Placement',
    inclusionTip: '% of IEP students in regular classroom 80%+ of the day',
    districtAvgAbsent: 'District avg: 18.3%',
    districtAvgSuspension: 'District avg: 2.2%',
    sarcTotalPerPupil: 'Total Per Pupil',
    sarcRestricted: 'Restricted',
    sarcUnrestricted: 'Unrestricted',
    sarcEstSchoolCost: 'Est. School Cost',
    sarcAvgTeacherSalary: 'Avg Teacher Salary',
    sarcDistrictLabel: 'District',
    sarcPtoPerPupil: 'PTO/PTA Per Pupil',
    sarcNoPto: 'Supported by <a href="https://www.rcef.org/" target="_blank">RCEF</a>',
    sarcExpenditureNote: 'Per-pupil expenditure data from the 2022-23 SARC. Restricted funds include Title I, special ed, and EL programs. Unrestricted funds are general operating. PTO/PTA revenue from IRS Form 990 filings.',
    spsaBudget: 'Supplemental (SPSA)',
    perPupil: 'SPSA Per Pupil',
    fundingBreakdown: 'SPSA Source Breakdown',
    titleI: 'Title I',
    districtFunds: 'District',
    ptoPta: 'PTO/PTA',
    measureU: 'Measure U',
    prop28: 'Prop 28',
    receivesTitle1: 'This school receives Title I federal funding.',
    noTitle1: 'This school does not receive Title I federal funding.',
    atsiNote: 'This school is designated ATSI (Additional Targeted Support and Improvement).',
    spsaNote: 'SPSA budgets represent supplemental site-level spending (enrichment, counseling, PD, materials). Base operating costs (teacher salaries, admin, facilities) come from the general fund and vary by school.',
    credentialsHeading: 'Credentials',
    fullyCredentialed: 'Fully Credentialed',
    misassigned: 'Misassigned',
    elMisassigned: 'EL Misassigned',
    districtAvgCredentialed: 'District avg: 75%',
    districtTarget: 'District target: 100% by 2027',
    misassignedExplainer: '"Misassigned" means a teacher was placed in a class they are not credentialed for — most often classes with students learning English (EL).',
    teacherDemoHighlights: 'Teacher demographics highlights',
    hispanicStaff: 'Hispanic staff',
    whiteStaff: 'White staff',
    over55: 'Staff over 55',
    under35: 'Staff under 35',
    sarc: 'School Accountability Report Card (SARC)',
    sarcDesc: 'A yearly report card the state requires from every school: test scores, class sizes, teacher credentials, and campus conditions in one PDF.',
    spsa: 'School Plan for Student Achievement (SPSA)',
    spsaDesc: 'The school’s yearly plan for how it spends its extra (“supplemental”) money — tutoring, counselors, materials, and more.',
    viewSarc: 'Download SARC (PDF)',
    viewSpsa: 'Download SPSA (PDF)',
    safetyPlan: 'Comprehensive Safety Plan',
    boardPresentation: 'Board Presentation',
    sitePresentations: 'Board Site Presentations',
    sitePresentationsDesc: 'Annual presentations this school made to the Board of Trustees.',
    viewPresentation: 'View presentation (PDF)',
    watchPresentation: 'Watch',
    viewCssp: 'Download CSSP (PDF)',
    csspDesc: '2025-26 plan, board-approved Feb 4, 2026.',
    bellSchedule: 'Bell Schedule',
    regularDays: 'Regular',
    regularDaysSub: 'Mon · Tue · Wed · Fri',
    thursdayEarlyRelease: 'Thursday',
    superMinDays: 'Super-min',
    supervisionStarts: 'Supervision starts',
    grade: 'Grade',
    dismissal: 'Dismissal',
    lunchMenu: 'Lunch Menu',
    schoolSiteCouncil: 'School Site Council',
    sscChair: 'Chair',
    sscAdopted: 'SPSA adopted',
    sscRolePrincipal: 'Principal',
    sscRoleTeacher: 'Teacher',
    sscRoleStaff: 'Staff',
    sscRoleParent: 'Parent / Community',
    sscMemberName: 'Name',
    sscMemberRole: 'Role',
    sscMeetings: 'Meetings',
    sscMeetingAgenda: 'Agenda',
    sscMeetingMinutes: 'Minutes',
    sscSubscribeTitle: 'Subscribe to Calendar',
    sscSubscribeDesc: 'Sync SSC meetings to your Apple, Google, or Outlook calendar.',
    ptoPtaOrg: 'PTO / PTA',
    afterSchool: 'After-School Programs',
    parentComm: 'Parent Communication',
    absenceReporting: 'Report an Absence',
    joinKonstella: 'Join on Konstella',
    joinPlatform: 'Join',
    comingSoon: 'Coming soon',
    viewMenu: 'View menu',
    visitWebsite: 'Visit PTO/PTA website',
    schoolWebsite: 'School website',
    backToDistrict: 'All schools',
    disclaimer: '<strong>Draft document.</strong> Personally prepared by David Weekly; this is not a representation of the district or the Board of Trustees and may contain material factual errors. For official information, visit <a href="https://www.rcsdk8.net" style="color:#664d03; text-decoration:underline">rcsdk8.net</a>.',
    langSwitch: 'Leer en espa&ntilde;ol',
    sourceNote: 'Sources: 2024-25 SARCs, 2025-26 SPSAs, 2025-26 LCAP, each school’s 2025-26 Board of Trustees data presentation. Proficiency from 2023-24 CAASPP. Growth from each school’s 2025-26 mid-year i-Ready diagnostic as reported to the Board.',
    chronicAbsentNote: 'reported as 0% -- likely a data error',
    address: 'Address',
    phone: 'Phone',
    start: 'Start',
    end: 'End',
    earlyRelease: 'Early release',
    boardMeetings: 'Board Meetings',
    boardMeetingsDesc: 'Board of Trustees meetings with agenda items mentioning this school.',
    watchVideo: 'Watch',
    viewAttachments: 'Attachments',
    viewFullMeeting: 'Full meeting',
    noBoardItems: 'No board meeting items found for this school.',
    cdeAbsenteeismBreakdown: 'Chronic Absenteeism by Subgroup',
    cdeAbsenteeismNote: 'Chronic absenteeism rate by student subgroup. A student is chronically absent if they miss 10% or more of school days — about 18 days a year. Groups too small to report (fewer than 10 students) are not shown, to protect privacy. Source: California Dept. of Education, 2024-25.',
    cdeLtelHeading: 'English Learners: A Closer Look',
    cdeElStudents: 'Learning English',
    cdeLtelCount: 'Long-Term (LTEL)',
    cdeLtelCountNote: '6+ years as an English Learner',
    cdeAtRisk: 'At Risk of LTEL',
    cdeAtRiskNote: '4-5 years as an English Learner',
    cdeReclassified: 'Now Fluent (RFEP)',
    cdeReclassifiedNote: 'Tested out of English Learner status',
    cdeLtelExplainer: 'A "long-term English Learner" (LTEL) is a student who has been learning English for 6 or more years without yet reaching fluency; students at 4-5 years are counted as "at risk" of becoming long-term. Schools watch these numbers because the goal is for students to reach fluency well before the 6-year mark.',
    cdeLtelElementaryNote: 'California only starts counting students as long-term English Learners in grade 6, so elementary schools always show zero.',
    cdeLtelSource: 'Source: <a href="https://dq.cde.ca.gov/dataquest/longtermel/" target="_blank">California Dept. of Education</a> English Learner data (ELAS/LTEL), 2024-25 school year.',
    cdeSuppressed: 'fewer than 10',
    cdeStaffDiversity: 'Teacher Race & Ethnicity',
    cdeStaffDiversityNote: 'Counts classroom teachers only. Source: <a href="https://www.cde.ca.gov/ds/ad/fsspre.asp" target="_blank">California Dept. of Education</a> staff data, 2024-25 school year.',
    cdeNotReported: 'Not reported',
    cdeTeachers: 'Teachers',
    cdeAvgYears: 'Avg Years Teaching',
    cdeInexperienced: 'New Teachers',
    cdeInexperiencedNote: 'In their 1st or 2nd year of teaching',
    cdePupilTeacher: 'Students per Teacher',
    cdePupilCounselor: 'Students per Counselor',
    cdeCounselorNote: 'Counselors, psychologists, social workers & nurses',
    cdeCounselorSuppressed: 'CDE lists less than one full-time position here',
    cdeStaffSource: 'Source: <a href="https://www.cde.ca.gov/ds/ad/fsspex.asp" target="_blank">California Dept. of Education</a> staffing data, 2024-25 school year.',
  },
  es: {
    overview: 'Resumen',
    academics: 'Rendimiento Académico',
    demographics: 'Demografía Estudiantil',
    funding: 'Financiamiento',
    staffing: '¿Quiénes enseñan aquí?',
    resources: 'Documentos y Recursos',
    grades: 'Grados',
    csppNote: '+ Preescolar Estatal de California →',
    csppUrl: 'https://www.rcsdk8.net/our-programs-and-services/educational-services/instructional-programs/california-state-preschool-program/preschool-enrollment-office',
    enrollment: 'Inscripción',
    principal: 'Director/a',
    highNeed: 'Alta necesidad',
    schoolType: 'Tipo de escuela',
    neighborhood: 'Vecindario',
    choice: 'Escuela de Elección',
    choiceTip: 'Las familias de cualquier parte del distrito pueden solicitar asistir a una Escuela de Elección a través del proceso de inscripción abierta.',
    neighborhoodTip: 'Una escuela de vecindario inscribe a estudiantes que viven dentro de los límites de su área de asistencia. Las familias también pueden solicitar a través de inscripción abierta.',
    communitySchool: 'Escuela Comunitaria',
    program: 'Programa especial',
    studentGrowth: 'Crecimiento Estudiantil',
    growthNote: 'El crecimiento mide cuánto aprenden los estudiantes cada año, sin importar su punto de partida. Una escuela con baja competencia pero alto crecimiento está acelerando el aprendizaje. La competencia mide cuántos estudiantes están al nivel de grado o por encima en este momento.',
    growthFinePrint: 'Crecimiento = % de estudiantes que alcanzaron su meta anual de Crecimiento Esperado en i-Ready en la evaluación diagnóstica de medio año. i-Ready es la evaluación local del distrito en lectura y matemáticas para K\u20138; la meta del LCAP es aumentar este porcentaje 4 puntos cada año. Competencia = % que cumplen o superan los estándares de grado en el CAASPP (examen estatal de California, administrado en primavera a los grados 3\u20138).',
    elaGrowth: 'Crecimiento en inglés',
    mathGrowth: 'Crecimiento en matemáticas',
    districtAvg: 'Nivel distrital:',
    growthYearMidYear: 'medio año 2025-26',
    growthYearY1Actual: '2024-25 real',
    ireadyuSourceLabel: (date) => `Presentación de la Mesa ${date}`,
    sourceLinkLabel: (date, page) => page ? `Fuente: presentación ${date}, diapositiva ${page}` : `Fuente: presentación ${date}`,
    growthPendingHeadline: 'En espera de la presentación 2025-26.',
    growthPendingBody: (date, url) => `Esta escuela aún no ha presentado los datos de crecimiento 2025-26 a la Mesa Directiva. Su presentación más reciente es del <a href="${url}" target="_blank">${date}</a>; publicaremos los números actualizados aquí una vez que se realice la presentación 2025-26.`,
    caasppProficiency: 'Examen Estatal de CA (2023-24)',
    elaProficiency: 'Competencia en Inglés',
    mathProficiency: 'Competencia en Matemáticas',
    districtAvgEla: 'Promedio del distrito: 42%',
    districtAvgMath: 'Promedio del distrito: 35%',
    teachersEvaluated: 'maestros evaluados',
    sed: 'Desventaja Socioeconómica',
    sedNote: 'Más que nada, estudiantes que califican para almuerzo gratis o a bajo costo',
    el: 'Estudiantes de Inglés',
    elNote: 'Estudiantes que todavía están aprendiendo inglés',
    chronicAbsent: 'Absentismo Crónico',
    chronicAbsentTip: 'Un estudiante está crónicamente ausente si falta el 10% o más de los días de clases — como 18 días al año.',
    suspension: 'Tasa de Suspensión',
    iepRate: 'Estudiantes con IEP',
    inclusionRate: 'Colocación Inclusiva',
    inclusionTip: '% de estudiantes con IEP en aula regular 80%+ del día',
    districtAvgAbsent: 'Promedio del distrito: 18.3%',
    districtAvgSuspension: 'Promedio del distrito: 2.2%',
    sarcTotalPerPupil: 'Total Por Alumno',
    sarcRestricted: 'Restringido',
    sarcUnrestricted: 'No Restringido',
    sarcEstSchoolCost: 'Costo Est. Escolar',
    sarcAvgTeacherSalary: 'Salario Prom. Maestro',
    sarcDistrictLabel: 'Distrito',
    sarcPtoPerPupil: 'PTO/PTA Por Alumno',
    sarcNoPto: 'Apoyado por <a href="https://www.rcef.org/" target="_blank">RCEF</a>',
    sarcExpenditureNote: 'Datos de gastos por alumno del SARC 2022-23. Los fondos restringidos incluyen Título I, educación especial y programas para estudiantes de inglés. Los fondos no restringidos son operación general. Ingresos de PTO/PTA de declaraciones IRS Form 990.',
    spsaBudget: 'Suplementario (SPSA)',
    perPupil: 'SPSA Por Alumno',
    fundingBreakdown: 'Desglose de Fuentes SPSA',
    titleI: 'Título I',
    districtFunds: 'Distrito',
    ptoPta: 'PTO/PTA',
    measureU: 'Medida U',
    prop28: 'Prop 28',
    receivesTitle1: 'Esta escuela recibe financiamiento federal del Título I.',
    noTitle1: 'Esta escuela no recibe financiamiento federal del Título I.',
    atsiNote: 'Esta escuela está designada como ATSI (Apoyo y Mejora Adicional Dirigido).',
    spsaNote: 'Los presupuestos SPSA representan gastos suplementarios a nivel de sitio (enriquecimiento, consejería, desarrollo profesional, materiales). Los costos operativos base (salarios de maestros, administración, instalaciones) provienen del fondo general y varían por escuela.',
    credentialsHeading: 'Credenciales',
    fullyCredentialed: 'Con Credencial Completa',
    misassigned: 'Asignación Incorrecta',
    elMisassigned: 'Asignación Incorrecta EL',
    districtAvgCredentialed: 'Promedio del distrito: 75%',
    districtTarget: 'Meta del distrito: 100% para 2027',
    misassignedExplainer: '"Asignación incorrecta" significa que pusieron a un maestro en una clase para la que no tiene credencial — más seguido en clases con estudiantes que están aprendiendo inglés (EL).',
    teacherDemoHighlights: 'Datos demográficos del personal docente',
    hispanicStaff: 'Personal hispano',
    whiteStaff: 'Personal blanco',
    over55: 'Personal mayor de 55',
    under35: 'Personal menor de 35',
    sarc: 'Informe de Responsabilidad Escolar (SARC)',
    sarcDesc: 'Una boleta anual que el estado le exige a cada escuela: puntajes, tamaños de clase, credenciales de maestros y condiciones del campus en un solo PDF.',
    spsa: 'Plan Escolar para el Logro Estudiantil (SPSA)',
    spsaDesc: 'El plan anual de la escuela sobre cómo gasta su dinero extra ("suplementario") — tutoría, consejeros, materiales y más.',
    viewSarc: 'Descargar SARC (PDF)',
    viewSpsa: 'Descargar SPSA (PDF)',
    safetyPlan: 'Plan Integral de Seguridad',
    boardPresentation: 'Presentación a la Junta',
    sitePresentations: 'Presentaciones de la escuela a la Junta',
    sitePresentationsDesc: 'Presentaciones anuales que esta escuela hizo a la Junta de Síndicos.',
    viewPresentation: 'Ver presentación (PDF)',
    watchPresentation: 'Ver video',
    viewCssp: 'Descargar CSSP (PDF)',
    csspDesc: 'Plan 2025-26, aprobado por la junta el 4 de feb de 2026.',
    bellSchedule: 'Horario Escolar',
    regularDays: 'Regular',
    regularDaysSub: 'lun · mar · mié · vie',
    thursdayEarlyRelease: 'Jueves',
    superMinDays: 'Súper-mín',
    supervisionStarts: 'Supervisión comienza',
    grade: 'Grado',
    dismissal: 'Salida',
    lunchMenu: 'Menú de Almuerzo',
    schoolSiteCouncil: 'Consejo del Sitio Escolar',
    sscChair: 'Presidente',
    sscAdopted: 'SPSA adoptado',
    sscRolePrincipal: 'Director(a)',
    sscRoleTeacher: 'Maestro(a)',
    sscRoleStaff: 'Personal',
    sscRoleParent: 'Padre / Comunidad',
    sscMemberName: 'Nombre',
    sscMemberRole: 'Rol',
    sscMeetings: 'Reuniones',
    sscMeetingAgenda: 'Agenda',
    sscMeetingMinutes: 'Acta',
    sscSubscribeTitle: 'Suscribirse al calendario',
    sscSubscribeDesc: 'Sincronice las reuniones de SSC con su calendario de Apple, Google o Outlook.',
    ptoPtaOrg: 'PTO / PTA',
    afterSchool: 'Programas Extracurriculares',
    parentComm: 'Comunicación con Padres',
    absenceReporting: 'Reportar una Ausencia',
    joinKonstella: 'Unirse en Konstella',
    joinPlatform: 'Unirse',
    comingSoon: 'Próximamente',
    viewMenu: 'Ver menú',
    visitWebsite: 'Visitar sitio web de PTO/PTA',
    schoolWebsite: 'Sitio web de la escuela',
    backToDistrict: 'Todas las escuelas',
    disclaimer: '<strong>Documento borrador.</strong> Preparado personalmente por David Weekly; esto no es una representación del distrito o de la Mesa Directiva y puede contener errores materiales. Para información oficial, visite <a href="https://www.rcsdk8.net" style="color:#664d03; text-decoration:underline">rcsdk8.net</a>.',
    langSwitch: 'Read in English',
    sourceNote: 'Fuentes: SARCs 2024-25, SPSAs 2025-26, LCAP 2025-26, presentaciones 2025-26 de cada escuela a la Mesa Directiva. Competencia del CAASPP 2023-24. Crecimiento de la evaluación diagnóstica de medio año i-Ready 2025-26 reportada a la Mesa.',
    chronicAbsentNote: 'reportado como 0% -- probablemente un error de datos',
    address: 'Dirección',
    phone: 'Teléfono',
    start: 'Inicio',
    end: 'Fin',
    earlyRelease: 'Salida temprana',
    boardMeetings: 'Reuniones de la Mesa Directiva',
    boardMeetingsDesc: 'Reuniones de la Mesa Directiva con temas de agenda que mencionan esta escuela.',
    watchVideo: 'Ver video',
    viewAttachments: 'Documentos',
    viewFullMeeting: 'Reunión completa',
    noBoardItems: 'No se encontraron temas de reuniones de la mesa directiva para esta escuela.',
    cdeAbsenteeismBreakdown: 'Ausentismo Crónico por Subgrupo',
    cdeAbsenteeismNote: 'Tasa de ausentismo crónico por subgrupo estudiantil. Un estudiante está crónicamente ausente si falta el 10% o más de los días de clases — como 18 días al año. Los grupos muy chicos (menos de 10 estudiantes) no se muestran, para proteger la privacidad. Fuente: Departamento de Educación de California, 2024-25.',
    cdeLtelHeading: 'Estudiantes de Inglés: una mirada más de cerca',
    cdeElStudents: 'Aprendiendo Inglés',
    cdeLtelCount: 'A Largo Plazo (LTEL)',
    cdeLtelCountNote: '6+ años como Estudiante de Inglés',
    cdeAtRisk: 'En Riesgo de LTEL',
    cdeAtRiskNote: '4-5 años como Estudiante de Inglés',
    cdeReclassified: 'Ya Dominan el Inglés (RFEP)',
    cdeReclassifiedNote: 'Pasaron el examen y salieron del programa',
    cdeLtelExplainer: 'Un "Estudiante de Inglés a largo plazo" (LTEL) es un estudiante que lleva 6 años o más aprendiendo inglés sin llegar a dominarlo; los que llevan 4-5 años cuentan como "en riesgo" de volverse de largo plazo. Las escuelas vigilan estos números porque la meta es que los estudiantes dominen el inglés mucho antes de los 6 años.',
    cdeLtelElementaryNote: 'California empieza a contar a los estudiantes como LTEL hasta el 6º grado, así que las escuelas primarias siempre muestran cero.',
    cdeLtelSource: 'Fuente: datos de Estudiantes de Inglés (ELAS/LTEL) del <a href="https://dq.cde.ca.gov/dataquest/longtermel/" target="_blank">Departamento de Educación de California</a>, año escolar 2024-25.',
    cdeSuppressed: 'menos de 10',
    cdeStaffDiversity: 'Raza y Etnicidad de los Maestros',
    cdeStaffDiversityNote: 'Cuenta solo a los maestros de salón. Fuente: datos de personal del <a href="https://www.cde.ca.gov/ds/ad/fsspre.asp" target="_blank">Departamento de Educación de California</a>, año escolar 2024-25.',
    cdeNotReported: 'No reportado',
    cdeTeachers: 'Maestros',
    cdeAvgYears: 'Años Promedio Enseñando',
    cdeInexperienced: 'Maestros Nuevos',
    cdeInexperiencedNote: 'En su 1er o 2º año enseñando',
    cdePupilTeacher: 'Estudiantes por Maestro',
    cdePupilCounselor: 'Estudiantes por Consejero',
    cdeCounselorNote: 'Consejeros, psicólogos, trabajadores sociales y enfermeras',
    cdeCounselorSuppressed: 'CDE reporta menos de un puesto de tiempo completo aquí',
    cdeStaffSource: 'Fuente: datos de personal del <a href="https://www.cde.ca.gov/ds/ad/fsspex.asp" target="_blank">Departamento de Educación de California</a>, año escolar 2024-25.',
  },
};

// ---- Bell schedule HTML helper ----

function expandGrades(rangeStr) {
  // Expand "TK-5" → ["TK","K","1","2","3","4","5"], "6-8" → ["6","7","8"], "TK" → ["TK"]
  const ALL = ['TK','K','1','2','3','4','5','6','7','8'];
  const s = rangeStr.trim();
  if (!s.includes('-')) return [s];
  const [lo, hi] = s.split('-');
  const loIdx = ALL.indexOf(lo);
  const hiIdx = ALL.indexOf(hi);
  if (loIdx === -1 || hiIdx === -1) return [s];
  return ALL.slice(loIdx, hiIdx + 1);
}

function compactGradeLabel(grades) {
  const ALL = ['TK','K','1','2','3','4','5','6','7','8'];
  // Map grades to indices, sort, then find contiguous runs
  const indices = [...new Set(grades.map(g => ALL.indexOf(g)))].filter(i => i >= 0).sort((a,b) => a - b);
  if (indices.length === 0) return grades.join(', ');
  if (indices.length === 1) return ALL[indices[0]];
  // Check if contiguous
  const isContiguous = indices.every((v, i) => i === 0 || v === indices[i-1] + 1);
  if (isContiguous) {
    return `${ALL[indices[0]]}-${ALL[indices[indices.length - 1]]}`;
  }
  // Non-contiguous: return comma-separated
  return indices.map(i => ALL[i]).join(', ');
}

function renderBellScheduleHTML(bs, L) {
  if (!bs.regular) {
    return `<p>${L.start}: ${bs.start}<br>${L.end}: ${bs.end}<br>${L.earlyRelease}: ${bs.earlyRelease}</p>`;
  }

  // Build a unified lookup: grade → { start, end, earlyEnd, superMinEnd }
  const gradeOrder = [];
  const gradeMap = {};
  for (const r of bs.regular) {
    gradeOrder.push(r.grades);
    gradeMap[r.grades] = { start: r.start, end: r.end, earlyEnd: null, superMinEnd: null };
  }

  // Match early release times to regular grade rows using grade set overlap
  for (const r of bs.earlyRelease) {
    const earlySet = new Set(expandGrades(r.grades));
    for (const g of gradeOrder) {
      if (gradeMap[g].earlyEnd) continue; // already matched
      const regSet = expandGrades(g);
      if (regSet.some(grade => earlySet.has(grade))) {
        gradeMap[g].earlyEnd = r.end;
      }
    }
  }

  // Match super-minimum times the same way
  if (bs.superMinimum) {
    for (const r of bs.superMinimum) {
      const smSet = new Set(expandGrades(r.grades));
      for (const g of gradeOrder) {
        if (gradeMap[g].superMinEnd) continue;
        const regSet = expandGrades(g);
        if (regSet.some(grade => smSet.has(grade))) {
          gradeMap[g].superMinEnd = r.end;
        }
      }
    }
  }

  const hasSuperMin = bs.superMinimum && bs.superMinimum.length > 0;

  // Merge consecutive rows with identical times to keep the table simple
  const mergedRows = [];
  for (const g of gradeOrder) {
    const d = gradeMap[g];
    const key = `${d.start}|${d.end}|${d.earlyEnd || ''}|${d.superMinEnd || ''}`;
    const prev = mergedRows.length > 0 ? mergedRows[mergedRows.length - 1] : null;
    if (prev && prev._key === key) {
      // Merge grade labels: expand both into individual grades and combine
      const prevGrades = expandGrades(prev.label);
      const curGrades = expandGrades(g);
      const allGrades = [...prevGrades, ...curGrades];
      // Build a compact label from the combined range
      prev.label = compactGradeLabel(allGrades);
    } else {
      mergedRows.push({ label: g, ...d, _key: key });
    }
  }

  let html = '';
  if (bs.supervision) {
    html += `<p class="bell-supervision">${L.supervisionStarts}: ${bs.supervision}</p>`;
  }

  html += '<div class="bell-card-inner"><table class="bell-table">';
  html += `<thead><tr>
    <th scope="col"><span class="bell-col-label">${L.grade}</span></th>
    <th scope="col"><span class="bell-col-label">${L.regularDays}</span><span class="bell-col-sub">${L.regularDaysSub}</span></th>
    <th scope="col"><span class="bell-col-label">${L.thursdayEarlyRelease}</span></th>
    ${hasSuperMin ? `<th scope="col"><span class="bell-col-label">${L.superMinDays}</span></th>` : ''}
  </tr></thead><tbody>`;

  for (const row of mergedRows) {
    html += `<tr>
      <td class="bell-grade">${row.label}</td>
      <td><span class="bell-time-range">${row.start}<span class="bell-dash"> – </span>${row.end}</span></td>
      <td>${row.earlyEnd || '—'}</td>
      ${hasSuperMin ? `<td>${row.superMinEnd || '—'}</td>` : ''}
    </tr>`;
  }

  html += '</tbody></table></div>';
  return html;
}

// ---- JSON-LD Generator ----

function schoolJsonLd(school, data, lang) {
  const isEs = lang === 'es';
  const slug = school.slug;
  const displayName = isEs ? school.nameEs : school.name;
  const description = isEs ? data.descriptionEs : data.description;
  const enPath = `/schools/${slug}/`;
  const esPath = `/escuelas/${slug}/`;
  const canonicalUrl = `https://rcsd.info${isEs ? esPath : enPath}`;

  let types = "School";
  if (school.grades === "6-8") {
    types = "MiddleSchool";
  } else if (school.grades === "TK-5" || school.grades === "K-5") {
    types = "ElementarySchool";
  } else {
    types = ["ElementarySchool", "MiddleSchool"];
  }

  const schoolId = `https://rcsd.info/schools/${slug}/#school`;
  const pageId = `https://rcsd.info${isEs ? esPath : enPath}#webpage`;

  const schoolSchema = {
    "@type": types,
    "@id": schoolId,
    "name": displayName,
    "description": description,
    "url": `https://rcsd.info/schools/${slug}/`,
    "telephone": school.phone ? `+1-${school.phone.replace(/[()]/g, '').replace(/\s+/g, '-').trim()}` : "",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": school.address.split(',')[0].trim(),
      "addressLocality": school.address.split(',')[1]?.trim() || "Redwood City",
      "addressRegion": "CA",
      "postalCode": school.address.match(/\d{5}/)?.[0] || "94063",
      "addressCountry": "US"
    },
    "parentOrganization": {
      "@type": "GovernmentOrganization",
      "name": isEs ? "Distrito Escolar de Redwood City" : "Redwood City School District",
      "url": "https://www.rcsdk8.net"
    }
  };

  const logoExt = slug === 'clifford' ? 'png' : 'jpg';
  schoolSchema.image = `https://data.rcsd.info/logos/${slug}.${logoExt}`;

  if (school.principal) {
    schoolSchema.employee = {
      "@type": "Person",
      "name": school.principal,
      "jobTitle": isEs ? "Director/a" : "Principal"
    };
  }

  if (school.enrollment) {
    schoolSchema.additionalProperty = {
      "@type": "PropertyValue",
      "name": isEs ? "Matrícula" : "Student Enrollment",
      "value": school.enrollment
    };
  }

  const sameAs = [school.website];
  if (school.cdsCode) {
    sameAs.push(`https://www.caschooldashboard.org/reports/${school.cdsCode}/2024`);
  }
  if (school.greatSchools?.url) {
    sameAs.push(school.greatSchools.url);
  }
  schoolSchema.sameAs = sameAs;

  if (school.bellSchedule && school.bellSchedule.regular) {
    const regularSchedule = school.bellSchedule.regular;
    const earlyReleaseSchedule = school.bellSchedule.earlyRelease;
    const earlyDay = school.bellSchedule.earlyReleaseDay || 'Thursday';

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const regDays = days.filter(d => d.toLowerCase() !== earlyDay.toLowerCase());

    const specs = [];
    const primaryReg = regularSchedule[regularSchedule.length - 1] || regularSchedule[0];
    if (primaryReg && primaryReg.start && primaryReg.end) {
      const formatTime = (tStr) => {
        const [time, ampm] = tStr.split(' ');
        let [h, m] = time.split(':');
        let hours = parseInt(h);
        if (ampm === 'PM' && hours < 12) hours += 12;
        if (ampm === 'AM' && hours === 12) hours = 0;
        return `${String(hours).padStart(2, '0')}:${m}:00`;
      };
      
      try {
        const opens = formatTime(primaryReg.start);
        const closes = formatTime(primaryReg.end);
        
        specs.push({
          "@type": "OpeningHoursSpecification",
          "dayOfWeek": regDays,
          "opens": opens,
          "closes": closes
        });

        const primaryEarly = earlyReleaseSchedule?.[earlyReleaseSchedule.length - 1] || earlyReleaseSchedule?.[0];
        if (primaryEarly && primaryEarly.end) {
          const earlyCloses = formatTime(primaryEarly.end);
          specs.push({
            "@type": "OpeningHoursSpecification",
            "dayOfWeek": [earlyDay],
            "opens": opens,
            "closes": earlyCloses,
            "description": isEs ? "Horario de salida temprana" : "Early Release Bell Schedule"
          });
        }
      } catch (e) {
        // Ignored
      }
    }

    if (specs.length > 0) {
      schoolSchema.openingHoursSpecification = specs;
    }
  }

  if (slug === 'adelante-selby' || slug === 'garfield' || slug === 'taft') {
    schoolSchema.knowsLanguage = [
      { "@type": "Language", "name": "English", "alternateName": "en" },
      { "@type": "Language", "name": "Spanish", "alternateName": "es" }
    ];
  } else if (slug === 'orion') {
    schoolSchema.knowsLanguage = [
      { "@type": "Language", "name": "English", "alternateName": "en" },
      { "@type": "Language", "name": "Mandarin Chinese", "alternateName": "zh" }
    ];
  }

  // Construct WebPage container pointing to the school as its main entity/subject
  const pageSchema = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    "@id": pageId,
    "url": canonicalUrl,
    "name": displayName,
    "description": description,
    "inLanguage": isEs ? "es" : "en",
    "about": schoolSchema
  };

  if (isEs) {
    pageSchema.translationOfWork = {
      "@type": "AboutPage",
      "@id": `https://rcsd.info${enPath}#webpage`,
      "url": `https://rcsd.info${enPath}`,
      "inLanguage": "en"
    };
  } else {
    pageSchema.workTranslation = {
      "@type": "AboutPage",
      "@id": `https://rcsd.info${esPath}#webpage`,
      "url": `https://rcsd.info${esPath}`,
      "inLanguage": "es"
    };
  }

  return `<script type="application/ld+json">\n${JSON.stringify(pageSchema, null, 2)}\n</script>`;
}

// ---- HTML generation ----

function buildSchoolPage(school, data, lang) {
  const L = LABELS[lang];
  const isEs = lang === 'es';
  const name = school.name;
  const nameEs = school.nameEs;
  const displayName = isEs ? nameEs : name;
  const slug = school.slug;

  const enPath = `/schools/${slug}/`;
  const esPath = `/escuelas/${slug}/`;
  const altLangHref = isEs ? enPath : esPath;

  const description = isEs ? data.descriptionEs : data.description;
  const notes = isEs ? data.notesEs : data.notes;

  const schoolTypeLabel = school.type === 'choice' ? L.choice : L.neighborhood;
  const programLabel = isEs ? school.programEs : school.program;

  // Funding bar segments
  const fundingSources = [
    { key: 'titleI', amount: data.funding.titleI, color: FUNDING_COLORS.titleI, label: L.titleI },
    { key: 'district', amount: data.funding.district, color: FUNDING_COLORS.district, label: L.districtFunds },
    { key: 'ptoPta', amount: data.funding.ptoPta, color: FUNDING_COLORS.ptoPta, label: L.ptoPta },
    { key: 'measureU', amount: data.funding.measureU, color: FUNDING_COLORS.measureU, label: L.measureU },
    { key: 'prop28', amount: data.funding.prop28, color: FUNDING_COLORS.prop28, label: L.prop28 },
  ].filter(s => s.amount > 0);

  const fundingTotal = data.funding.spsaTotal;
  const fundingBarHtml = fundingSources.map(s =>
    `<div class="funding-bar-segment" style="width:${((s.amount / fundingTotal) * 100).toFixed(1)}%; background:${s.color}"></div>`
  ).join('');
  const fundingLegendHtml = fundingSources.map(s =>
    `<span class="funding-legend-item"><span class="funding-legend-swatch" style="background:${s.color}"></span>${s.label}: ${fmtDollar(s.amount)}</span>`
  ).join('\n          ');

  // SARC expenditure data
  const sarc = SARC_DATA[slug];
  const sarcExp = sarc?.expenditures?.schoolSite;
  const sarcEnrollment = sarc?.enrollment?.total;
  const ptoRevenue = school.pto?.revenue || 0;
  const ptoPerPupil = ptoRevenue > 0 && school.enrollment > 0 ? Math.round(ptoRevenue / school.enrollment) : 0;
  const miBoosterRevenue = school.miBooster?.revenue || 0;
  const miBoosterPerPupil = miBoosterRevenue > 0 && school.enrollment > 0 ? Math.round(miBoosterRevenue / school.enrollment) : 0;
  const communityPerPupil = ptoPerPupil + miBoosterPerPupil;
  const totalPerPupil = sarcExp ? sarcExp.totalPerPupil + communityPerPupil : 0;
  const estSchoolCost = totalPerPupil > 0 && school.enrollment > 0 ? totalPerPupil * school.enrollment : null;

  // Teacher demo highlights
  const demoItems = [];
  if (data.teacherDemo.hispanicStaff !== null) demoItems.push(`${L.hispanicStaff}: ${fmtPct(data.teacherDemo.hispanicStaff)}`);
  if (data.teacherDemo.whiteStaff !== null) demoItems.push(`${L.whiteStaff}: ${fmtPct(data.teacherDemo.whiteStaff)}`);
  if (data.teacherDemo.over55 !== null) demoItems.push(`${L.over55}: ${fmtPct(data.teacherDemo.over55)}`);
  if (data.teacherDemo.under35 !== null) demoItems.push(`${L.under35}: ${fmtPct(data.teacherDemo.under35)}`);

  // Chronic absenteeism note for McKinley
  const chronicAbsentDisplay = data.demographics.chronicAbsent === 0
    ? `0%*`
    : fmtPct(data.demographics.chronicAbsent);
  const chronicAbsentNote = data.demographics.chronicAbsent === 0
    ? `<br><span class="source">* ${L.chronicAbsentNote}</span>`
    : '';

  // SpEd data for this school
  const spedEnroll = SPED_ENROLLMENT.schools?.[slug];
  const spedCat = SPED_CATEGORIES.schools?.[slug];
  const spedIepPct = spedEnroll?.pct ?? null;
  const spedInclusionPct = spedCat?.placement
    ? Math.round(spedCat.placement.regularGt80 / spedCat.placement.total * 1000) / 10
    : null;

  // i-Ready Expected Growth data for this school. Either a populated record
  // with reading/math sub-objects, a pending-status record (HF / NS), or missing.
  const ireadyu = IREADYU_DATA[slug] || null;
  const ireadyuPending = ireadyu?.status === 'pending_25_26_presentation';
  const ireadyuAvailable = ireadyu && !ireadyuPending && ireadyu.reading && ireadyu.math;

  // School logo
  const logoExt = slug === 'clifford' ? 'png' : 'jpg';
  const logoUrl = `https://data.rcsd.info/logos/${slug}.${logoExt}`;

  // Info bubble helper for source attribution
  const sarcPdfUrl = `https://data.rcsd.info/documents/sarc/2024-25/english/${slug}.pdf`;
  const spsaPdfUrl = `https://data.rcsd.info/documents/spsa/2025-26/${slug}.pdf`;
  const dashboardUrl = `https://www.caschooldashboard.org/reports/${school.cdsCode}/2024`;
  const infoBubble = (text, url) => `<span class="info-bubble" tabindex="0"><span class="info-bubble-icon">i</span><span class="info-bubble-tip"><a href="${url}" target="_blank">${text}</a></span></span>`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
${headMeta({
  title: `${displayName} — RCSD Open Data`,
  description: isEs
    ? `Datos públicos de ${displayName}: rendimiento académico, demografía, financiamiento y personal para el año escolar 2025-26.`
    : `Public data for ${displayName}: academic performance, demographics, funding, and staffing for the 2025-26 school year.`,
  canonical: `https://rcsd.info${isEs ? esPath : enPath}`,
  ogLocale: isEs ? 'es_US' : 'en_US',
  ogImageKey: `school-${slug}${isEs ? '-es' : ''}`,
  hreflang: [
    { lang: 'en', href: `https://rcsd.info${enPath}` },
    { lang: 'es', href: `https://rcsd.info${esPath}` },
  ],
  jsonLd: schoolJsonLd(school, data, lang),
  pageCSS: schoolCSS,
})}
</head>
<body>

${siteNav({ activePage: 'schools', lang, altLangHref })}

<header class="site-header">
  <div class="header-inner">
    <div class="header-district"><a href="${isEs ? '/distrito/' : '/district/'}">${isEs ? 'Distrito Escolar de Redwood City' : 'Redwood City School District'}</a></div>
    <img src="${logoUrl}" alt="${displayName}" class="header-logo" width="${LOGO_DIMS[slug]?.w || 1200}" height="${LOGO_DIMS[slug]?.h || 400}" fetchpriority="high">
    <h1 class="header-title">${displayName}</h1>
    <p class="header-subtitle">${description}</p>
    <div style="margin-top:0.8rem">
      <span class="school-badge ${school.type}">${schoolTypeLabel} <span class="info-bubble" tabindex="0"><span class="info-bubble-icon" style="border-color:rgba(255,255,255,0.2);color:rgba(255,255,255,0.4)">i</span><span class="info-bubble-tip">${school.type === 'choice' ? L.choiceTip : L.neighborhoodTip}</span></span></span>${school.communitySchool ? `<span class="school-badge community">${L.communitySchool}</span>` : ''}
    </div>
  </div>
</header>

<div class="disclaimer">
  ${L.disclaimer}
</div>

<div class="lang-switch">
  <a href="${altLangHref}">${L.langSwitch}</a>
</div>

<nav class="toc">
  <div class="toc-inner">
    <a href="#overview">${L.overview}</a>
    <a href="#academics">${L.academics}</a>
    <a href="#demographics">${L.demographics}</a>
    <a href="#funding">${L.funding}</a>
    <a href="#staffing">${L.staffing}</a>
    <a href="#resources">${L.resources}</a>
    <a href="#board">${L.boardMeetings}</a>
  </div>
</nav>

<main class="content">

  <!-- ======== 1. OVERVIEW ======== -->
  <section class="section" id="overview">
    <div class="section-rule"></div>
    <div class="section-num">01</div>
    <h2>${L.overview}</h2>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-card-label">${L.grades}</div>
        <div class="stat-card-value">${school.grades}</div>
        ${school.cspp ? `<div class="stat-card-note"><a href="${L.csppUrl}" target="_blank" rel="noopener">${L.csppNote}</a></div>` : ''}
      </div>
      <div class="stat-card">
        <div class="stat-card-label">${L.enrollment}</div>
        <div class="stat-card-value">${fmt(school.enrollment)} ${infoBubble('SARC 2024-25', sarcPdfUrl)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">${L.highNeed}</div>
        <div class="stat-card-value">${fmtPct(school.highNeedPct)} ${infoBubble('SARC 2024-25', sarcPdfUrl)}</div>
      </div>
    </div>

    <div class="principal-row">
      ${existsSync(resolve(ROOT, 'docs/img/principals', slug + '.jpg')) ? `<div style="flex-shrink:0">
        <a href="${school.website}/our-school/meet-our-school-leadership"><img src="/img/principals/${slug}.jpg" alt="${school.principal}" width="300" height="${jpegHeight(resolve(ROOT, 'docs/img/principals', slug + '.jpg'))}" loading="lazy" style="width:160px; height:213px; object-fit:cover; border-radius:10px; display:block"></a>
        <div style="text-align:center; margin-top:0.6rem">
          <div style="font-family:'IBM Plex Mono',monospace; font-size:0.6rem; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-muted)">${L.principal}</div>
          <div style="font-size:1.05rem; font-weight:500; margin-top:0.15rem"><a href="${school.website}/our-school/meet-our-school-leadership" style="color:var(--green-mid); text-decoration:none">${school.principal}</a></div>
        </div>
      </div>` : ''}
      <div class="table-wrap" style="flex:1; margin:0">
        <table>
          <tbody>
            <tr><td class="label-cell">${L.schoolType}</td><td>${schoolTypeLabel}</td></tr>${programLabel ? `
            <tr><td class="label-cell">${L.program}</td><td>${programLabel}</td></tr>` : ''}${school.communitySchool ? `
            <tr><td class="label-cell">${L.communitySchool}</td><td>${isEs ? 'Sí' : 'Yes'}</td></tr>` : ''}
            <tr><td class="label-cell">${L.address}</td><td>${school.address}</td></tr>
            <tr><td class="label-cell">${L.phone}</td><td>${school.phone}</td></tr>
            <tr><td class="label-cell">${L.schoolWebsite}</td><td><a href="${school.website}">${school.website.replace('https://', '')}</a></td></tr>${school.greatSchools ? `
            <tr><td class="label-cell">GreatSchools</td><td><a href="${school.greatSchools.url}" target="_blank" rel="noopener">${school.greatSchools.rating != null ? `${school.greatSchools.rating}/10` : (isEs ? 'Ver perfil' : 'View profile')} <span style="font-size:0.8em">&#8599;</span></a></td></tr>` : ''}
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <!-- ======== 2. ACADEMIC PERFORMANCE ======== -->
  <section class="section" id="academics">
    <div class="section-rule"></div>
    <div class="section-num">02</div>
    <h2>${L.academics}</h2>

    <h3>${L.studentGrowth}</h3>

    ${ireadyuPending ? `
    <div class="callout" style="background:#f6f6f6; border-color:#ddd">
      <p><strong>${L.growthPendingHeadline}</strong> ${L.growthPendingBody(ireadyu.lastPresentation.date, ireadyu.lastPresentation.pdfUrl)}</p>
    </div>
    ` : ireadyuAvailable ? (() => {
      const r = ireadyu.reading;
      const m = ireadyu.math;
      // Prefer mid-year 25-26 when present; fall back to year-1 24-25 actual.
      const rVal = r.y2_25_26_midyear ?? r.y1_24_25_actual;
      const mVal = m.y2_25_26_midyear ?? m.y1_24_25_actual;
      const rYearLbl = r.y2_25_26_midyear != null ? L.growthYearMidYear : L.growthYearY1Actual;
      const mYearLbl = m.y2_25_26_midyear != null ? L.growthYearMidYear : L.growthYearY1Actual;
      const rReadingUrl = `${ireadyu.source.pdfUrl}#page=${r.source?.pdfPage ?? ''}`;
      const mReadingUrl = `${ireadyu.source.pdfUrl}#page=${m.source?.pdfPage ?? ''}`;
      const sourceLink = (url, page) =>
        `<a class="source-link" href="${url}" target="_blank" rel="noopener">${L.sourceLinkLabel(ireadyu.source.presentationDate, page)} &rarr;</a>`;
      return `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-card-label">${L.elaGrowth}</div>
        <div class="stat-card-value">${fmtPct(rVal)}</div>
        <div class="stat-card-note">${rYearLbl} &middot; ${L.districtAvg} ${fmtPct(DISTRICT_IREADYU.reading)}</div>
        <div class="stat-card-source">${sourceLink(rReadingUrl, r.source?.pdfPage)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">${L.mathGrowth}</div>
        <div class="stat-card-value">${fmtPct(mVal)}</div>
        <div class="stat-card-note">${mYearLbl} &middot; ${L.districtAvg} ${fmtPct(DISTRICT_IREADYU.math)}</div>
        <div class="stat-card-source">${sourceLink(mReadingUrl, m.source?.pdfPage)}</div>
      </div>
    </div>`;
    })() : ''}

    <h3>${L.caasppProficiency}</h3>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-card-label">${L.elaProficiency}</div>
        <div class="stat-card-value">${fmtPct(data.caaspp.ela)} ${infoBubble('SARC 2024-25', sarcPdfUrl)}</div>
        <div class="stat-card-note"><span class="bar ${barClass(data.caaspp.ela)}" style="width:${barWidth(data.caaspp.ela)}px"></span>${L.districtAvgEla}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">${L.mathProficiency}</div>
        <div class="stat-card-value">${fmtPct(data.caaspp.math)} ${infoBubble('SARC 2024-25', sarcPdfUrl)}</div>
        <div class="stat-card-note"><span class="bar ${barClass(data.caaspp.math)}" style="width:${barWidth(data.caaspp.math)}px"></span>${L.districtAvgMath}</div>
      </div>
    </div>

    <div class="callout">
      <p>${L.growthNote}</p>
    </div>

    <p class="source">${L.growthFinePrint}</p>
    <p class="source">${L.sourceNote}</p>
  </section>

  <!-- ======== 3. STUDENT DEMOGRAPHICS ======== -->
  <section class="section" id="demographics">
    <div class="section-rule"></div>
    <div class="section-num">03</div>
    <h2>${L.demographics}</h2>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-card-label">${L.sed}</div>
        <div class="stat-card-value">${fmtPct(data.demographics.sed)} ${infoBubble('SARC 2024-25', sarcPdfUrl)}</div>
        <div class="stat-card-note">${L.sedNote}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">${L.el}</div>
        <div class="stat-card-value">${fmtPct(data.demographics.el)} ${infoBubble('SARC 2024-25', sarcPdfUrl)}</div>
        <div class="stat-card-note">${L.elNote}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">${L.chronicAbsent} ${infoBubble(L.chronicAbsentTip, dashboardUrl)}</div>
        <div class="stat-card-value">${chronicAbsentDisplay} ${infoBubble('CA Dashboard', dashboardUrl)}</div>
        <div class="stat-card-note">${L.districtAvgAbsent}${chronicAbsentNote}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">${L.suspension}</div>
        <div class="stat-card-value">${fmtPct(data.demographics.suspension)} ${infoBubble('CA Dashboard', dashboardUrl)}</div>
        <div class="stat-card-note">${L.districtAvgSuspension}</div>
      </div>
      ${spedIepPct !== null ? `<div class="stat-card">
        <div class="stat-card-label">${L.iepRate}</div>
        <div class="stat-card-value">${fmtPct(spedIepPct)} ${infoBubble('CDE Census 2024-25', 'https://www.cde.ca.gov/ds/ad/filesenrcensus.asp')}</div>
        <div class="stat-card-note">${isEs ? 'Promedio del distrito' : 'District avg'}: ${fmtPct(districtSpedPct)}</div>
      </div>` : ''}
      ${spedInclusionPct !== null ? `<div class="stat-card">
        <div class="stat-card-label">${L.inclusionRate} ${infoBubble(L.inclusionTip, 'https://www.cde.ca.gov/ds/ad/filesspedps.asp')}</div>
        <div class="stat-card-value">${fmtPct(spedInclusionPct)}</div>
        <div class="stat-card-note">${isEs ? 'Promedio del distrito' : 'District avg'}: ${fmtPct(districtInclusionPct)}</div>
      </div>` : ''}
    </div>

    ${(() => {
      const absent = CDE_ABSENT[slug];
      if (!absent) return '';
      // Show key subgroups: race/ethnicity + program categories
      const show = ['TA','RH','RW','RA','RB','RT','SE','SD','SS','SH'];
      const labels = isEs ? ABSENT_LABELS_ES : ABSENT_LABELS;
      const rows = show.filter(k => absent[k]?.rate !== null).map(k => {
        const d = absent[k];
        return `<tr${k === 'TA' ? ' class="total-row"' : ''}><td class="label-cell">${labels[k] || k}</td><td class="num">${d.rate}%</td><td class="num">${fmt(d.count)}</td><td class="num">${fmt(d.enrolled)}</td></tr>`;
      }).join('');
      if (!rows) return '';
      return `
        <h3 style="margin-top:2rem">${L.cdeAbsenteeismBreakdown}</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>${isEs ? 'Subgrupo' : 'Subgroup'}</th><th class="num">${isEs ? 'Tasa' : 'Rate'}</th><th class="num">${isEs ? 'Ausentes' : 'Absent'}</th><th class="num">${isEs ? 'Inscritos' : 'Enrolled'}</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <p class="source">${L.cdeAbsenteeismNote}</p>`;
    })()}

    ${(() => {
      // CDE ELAS/LTEL detail. Skips schools absent from the file (e.g.
      // charters) or with no EL students. A null cell means CDE suppressed a
      // small count for privacy — render it as "fewer than 10", never 0.
      const ltel = CDE_LTEL[slug];
      if (!ltel || !ltel.el) return '';
      const supp = (v) => (v === null || v === undefined) ? L.cdeSuppressed : fmt(v);
      const elPct = ltel.totalEnrollment ? Math.round(ltel.el / ltel.totalEnrollment * 100) : null;
      // LTEL status only exists for grades 6-12, so TK-5 schools always show 0.
      const maxGrade = parseInt(String(school.grades).split('-').pop(), 10);
      const intro = isEs
        ? `En 2024-25, ${fmt(ltel.el)} de los ${fmt(ltel.totalEnrollment)} estudiantes de esta escuela${elPct !== null ? ` (${elPct}%)` : ''} eran Estudiantes de Inglés — estudiantes que todavía están aprendiendo inglés. Otros ${supp(ltel.rfep)} ya lo dominan: pasaron el examen del estado y fueron "reclasificados" (RFEP).`
        : `In 2024-25, ${fmt(ltel.el)} of this school's ${fmt(ltel.totalEnrollment)} students${elPct !== null ? ` (${elPct}%)` : ''} were English Learners — students who are still learning English. Another ${supp(ltel.rfep)} used to be English Learners and are now fluent: they passed the state's English test and were "reclassified" (RFEP).`;
      return `
        <h3 style="margin-top:2rem">${L.cdeLtelHeading}</h3>
        <p>${intro}</p>
        <div class="stat-grid">
          <div class="stat-card"><div class="stat-card-label">${L.cdeElStudents}</div><div class="stat-card-value">${supp(ltel.el)}</div>${elPct !== null ? `<div class="stat-card-note">${elPct}% ${isEs ? 'de la escuela' : 'of the school'}</div>` : ''}</div>
          <div class="stat-card"><div class="stat-card-label">${L.cdeLtelCount}</div><div class="stat-card-value">${supp(ltel.ltel)}</div><div class="stat-card-note">${L.cdeLtelCountNote}</div></div>
          <div class="stat-card"><div class="stat-card-label">${L.cdeAtRisk}</div><div class="stat-card-value">${supp(ltel.atRisk)}</div><div class="stat-card-note">${L.cdeAtRiskNote}</div></div>
          <div class="stat-card"><div class="stat-card-label">${L.cdeReclassified}</div><div class="stat-card-value">${supp(ltel.rfep)}</div><div class="stat-card-note">${L.cdeReclassifiedNote}</div></div>
        </div>
        <p>${L.cdeLtelExplainer}${maxGrade < 6 ? ` ${L.cdeLtelElementaryNote}` : ''}</p>
        <p class="source">${L.cdeLtelSource}</p>`;
    })()}
  </section>

  <!-- ======== 4. FUNDING ======== -->
  <section class="section" id="funding">
    <div class="section-rule"></div>
    <div class="section-num">04</div>
    <h2>${L.funding}</h2>

    ${sarcExp ? `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-card-label">${L.sarcTotalPerPupil}</div>
        <div class="stat-card-value">$${fmt(totalPerPupil)} ${infoBubble('SARC 2024-25', sarcPdfUrl)}</div>
        <div class="stat-card-note">${isEs ? 'Distrito' : 'District'}: $${fmt(sarcExp.totalPerPupil)}${communityPerPupil > 0 ? ` + ${isEs ? 'comunidad' : 'community'}: $${fmt(communityPerPupil)}` : ''}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">${L.sarcEstSchoolCost}</div>
        <div class="stat-card-value">${fmtDollar(estSchoolCost)} ${infoBubble('SARC 2024-25', sarcPdfUrl)}</div>
        <div class="stat-card-note">${L.sarcRestricted}: $${fmt(sarcExp.restrictedPerPupil)} · ${L.sarcUnrestricted}: $${fmt(sarcExp.unrestrictedPerPupil)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">${L.sarcAvgTeacherSalary}</div>
        <div class="stat-card-value">$${fmt(sarcExp.avgTeacherSalary)} ${infoBubble('SARC 2024-25', sarcPdfUrl)}</div>
        <div class="stat-card-note">${L.sarcDistrictLabel}: $${fmt(sarc.expenditures.district.avgTeacherSalary)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">${L.sarcPtoPerPupil}</div>
        <div class="stat-card-value">${communityPerPupil > 0 ? '$' + fmt(communityPerPupil) : '\u2014'}</div>
        <div class="stat-card-note">${school.pto?.revenue ? '<a href="' + school.pto.sourceUrl + '" target="_blank">' + fmtDollar(ptoRevenue) + ' ' + (isEs ? 'ingresos anuales' : 'annual revenue') + ' (IRS 990) &#8599;</a>' : L.sarcNoPto}${school.miBooster?.revenue ? '<br><a href="' + school.miBooster.sourceUrl + '" target="_blank">+ ' + fmtDollar(miBoosterRevenue) + ' RCMIS (IRS 990) &#8599;</a>' : ''}</div>
      </div>
    </div>

    <div class="callout">
      <p>${L.sarcExpenditureNote}</p>
    </div>
    ` : ''}

    <h3 style="margin-top:2rem">${isEs ? 'Financiamiento Suplementario del Sitio (SPSA) 2025-26' : 'Site Supplemental (SPSA) 2025-26'}</h3>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-card-label">${L.spsaBudget}</div>
        <div class="stat-card-value">${fmtDollar(data.funding.spsaTotal)} ${infoBubble('SPSA 2025-26', spsaPdfUrl)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">${L.perPupil}</div>
        <div class="stat-card-value">$${fmt(data.funding.perPupil)} ${infoBubble('SPSA 2025-26', spsaPdfUrl)}</div>
      </div>
    </div>

    <h3>${L.fundingBreakdown}</h3>

    <div class="funding-bar">
      ${fundingBarHtml}
    </div>
    <div class="funding-legend">
      ${fundingLegendHtml}
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>${isEs ? 'Fuente' : 'Source'}</th>
            <th class="num">${isEs ? 'Monto' : 'Amount'}</th>
            <th class="num">${isEs ? '% del Total' : '% of Total'}</th>
          </tr>
        </thead>
        <tbody>
          ${fundingSources.map(s => `<tr>
            <td class="label-cell">${s.label}</td>
            <td class="num">${fmtDollar(s.amount)}</td>
            <td class="num">${((s.amount / fundingTotal) * 100).toFixed(0)}%</td>
          </tr>`).join('\n          ')}
          <tr class="total-row">
            <td class="label-cell">Total</td>
            <td class="num">${fmtDollar(fundingTotal)}</td>
            <td class="num">100%</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="callout${data.funding.atsi ? ' callout-amber' : ''}">
      <p>${data.funding.titleISchool ? L.receivesTitle1 : L.noTitle1}${data.funding.atsi ? ` ${L.atsiNote}` : ''}</p>
    </div>

    <p class="source">${L.spsaNote}</p>
  </section>

  <!-- ======== 5. WHO TEACHES HERE ======== -->
  <section class="section" id="staffing">
    <div class="section-rule"></div>
    <div class="section-num">05</div>
    <h2>${L.staffing}</h2>

    ${(() => {
      // CDE staffing basics. Each lookup is independent so a school missing
      // from one CDE file still renders whatever the other files have.
      const exp = CDE_STAFF_EXP[slug];
      const ratios = CDE_RATIOS[slug];
      if (!exp && !ratios) return '';
      const dRatio = CDE_RATIOS.district?.studentTeacherRatio;
      const intro = (exp && ratios)
        ? (isEs
          ? `${displayName} tiene ${fmt(exp.total)} maestros para ${fmt(ratios.enrollment)} estudiantes — como ${Math.round(ratios.studentTeacherRatio)} estudiantes por maestro. En promedio, sus maestros llevan ${exp.avgYearsTotal} años enseñando, y ${fmt(exp.inexperienced)} de los ${fmt(exp.total)} están en su primer o segundo año.`
          : `${displayName} has ${fmt(exp.total)} teachers for ${fmt(ratios.enrollment)} students — about ${Math.round(ratios.studentTeacherRatio)} students per teacher. On average, its teachers have been teaching for ${exp.avgYearsTotal} years, and ${fmt(exp.inexperienced)} of the ${fmt(exp.total)} are in their first or second year.`)
        : '';
      let cards = '';
      if (exp) {
        cards += `
      <div class="stat-card">
        <div class="stat-card-label">${L.cdeTeachers}</div>
        <div class="stat-card-value">${fmt(exp.total)}</div>
      </div>`;
      }
      if (ratios && ratios.studentTeacherRatio !== null) {
        cards += `
      <div class="stat-card">
        <div class="stat-card-label">${L.cdePupilTeacher}</div>
        <div class="stat-card-value">${ratios.studentTeacherRatio}:1</div>
        ${dRatio ? `<div class="stat-card-note">${isEs ? 'Promedio del distrito' : 'District avg'}: ${dRatio}:1</div>` : ''}
      </div>`;
      }
      if (exp) {
        cards += `
      <div class="stat-card">
        <div class="stat-card-label">${L.cdeAvgYears}</div>
        <div class="stat-card-value">${exp.avgYearsTotal}</div>
        <div class="stat-card-note">${exp.avgYearsDistrict} ${isEs ? 'años en RCSD' : 'years in RCSD'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">${L.cdeInexperienced}</div>
        <div class="stat-card-value">${fmt(exp.inexperienced)} / ${fmt(exp.total)}</div>
        <div class="stat-card-note">${L.cdeInexperiencedNote}</div>
      </div>`;
      }
      if (ratios) {
        // null ratio = CDE suppresses the calculation below 1.0 FTE; say so
        // instead of hiding the card (parents ask about counselors a lot).
        cards += ratios.studentPupilServicesRatio ? `
      <div class="stat-card">
        <div class="stat-card-label">${L.cdePupilCounselor}</div>
        <div class="stat-card-value">${ratios.studentPupilServicesRatio}:1</div>
        <div class="stat-card-note">${L.cdeCounselorNote}</div>
      </div>` : `
      <div class="stat-card">
        <div class="stat-card-label">${L.cdePupilCounselor}</div>
        <div class="stat-card-value">&mdash;</div>
        <div class="stat-card-note">${L.cdeCounselorSuppressed}</div>
      </div>`;
      }
      return `${intro ? `<p>${intro}</p>\n` : ''}
    <div class="stat-grid">${cards}
    </div>
    <p class="source">${L.cdeStaffSource}</p>`;
    })()}

    <h3 style="margin-top:2rem">${L.credentialsHeading}</h3>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-card-label">${L.fullyCredentialed}</div>
        <div class="stat-card-value">${fmtPct(data.staffing.credentialed)} ${infoBubble('SARC 2024-25', sarcPdfUrl)}</div>
        <div class="stat-card-note"><span class="bar ${barClass(data.staffing.credentialed)}" style="width:${barWidth(data.staffing.credentialed)}px"></span>${L.districtAvgCredentialed}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">${L.misassigned}</div>
        <div class="stat-card-value">${fmtPct(data.staffing.misassigned)} ${infoBubble('SARC 2024-25', sarcPdfUrl)}</div>
      </div>
      ${data.staffing.elMisassigned !== null ? `<div class="stat-card">
        <div class="stat-card-label">${L.elMisassigned}</div>
        <div class="stat-card-value">${fmtPct(data.staffing.elMisassigned)} ${infoBubble('SARC 2024-25', sarcPdfUrl)}</div>
      </div>` : ''}
    </div>

    <p class="source">${L.misassignedExplainer} ${L.districtTarget}.</p>

    ${demoItems.length > 0 ? `
    <h3>${L.teacherDemoHighlights}</h3>
    <div class="table-wrap">
      <table>
        <tbody>
          ${demoItems.map(item => {
            const [label, value] = item.split(': ');
            return `<tr><td class="label-cell">${label}</td><td class="num">${value}</td></tr>`;
          }).join('\n          ')}
        </tbody>
      </table>
    </div>` : ''}

    ${notes ? `
    <div class="callout">
      <p>${notes}</p>
    </div>` : ''}

    ${(() => {
      // CDE teacher race/ethnicity. notReported gets its own row so the
      // shown rows always sum to the total.
      const eth = CDE_STAFF_ETH[slug];
      if (!eth || !eth.total) return '';
      const cats = [
        ['hispanicLatino', isEs ? 'Hispano/Latino' : 'Hispanic/Latino'],
        ['white', isEs ? 'Blanco' : 'White'],
        ['asian', isEs ? 'Asiático' : 'Asian'],
        ['africanAmerican', isEs ? 'Afroamericano' : 'African American'],
        ['filipino', 'Filipino'],
        ['twoOrMore', isEs ? 'Dos o Más' : 'Two or More'],
        ['pacificIslander', isEs ? 'Isleño del Pacífico' : 'Pacific Islander'],
        ['americanIndian', isEs ? 'Indígena Americano' : 'American Indian'],
        ['notReported', L.cdeNotReported],
      ].filter(([k]) => eth[k] > 0);
      const rows = cats.map(([k, label]) => {
        const pct = (eth[k] / eth.total * 100).toFixed(1);
        return `<tr><td class="label-cell">${label}</td><td class="num">${eth[k]}</td><td class="num">${pct}%</td><td class="bar-cell"><span class="bar" style="width:${barWidth(Number(pct), 80)}px; background:var(--green-light)"></span></td></tr>`;
      }).join('');
      return `
        <h3 style="margin-top:2rem">${L.cdeStaffDiversity}</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th scope="col">${isEs ? 'Raza/Etnicidad' : 'Race/Ethnicity'}</th><th scope="col" class="num">${isEs ? 'Maestros' : 'Teachers'}</th><th scope="col" class="num">%</th><th scope="col">${isEs ? 'Proporción' : 'Share'}</th></tr></thead>
            <tbody>${rows}
            <tr class="total-row"><td class="label-cell">Total</td><td class="num">${eth.total}</td><td class="num">100%</td><td></td></tr></tbody>
          </table>
        </div>
        <p class="source">${L.cdeStaffDiversityNote}</p>`;
    })()}
  </section>

  <!-- ======== 6. DOCUMENTS & RESOURCES ======== -->
  <section class="section" id="resources">
    <div class="section-rule"></div>
    <div class="section-num">06</div>
    <h2>${L.resources}</h2>

    <div class="resource-grid">
      <div class="resource-card">
        <h3>${L.sarc}</h3>
        <p>${L.sarcDesc}</p>
        <p style="margin-top:0.5rem"><a href="https://data.rcsd.info/documents/sarc/2024-25/english/${slug}.pdf" target="_blank">${L.viewSarc}${isEs ? ' (inglés)' : ''} &#8599;</a></p>
      </div>
      <div class="resource-card">
        <h3>${L.spsa}</h3>
        <p>${L.spsaDesc}</p>
        <p style="margin-top:0.5rem"><a href="https://data.rcsd.info/documents/spsa/2025-26/${slug}.pdf" target="_blank">${L.viewSpsa}${isEs ? ' (inglés)' : ''} &#8599;</a></p>
      </div>
      ${(() => {
        const decks = SITE_PRESENTATIONS[slug] || [];
        if (!decks.length) return '';
        const locale = lang === 'es' ? 'es-US' : 'en-US';
        const rows = decks.map(p => {
          const dateStr = new Date(p.meetingDate + 'T12:00:00').toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
          const links = [];
          if (p.pdfUrl) links.push(`<a href="${p.pdfUrl}" target="_blank">${L.viewPresentation} &#8599;</a>`);
          if (p.videoUrl) links.push(`<a href="${p.videoUrl}" target="_blank">&#9654; ${L.watchPresentation}</a>`);
          return `<li style="margin-bottom:0.35rem"><span style="font-family:'IBM Plex Mono',monospace; font-size:0.78rem; color:#666; margin-right:0.5rem">${p.schoolYear}</span><span style="font-size:0.78rem; color:#888; margin-right:0.5rem">${dateStr}</span>${links.join(' &nbsp;·&nbsp; ')}</li>`;
        }).join('');
        return `<div class="resource-card">
        <h3>${L.sitePresentations}</h3>
        <p>${L.sitePresentationsDesc}</p>
        <ul style="list-style:none; padding:0; margin:0.5rem 0 0; font-size:0.82rem">${rows}</ul>
      </div>`;
      })()}
      <div class="resource-card bell-card">
        <h3>${L.bellSchedule}</h3>
        ${renderBellScheduleHTML(school.bellSchedule, L)}
      </div>
      <div class="resource-card">
        <h3>${L.lunchMenu}</h3>
        ${school.lunchUrl
          ? `<p><a href="${school.lunchUrl}" target="_blank">${L.viewMenu} &#8599;</a></p>`
          : `<p class="coming-soon">${L.comingSoon}</p>`}
      </div>
      <div class="resource-card">
        <h3>${L.ptoPtaOrg}</h3>
        ${school.pto?.url
          ? `<p><a href="${school.pto.url}" target="_blank">${school.pto.name || L.visitWebsite} &#8599;</a></p>${rctStatusNote(school.pto, isEs)}`
          : `<p><a href="https://www.rcef.org/" target="_blank">${isEs ? 'Fundación Educativa de Redwood City (RCEF)' : 'Redwood City Education Foundation (RCEF)'} &#8599;</a></p>`}
        ${school.miBooster?.url ? `<p style="margin-top:0.4rem"><a href="${school.miBooster.url}" target="_blank">${school.miBooster.name} &#8599;</a></p>` : ''}
      </div>
      <div class="resource-card">
        <h3>${L.parentComm}</h3>
        <p><a href="${schoolsData.districtLinks.parentSquare}" target="_blank">ParentSquare ${isEs ? '(oficial del distrito)' : '(district-wide)'} &#8599;</a></p>
        ${school.parentLinks?.konstella
          ? `<p><a href="${school.parentLinks.konstella}" target="_blank">${L.joinKonstella} &#8599;</a></p>`
          : school.parentLinks?.platform === 'Konstella'
            ? `<p>Konstella — ${school.parentLinks.konstellaNote || (isEs ? 'contacte al PTO' : 'contact PTO for link')}</p>`
            : school.parentLinks?.platform === 'Membership Toolkit' && school.parentLinks.joinUrl
              ? `<p><a href="${school.parentLinks.joinUrl}" target="_blank">${L.joinPlatform} PTA &#8599;</a></p>`
              : ''}
      </div>
      <div class="resource-card">
        <h3>${L.absenceReporting}</h3>
        <p>SchoolMessenger</p>
        <p><a href="${schoolsData.districtLinks.absenceReporting.ios}" target="_blank">iOS &#8599;</a> · <a href="${schoolsData.districtLinks.absenceReporting.android}" target="_blank">Android &#8599;</a></p>
      </div>
      <div class="resource-card">
        <h3>${L.safetyPlan}</h3>
        ${CSSP_URLS[slug]
          ? `<p>${L.csspDesc}</p><p><a href="${CSSP_URLS[slug]}" target="_blank">${L.viewCssp} &#8599;</a></p>`
          : `<p class="coming-soon">${L.comingSoon}</p>`}
      </div>
      <div class="resource-card">
        <h3>${L.schoolSiteCouncil}</h3>
        ${(() => {
          const ssc = SSC_DATA[slug]?.['2025-26'];
          if (!ssc?.members?.length) return `<p class="coming-soon">${L.comingSoon}</p>`;
          const roleLabel = { principal: L.sscRolePrincipal, classroomTeacher: L.sscRoleTeacher, otherStaff: L.sscRoleStaff, parentCommunity: L.sscRoleParent };
          const adoptedStr = ssc.adoptionDate ? new Date(ssc.adoptionDate + 'T12:00:00').toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
          return `${ssc.chairperson ? `<p style="margin-bottom:0.2rem"><strong>${L.sscChair}:</strong> ${ssc.chairperson}</p>` : ''}
          ${adoptedStr ? `<p style="margin-bottom:0.4rem; font-size:0.82rem; color:#666">${L.sscAdopted}: ${adoptedStr}</p>` : ''}
          <div class="ssc-members">${[['principal', L.sscRolePrincipal], ['classroomTeacher', L.sscRoleTeacher], ['otherStaff', L.sscRoleStaff], ['parentCommunity', L.sscRoleParent]].map(([role, label]) => {
            const names = ssc.members.filter(m => m.role === role).map(m => m.name);
            return names.length ? `<span class="ssc-role">${label}:</span> ${names.join(', ')}` : '';
          }).filter(Boolean).join('<br>')}</div>
          <p style="margin-top:0.5rem"><a href="https://data.rcsd.info/documents/spsa/2025-26/${slug}.pdf" target="_blank">${isEs ? 'Ver SPSA' : 'View SPSA'} &#8599;</a></p>
          ${(() => {
            const meetings = SSC_MEETINGS[slug]?.['2025-26'] || [];
            if (!meetings.length) return '';
            const locale = isEs ? 'es-US' : 'en-US';
            const rows = [...meetings].sort((a, b) => a.date.localeCompare(b.date)).map(m => {
              const dateStr = new Date(m.date + 'T12:00:00').toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
              const links = [];
              if (m.agendaPdf) links.push(`<a href="https://data.rcsd.info/${m.agendaPdf}" target="_blank">${L.sscMeetingAgenda} &#8599;</a>`);
              if (m.minutesPdf) links.push(`<a href="https://data.rcsd.info/${m.minutesPdf}" target="_blank">${L.sscMeetingMinutes} &#8599;</a>`);
              return `<li style="margin-bottom:0.25rem"><span style="font-family:'IBM Plex Mono',monospace; font-size:0.78rem; color:#666; margin-right:0.5rem">${dateStr}</span>${links.join(' &nbsp;·&nbsp; ')}</li>`;
            }).join('');
            const feedFilename = lang === 'en' ? `ssc-${slug}.ics` : `ssc-${slug}-es.ics`;
            const feedUrl = `http://rcsd.info/${feedFilename}`;
            const webcalUrl = `webcal://rcsd.info/${feedFilename}`;
            const gcalUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feedUrl)}`;
            return `<div style="margin-top:0.8rem; padding-top:0.6rem; border-top:1px solid var(--rule-light)">
              <p style="margin:0 0 0.3rem; font-size:0.82rem; font-weight:600">${L.sscMeetings}</p>
              <ul style="list-style:none; padding:0; margin:0; font-size:0.82rem; margin-bottom:0.6rem">${rows}</ul>
              <div style="margin-top:0.6rem; padding-top:0.5rem; border-top:1px dashed var(--rule-light)">
                <p style="margin:0 0 0.2rem; font-size:0.78rem; font-weight:600; color:var(--green-mid)">${L.sscSubscribeTitle}</p>
                <p style="margin:0 0 0.5rem; font-size:0.75rem; color:var(--text-muted); line-height:1.35">${L.sscSubscribeDesc}</p>
                <div class="calendar-links">
                  <a href="${webcalUrl}" class="calendar-btn">Apple / Outlook</a>
                  <a href="${gcalUrl}" class="calendar-btn" target="_blank" rel="noopener">Google</a>
                  <a href="/${feedFilename}" class="calendar-btn" download>ICS</a>
                </div>
              </div>
            </div>`;
          })()}`;
        })()}
      </div>
    </div>

  </section>

  <!-- ======== 7. BOARD MEETINGS ======== -->
  <section class="section" id="board">
    <div class="section-rule"></div>
    <div class="section-num">07</div>
    <h2>${L.boardMeetings}</h2>
    <p class="source" style="margin-bottom:1.5rem">${L.boardMeetingsDesc}</p>

    ${(() => {
      const items = SCHOOL_BOARD_ITEMS[slug] || [];
      if (items.length === 0) return `<p>${L.noBoardItems}</p>`;

      // Group by date
      const byDate = new Map();
      for (const item of items) {
        if (!byDate.has(item.date)) byDate.set(item.date, []);
        byDate.get(item.date).push(item);
      }

      return [...byDate.entries()].map(([date, dateItems]) => {
        const d = new Date(date + 'T12:00:00');
        const dateStr = d.toLocaleDateString(isEs ? 'es-US' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const meetingType = dateItems[0].type;
        const meetingSlug = dateItems[0].meetingSlug;

        const itemsHtml = dateItems.map(item => {
          // Use concise per-school summary if available, otherwise fall back to raw title
          const summaryKey = item.date + '|' + item.title.replace(/&#039;/g, "'");
          const summaryObj = BOARD_SUMMARIES[summaryKey]?.[slug];
          const displayText = (summaryObj ? (isEs ? summaryObj.es : summaryObj.en) : null) || item.title;

          const attsHtml = item.attachments.length > 0
            ? `<div style="margin-top:0.4rem; display:flex; flex-wrap:wrap; gap:0.4rem">${item.attachments.map(a =>
                // overflow-wrap:anywhere — attachment titles are often long unbroken
                // PDF filenames; without a break opportunity they force the whole
                // page wider than a phone viewport (horizontal scroll bug).
                `<a href="${a.url}" target="_blank" style="font-family:'IBM Plex Mono',monospace; font-size:0.65rem; background:var(--green-wash); padding:0.2rem 0.5rem; border-radius:3px; text-decoration:none; color:var(--green-mid); max-width:100%; overflow-wrap:anywhere">${a.title} &#8599;</a>`
              ).join('')}</div>`
            : '';

          const videoLink = item.videoId
            ? `<a href="https://www.youtube.com/watch?v=${item.videoId}${item.timestampSeconds ? '&t=' + item.timestampSeconds : ''}" target="_blank" style="font-family:'IBM Plex Mono',monospace; font-size:0.65rem; color:var(--coral); text-decoration:none; white-space:nowrap">&#9654; ${L.watchVideo}</a>`
            : '';

          return `<div style="padding:0.6rem 0; border-bottom:1px solid var(--rule-light)">
              <div style="font-size:0.9rem; line-height:1.4">${displayText}</div>
              <div style="margin-top:0.3rem; display:flex; align-items:center; gap:0.8rem; flex-wrap:wrap">${videoLink}</div>
              ${attsHtml}
            </div>`;
        }).join('');

        return `<div style="margin-bottom:2rem">
          <div style="display:flex; align-items:baseline; gap:0.8rem; margin-bottom:0.3rem">
            <h3 style="margin:0; font-size:1rem">${dateStr}</h3>
            <span style="font-family:'IBM Plex Mono',monospace; font-size:0.6rem; text-transform:uppercase; color:var(--text-muted); letter-spacing:0.05em">${meetingType}</span>
            <a href="/meetings/#${date}" style="font-family:'IBM Plex Mono',monospace; font-size:0.6rem; color:var(--green-mid); text-decoration:none">${L.viewFullMeeting} &rarr;</a>
          </div>
          ${itemsHtml}
        </div>`;
      }).join('');
    })()}
  </section>

</main>

${siteFooter({ lang })}

</body>
</html>`;
}


// ---- Schools index page ----

function buildSchoolsIndex(lang) {
  const isEs = lang === 'es';
  const title = isEs ? 'Escuelas — Distrito Escolar de Redwood City' : 'Schools — Redwood City School District';
  const description = isEs
    ? 'Las 12 escuelas del Distrito Escolar de Redwood City: datos, financiamiento, rendimiento y recursos.'
    : 'All 12 Redwood City School District schools: data, funding, performance, and resources.';
  const canonical = isEs ? 'https://rcsd.info/escuelas/' : 'https://rcsd.info/schools/';
  const altHref = isEs ? '/schools/' : '/escuelas/';

  const L = isEs ? {
    pageHeading: 'Escuelas y propiedades',
    pageSubtitle: 'Las 12 escuelas operadas por el distrito, las tres escuelas ch\u00e1rter autorizadas por RCSD, y otras propiedades del distrito.',
    districtH2: 'Escuelas del distrito',
    charterH2: 'Escuelas ch\u00e1rter autorizadas por RCSD',
    charterIntro: 'Tres escuelas ch\u00e1rter financiadas directamente. Sus presupuestos, informes interinos y auditor\u00edas se presentan regularmente a la mesa directiva como parte de la supervisi\u00f3n fiscal del distrito.',
    propertiesH2: 'Otras propiedades del distrito',
    propertiesIntro: 'Edificios y terrenos propiedad del distrito (o alquilados por el distrito) que actualmente no albergan una escuela operada por el distrito \u2014 incluye los campus donde operan las escuelas ch\u00e1rter autorizadas por RCSD de la lista de arriba. Los contratos de alquiler y acuerdos de uso aprobados por la mesa directiva est\u00e1n enlazados cuando est\u00e1n disponibles.',
    thSchool: 'Escuela', thGrades: 'Grados', thEnroll: 'Inscripci\u00f3n', thHighNeed: '% alta necesidad',
    thGrowthEla: 'Crec. lectura', thGrowthMath: 'Crec. mat',
    growthPendingShort: 'En espera de la presentaci\u00f3n 2025-26',
    growthCellSourceTitle: (date, page) => `Ver fuente: presentaci\u00f3n de la Mesa ${date}, diapositiva ${page}`,
    thNetwork: 'Red', thOpened: 'Inauguraci\u00f3n',
    thProperty: 'Propiedad', thAddress: 'Direcci\u00f3n', thDetails: 'Detalles',
    networkIndep: 'Independiente',
    growthExplainer: '<strong>% alta necesidad</strong> = porcentaje de estudiantes socioeconómicamente desfavorecidos o aprendices de inglés. <strong>Crecimiento</strong> = % de estudiantes que alcanzaron su meta anual de Crecimiento Esperado en i-Ready en la evaluación diagnóstica de medio año 2025-26. La meta del LCAP es aumentar este número 4 puntos cada año. Una escuela con baja competencia pero alto crecimiento está acelerando el aprendizaje.',
    pathPrefix: '/escuelas/',
    charterPathKey: 'esPath',
  } : {
    pageHeading: 'Schools & properties',
    pageSubtitle: 'The 12 district-operated schools, the three RCSD-authorized charter schools, and other district-owned properties.',
    districtH2: 'District schools',
    charterH2: 'RCSD-authorized charter schools',
    charterIntro: 'Three directly-funded charter schools. Their budgets, interim reports, and audits are presented regularly to the Board as part of the district\u2019s fiscal oversight role.',
    propertiesH2: 'Other district properties',
    propertiesIntro: 'Buildings and sites owned (or leased) by the district that do not currently host a district-operated school — including the campuses that house the RCSD-authorized charters listed above. Leases and use agreements approved by the Board are linked where available.',
    thSchool: 'School', thGrades: 'Grades', thEnroll: 'Enrollment', thHighNeed: '% high-need',
    thGrowthEla: 'Reading growth', thGrowthMath: 'Math growth',
    growthPendingShort: 'Awaiting 2025-26 presentation',
    growthCellSourceTitle: (date, page) => `View source: board presentation ${date}, slide ${page}`,
    thNetwork: 'Network', thOpened: 'Opened',
    thProperty: 'Property', thAddress: 'Address', thDetails: 'Details',
    networkIndep: 'Independent',
    growthExplainer: '<strong>% high-need</strong> = share of students who are socioeconomically disadvantaged or English learners. <strong>Growth</strong> = % of students who met their annual i-Ready Expected Growth target on the 2025-26 mid-year diagnostic. The district\u2019s LCAP goal is to raise this by 4 percentage points each year. A school with low proficiency but high growth is accelerating learning. Bar colors compare each school to the district-wide mid-year result (Reading 60.7%, Math 56.4%). Schools without a bar have not yet presented 2025-26 data to the Board.',
    pathPrefix: '/schools/',
    charterPathKey: 'enPath',
  };

  // Sort schools by name for the index
  const sorted = [...schoolsData.schools]
    .filter(s => SCHOOL_DATA[s.slug])
    .sort((a, b) => a.name.localeCompare(b.name));

  // Color thresholds are pegged to the district-wide mid-year result so the
  // bars communicate "this school vs. district trajectory," not an arbitrary cut.
  const colorFor = (val, districtPct) => {
    if (val == null) return 'muted';
    if (val >= districtPct) return 'green';
    if (val >= districtPct - 5) return 'amber';
    return 'coral';
  };
  const barWidthForPct = (val) => val == null ? 0 : Math.round((val / 75) * 58); // 75% is a generous visual ceiling

  // Sort-key for grades strings like "TK-5", "K-5", "3-8" — use the lowest grade
  // (TK=-1, K=0, otherwise the integer prefix) so a numeric sort puts the
  // youngest-served grades first.
  const gradesSortVal = (g) => {
    if (!g) return null;
    const lo = g.split('-')[0].trim().toUpperCase();
    if (lo === 'TK') return -1;
    if (lo === 'K') return 0;
    const n = parseInt(lo, 10);
    return Number.isFinite(n) ? n : null;
  };

  const rows = sorted.map(s => {
    const ir = IREADYU_DATA[s.slug];
    const pending = ir?.status === 'pending_25_26_presentation';
    const r = !pending && ir?.reading ? (ir.reading.y2_25_26_midyear ?? ir.reading.y1_24_25_actual) : null;
    const m = !pending && ir?.math ? (ir.math.y2_25_26_midyear ?? ir.math.y1_24_25_actual) : null;
    const href = `${L.pathPrefix}${s.slug}/`;
    const pdfBase = ir?.source?.pdfUrl;
    const readingSrc = pdfBase && ir?.reading?.source?.pdfPage ? `${pdfBase}#page=${ir.reading.source.pdfPage}` : null;
    const mathSrc = pdfBase && ir?.math?.source?.pdfPage ? `${pdfBase}#page=${ir.math.source.pdfPage}` : null;

    const cellFor = (val, districtPct, srcUrl, srcPage) => {
      if (pending) return `<td class="num" data-sort-value="" title="${L.growthPendingShort}"><span class="pending-mark">—</span></td>`;
      if (val == null) return `<td class="num" data-sort-value="">—</td>`;
      const color = colorFor(val, districtPct);
      const w = barWidthForPct(val);
      const num = `<span class="bar bar-${color}" style="width:${w}px"></span>${Math.round(val)}%`;
      if (!srcUrl) return `<td class="num" data-sort-value="${val}">${num}</td>`;
      // Link opens the source PDF at the exact slide; event delegation handles row clicks
      const title = L.growthCellSourceTitle(ir.source.presentationDate, srcPage);
      return `<td class="num" data-sort-value="${val}"><a class="growth-cell-link" href="${srcUrl}" target="_blank" rel="noopener" title="${title}">${num}</a></td>`;
    };
    const gv = gradesSortVal(s.grades);
    return `          <tr data-href="${href}">
            <td class="school-name" data-sort-value="${(s.nameShort || s.name).toLowerCase()}"><a href="${href}">${s.nameShort || s.name} <span class="arrow">&rarr;</span></a></td>
            <td data-sort-value="${gv ?? ''}">${s.grades}</td>
            <td class="num" data-sort-value="${s.enrollment}">${s.enrollment.toLocaleString()}</td>
            <td class="num" data-sort-value="${s.highNeedPct}">${s.highNeedPct}%</td>
            ${cellFor(r, DISTRICT_IREADYU.reading, readingSrc, ir?.reading?.source?.pdfPage)}
            ${cellFor(m, DISTRICT_IREADYU.math, mathSrc, ir?.math?.source?.pdfPage)}
          </tr>`;
  }).join('\n');

  // ---- Section 2: Charter schools ----
  const charterRows = charterSummaries().map(c => {
    const href = c[L.charterPathKey];
    const name = isEs ? (c.nameEs || c.name) : c.name;
    const gv = gradesSortVal(c.grades);
    const openedYear = (c.dateOpened || '').slice(0, 4);
    // Drop city/state/zip for the table — every charter is in Redwood City.
    const streetAddress = (c.address || '').split(',')[0];
    const addressNote = isEs ? (c.addressNoteEs || c.addressNote) : c.addressNote;
    const addressCell = addressNote
      ? `<span title="${addressNote.replace(/"/g, '&quot;')}">${streetAddress}*</span>`
      : streetAddress;
    return `          <tr data-href="${href}">
            <td class="school-name" data-sort-value="${name.toLowerCase()}"><a href="${href}">${name} <span class="arrow">&rarr;</span></a></td>
            <td data-sort-value="${gv ?? ''}">${c.grades || ''}</td>
            <td data-sort-value="${streetAddress.toLowerCase()}">${addressCell}</td>
            <td class="num" data-sort-value="${c.enrollment ?? ''}">${c.enrollment ? c.enrollment.toLocaleString() : ''}</td>
            <td>${c.network || L.networkIndep}</td>
            <td class="num" data-sort-value="${openedYear || ''}">${openedYear}</td>
          </tr>`;
  }).join('\n');

  // ---- Section 3: District properties ----
  const propertyRows = (propertiesData.properties || []).map(p => {
    const name = isEs ? (p.nameEs || p.name) : p.name;
    const useLabel = isEs ? (p.useLabelEs || p.useLabel) : p.useLabel;
    const formerUse = isEs ? (p.formerUseEs || p.formerUse) : p.formerUse;
    const tenantUrl = p.tenant?.url;
    const nameCell = tenantUrl
      ? `<a href="${tenantUrl}" target="_blank" rel="noopener">${name} <span style="font-size:0.8em; color:var(--text-muted)">&#8599;</span></a>`
      : name;
    const docLinks = (p.documents || []).map(d => {
      const label = isEs ? (d.labelEs || d.label) : d.label;
      return `<a class="prop-doc-link" href="${d.url}" target="_blank" rel="noopener">${label} &#8599;</a>`;
    }).join('');
    // Short parenthetical under the name; long formerUse stays in the title attribute.
    const formerShort = isEs ? (p.formerUseShortEs || p.formerUseShort) : p.formerUseShort;
    const formerLine = formerShort
      ? `<div class="prop-former"${formerUse ? ` title="${formerUse.replace(/"/g, '&quot;')}"` : ''}>(${formerShort})</div>`
      : '';
    const detailsCell = `${useLabel || ''}${docLinks ? `<div class="prop-docs">${docLinks}</div>` : ''}`;
    return `          <tr>
            <td class="school-name prop-name" data-sort-value="${name.toLowerCase()}">${nameCell}${formerLine}</td>
            <td data-sort-value="${(p.address || '').toLowerCase()}">${p.address || '<span style="color:var(--text-muted); font-style:italic">TBD</span>'}</td>
            <td>${detailsCell}</td>
          </tr>`;
  }).join('\n');

  const indexCSS = `
  .schools-header { padding: 3rem 0 0; }
  .schools-header h1 {
    font-family: 'Fraunces', Georgia, serif;
    font-size: clamp(1.8rem, 4vw, 2.5rem);
    font-weight: 400;
    color: var(--green-deep);
    margin-bottom: 1rem;
  }
  .schools-header p { max-width: 640px; margin-bottom: 2rem; }
  .schools-section { margin-top: 3rem; }
  .schools-section:first-of-type { margin-top: 0; }
  .schools-section h2 {
    font-family: 'Fraunces', Georgia, serif; font-size: 1.5rem; font-weight: 400;
    color: var(--green-deep); margin-bottom: 0.3rem;
  }
  .schools-section p.section-intro {
    color: var(--text-secondary); font-size: 0.92rem; max-width: 640px; margin-bottom: 1rem;
  }
  .schools-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .schools-table-wrap table { width: 100%; border-collapse: collapse; font-size: 0.88rem; line-height: 1.45; }
  .schools-table-wrap thead th {
    font-family: 'IBM Plex Mono', monospace; font-size: 0.65rem; font-weight: 500;
    letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted);
    text-align: left; padding: 0.6rem 0.8rem; border-bottom: 2px solid var(--green-deep); white-space: nowrap;
  }
  .schools-table-wrap thead th.num { text-align: right; }
  .schools-table-wrap table.sortable thead th[data-sort-type] {
    cursor: pointer; user-select: none; position: relative; padding-right: 1.7rem;
    transition: color 0.12s;
  }
  .schools-table-wrap table.sortable thead th[data-sort-type]::after {
    content: '↕'; position: absolute; right: 0.5rem; top: 50%;
    transform: translateY(-50%); opacity: 0.35; font-size: 0.95em;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  .schools-table-wrap table.sortable thead th[data-sort-type]:hover { color: var(--green-deep); }
  .schools-table-wrap table.sortable thead th[data-sort-type]:hover::after { opacity: 0.7; }
  .schools-table-wrap table.sortable thead th[data-sort-type]:focus-visible {
    outline: 2px solid var(--green-mid); outline-offset: -2px;
  }
  .schools-table-wrap table.sortable thead th[aria-sort="ascending"],
  .schools-table-wrap table.sortable thead th[aria-sort="descending"] { color: var(--green-deep); }
  .schools-table-wrap table.sortable thead th[aria-sort="ascending"]::after { content: '↑'; opacity: 1; }
  .schools-table-wrap table.sortable thead th[aria-sort="descending"]::after { content: '↓'; opacity: 1; }
  .schools-table-wrap tbody td {
    padding: 0.55rem 0.8rem; border-bottom: 1px solid var(--rule-light); vertical-align: top;
  }
  .schools-table-wrap tbody td.num {
    text-align: right; font-family: 'IBM Plex Mono', monospace; font-size: 0.82rem; white-space: nowrap;
  }
  .schools-table-wrap tbody td.school-name { font-weight: 500; white-space: nowrap; }
  .schools-table-wrap tbody td.school-name a { color: var(--green-mid); text-decoration: underline; text-decoration-color: var(--rule); text-underline-offset: 2px; }
  .schools-table-wrap tbody td.school-name a:hover { color: var(--green-deep); text-decoration-color: var(--green-mid); }
  .schools-table-wrap tbody td.school-name .arrow { color: var(--text-muted); font-size: 0.8em; transition: transform 0.15s, color 0.15s; display: inline-block; }
  .schools-table-wrap tbody tr[data-href] { cursor: pointer; }
  .schools-table-wrap tbody tr:hover td { background: var(--green-wash); }
  .schools-table-wrap tbody tr:hover .arrow { color: var(--green-mid); transform: translateX(3px); }
  .schools-table-wrap tbody tr:last-child td { border-bottom: 2px solid var(--rule); }
  .bar { display: inline-block; height: 6px; border-radius: 3px; margin-right: 0.5rem; vertical-align: middle; }
  .bar-green { background: var(--green-light); }
  .bar-amber { background: var(--amber); }
  .bar-coral { background: var(--coral); }
  .bar-muted { background: var(--rule); }
  .pending-mark { color: var(--text-muted); font-style: italic; cursor: help; }
  .prop-doc-link {
    display: inline-block; font-family: 'IBM Plex Mono', monospace; font-size: 0.68rem;
    background: var(--green-wash); color: var(--green-mid); padding: 0.15rem 0.45rem;
    border-radius: 3px; text-decoration: none; margin: 0.1rem 0.3rem 0.1rem 0;
  }
  .prop-doc-link:hover { background: var(--green-mid); color: #fff; }
  .prop-docs { margin-top: 0.4rem; }
  td.prop-name { white-space: normal; min-width: 11em; }
  .prop-former { font-weight: 400; font-size: 0.78rem; color: var(--text-muted); margin-top: 0.15rem; }
  a.growth-cell-link {
    color: var(--green-mid);
    text-decoration: underline;
    text-decoration-color: var(--green-mid);
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
    padding: 3px 8px;
    border-radius: 4px;
    transition: background 0.12s, color 0.12s, box-shadow 0.12s;
  }
  a.growth-cell-link:hover {
    color: #fff;
    background: var(--green-mid);
    text-decoration-color: #fff;
    text-decoration-thickness: 2px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.12);
  }
  a.growth-cell-link:hover .bar { filter: brightness(1.25) saturate(0.6); }
  .schools-content { max-width: 960px; margin: 0 auto; padding: 0 2rem 6rem; }
  @media (max-width: 640px) { .schools-content { padding: 0 1.2rem 4rem; } }`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
${headMeta({
  title,
  description,
  canonical,
  ogLocale: isEs ? 'es_US' : 'en_US',
  ogImageKey: `page-schools${isEs ? '-es' : ''}`,
  hreflang: [
    { lang: 'en', href: 'https://rcsd.info/schools/' },
    { lang: 'es', href: 'https://rcsd.info/escuelas/' },
  ],
  pageCSS: indexCSS,
})}
</head>
<body>

${siteNav({ activePage: 'schools', lang, altLangHref: altHref })}

<div class="schools-content">
  <div class="schools-header">
    <h1>${L.pageHeading}</h1>
    <p>${L.pageSubtitle}</p>
  </div>

  <section class="schools-section">
    <h2>${L.districtH2}</h2>
    <div class="schools-table-wrap">
      <table class="sortable">
        <thead>
          <tr>
            <th data-sort-type="text" data-sort-initial="asc" aria-sort="ascending">${L.thSchool}</th>
            <th data-sort-type="num">${L.thGrades}</th>
            <th class="num" data-sort-type="num">${L.thEnroll}</th>
            <th class="num" data-sort-type="num">${L.thHighNeed}</th>
            <th class="num" data-sort-type="num">${L.thGrowthEla}</th>
            <th class="num" data-sort-type="num">${L.thGrowthMath}</th>
          </tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>
    <p style="font-size:0.82rem; color:var(--text-muted); margin-top:1.2rem; line-height:1.5">${L.growthExplainer}</p>
  </section>

  <section class="schools-section" id="charters">
    <h2>${L.charterH2}</h2>
    <p class="section-intro">${L.charterIntro}</p>
    <div class="schools-table-wrap">
      <table class="sortable">
        <thead>
          <tr>
            <th data-sort-type="text" data-sort-initial="asc" aria-sort="ascending">${L.thSchool}</th>
            <th data-sort-type="num">${L.thGrades}</th>
            <th data-sort-type="text">${L.thAddress}</th>
            <th class="num" data-sort-type="num">${L.thEnroll}</th>
            <th data-sort-type="text">${L.thNetwork}</th>
            <th class="num" data-sort-type="num">${L.thOpened}</th>
          </tr>
        </thead>
        <tbody>
${charterRows}
        </tbody>
      </table>
    </div>
  </section>

  <section class="schools-section" id="properties">
    <h2>${L.propertiesH2}</h2>
    <p class="section-intro">${L.propertiesIntro}</p>
    <div class="schools-table-wrap">
      <table class="sortable">
        <thead>
          <tr>
            <th data-sort-type="text" data-sort-initial="asc" aria-sort="ascending">${L.thProperty}</th>
            <th data-sort-type="text">${L.thAddress}</th>
            <th>${L.thDetails}</th>
          </tr>
        </thead>
        <tbody>
${propertyRows}
        </tbody>
      </table>
    </div>
  </section>
</div>

${siteFooter({ lang })}

<script>
(function () {
  function init(table) {
    var ths = table.querySelectorAll('thead th[data-sort-type]');
    var tbody = table.tBodies[0];
    if (!tbody) return;
    var current = { idx: -1, dir: null };
    ths.forEach(function (th) { if (th.getAttribute('aria-sort') === 'ascending') { current.idx = th.cellIndex; current.dir = 'asc'; } });

    function sort(idx, dir) {
      var th = ths[Array.prototype.findIndex.call(ths, function (t) { return t.cellIndex === idx; })];
      var type = th.getAttribute('data-sort-type') || 'text';
      var rows = Array.prototype.slice.call(tbody.rows);
      rows.sort(function (a, b) {
        var av = a.children[idx].getAttribute('data-sort-value');
        var bv = b.children[idx].getAttribute('data-sort-value');
        if (av === null) av = a.children[idx].textContent.trim();
        if (bv === null) bv = b.children[idx].textContent.trim();
        var aMissing = av === '' || av == null;
        var bMissing = bv === '' || bv == null;
        if (aMissing && bMissing) return 0;
        if (aMissing) return 1;  // missing always sorts last
        if (bMissing) return -1;
        if (type === 'num') {
          var an = parseFloat(av), bn = parseFloat(bv);
          if (isNaN(an) && isNaN(bn)) return 0;
          if (isNaN(an)) return 1;
          if (isNaN(bn)) return -1;
          return dir === 'asc' ? an - bn : bn - an;
        }
        var as = String(av).toLowerCase(), bs = String(bv).toLowerCase();
        if (as < bs) return dir === 'asc' ? -1 : 1;
        if (as > bs) return dir === 'asc' ? 1 : -1;
        return 0;
      });
      var frag = document.createDocumentFragment();
      rows.forEach(function (r) { frag.appendChild(r); });
      tbody.appendChild(frag);
      ths.forEach(function (t) {
        t.setAttribute('aria-sort', t.cellIndex === idx ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
      });
      current.idx = idx; current.dir = dir;
    }

    ths.forEach(function (th) {
      th.setAttribute('role', 'button');
      th.setAttribute('tabindex', '0');
      if (!th.hasAttribute('aria-sort')) th.setAttribute('aria-sort', 'none');
      function trigger() {
        var idx = th.cellIndex;
        var type = th.getAttribute('data-sort-type') || 'text';
        var dir = current.idx === idx ? (current.dir === 'asc' ? 'desc' : 'asc') : (type === 'num' ? 'desc' : 'asc');
        sort(idx, dir);
      }
      th.addEventListener('click', trigger);
      th.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger(); }
      });
    });
  }
  document.querySelectorAll('table.sortable').forEach(init);

  // Row-level clicks delegate to the row's own name-cell anchor instead of
  // reading data-href into window.location — DOM text never reaches a
  // navigation sink (CodeQL js/xss-through-dom), and the anchor href stays
  // the single source of truth for the destination.
  document.querySelectorAll('tr[data-href]').forEach(function (row) {
    row.addEventListener('click', function (e) {
      if (e.target.closest('a')) return;
      var link = row.querySelector('a[href]');
      if (link) link.click();
    });
  });
})();
</script>

</body>
</html>`;
}


// ---- Main: generate all pages ----

let count = 0;

for (const school of schoolsData.schools) {
  const data = SCHOOL_DATA[school.slug];
  if (!data) {
    console.warn(`No enrichment data for ${school.slug}, skipping`);
    continue;
  }

  // English
  const enDir = resolve(ROOT, 'docs', 'schools', school.slug);
  mkdirSync(enDir, { recursive: true });
  const enHtml = buildSchoolPage(school, data, 'en');
  writeFileSync(resolve(enDir, 'index.html'), enHtml);
  console.log(`Wrote docs/schools/${school.slug}/index.html`);

  // Spanish
  const esDir = resolve(ROOT, 'docs', 'escuelas', school.slug);
  mkdirSync(esDir, { recursive: true });
  const esHtml = buildSchoolPage(school, data, 'es');
  writeFileSync(resolve(esDir, 'index.html'), esHtml);
  console.log(`Wrote docs/escuelas/${school.slug}/index.html`);

  count++;
}

// Schools index pages
const enIndexDir = resolve(ROOT, 'docs', 'schools');
mkdirSync(enIndexDir, { recursive: true });
writeFileSync(resolve(enIndexDir, 'index.html'), buildSchoolsIndex('en'));
console.log('Wrote docs/schools/index.html');

const esIndexDir = resolve(ROOT, 'docs', 'escuelas');
mkdirSync(esIndexDir, { recursive: true });
writeFileSync(resolve(esIndexDir, 'index.html'), buildSchoolsIndex('es'));
console.log('Wrote docs/escuelas/index.html');

console.log(`\nGenerated ${count} school pages + 2 index pages (${count * 2 + 2} HTML files total).`);
