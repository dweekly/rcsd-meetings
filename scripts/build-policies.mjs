#!/usr/bin/env node
/**
 * Build the board policies experience:
 *
 *   1. INDEX pages — docs/policies/index.html (EN) + docs/politicas/index.html
 *      (ES): one linked row per policy (code, type badge, title, one-sentence
 *      AI summary) grouped into native <details> accordion section cards
 *      (collapsed by default; search/filter auto-opens matching sections;
 *      #slug / #sec-XXXX deep links open their section), with client-side
 *      search and type filtering. No policy bodies live on the index.
 *   2. PER-POLICY pages — docs/policies/{slug}/index.html (EN) and
 *      docs/politicas/{slug}/index.html (ES), one pair per policy
 *      (619 × 2 = 1,238 pages). Slugs come from scripts/lib/policy-slug.mjs,
 *      the single source of truth shared with the sitemap.
 *   3. MACHINE-READABLE mirrors — docs/policies-index.json,
 *      docs/board-policies/*.json, docs/board-policies-es/*.json (consumed by
 *      the MCP server and the rcsd-data skill; published unchanged).
 *
 * Data sources & provenance:
 *   - data/policies-index.json — catalog scraped from Simbli
 *     (scrape-board-policies.mjs).
 *   - data/board-policies/{code}-{type}.json — full EN policy bodies,
 *     footnotes/legal refs, cross references (same scraper).
 *   - data/board-policies-es/{code}-{type}.json — Spanish bodies,
 *     AI-translated by scripts/translate-policy-bodies.mjs. May be partial:
 *     any policy without an ES body renders the English text on /politicas/
 *     with an honest "solo en inglés por ahora" note. Translated bodies carry
 *     a machine-translation disclaimer linking to the binding English
 *     original on Simbli.
 *   - data/policy-titles-es.json — AI-translated titles + section names
 *     (translate-policy-titles.mjs).
 *   - data/policy-summaries.json — one-sentence EN+ES summaries, AI-generated
 *     by scripts/generate-policy-summaries.mjs and labeled as such on the
 *     index pages. The 12 PDF-exhibit policies (empty contentText) have no
 *     summary; their cells stay empty and their pages feature the official
 *     Simbli PDF link instead of a body.
 *
 * Footnotes/legal citations and cross-reference titles are intentionally NOT
 * translated (statute names and codes stay as published); on Spanish pages
 * the cross-reference list uses the AI-translated policy titles since those
 * link to Spanish policy pages.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { headMeta, siteNav, siteFooter } from './html-parts.mjs';
import { policySlug } from './lib/policy-slug.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const DATA_DIR = resolve(ROOT, 'data');
const POLICIES_DATA_DIR = resolve(DATA_DIR, 'board-policies');
const POLICIES_ES_DATA_DIR = resolve(DATA_DIR, 'board-policies-es');
const INDEX_DATA_PATH = resolve(DATA_DIR, 'policies-index.json');
const TITLES_ES_PATH = resolve(DATA_DIR, 'policy-titles-es.json');
const SUMMARIES_PATH = resolve(DATA_DIR, 'policy-summaries.json');
const PROVENANCE_DIR = resolve(DATA_DIR, 'provenance');
const POLICY_PROVENANCE_PATH = resolve(PROVENANCE_DIR, 'rcsd.board-policies.json');
const POLICY_ES_PROVENANCE_PATH = resolve(PROVENANCE_DIR, 'rcsd.board-policies-es.json');
const POLICY_SUMMARY_PROVENANCE_PATH = resolve(PROVENANCE_DIR, 'rcsd.board-policy-summaries.json');

const DOCS_DIR = resolve(ROOT, 'docs');
const POLICIES_DOCS_DIR = resolve(DOCS_DIR, 'board-policies');
const POLICIES_ES_DOCS_DIR = resolve(DOCS_DIR, 'board-policies-es');
const INDEX_DOCS_PATH = resolve(DOCS_DIR, 'policies-index.json');

// Every dynamic value reaching HTML goes through one of these.
const escapeAttr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escapeText = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Only http(s) URLs from scraped JSON may become hrefs — blocks
// javascript:/data: schemes (same gate the old client drawer applied).
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);

// Simbli dates are MM/DD/YYYY strings; Spanish pages render dd/mm/yyyy
// per the site's es-MX date convention.
function formatUsDate(s, lang) {
  if (!s) return null;
  if (lang === 'es') {
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[2]}/${m[1]}/${m[3]}`;
  }
  return s;
}

// MM/DD/YYYY -> ISO 8601 YYYY-MM-DD (for JSON-LD dateModified).
function isoDate(s) {
  const m = (s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

// Official Simbli URL for a policy: prefer the scraper-recorded source URL,
// fall back to the ViewPolicy pattern keyed by revision id.
function officialSimbliUrl(detail, revid) {
  return safeUrl(detail?._metadata?.source)
    || `https://simbli.eboardsolutions.com/Policy/ViewPolicy.aspx?S=36030397&revid=${encodeURIComponent(revid || '')}`;
}

// ---- Per-language strings ----
// Spanish register: plain, colloquial Californian Spanish (sixth-grade);
// legal document names stay formal-ish for accuracy.
const PAGES = {
  en: {
    lang: 'en',
    htmlLang: 'en',
    outputDir: resolve(DOCS_DIR, 'policies'),
    indexHref: '/policies/',
    altIndexHref: '/politicas/',
    canonical: 'https://rcsd.info/policies/',
    ogLocale: 'en_US',
    ogImageKey: 'page-home',
    metaTitle: 'RCSD Board Policies Manual — Redwood City School District',
    metaDescription: 'Browsable and machine-readable school board policies, bylaws, and administrative regulations of the Redwood City School District, each with a one-sentence summary and full-text page.',
    jsonLdName: 'Redwood City School District Board Policies Manual',
    h1: 'Board Policies Manual',
    subtitle: "Redwood City School District's active board policies, bylaws, and administrative regulations. Each policy links to its own page with the full text.",
    disclaimer: 'Not an official District document; independently assembled by <a href="https://github.com/dweekly/rcsd-meetings" style="color:#664d03">David Weekly</a>. May contain errors. Questions? <a href="mailto:team@rcsd.info" style="color:#664d03">Contact us</a>.',
    aiSummariesNote: 'One-sentence summaries are AI-generated; click through for the full text.',
    searchPlaceholder: 'Search by policy code (e.g. 0100) or keyword...',
    searchAriaLabel: 'Search policies',
    filterAll: 'All',
    filterBP: 'Policies (BP)',
    filterAR: 'Regulations (AR)',
    filterBB: 'Bylaws/Exhibits',
    // Accordion summary chip: "1 policy" / "62 policies".
    countChip: (n) => (n === 1 ? '1 policy' : `${n} policies`),
    unmodified: 'Unmodified',
    noResultsTitle: 'No matching policies found',
    noResultsBody: 'Try searching for a different keyword or checking your filters. For example, search for "0100" or "Equity".',
    // ---- Per-policy page strings ----
    crumb: '&larr; Board Policies Manual',
    typeLabels: { BP: 'Board Policy', AR: 'Administrative Regulation', BB: 'Board Bylaw' },
    pageTitle: (p, title) => `${p.type} ${p.code}: ${title} — RCSD Board Policies`,
    fallbackDesc: (p, title) => `Full text of ${p.type} ${p.code} "${title}" from the Redwood City School District board policies manual.`,
    exhibitDesc: (p, title) => `${p.type} ${p.code} "${title}" — a PDF exhibit in the Redwood City School District board policies manual.`,
    lastRevised: 'LAST REVISED',
    lastReviewed: 'LAST REVIEWED',
    checked: 'CHECKED',
    revisionId: 'REVISION ID',
    na: 'N/A',
    dateLocale: 'en-US',
    official: 'Official version on Simbli &#8599;',
    viewJson: 'View JSON &#8599;',
    provenanceTitle: 'Source &amp; methodology',
    provenanceStatus: 'RCSD.info status',
    provenanceStatusValue: 'Independent mirror of the official English source',
    provenanceQuality: 'PROVENANCE CHECK',
    provenanceSource: 'Official source',
    provenanceData: 'Dataset provenance JSON &#8599;',
    provenanceSummary: 'Summary provenance JSON &#8599;',
    provenanceNote: 'Hashes and lineage are machine-checked. AI execution details are recorded when available; older cached outputs are explicitly marked partial rather than reconstructed.',
    legalRefs: 'Legal &amp; Management References',
    crossRefs: 'Cross References',
    attachmentsLabel: 'Attachments',
    exhibitLead: 'This policy entry is a PDF exhibit; its content is not published as web text.',
    alsoSearchedAs: 'Also searched as',
    exhibitLink: 'Open the PDF on Simbli &#8599;',
    // EN pages carry no body-language note.
    esBodyNote: null,
    enFallbackNote: null,
  },
  es: {
    lang: 'es',
    htmlLang: 'es',
    outputDir: resolve(DOCS_DIR, 'politicas'),
    indexHref: '/politicas/',
    altIndexHref: '/policies/',
    canonical: 'https://rcsd.info/politicas/',
    ogLocale: 'es_US',
    // Stopgap: reuses the Spanish homepage card until dedicated page-policies
    // OG images are generated (per the bilingual-assets rule).
    ogImageKey: 'page-home-es',
    metaTitle: 'Manual de Políticas de la Mesa Directiva de RCSD — Distrito Escolar de Redwood City',
    metaDescription: 'Políticas, estatutos y reglamentos administrativos de la Mesa Directiva del Distrito Escolar de Redwood City, cada una con un resumen de una línea y su propia página con el texto completo en español.',
    jsonLdName: 'Manual de Políticas de la Mesa Directiva del Distrito Escolar de Redwood City',
    h1: 'Manual de Políticas de la Mesa Directiva',
    subtitle: 'Las políticas, estatutos y reglamentos vigentes de la Mesa Directiva del Distrito Escolar de Redwood City. Cada política tiene su propia página con el texto completo, traducido al español con IA; la versión oficial sigue siendo la de Simbli, en inglés.',
    disclaimer: 'No es un documento oficial del Distrito; compilado independientemente por <a href="https://github.com/dweekly/rcsd-meetings" style="color:#664d03">David Weekly</a>. Los títulos y resúmenes fueron traducidos o generados con IA y pueden contener errores. <a href="mailto:team@rcsd.info" style="color:#664d03">Contáctenos</a>.',
    aiSummariesNote: 'Los resúmenes de una línea están hechos con IA; haz clic en cada política para leer el texto completo.',
    searchPlaceholder: 'Busca por número de política (ej. 0100) o palabra clave...',
    searchAriaLabel: 'Buscar políticas',
    filterAll: 'Todas',
    filterBP: 'Políticas (BP)',
    filterAR: 'Reglamentos (AR)',
    filterBB: 'Estatutos/Anexos',
    // Chip del acordeón: "1 política" / "62 políticas".
    countChip: (n) => (n === 1 ? '1 política' : `${n} políticas`),
    unmodified: 'Sin modificar',
    noResultsTitle: 'No encontramos políticas con esa búsqueda',
    noResultsBody: 'Prueba con otra palabra o cambia los filtros. Por ejemplo, busca "0100" o "Equidad".',
    // ---- Per-policy page strings ----
    crumb: '&larr; Manual de Políticas',
    typeLabels: { BP: 'Política de la Mesa Directiva', AR: 'Reglamento Administrativo', BB: 'Estatuto de la Mesa' },
    pageTitle: (p, title) => `${p.type} ${p.code}: ${title} — Políticas de la Mesa de RCSD`,
    fallbackDesc: (p, title) => `Texto completo de ${p.type} ${p.code} "${title}" del manual de políticas de la Mesa Directiva del Distrito Escolar de Redwood City.`,
    exhibitDesc: (p, title) => `${p.type} ${p.code} "${title}" — un anexo en PDF del manual de políticas de la Mesa Directiva del Distrito Escolar de Redwood City.`,
    lastRevised: 'ÚLTIMO CAMBIO',
    lastReviewed: 'ÚLTIMA REVISIÓN',
    checked: 'VERIFICADA',
    revisionId: 'ID DE REVISIÓN',
    na: 'N/D',
    dateLocale: 'es-MX',
    official: 'Versión oficial en Simbli &#8599;',
    englishVersion: 'Versión en inglés',
    viewJson: 'Ver JSON &#8599;',
    provenanceTitle: 'Fuente y metodología',
    provenanceStatus: 'Estado en RCSD.info',
    provenanceStatusValue: 'Copia independiente; la fuente oficial sigue siendo el texto en inglés',
    provenanceQuality: 'REVISIÓN DE PROCEDENCIA',
    provenanceSource: 'Fuente oficial',
    provenanceData: 'JSON de procedencia del conjunto &#8599;',
    provenanceSummary: 'JSON de procedencia del resumen &#8599;',
    provenanceNote: 'Los hashes y el linaje se revisan automáticamente. Los detalles de ejecución de IA se guardan cuando están disponibles; las salidas antiguas se marcan como parciales en vez de inventar datos.',
    legalRefs: 'Referencias legales y administrativas',
    crossRefs: 'Referencias cruzadas',
    attachmentsLabel: 'Anexos',
    exhibitLead: 'Esta entrada es un anexo en PDF; su contenido no está publicado como texto.',
    alsoSearchedAs: 'También se busca como',
    exhibitLink: 'Abre el PDF en Simbli &#8599;',
    // Machine-translation provenance line, shown when the Spanish body IS
    // rendered. The "Simbli ↗" tail links to the policy's official URL.
    esBodyNote: {
      text: 'Traducción automática (IA) para ayudarte a entender la política. La única versión oficial y con valor legal es la versión en inglés, en ',
      linkLabel: 'Simbli &#8599;',
    },
    // Yellow fallback note, shown when a policy has no Spanish body yet.
    enFallbackNote: 'El texto completo de la política está disponible solo en inglés por ahora.',
  },
};

// Both languages alternate to the same pair of URLs (index pages).
const INDEX_HREFLANG = [
  { lang: 'x-default', href: 'https://rcsd.info/policies/' },
  { lang: 'en', href: 'https://rcsd.info/policies/' },
  { lang: 'es', href: 'https://rcsd.info/politicas/' },
];

// English legislationType labels (used in JSON-LD on both languages).
const LEGISLATION_TYPE_EN = { BP: 'Board Policy', AR: 'Administrative Regulation', BB: 'Board Bylaw' };

// Hand-curated search synonyms: words families actually type that appear in
// neither language's official policy title. Keyed by policy code (matches all
// BP/AR/E variants of that code). Curated 2026-06-10 from the parent-query
// review; extend freely — these are additive recall only, rows still display
// their real titles.
const SEARCH_SYNONYMS = {
  '5132':    'uniforme uniformes uniform dress code ropa',          // Dress and Grooming
  '5141.31': 'vacunas vacuna immunization shots',                   // Immunizations
  '5131.2':  'bullying acoso intimidacion',                         // Bullying
  '5144':    'disciplina castigo discipline',                       // Discipline
  '6154':    'tarea tareas homework',                               // Homework/Makeup Work
  '5111.1':  'inscripcion inscripciones enrollment residencia',     // District Residency
  '5112.5':  'cierre cierres closure closures',                     // Open/Closed Campus
  '3550':    'comida almuerzo lunch cafeteria',                     // Food Service
};

// ---- Shared CSS chunks ----

// Disclaimer banner — same yellow band as the meetings/budget page families.
const disclaimerCSS = `
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
    }`;

const typeBadgeCSS = `
    .type-badge {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.58rem;
      text-transform: uppercase;
      padding: 0.1rem 0.4rem;
      border-radius: 2px;
      white-space: nowrap;
    }
    .type-badge--bp { background: var(--green-wash); color: var(--green-mid); border: 1px solid rgba(74,140,106,0.3); }
    .type-badge--ar { background: var(--cream-dark); color: var(--text-secondary); border: 1px solid var(--rule); }
    .type-badge--bb { background: var(--amber-light); color: var(--amber); border: 1px solid rgba(196,132,45,0.3); }`;

// ---- Index page CSS ----

const indexCSS = `
    .policies-header {
      background: var(--green-deep);
      color: var(--cream);
      padding: 4rem 2rem 3rem;
      text-align: center;
      position: relative;
      overflow: hidden;
    }
    .policies-header::before {
      content: '';
      position: absolute;
      inset: 0;
      background:
        radial-gradient(ellipse at 20% 80%, rgba(74,140,106,0.3) 0%, transparent 60%),
        radial-gradient(ellipse at 80% 20%, rgba(196,132,45,0.15) 0%, transparent 50%);
      pointer-events: none;
    }
    .policies-header-inner {
      max-width: 960px;
      margin: 0 auto;
      position: relative;
    }
    .policies-header h1 {
      font-family: 'Fraunces', Georgia, serif;
      font-size: clamp(2rem, 5vw, 3rem);
      font-weight: 300;
      line-height: 1.15;
      color: #fff;
    }
    .policies-header p {
      margin-top: 1rem;
      font-size: 0.95rem;
      color: rgba(255,255,255,0.6);
      max-width: 600px;
      margin-left: auto;
      margin-right: auto;
      font-style: italic;
    }
${disclaimerCSS}

    /* ---- SEARCH AND CONTROLS ---- */
    .controls-container {
      max-width: 960px;
      margin: 1.5rem auto 2rem;
      padding: 0 2rem;
      position: relative;
      z-index: 10;
    }
    .search-panel {
      background: #fff;
      border: 1px solid var(--rule);
      border-radius: 6px;
      padding: 1rem 1.5rem;
      box-shadow: 0 4px 20px rgba(0,0,0,0.06);
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      align-items: center;
    }
    .search-wrapper {
      flex: 1;
      min-width: 250px;
      position: relative;
    }
    .search-input {
      width: 100%;
      padding: 0.6rem 2.2rem 0.6rem 1rem;
      font-family: inherit;
      font-size: 0.9rem;
      border: 1px solid var(--rule);
      border-radius: 4px;
      outline: none;
      background: var(--cream);
      transition: border-color 0.15s, background-color 0.15s;
    }
    .search-input:focus {
      border-color: var(--green-light);
      background: #fff;
    }
    .search-icon {
      position: absolute;
      right: 0.8rem;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-muted);
      font-size: 0.9rem;
    }
    .filter-buttons {
      display: flex;
      gap: 0.5rem;
      /* Must wrap: on one line the four buttons are ~437px wide and force the
         whole page to pan sideways on phones. */
      flex-wrap: wrap;
    }
    .filter-btn {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.65rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      padding: 0.5rem 0.8rem;
      border: 1px solid var(--rule);
      background: #fff;
      cursor: pointer;
      transition: all 0.15s;
      border-radius: 3px;
    }
    .filter-btn:hover {
      border-color: var(--green-light);
      color: var(--green-mid);
    }
    .filter-btn.active {
      background: var(--green-deep);
      color: #fff;
      border-color: var(--green-deep);
    }
    /* AI-summaries provenance note (once per page, under the search panel) */
    .ai-summaries-note {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.65rem;
      color: var(--text-muted);
      margin-top: 0.6rem;
      padding: 0 0.25rem;
    }

    /* ---- MAIN CONTENT ---- */
    .main-content {
      max-width: 960px;
      margin: 0 auto;
      padding: 0 2rem 4rem;
    }
    /* Each section card is a native <details> accordion, collapsed by default
       so the index reads as a table of contents. Native semantics keep every
       row in the served HTML (Pagefind still indexes it) and the accordion
       stays usable with JavaScript disabled. */
    .sec-card {
      margin-bottom: 1rem;
      background: #fff;
      border: 1px solid var(--rule-light);
      box-shadow: 0 1px 4px rgba(0,0,0,0.02);
    }
    .sec-header {
      background: var(--cream-dark);
      padding: 1rem 1.5rem;
      display: flex;
      align-items: baseline;
      gap: 0.8rem;
      cursor: pointer;
      /* Hide the default disclosure triangle; the .sec-chevron replaces it. */
      list-style: none;
      /* Generous tap target (WCAG 2.5.8 wants 24px; we give 44px+). The
         padding already yields ~52px, the min-height is a guarantee. */
      min-height: 44px;
      user-select: none;
      scroll-margin-top: 1rem;
      transition: background-color 0.15s;
    }
    .sec-header::-webkit-details-marker { display: none; }
    .sec-header:hover { background: var(--green-wash); }
    /* Visible keyboard focus ring, inset so the card border doesn't clip it. */
    .sec-header:focus-visible {
      outline: 3px solid var(--green-mid);
      outline-offset: -3px;
    }
    /* The header/list divider only exists while the section is open;
       closed cards would otherwise show a doubled bottom border. */
    details[open] > .sec-header { border-bottom: 1px solid var(--rule-light); }
    .sec-code {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.75rem;
      color: var(--green-light);
      font-weight: 600;
    }
    .sec-title {
      font-family: 'Fraunces', serif;
      font-size: 1.15rem;
      font-weight: 500;
      color: var(--green-deep);
      /* Let the title shrink below its longest word so the nowrap count chip
         and chevron never push the summary past a 320px viewport. */
      min-width: 0;
      overflow-wrap: anywhere;
    }
    /* Policy-count chip, pushed to the right edge of the summary. */
    .sec-count {
      margin-left: auto;
      align-self: center;
      flex-shrink: 0;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.62rem;
      letter-spacing: 0.02em;
      white-space: nowrap;
      color: var(--green-mid);
      background: var(--green-wash);
      border: 1px solid rgba(74,140,106,0.3);
      border-radius: 999px;
      padding: 0.15rem 0.55rem;
    }
    /* CSS-drawn chevron: points right when closed, rotates down when open. */
    .sec-chevron {
      align-self: center;
      flex-shrink: 0;
      width: 0.5em;
      height: 0.5em;
      border-right: 2px solid var(--green-mid);
      border-bottom: 2px solid var(--green-mid);
      transform: rotate(-45deg);
      transition: transform 0.2s;
    }
    details[open] > .sec-header .sec-chevron { transform: rotate(45deg); }
    @media print {
      /* CSS alone cannot force a closed <details> open; the index script's
         beforeprint handler opens every section for the print run (and
         restores state after). The chevron is meaningless on paper. */
      .sec-chevron { display: none; }
    }
    .policy-list {
      display: flex;
      flex-direction: column;
    }
    /* Each row is now a plain link to that policy's own page. */
    .policy-row {
      display: block;
      border-bottom: 1px solid var(--rule-light);
      padding: 0.8rem 1.5rem;
      text-decoration: none;
      color: inherit;
      transition: background-color 0.15s;
      /* Deep-link landing room: the nav isn't sticky, so this is breathing
         space rather than overlap-avoidance. */
      scroll-margin-top: 1rem;
    }
    .policy-row:last-child {
      border-bottom: none;
    }
    .policy-row:hover {
      background: var(--green-wash);
    }
    .policy-row:hover .policy-title {
      text-decoration: underline;
      text-decoration-color: var(--green-light);
      text-underline-offset: 2px;
    }
    .policy-row-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
    }
    .policy-left {
      display: flex;
      align-items: center;
      gap: 0.8rem;
      flex-wrap: wrap;
    }
    .policy-code {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--text);
      min-width: 60px;
    }
    .policy-title {
      font-family: 'Newsreader', serif;
      font-size: 0.92rem;
      color: var(--green-deep);
      font-weight: 500;
      /* Slash-joined titles ("Dismissal/Suspension/Disciplinary Action") are
         one unbreakable token and pushed rows past a 320px viewport. */
      overflow-wrap: anywhere;
    }
    .policy-badges {
      display: flex;
      gap: 0.3rem;
      align-items: center;
    }
${typeBadgeCSS}
    .policy-right {
      display: flex;
      align-items: center;
      gap: 1rem;
      color: var(--text-muted);
      font-size: 0.72rem;
      font-family: 'IBM Plex Mono', monospace;
    }
    .policy-date {
      white-space: nowrap;
    }
    /* The nowrap date pushed rows past a 375px viewport; the revision date is
       on the policy's own page. */
    @media (max-width: 480px) {
      .policy-date { display: none; }
    }
    .row-arrow {
      color: var(--green-light);
      font-size: 0.75rem;
    }
    /* One-sentence AI summary under the title (empty for PDF exhibits). */
    .policy-summary {
      margin: 0.3rem 0 0;
      font-family: 'Newsreader', serif;
      font-size: 0.84rem;
      line-height: 1.5;
      color: var(--text-secondary);
      overflow-wrap: anywhere;
      max-width: 640px;
    }
    .no-results {
      text-align: center;
      padding: 3rem 0;
      color: var(--text-muted);
      display: none;
      background: #fff;
      border: 1px solid var(--rule-light);
    }
    .no-results h3 {
      font-family: 'Fraunces', serif;
      margin-bottom: 0.5rem;
      color: var(--green-deep);
    }
    .no-results p {
      font-size: 0.88rem;
      max-width: 400px;
      margin: 0 auto;
    }
    @media (max-width: 480px) {
      /* min-width: 250px overflows the search panel's inner padding once the
         viewport drops under ~390px; let the input shrink with the panel. */
      .search-wrapper { min-width: 0; }
      .controls-container, .main-content { padding-left: 1rem; padding-right: 1rem; }
      /* Under ~360px the code + title + chip + chevron can't share one line;
         let the chip/chevron wrap below instead of overflowing sideways. */
      .sec-header { flex-wrap: wrap; padding: 0.9rem 1rem; }
    }
  `;

// ---- Per-policy page CSS ----

const policyCSS = `
${disclaimerCSS}
${typeBadgeCSS}
    .policy-page {
      max-width: 760px;
      margin: 0 auto;
      padding: 1.5rem 1.25rem 4rem;
    }
    .policy-crumb {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.7rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      text-decoration: none;
      color: var(--green-mid);
      display: inline-block;
      padding: 0.4rem 0;
    }
    .policy-crumb:hover { text-decoration: underline; }
    .policy-head { margin: 1rem 0 1.25rem; }
    .policy-kicker {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.72rem;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-bottom: 0.5rem;
    }
    .policy-kicker .policy-code {
      font-weight: 600;
      color: var(--text);
      font-size: 0.85rem;
    }
    .policy-head h1 {
      font-family: 'Fraunces', Georgia, serif;
      font-size: clamp(1.5rem, 4.5vw, 2.3rem);
      font-weight: 400;
      line-height: 1.2;
      color: var(--green-deep);
      overflow-wrap: anywhere;
    }
    .policy-meta-bar {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      border-top: 1px solid var(--rule);
      border-bottom: 1px solid var(--rule);
      padding: 0.6rem 0;
      margin-bottom: 1.25rem;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.65rem;
      color: var(--text-muted);
      /* Revision ids are long unbroken base64 — must wrap inside 320px. */
      overflow-wrap: anywhere;
    }
    .policy-meta-links {
      display: flex;
      gap: 1.25rem;
      flex-wrap: wrap;
    }
    .policy-meta-links a {
      color: var(--green-mid);
      text-decoration: none;
    }
    .policy-meta-links a:hover {
      color: var(--green-deep);
      text-decoration: underline;
    }
    /* Spanish page: machine-translation provenance line, shown when the
       Spanish body IS rendered. Calmer than the yellow fallback note —
       green wash, matching the BP type badge. */
    .policy-es-note {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.68rem;
      line-height: 1.55;
      color: var(--green-mid);
      background: var(--green-wash);
      border: 1px solid rgba(74,140,106,0.3);
      border-radius: 3px;
      padding: 0.5rem 0.8rem;
      margin-bottom: 1rem;
    }
    .policy-es-note a { color: var(--green-deep); }
    /* Spanish page: "body text is English-only for now" fallback note. */
    .policy-lang-note {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.68rem;
      line-height: 1.55;
      color: #664d03;
      background: #fff3cd;
      border: 1px solid #e0c36a;
      border-radius: 3px;
      padding: 0.5rem 0.8rem;
      margin-bottom: 1rem;
    }
    /* Visually hidden but real content: indexed by Pagefind, read by
       screen readers. NOT display:none/hidden (Pagefind drops those). */
    .sr-only {
      position: absolute;
      width: 1px; height: 1px;
      padding: 0; margin: -1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
      border: 0;
    }
    .policy-body-text {
      font-family: 'Newsreader', Georgia, serif;
      font-size: 0.95rem;
      line-height: 1.7;
      white-space: pre-wrap;
      overflow-wrap: break-word;
      margin-bottom: 2rem;
    }
    /* PDF exhibits: featured link box instead of an empty body. */
    .policy-exhibit {
      background: #fff;
      border: 1px solid var(--rule);
      border-left: 3px solid var(--green-light);
      padding: 1.2rem 1.4rem;
      margin-bottom: 2rem;
      font-size: 0.92rem;
    }
    .policy-exhibit p { margin-bottom: 0.6rem; }
    .policy-exhibit a {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.8rem;
      font-weight: 600;
    }
    .policy-exhibit ul {
      margin: 0.4rem 0 0 1.2rem;
      font-size: 0.85rem;
      color: var(--text-secondary);
    }
    .policy-refs-section {
      background: #fff;
      border: 1px solid var(--rule-light);
      padding: 1.2rem;
      margin-top: 1.5rem;
      font-size: 0.8rem;
    }
    .policy-refs-title {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.65rem;
      text-transform: uppercase;
      color: var(--green-light);
      letter-spacing: 0.05em;
      margin-bottom: 0.6rem;
      border-bottom: 1px solid var(--rule-light);
      padding-bottom: 0.3rem;
    }
    .ref-group { margin-bottom: 1rem; }
    .ref-group:last-child { margin-bottom: 0; }
    .ref-group-title {
      font-weight: 600;
      margin-bottom: 0.3rem;
      color: var(--text);
    }
    .ref-item {
      margin-left: 1rem;
      margin-bottom: 0.25rem;
      line-height: 1.45;
      /* Statute citations and URLs are long unbroken tokens. */
      overflow-wrap: anywhere;
    }
    .ref-code {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.72rem;
      font-weight: 500;
    }
    .xref-list {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }
    .xref-item {
      font-size: 0.78rem;
      overflow-wrap: anywhere;
    }
    .xref-code {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.72rem;
      font-weight: 600;
      display: inline-block;
      min-width: 5.2rem;
    }
    .xref-item a { color: var(--green-mid); }
    .xref-item a:hover { color: var(--green-deep); }
    @media (max-width: 480px) {
      .policy-page { padding: 1rem 0.9rem 3rem; }
      .ref-item { margin-left: 0.4rem; }
    }
  `;

// ---- Index page JSON-LD ----

function policiesIndexJsonLd(policies, page, titleFor) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    "name": page.jsonLdName,
    "description": page.metaDescription,
    "url": page.canonical,
    "publisher": {
      "@type": "GovernmentOrganization",
      "name": "Redwood City School District",
      "url": "https://www.rcsdk8.net"
    },
    "about": {
      "@type": "GovernmentOrganization",
      "name": "Redwood City School District Board of Trustees"
    },
    "inLanguage": page.lang,
    "genre": "Government Policy",
    "hasPart": policies.map((p) => ({
      "@type": ["Legislation", "DigitalDocument"],
      "name": `${p.type} ${p.code}: ${titleFor(p)}`,
      "legislationIdentifier": `${p.type} ${p.code}`,
      "legislationType": LEGISLATION_TYPE_EN[p.type] || 'Board Bylaw',
      "url": `https://rcsd.info${page.indexHref}${policySlug(p.code, p.type)}/`,
      "dateModified": isoDate(p.lastRevised) || undefined
    }))
  };

  return `<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`;
}

// ---- Per-policy page JSON-LD ----
// One Legislation/DigitalDocument entity per page; the EN and ES twins point
// at each other via workTranslation/translationOfWork (mirrors how school
// pages pair their language variants).

function policyJsonLd({ p, page, displayTitle, summary, canonicalUrl, twinUrl }) {
  const isEs = page.lang === 'es';
  const schema = {
    "@context": "https://schema.org",
    "@type": ["Legislation", "DigitalDocument"],
    "@id": `${canonicalUrl}#policy`,
    "name": `${p.type} ${p.code}: ${displayTitle}`,
    "legislationIdentifier": `${p.type} ${p.code}`,
    "legislationType": LEGISLATION_TYPE_EN[p.type] || 'Board Bylaw',
    "url": canonicalUrl,
    "inLanguage": page.lang,
    "isPartOf": {
      "@type": "CreativeWork",
      "name": page.jsonLdName,
      "url": page.canonical
    },
    "publisher": {
      "@type": "GovernmentOrganization",
      "name": "Redwood City School District",
      "url": "https://www.rcsdk8.net"
    }
  };
  if (summary) schema.description = summary;
  const modified = isoDate(p.lastRevised);
  if (modified) schema.dateModified = modified;

  const twin = {
    "@type": ["Legislation", "DigitalDocument"],
    "@id": `${twinUrl}#policy`,
    "url": twinUrl,
    "inLanguage": isEs ? 'en' : 'es'
  };
  if (isEs) schema.translationOfWork = twin;
  else schema.workTranslation = twin;

  return `<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`;
}

// ---- Index page client script (search + type filter + accordion; no drawer) ----
// Accordion contract:
//   - Default state: every <details.sec-card> collapsed (a table of contents).
//   - While a search query or a non-'all' type filter is active, every
//     section with visible matching rows auto-opens; clearing back to the
//     default re-collapses everything except the location.hash target's
//     section, so deep-linked rows never vanish.
//   - #'{slug}' (a policy row) and #sec-XXXX (a summary) deep links open
//     their section and scroll into view, on load and on hashchange.
//   - beforeprint opens all sections (CSS can't force <details> open);
//     afterprint restores the prior state.

function indexClientScript() {
  return `
    document.addEventListener('DOMContentLoaded', () => {
      const searchInput = document.getElementById('search-input');
      const filterBtns = document.querySelectorAll('.filter-btn');
      const policyRows = Array.from(document.querySelectorAll('.policy-row'));
      const secCards = Array.from(document.querySelectorAll('details.sec-card'));
      const noResults = document.getElementById('no-results');

      let currentSearch = '';
      let currentFilter = 'all';
      // The section the current location.hash points into (a row's parent
      // <details>, or a summary's own). Kept open in the default state.
      let hashCard = null;

      // Accent-insensitive compare so "filosofia" matches "Filosofía".
      function norm(s) {
        return (s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
      }

      // Pre-computed searchable haystack per row: code + both languages'
      // titles + curated synonym keywords + the visible one-sentence summary.
      const haystacks = new Map();
      policyRows.forEach(row => {
        const summaryEl = row.querySelector('.policy-summary');
        haystacks.set(row, norm([
          row.getAttribute('data-code'),
          row.getAttribute('data-title'),
          row.getAttribute('data-title-alt'),
          row.getAttribute('data-keywords'),
          summaryEl ? summaryEl.textContent : ''
        ].join(' ')));
      });

      function updateVisibility() {
        let totalVisible = 0;
        const q = norm(currentSearch);
        // Any query or non-default filter flips the accordion from
        // table-of-contents mode into findability mode.
        const filtering = q !== '' || currentFilter !== 'all';

        secCards.forEach(card => {
          const rowsInCard = card.querySelectorAll('.policy-row');
          let visibleInCard = 0;

          rowsInCard.forEach(row => {
            const type = row.getAttribute('data-type') || '';
            const matchesSearch = !q || (haystacks.get(row) || '').includes(q);
            const matchesFilter = currentFilter === 'all' || type === currentFilter;

            if (matchesSearch && matchesFilter) {
              row.style.display = '';
              visibleInCard++;
              totalVisible++;
            } else {
              row.style.display = 'none';
            }
          });

          card.style.display = visibleInCard > 0 ? '' : 'none';
          // Findability: matches must be visible without extra clicks, so
          // matching sections auto-open. Back at the default state, collapse
          // everything except the hash target's section.
          card.open = filtering ? visibleInCard > 0 : card === hashCard;
        });

        noResults.style.display = totalVisible === 0 ? 'block' : 'none';
      }

      searchInput.addEventListener('input', (e) => {
        currentSearch = e.target.value.trim();
        updateVisibility();
      });

      filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          filterBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          currentFilter = btn.getAttribute('data-filter');
          updateVisibility();
        });
      });

      // ---- Deep links: #{row-slug} or #sec-XXXX ----
      // Per-policy breadcrumbs link back to the index as /policies/#{slug};
      // those anchors now live inside collapsed <details>, so the section
      // must be opened before the row can be scrolled to.
      function openHashTarget() {
        hashCard = null;
        let id = location.hash.slice(1);
        try { id = decodeURIComponent(id); } catch (e) { /* keep raw */ }
        if (!id) return;
        const target = document.getElementById(id);
        if (!target) return;
        const card = target.closest('details.sec-card');
        if (!card) return;
        hashCard = card;
        card.open = true;
        // Scroll after the newly opened section has laid out; CSS
        // scroll-margin-top gives the row breathing room at the top.
        requestAnimationFrame(() => target.scrollIntoView());
      }
      openHashTarget();
      window.addEventListener('hashchange', openHashTarget);

      // ---- Print: open everything, then restore ----
      // No CSS rule can force a closed <details> open, so do it in JS for
      // the duration of the print run.
      let printClosed = null;
      window.addEventListener('beforeprint', () => {
        printClosed = secCards.filter(c => !c.open);
        printClosed.forEach(c => { c.open = true; });
      });
      window.addEventListener('afterprint', () => {
        (printClosed || []).forEach(c => { c.open = false; });
        printClosed = null;
      });
    });
  `;
}

// ---- Index page assembly ----

function buildIndexPage({ page, sections, policiesBySection, policies, titlesEs, summaries }) {
  const isEs = page.lang === 'es';
  // Per-type totals drive the filter buttons; zero-count types (the catalog
  // currently has no BB-typed entries) get no button at all rather than a
  // filter that can only ever show an empty list.
  const typeCounts = policies.reduce((m, p) => ((m[p.type] = (m[p.type] || 0) + 1), m), {});
  // Per-policy display title: Spanish page uses the AI-translated title,
  // falling back to English if a translation is somehow missing.
  const esTitle = (p) => titlesEs.titles[`${p.code}-${p.type}`]?.es || p.title;
  const titleFor = (p) => (isEs ? esTitle(p) : p.title);
  const altTitleFor = (p) => (isEs ? p.title : esTitle(p));
  const sectionNameFor = (sec) => (isEs ? (titlesEs.sections[sec.code]?.es || sec.name) : sec.name);
  // One-sentence summary in this page's language; the 12 PDF exhibits have
  // no summary and render no summary line (never invent one).
  const summaryFor = (p) => summaries[`${p.code}-${p.type}`]?.[page.lang] || null;

  let sectionsHtml = '';
  for (const sec of sections) {
    const secPolicies = policiesBySection[sec.code] || [];
    if (secPolicies.length === 0) continue;

    let pRowsHtml = '';
    for (const p of secPolicies) {
      const typeBadgeClass = p.type.toLowerCase() === 'bp' ? 'type-badge--bp'
                           : p.type.toLowerCase() === 'ar' ? 'type-badge--ar'
                           : 'type-badge--bb';
      const slug = policySlug(p.code, p.type);
      const href = `${page.indexHref}${slug}/`;
      const keywords = SEARCH_SYNONYMS[p.code] || '';
      const summary = summaryFor(p);

      pRowsHtml += `
        <a class="policy-row" id="${escapeAttr(slug)}" href="${escapeAttr(href)}" data-code="${escapeAttr(p.code)}" data-title="${escapeAttr(titleFor(p))}" data-title-alt="${escapeAttr(altTitleFor(p))}"${keywords ? ` data-keywords="${escapeAttr(keywords)}"` : ''} data-type="${escapeAttr(p.type)}">
          <div class="policy-row-header">
            <div class="policy-left">
              <span class="policy-code">${escapeText(p.code)}</span>
              <span class="policy-title">${escapeText(titleFor(p))}</span>
              <span class="policy-badges">
                <span class="type-badge ${typeBadgeClass}">${escapeText(p.type)}</span>
              </span>
            </div>
            <div class="policy-right">
              <span class="policy-date">${escapeText(formatUsDate(p.lastRevised, page.lang) || page.unmodified)}</span>
              <span class="row-arrow" aria-hidden="true">&rarr;</span>
            </div>
          </div>${summary ? `
          <p class="policy-summary">${escapeText(summary)}</p>` : ''}
        </a>
      `;
    }

    // Native <details> accordion (collapsed by default — no open attribute).
    // The summary id (#sec-5000 etc.) is a deep-link target alongside the
    // per-row #slug anchors. The old <h3 class="sec-title"> became a <span>:
    // the HTML spec only allows a heading as the summary's SOLE content, and
    // browsers flatten descendant heading roles inside summary's implicit
    // button anyway. Visuals are class-driven and unchanged.
    sectionsHtml += `
      <details class="sec-card" data-sec-code="${escapeAttr(sec.code)}">
        <summary class="sec-header" id="sec-${escapeAttr(sec.code)}">
          <span class="sec-code">${escapeText(sec.code)}</span>
          <span class="sec-title">${escapeText(sectionNameFor(sec))}</span>
          <span class="sec-count">${escapeText(page.countChip(secPolicies.length))}</span>
          <span class="sec-chevron" aria-hidden="true"></span>
        </summary>
        <div class="policy-list">
          ${pRowsHtml}
        </div>
      </details>
    `;
  }

  return `<!DOCTYPE html>
<html lang="${page.htmlLang}">
<head>
${headMeta({
  title: escapeAttr(page.metaTitle),
  description: escapeAttr(page.metaDescription),
  canonical: page.canonical,
  ogLocale: page.ogLocale,
  ogImageKey: page.ogImageKey,
  hreflang: INDEX_HREFLANG,
  jsonLd: policiesIndexJsonLd(policies, page, titleFor),
  pageCSS: indexCSS,
})}
</head>
<body>

${siteNav({ activePage: 'district', lang: page.lang, altLangHref: page.altIndexHref })}

<header class="policies-header">
  <div class="policies-header-inner">
    <h1>${page.h1}</h1>
    <p>${page.subtitle}</p>
  </div>
</header>

<div class="disclaimer">
  ${page.disclaimer}
</div>

<div class="controls-container">
  <div class="search-panel">
    <div class="search-wrapper">
      <span class="search-icon">&#128269;</span>
      <input type="text" id="search-input" class="search-input" placeholder="${escapeAttr(page.searchPlaceholder)}" aria-label="${escapeAttr(page.searchAriaLabel)}">
    </div>
    <div class="filter-buttons">
      <button class="filter-btn active" data-filter="all">${page.filterAll} (${policies.length})</button>
      ${[['BP', page.filterBP], ['AR', page.filterAR], ['BB', page.filterBB]]
        .filter(([t]) => typeCounts[t] > 0)
        .map(([t, label]) => `<button class="filter-btn" data-filter="${t}">${label} (${typeCounts[t]})</button>`)
        .join('\n      ')}
    </div>
  </div>
  <p class="ai-summaries-note">${escapeText(page.aiSummariesNote)}</p>
</div>

<main class="main-content">
  <div id="policies-catalog">
    ${sectionsHtml}
  </div>

  <div id="no-results" class="no-results">
    <h3>${page.noResultsTitle}</h3>
    <p>${page.noResultsBody}</p>
  </div>
</main>

${siteFooter({ lang: page.lang })}

<script>
${indexClientScript()}
</script>

</body>
</html>
`;
}

// ---- Per-policy page assembly ----

function buildPolicyPage({ p, page, detail, esBody, titlesEs, summaries, provenance, catalogByKey, catalogByCode }) {
  const isEs = page.lang === 'es';
  const key = `${p.code}-${p.type}`;
  const slug = policySlug(p.code, p.type);

  const enTitle = p.title;
  const esTitleStr = titlesEs.titles[key]?.es || p.title;
  const displayTitle = isEs ? esTitleStr : enTitle;

  const canonicalUrl = `https://rcsd.info${page.indexHref}${slug}/`;
  const twinUrl = `https://rcsd.info${page.altIndexHref}${slug}/`;
  const enUrl = isEs ? twinUrl : canonicalUrl;
  const esUrl = isEs ? canonicalUrl : twinUrl;

  const summary = summaries[key]?.[page.lang] || null;
  const isExhibit = !(detail.contentText && detail.contentText.trim());
  const metaDescription = summary
    || (isExhibit ? page.exhibitDesc(p, displayTitle) : page.fallbackDesc(p, displayTitle));

  const officialUrl = officialSimbliUrl(detail, p.revid);
  const datasetManifest = isEs ? provenance.translation : provenance.english;
  const datasetManifestName = isEs ? 'rcsd.board-policies-es.json' : 'rcsd.board-policies.json';
  const datasetManifestUrl = `https://data.rcsd.info/json/provenance/${datasetManifestName}`;
  const summaryManifestUrl = 'https://data.rcsd.info/json/provenance/rcsd.board-policy-summaries.json';
  // The catalog filename is the raw "{code}-{type}.json"; codes can contain
  // spaces and parens ("0420.41-E PDF(1)"), so the href is URI-encoded.
  const hasEsBody = !!(esBody && typeof esBody.contentTextEs === 'string' && esBody.contentTextEs.trim());
  const jsonHref = (isEs && hasEsBody)
    ? `/board-policies-es/${encodeURIComponent(key)}.json`
    : `/board-policies/${encodeURIComponent(key)}.json`;

  const typeBadgeClass = p.type.toLowerCase() === 'bp' ? 'type-badge--bp'
                       : p.type.toLowerCase() === 'ar' ? 'type-badge--ar'
                       : 'type-badge--bb';
  const typeLabel = page.typeLabels[p.type] || p.type;

  // ---- Metadata row ----
  const checkedDate = detail._metadata?.scrapedAt
    ? new Date(detail._metadata.scrapedAt).toLocaleDateString(page.dateLocale)
    : page.na;
  const metaParts = [
    `${page.lastRevised}: ${escapeText(formatUsDate(p.lastRevised, page.lang) || page.na)}`,
  ];
  if (p.lastReviewed && p.lastReviewed !== p.lastRevised) {
    metaParts.push(`${page.lastReviewed}: ${escapeText(formatUsDate(p.lastReviewed, page.lang))}`);
  }
  metaParts.push(`${page.checked}: ${escapeText(checkedDate)}`);
  metaParts.push(`${page.revisionId}: ${escapeText(p.revid || page.na)}`);

  // ---- Body (or exhibit box) + language notes ----
  let langNoteHtml = '';
  let bodyHtml = '';

  if (isExhibit) {
    // PDF exhibits have no extractable text — feature the official PDF link
    // instead of an empty body. (None of the 12 current exhibits carries
    // attachment records; if the scraper ever populates them, list the
    // filenames too. Attachment records have no URLs, names only.)
    // The PDF itself is English-only, so ES pages keep the honest yellow note.
    if (isEs && page.enFallbackNote) {
      langNoteHtml = `
  <p class="policy-lang-note">${escapeText(page.enFallbackNote)}</p>`;
    }
    const attachments = Array.isArray(detail.attachments) ? detail.attachments : [];
    const attachmentsHtml = attachments.length > 0
      ? `<p>${escapeText(page.attachmentsLabel)}:</p><ul>${attachments.map(a => `<li>${escapeText(a.filename || a.name || '')}</li>`).join('')}</ul>`
      : '';
    bodyHtml = `
  <div class="policy-exhibit">
    <p>${escapeText(page.exhibitLead)}</p>
    <a href="${escapeAttr(officialUrl)}" target="_blank" rel="noopener">${page.exhibitLink}</a>
    ${attachmentsHtml}
  </div>`;
  } else if (isEs && hasEsBody) {
    // Machine-translated Spanish body + the binding-English disclaimer.
    langNoteHtml = `
  <p class="policy-es-note">${escapeText(page.esBodyNote.text)}<a href="${escapeAttr(officialUrl)}" target="_blank" rel="noopener">${page.esBodyNote.linkLabel}</a></p>`;
    bodyHtml = `
  <div class="policy-body-text">${escapeText(esBody.contentTextEs)}</div>`;
  } else {
    // English body — on the ES page this is the honest fallback case. The
    // yellow note carries the page's single Simbli link (the ES meta row
    // links our English version instead).
    if (isEs && page.enFallbackNote) {
      langNoteHtml = `
  <p class="policy-lang-note">${escapeText(page.enFallbackNote)} <a href="${escapeAttr(officialUrl)}" target="_blank" rel="noopener">${page.official}</a></p>`;
    }
    bodyHtml = `
  <div class="policy-body-text"${isEs ? ' lang="en"' : ''}>${escapeText(detail.contentText)}</div>`;
  }

  // Curated search synonyms (same map the index filter uses) emitted as
  // visually-hidden real text so Pagefind indexes them on the policy page
  // itself — 'uniformes' should rank the dress-code page, not only filter the
  // index. sr-only CSS (not hidden/display:none, which Pagefind drops); also
  // genuinely useful to screen-reader users as an 'also known as' line.
  const synonyms = SEARCH_SYNONYMS[detail.code] || '';
  const synonymsHtml = synonyms
    ? `\n  <p class="sr-only" data-pagefind-weight="10">${escapeText(page.alsoSearchedAs)}: ${escapeText(synonyms)}</p>`
    : '';
  bodyHtml += synonymsHtml;

  // One machine-readable source drives both this panel and the public
  // provenance JSON. Never infer a stronger status than the sidecar declares.
  const qualityStateRaw = datasetManifest?.quality?.state || 'unreviewed';
  const qualityLabelsEs = {
    'unreviewed': 'sin revisar',
    'machine-checked': 'revisado automáticamente',
    'human-reviewed': 'revisado por una persona',
    'reconciled': 'conciliado',
    'partial': 'parcial',
  };
  const qualityState = isEs ? (qualityLabelsEs[qualityStateRaw] || qualityStateRaw) : qualityStateRaw;
  const provenanceChecked = datasetManifest?.quality?.checkedAt
    ? new Date(datasetManifest.quality.checkedAt).toLocaleDateString(page.dateLocale)
    : checkedDate;
  const provenanceHtml = `
  <aside class="policy-provenance" aria-labelledby="policy-provenance-title">
    <h2 id="policy-provenance-title">${page.provenanceTitle}</h2>
    <dl>
      <dt>${escapeText(page.provenanceStatus)}</dt>
      <dd>${escapeText(page.provenanceStatusValue)}</dd>
      <dt>${escapeText(page.provenanceQuality)}</dt>
      <dd>${escapeText(qualityState)} &middot; ${escapeText(provenanceChecked)}</dd>
      <dt>${escapeText(page.provenanceSource)}</dt>
      <dd><a href="${escapeAttr(officialUrl)}" target="_blank" rel="noopener">Simbli</a></dd>
    </dl>
    <p>${escapeText(page.provenanceNote)}</p>
    <div class="policy-provenance-links">
      <a href="${escapeAttr(datasetManifestUrl)}" target="_blank" rel="noopener">${page.provenanceData}</a>
      <a href="${escapeAttr(summaryManifestUrl)}" target="_blank" rel="noopener">${page.provenanceSummary}</a>
    </div>
  </aside>`;

  // ---- Footnotes / legal references ----
  // Citations render verbatim; only http(s) URLs become links.
  let footnotesHtml = '';
  if (Array.isArray(detail.footnotes) && detail.footnotes.length > 0) {
    const groups = detail.footnotes.map(group => {
      const refs = (group.references || []).map(ref => {
        const refUrl = safeUrl(ref.url);
        const codeHtml = refUrl
          ? `<a href="${escapeAttr(refUrl)}" target="_blank" rel="noopener">${escapeText(ref.code)}</a>`
          : `<span class="ref-code">${escapeText(ref.code)}</span>`;
        return `<div class="ref-item">${codeHtml} - ${escapeText(ref.description)}</div>`;
      }).join('\n        ');
      return `<div class="ref-group">
        <div class="ref-group-title">${escapeText(group.type)}</div>
        ${refs}
      </div>`;
    }).join('\n      ');
    footnotesHtml = `
  <section class="policy-refs-section">
    <h2 class="policy-refs-title">${page.legalRefs}</h2>
      ${groups}
  </section>`;
  }

  // ---- Cross references, linked when the target is in the catalog ----
  // Source data repeats refs (each appears twice); dedupe by code+type.
  // TRAP: Simbli's crossRef "type" field is constant garbage — every one of
  // the 24,268 refs in the catalog says "AR", even when the target is a BP.
  // Resolve by code instead: exact code-type first (harmless), then the same
  // code as BP, then ANY catalog entry sharing the code. Render the RESOLVED
  // entry's real type and title, not the ref's claimed ones.
  let crossRefsHtml = '';
  if (Array.isArray(detail.crossRefs) && detail.crossRefs.length > 0) {
    const seen = new Set();
    const items = [];
    for (const ref of detail.crossRefs) {
      const target = catalogByKey.get(`${ref.code}-${ref.type}`)
        || catalogByKey.get(`${ref.code}-BP`)
        || catalogByCode.get(ref.code);
      const refKey = target ? `${target.code}-${target.type}` : `${ref.code}-${ref.type}`;
      if (seen.has(refKey)) continue;
      seen.add(refKey);
      if (target) {
        // In-catalog: link to the same-language policy page; on ES pages use
        // the AI-translated title since that's where the link goes.
        const refTitle = isEs ? (titlesEs.titles[refKey]?.es || target.title) : target.title;
        const refHref = `${page.indexHref}${policySlug(target.code, target.type)}/`;
        items.push(`<div class="xref-item"><span class="xref-code">${escapeText(target.code)} ${escapeText(target.type)}</span> <a href="${escapeAttr(refHref)}">${escapeText(refTitle)}</a></div>`);
      } else {
        // Not in the active catalog (rescinded/CSBA-only): plain text.
        items.push(`<div class="xref-item"><span class="xref-code">${escapeText(ref.code)} ${escapeText(ref.type)}</span> <span>${escapeText(ref.title)}</span></div>`);
      }
    }
    crossRefsHtml = `
  <section class="policy-refs-section">
    <h2 class="policy-refs-title">${page.crossRefs}</h2>
    <div class="xref-list">
      ${items.join('\n      ')}
    </div>
  </section>`;
  }

  const hreflang = [
    { lang: 'x-default', href: enUrl },
    { lang: 'en', href: enUrl },
    { lang: 'es', href: esUrl },
  ];

  return `<!DOCTYPE html>
<html lang="${page.htmlLang}">
<head>
${headMeta({
  title: escapeAttr(page.pageTitle(p, displayTitle)),
  description: escapeAttr(metaDescription),
  canonical: canonicalUrl,
  ogLocale: page.ogLocale,
  ogImageKey: page.ogImageKey,
  hreflang,
  jsonLd: policyJsonLd({ p, page, displayTitle, summary, canonicalUrl, twinUrl }),
  extraHead: `<link rel="describedby" href="${escapeAttr(datasetManifestUrl)}" type="application/json">
<link rel="stylesheet" href="/styles/policy-provenance.css">`,
  pageCSS: policyCSS,
})}
</head>
<body>

${siteNav({ activePage: 'district', lang: page.lang, altLangHref: `${page.altIndexHref}${slug}/` })}

<div class="disclaimer">
  ${page.disclaimer}
</div>

<main class="policy-page">
  <a class="policy-crumb" href="${escapeAttr(`${page.indexHref}#${slug}`)}">${page.crumb}</a>

  <header class="policy-head">
    <div class="policy-kicker">
      <span class="policy-code">${escapeText(p.code)}</span>
      <span class="type-badge ${typeBadgeClass}">${escapeText(p.type)}</span>
      <span>${escapeText(typeLabel)}</span>
    </div>
    <h1>${escapeText(displayTitle)}</h1>
  </header>

  <div class="policy-meta-bar">
    <div class="policy-meta-data">${metaParts.join(' &middot; ')}</div>
    <div class="policy-meta-links">
      ${isEs
        ? `<a href="/policies/${slug}/">${page.englishVersion}</a>`
        : `<a href="${escapeAttr(officialUrl)}" target="_blank" rel="noopener">${page.official}</a>`}
      <a href="${escapeAttr(jsonHref)}" target="_blank" rel="noopener">${page.viewJson}</a>
    </div>
  </div>
${langNoteHtml}${bodyHtml}${provenanceHtml}${footnotesHtml}${crossRefsHtml}
</main>

${siteFooter({ lang: page.lang })}

</body>
</html>
`;
}

// ---- Build ----

function main() {
  console.log('Publishing policies in machine-readable form...');

  for (const [path, hint] of [
    [INDEX_DATA_PATH, 'Run scrape-board-policies.mjs first.'],
    [TITLES_ES_PATH, 'Run scripts/translate-policy-titles.mjs first.'],
    [SUMMARIES_PATH, 'Run scripts/generate-policy-summaries.mjs first.'],
    [POLICY_PROVENANCE_PATH, 'Run scripts/generate-policy-provenance.mjs first.'],
    [POLICY_ES_PROVENANCE_PATH, 'Run scripts/generate-policy-provenance.mjs first.'],
    [POLICY_SUMMARY_PROVENANCE_PATH, 'Run scripts/generate-policy-provenance.mjs first.'],
  ]) {
    if (!existsSync(path)) {
      console.error(`Error: ${path} does not exist. ${hint}`);
      process.exit(1);
    }
  }

  // 1. Copy policies-index.json to docs/ (machine-readable, additive-only —
  // the MCP server and the rcsd-data skill consume this).
  const indexJsonStr = readFileSync(INDEX_DATA_PATH, 'utf-8');
  writeFileSync(INDEX_DOCS_PATH, indexJsonStr);
  console.log(`Copied global index to ${INDEX_DOCS_PATH}`);

  // 2. Copy individual policy JSONs to docs/board-policies/
  mkdirSync(POLICIES_DOCS_DIR, { recursive: true });
  const dataFiles = readdirSync(POLICIES_DATA_DIR).filter(f => f.endsWith('.json'));
  console.log(`Copying ${dataFiles.length} detailed policy JSONs to public docs...`);
  for (const filename of dataFiles) {
    writeFileSync(resolve(POLICIES_DOCS_DIR, filename), readFileSync(resolve(POLICIES_DATA_DIR, filename)));
  }

  // 2b. Copy machine-translated Spanish bodies to docs/board-policies-es/.
  // The source dir may hold only some policies while translation is running;
  // publish whatever exists. Missing ones fall back to English pages.
  mkdirSync(POLICIES_ES_DOCS_DIR, { recursive: true });
  const esFiles = existsSync(POLICIES_ES_DATA_DIR)
    ? readdirSync(POLICIES_ES_DATA_DIR).filter(f => f.endsWith('.json'))
    : [];
  for (const filename of esFiles) {
    writeFileSync(resolve(POLICIES_ES_DOCS_DIR, filename), readFileSync(resolve(POLICIES_ES_DATA_DIR, filename)));
  }
  console.log(`Published ${esFiles.length}/${dataFiles.length} Spanish policy bodies (missing ones fall back to English).`);

  // 3. Load everything once.
  const indexData = JSON.parse(indexJsonStr);
  const titlesEs = JSON.parse(readFileSync(TITLES_ES_PATH, 'utf-8'));
  const summaries = JSON.parse(readFileSync(SUMMARIES_PATH, 'utf-8')).summaries || {};
  const provenance = {
    english: JSON.parse(readFileSync(POLICY_PROVENANCE_PATH, 'utf-8')),
    translation: JSON.parse(readFileSync(POLICY_ES_PROVENANCE_PATH, 'utf-8')),
    summaries: JSON.parse(readFileSync(POLICY_SUMMARY_PROVENANCE_PATH, 'utf-8')),
  };

  const sections = indexData.sections || [];
  const policies = indexData.policies || [];

  // Slug uniqueness is a hard invariant: a collision would silently overwrite
  // a policy page. 619 code+type pairs must yield 619 unique slugs.
  const slugOwner = new Map();
  for (const p of policies) {
    const slug = policySlug(p.code, p.type);
    if (slugOwner.has(slug)) {
      console.error(`Error: slug collision "${slug}" between ${slugOwner.get(slug)} and ${p.code}-${p.type}.`);
      process.exit(1);
    }
    slugOwner.set(slug, `${p.code}-${p.type}`);
  }
  console.log(`Slug check: ${policies.length} policies -> ${slugOwner.size} unique slugs.`);

  // Fast lookup for cross-reference linking. catalogByCode resolves refs whose
  // claimed type is wrong (Simbli says AR for everything): BP wins when a code
  // has both, since the policy is the natural cross-reference target.
  const catalogByKey = new Map(policies.map(p => [`${p.code}-${p.type}`, p]));
  const catalogByCode = new Map();
  for (const p of policies) {
    const cur = catalogByCode.get(p.code);
    if (!cur || (p.type === 'BP' && cur.type !== 'BP')) catalogByCode.set(p.code, p);
  }

  // Per-policy detail + Spanish bodies, read once and reused by both
  // language pages.
  const detailByKey = new Map();
  const esBodyByKey = new Map();
  for (const p of policies) {
    const key = `${p.code}-${p.type}`;
    const detailPath = resolve(POLICIES_DATA_DIR, `${key}.json`);
    if (!existsSync(detailPath)) {
      console.error(`Error: missing detail JSON for ${key} (${detailPath}). Re-run scrape-board-policies.mjs.`);
      process.exit(1);
    }
    detailByKey.set(key, JSON.parse(readFileSync(detailPath, 'utf-8')));
    const esPath = resolve(POLICIES_ES_DATA_DIR, `${key}.json`);
    if (existsSync(esPath)) {
      esBodyByKey.set(key, JSON.parse(readFileSync(esPath, 'utf-8')));
    }
  }

  // Group policies by section (index page layout).
  const policiesBySection = {};
  for (const sec of sections) policiesBySection[sec.code] = [];
  for (const pol of policies) {
    const secCode = pol.section || '0000';
    if (!policiesBySection[secCode]) policiesBySection[secCode] = [];
    policiesBySection[secCode].push(pol);
  }
  for (const secCode of Object.keys(policiesBySection)) {
    policiesBySection[secCode].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  }

  const missingEsTitles = policies.filter(p => !titlesEs.titles[`${p.code}-${p.type}`]);
  if (missingEsTitles.length > 0) {
    console.warn(`Warning: ${missingEsTitles.length} policies have no Spanish title (falling back to English). Re-run scripts/translate-policy-titles.mjs.`);
  }
  const missingSummaries = policies.filter(p => {
    const detail = detailByKey.get(`${p.code}-${p.type}`);
    return detail.contentText?.trim() && !summaries[`${p.code}-${p.type}`];
  });
  if (missingSummaries.length > 0) {
    console.warn(`Warning: ${missingSummaries.length} non-exhibit policies have no summary. Re-run scripts/generate-policy-summaries.mjs.`);
  }

  // 4. Index pages: docs/policies/index.html (EN) + docs/politicas/index.html (ES)
  for (const page of Object.values(PAGES)) {
    mkdirSync(page.outputDir, { recursive: true });
    const html = buildIndexPage({ page, sections, policiesBySection, policies, titlesEs, summaries });
    const outPath = resolve(page.outputDir, 'index.html');
    writeFileSync(outPath, html);
    console.log(`Built policies index (${page.lang}) at ${outPath}`);
  }

  // 5. Per-policy pages, both languages.
  let pageCount = 0;
  let esBodyCount = 0;
  for (const p of policies) {
    const key = `${p.code}-${p.type}`;
    const detail = detailByKey.get(key);
    const esBody = esBodyByKey.get(key) || null;
    const slug = policySlug(p.code, p.type);

    for (const page of Object.values(PAGES)) {
      const outDir = resolve(page.outputDir, slug);
      mkdirSync(outDir, { recursive: true });
      const html = buildPolicyPage({ p, page, detail, esBody, titlesEs, summaries, provenance, catalogByKey, catalogByCode });
      writeFileSync(resolve(outDir, 'index.html'), html);
      pageCount++;
    }
    if (esBody?.contentTextEs?.trim()) esBodyCount++;
  }
  console.log(`Built ${pageCount} per-policy pages (${policies.length} EN + ${policies.length} ES; ${esBodyCount} ES pages carry translated bodies).`);
}

main();
