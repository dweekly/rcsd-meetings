#!/usr/bin/env node
/**
 * Generate docs/budget/index.html and docs/presupuesto/index.html
 * Comprehensive district budget deep-dive pages.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { headMeta, siteNav, siteFooter } from './html-parts.mjs';
import {
  caDashboardUrl, RCSD_DISTRICT_CDS, LCAP_YEAR, LCAP_PDF_URL, BUDGET_SOURCE, ACTUALS_SOURCE,
} from './lib/school-year.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---- Page-specific CSS (reuses district page patterns) ----
const budgetCSS = `
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
  .proposed-banner {
    max-width: 900px;
    margin: 1.5rem auto 0;
    padding: 1.1rem 1.4rem;
    background: var(--green-wash);
    border: 1px solid var(--green-light);
    border-left: 4px solid var(--green-deep);
    border-radius: 6px;
  }
  .proposed-banner .pb-tag {
    display: inline-block;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.66rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--green-deep);
    margin-bottom: 0.35rem;
  }
  .proposed-banner h2 {
    font-size: 1.15rem;
    margin: 0 0 0.2rem;
    border: none;
    padding: 0;
  }
  .proposed-banner .pb-dates {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.72rem;
    color: var(--green-mid);
    margin: 0 0 0.8rem;
  }
  .proposed-banner .pb-figs {
    display: flex;
    flex-wrap: wrap;
    gap: 1.2rem 2rem;
    margin: 0.4rem 0 0.9rem;
  }
  .proposed-banner .pb-fig { line-height: 1.2; }
  .proposed-banner .pb-fig .pb-val {
    display: block;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--green-deep);
  }
  .proposed-banner .pb-fig .pb-lbl {
    display: block;
    font-size: 0.7rem;
    color: var(--green-mid);
  }
  .proposed-banner .pb-docs { font-size: 0.82rem; margin: 0; }
  .proposed-banner .pb-note {
    font-size: 0.72rem;
    color: var(--green-mid);
    margin: 0.55rem 0 0;
    font-style: italic;
  }
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
  .toc a.toc-ext {
    color: var(--green-mid);
    font-weight: 600;
    border-bottom-color: var(--green-pale);
  }
  .toc a.toc-ext:hover { color: var(--green-deep); border-bottom-color: var(--green-light); }
  .toc a.active {
    color: var(--green-deep);
    border-bottom-color: var(--green-mid);
    background: var(--cream);
  }
  .content {
    max-width: 900px;
    margin: 0 auto;
    padding: 0 2rem 6rem;
  }
  .section { padding-top: 3.5rem; }
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
  p { margin-bottom: 1rem; max-width: 640px; }
  .wide p { max-width: none; }
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
  thead th.num { text-align: right; }
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
  tbody tr:last-child td {
    border-bottom: 2px solid var(--rule);
  }
  tbody tr.total-row td {
    font-weight: 500;
    border-top: 2px solid var(--green-deep);
    border-bottom: 2px solid var(--green-deep);
    background: var(--green-wash);
  }
  tbody tr:hover td { background: var(--green-wash); }
  .bar-cell { position: relative; min-width: 100px; }
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
  .callout {
    background: var(--green-wash);
    border-left: 3px solid var(--green-light);
    padding: 1.2rem 1.5rem;
    margin: 1.5rem 0;
    font-size: 0.92rem;
    max-width: none;
  }
  .callout p { max-width: none; margin-bottom: 0.5rem; }
  .callout p:last-child { margin-bottom: 0; }
  .callout-amber {
    background: #fdf6e8;
    border-left-color: var(--amber);
  }
  .callout-coral {
    background: var(--coral-light);
    border-left-color: var(--coral);
  }
  .glossary {
    columns: 2;
    column-gap: 2.5rem;
    margin-top: 1.5rem;
  }
  .glossary-item {
    break-inside: avoid;
    margin-bottom: 1rem;
    font-size: 0.88rem;
  }
  .glossary-term {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--green-deep);
  }
  .glossary-def {
    color: var(--text-secondary);
    margin-top: 0.15rem;
    line-height: 1.5;
  }
  .trend-item {
    padding: 1.5rem 0;
    border-bottom: 1px solid var(--rule-light);
  }
  .trend-item:last-child { border-bottom: none; }
  .trend-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 0.4rem;
  }
  .trend-item p { font-size: 0.92rem; max-width: none; }
  .trend-up { color: var(--green-mid); }
  .trend-down { color: var(--coral); }
  .trend-flat { color: var(--text-muted); }
  @media (max-width: 640px) {
    html { font-size: 15px; }
    .header-inner { padding: 3rem 1.2rem 2.5rem; }
    .content { padding: 0 1.2rem 4rem; }
    .header-meta { gap: 1.5rem; }
    .glossary { columns: 1; }
    .toc a { padding: 0.8rem 0.6rem; font-size: 0.6rem; }
    .proposed-banner { margin: 1.5rem 1rem 0; }
    /* Actual-vs-adopted tables carry two full-dollar columns; tighten them so the
       adopted column isn't hidden off the right edge on a phone. */
    thead th, tbody td { padding: 0.5rem 0.4rem; }
    thead th:first-child, tbody td:first-child { padding-left: 0; }
    tbody td.num { font-size: 0.7rem; letter-spacing: -0.02em; }
  }
  .site-footer { font-size: 0.8rem; text-align: left; }
  .footer-nav { margin-top: 1rem; }
  .footer-nav a { font-size: 0.68rem; margin: 0 1.5rem 0 0; }
`;

// ---- Figures, each with the report it came from ----
//
// Every number on this page lives here or is computed from here, next to the
// report it was copied from. BUDGET_SOURCE and ACTUALS_SOURCE (school-year.mjs)
// name those reports in headings and source notes; the guard below refuses to
// build when a constant has moved but these figures have not, so a bump can
// never relabel old numbers as new ones. To refresh: replace the figures, update
// FIGURES_FROM, then bump the constant.
//
// Sources (all public, archived on R2 from the Board's Simbli agendas):
//   ADOPTED  2026-27 Adopted Budget book, approved by the Board 2026-06-24 (4-0,
//            minutes approved 2026-08-10). Revenue table p. 11, expenditure table
//            p. 12, assumptions p. 9, short-form multi-year projection p. 15,
//            other funds p. 16, statement of reasons p. 25. The 6/17 hearing MYP
//            (2026-27-MYP-Budget-Adoption.pdf) carries identical totals.
//   ACTUALS  2025-26 Unaudited Actuals book, approved by the Board 2026-09-23
//            (5-0, meeting recording; minutes not yet posted). Executive summary
//            p. 7, Fund 01 summary p. 8, revenue table p. 9, expenditure table
//            p. 10, other funds p. 13, SACS Form 01 fund-balance components.
//   LCAP     2026-27 LCAP adopted 2026-06-24 (LCAP_PDF_URL): Increased or Improved
//            Services p. 74, Total Planned Expenditures Table p. 95; goal totals
//            are the sums of each goal's action rows (Goals & Actions tables).
//   MEASURE_C  San Mateo County Elections, June 2, 2026 Official Results,
//            certified 2026-06-30 (results page and Election Summary Report FINAL).
const FIGURES_FROM = {
  budget: { fiscalYear: '2026-27', report: 'adopted' },
  actuals: { fiscalYear: '2025-26' },
};
if (FIGURES_FROM.budget.fiscalYear !== BUDGET_SOURCE.fiscalYear
  || FIGURES_FROM.budget.report !== BUDGET_SOURCE.report
  || FIGURES_FROM.actuals.fiscalYear !== ACTUALS_SOURCE.fiscalYear) {
  throw new Error(
    `build-budget.mjs holds figures from the ${FIGURES_FROM.budget.fiscalYear} ${FIGURES_FROM.budget.report} budget `
    + `and ${FIGURES_FROM.actuals.fiscalYear} actuals, but school-year.mjs says BUDGET_SOURCE=${JSON.stringify(BUDGET_SOURCE)} `
    + `ACTUALS_SOURCE=${JSON.stringify(ACTUALS_SOURCE)}. Refresh the figures in build-budget.mjs from the new report `
    + 'before (or together with) bumping the constant. See docs/ANNUAL-REFRESH.md.',
  );
}

const PACKETS = 'https://data.rcsd.info/board-packets';
const DOCS = {
  adoptedBook: `${PACKETS}/2026-06-24/2026-27-Proposed-Adopted-Budget-Book.pdf`,
  hearingMyp: `${PACKETS}/2026-06-17/2026-27-MYP-Budget-Adoption.pdf`,
  minutes0624: `${PACKETS}/2026-08-10/2026.06.24-Minutes-DRAFT-Closed.Regular.pdf`,
  uaBook: `${PACKETS}/2026-09-23/25.26-Unaudited-Actuals-Book.pdf`,
  uaPresentation: `${PACKETS}/2026-09-23/25-26-UA-Presentation.pdf`,
  gann: `${PACKETS}/2026-09-23/Gann-Limit-Resolution-10-26.27.pdf`,
  lcap: LCAP_PDF_URL,
  cdeExhibit: 'https://ias.cde.ca.gov/apportionment/PrincipalApportionmentWebExhibit',
  districtBudget: 'https://www.rcsdk8.net/our-programs-and-services/business-services/district-budget',
  measureCResults: 'https://smcacre.gov/elections/june-2-2026-election-results',
  measureCSummary: 'https://smcacre.gov/system/files/2026-06/51_ElectionSummaryReportFINAL.pdf',
};

// RCSD's LCFF funding as the state computes it: CDE Principal Apportionment Web
// Exhibits (DOCS.cdeExhibit), 2025-26 P-2, School District, "School District LCFF
// Calculation", San Mateo / Redwood City Elementary. Read 2026-10-18. The books'
// "LCFF State Aid" line is line J-9 here, Categorical Minimum State Aid under
// EC 42238.03(e), not formula state aid: Gross State Aid (I-2) is $0 because local
// revenue exceeds the entitlement (L-1, basic aid = TRUE; margin L-2). The adopted
// 2026-27 book budgets the same $12,863,512.
const STATE_LCFF = {
  period: { en: '2025-26 P-2', es: '2025-26 P-2' },
  entitlement: 82575924,  // H-3
  localRevenue: 85148208, // I-1
  excess: 2572284,        // L-2
  epa: 1198570,           // I-3
  minStateAid: 12863512,  // J-9 / K-2
};
if (STATE_LCFF.localRevenue - STATE_LCFF.entitlement !== STATE_LCFF.excess) {
  throw new Error('STATE_LCFF: local revenue minus entitlement must equal the excess (CDE line L-2).');
}

const DATES = {
  adopted: { en: 'June 24, 2026', es: '24 de junio de 2026' },
  actualsApproved: { en: 'September 23, 2026', es: '23 de septiembre de 2026' },
  secondInterim: { en: 'March 25, 2026', es: '25 de marzo de 2026' },
  measureCCertified: { en: 'June 30, 2026', es: '30 de junio de 2026' },
};

const REPORT_LABEL = {
  adopted: { en: 'Adopted Budget', es: 'Presupuesto Adoptado' },
  'first-interim': { en: 'First Interim Report', es: 'Primer Informe Interino' },
  'second-interim': { en: 'Second Interim Report', es: 'Segundo Informe Interino' },
};
/** "2026-27 Adopted Budget" / "Presupuesto Adoptado 2026-27" */
function budgetName(lang) {
  const label = REPORT_LABEL[BUDGET_SOURCE.report][lang];
  return lang === 'es' ? `${label} ${BUDGET_SOURCE.fiscalYear}` : `${BUDGET_SOURCE.fiscalYear} ${label}`;
}
/** "2025-26 Unaudited Actuals" / "Cierre No Auditado 2025-26" */
function actualsName(lang) {
  return lang === 'es' ? `Cierre No Auditado ${ACTUALS_SOURCE.fiscalYear}` : `${ACTUALS_SOURCE.fiscalYear} Unaudited Actuals`;
}

// General Fund (Fund 01) revenue, by the categories both books use.
// [en label, es label, 2025-26 actual, 2026-27 adopted]
const REVENUE_ROWS = [
  ['LCFF Minimum State Aid (see note)', 'Ayuda Estatal Mínima LCFF (ver nota)', 13077781, 12863512],
  ['LCFF Education Protection Account', 'Cuenta de Protección Educativa LCFF', 1198570, 1192530],
  ['LCFF Property Taxes (net of in-lieu)', 'Impuestos a la Propiedad LCFF (netos de pagos a charters)', 85060778, 89320674],
  ['Special Education Property Taxes', 'Impuestos a la Propiedad de Educación Especial', 5737822, 8216514],
  ['Federal Revenues', 'Ingresos Federales', 3849746, 3903526],
  ['Other State Revenues', 'Otros Ingresos Estatales', 21663999, 19821887],
  ['Lottery', 'Lotería', 1764923, 1657535],
  ['Local Revenues', 'Ingresos Locales', 13472245, 11684351],
  ['Measure U Parcel Tax', 'Impuesto Parcelario Medida U', 1658889, 1628702],
  ['Transfer in: RDA negotiated agreements (Fund 25)', 'Transferencia: acuerdos negociados RDA (Fondo 25)', 11000000, 0],
];
const REVENUE_TOTAL = { actual: 158484752, adopted: 150289231 };      // book totals, incl. the transfer
const ACTUAL_TRANSFER_IN = 11000000;

// General Fund (Fund 01) expenditures. [en, es, 2025-26 actual, 2026-27 adopted]
const EXPENDITURE_ROWS = [
  ['Certificated Salaries (teachers, admin)', 'Salarios Certificados (maestros, admin.)', 54231756, 52368633],
  ['Classified Salaries (support staff)', 'Salarios Clasificados (personal de apoyo)', 28849566, 29786894],
  ['Employee Benefits', 'Beneficios de Empleados', 38440449, 41437925],
  ['Books &amp; Supplies', 'Libros y Materiales', 3392014, 2675022],
  ['Services &amp; Operating Expenses', 'Servicios y Gastos Operativos', 31288708, 25281768],
  ['Capital Outlay', 'Gastos de Capital', 850564, 115423],
  ['Other Outgo &amp; Indirect Costs (net)', 'Otros Pagos y Costos Indirectos (neto)', 162621, -393137],
];
const EXPENDITURE_TOTAL = { actual: 157215678, adopted: 151272528 };

// 2025-26 close (Unaudited Actuals).
const ACTUALS = {
  revenue: 147484752,          // executive-summary basis: excludes the $11.0M transfer in
  expenditures: 157215678,
  transferIn: ACTUAL_TRANSFER_IN,
  beginningBalance: 17108863,
  endingBalance: 18377937,
  estimatedActualsEnding: 12748477, // what the June budget assumed 2025-26 would end at
  enrollment: 6310,              // Oct 2025 CALPADS (certified)
  ada: '94.70%',
  // SACS Form 01 components of the June 30, 2026 ending balance (rounded to dollars)
  components: [
    ['Nonspendable (revolving cash, stores, prepaids)', 'No disponible (caja chica, inventario, prepagos)', 604327],
    ['Restricted (grants and programs with legal limits)', 'Restringido (subsidios y programas con límites legales)', 10575459],
    ['Assigned (carryover of site and S&amp;C funds)', 'Asignado (sobrantes de escuelas y de S&amp;C)', 930411],
    ['Reserve for Economic Uncertainties (3%)', 'Reserva para Incertidumbre Económica (3%)', 4716470],
    ['Unassigned', 'Sin asignar', 1551270],
  ],
  gannLimit: '$94,351,626.61',
  otherFunds: { f12: 4063385, f13: 5262368, f21: 39071748, f25: 10300259, f35: 22543400, f40: 7570471 },
};

// Adopted multi-year projection (book p. 15). The 2025-26 column is the June
// Estimated Actuals the budget was built on, not the September actuals.
const MYP = {
  years: ['2025-26', '2026-27', '2027-28', '2028-29'],
  revenue: [162391540, 150289231, 157058394, 164126755],        // incl. transfers in
  expenditures: [166751924, 151272528, 151936002, 154813136],
  beginning: [17108861, 12748477, 11765180, 16887572],
  ending: [12748477, 11765180, 16887572, 26201192],
  reserveEU: [5002558, 4538176, 4558080, 4644394],
  unassigned: [211527, 173723, 979499, 4601172],
  reservePct: ['3.13%', '3.11%', '3.64%', '5.97%'],
  // The book's 2028-29 ending balance ($26,201,192) is $1 more than its own
  // beginning balance plus net change ($26,201,191): rounding in the book.
  roundingGap: [0, 0, 0, -1],
};
const FUND21_ADOPTED_END = 3350536;   // Fund 21 projected June 30, 2027 (book p. 16)
const EXCESS_OVER_MINIMUM = 253723;   // statement of reasons, p. 25

// Adopted budget assumptions (book p. 9). [en, es, 25-26, 26-27, 27-28, 28-29]
const ASSUMPTIONS = [
  ['District Enrollment', 'Inscripción del Distrito', '6,310', '6,239', '6,212', '6,152'],
  ['Average Daily Attendance', 'Asistencia Diaria Promedio', '94.70%', '95.57%', '95.33%', '95.33%'],
  ['Unduplicated Pupil %', '% de Alumnos No Duplicados', '60.28%', '59.37%', '58.28%', '58.11%'],
  ['LCFF COLA', 'COLA de LCFF', '2.30%', '2.41%', '3.30%', '3.09%'],
  ['CalSTRS Rate', 'Tasa CalSTRS', '19.10%', '19.10%', '19.10%', '19.10%'],
  ['CalPERS Rate', 'Tasa CalPERS', '26.81%', '26.40%', '26.80%', '25.90%'],
  ['Step &amp; Column', 'Escalafón (Step &amp; Column)', '1.50%', '1.50%', '1.50%', '1.50%'],
  ['Property Tax Growth', 'Crecimiento del Impuesto a la Propiedad', '5.00%', '5.00%', '5.00%', '5.00%'],
  ['California CPI', 'IPC de California', '3.37%', '3.08%', '3.18%', '2.76%'],
];
const ADOPTED_ENROLLMENT = 6239;
const ADOPTED_RESERVE_PCT = MYP.reservePct[1];

// Adopted 2026-27 LCAP. Goal totals are sums of each goal's action rows and
// together equal the plan's Total Funds.
const LCAP = {
  goals: [
    { n: 3, en: 'Academics', es: 'Académicos', amount: 58589581,
      focusEn: 'i-Ready growth in ELA and math; CAASPP for English learners; core classroom staffing (Action 3.1, $53.2M)',
      focusEs: 'Crecimiento en i-Ready en lectura y matemáticas; CAASPP de estudiantes de inglés; personal básico de los salónes (Acción 3.1, $53.2M)' },
    { n: 1, en: 'Engagement &amp; well-being', es: 'Participación y bienestar', amount: 8153952,
      focusEn: 'Social-emotional support (MTSS), attendance, chronic absence, suspensions',
      focusEs: 'Apoyo socioemocional (MTSS), asistencia, ausentismo crónico, suspensiones' },
    { n: 2, en: 'English Learners', es: 'Estudiantes de Inglés', amount: 2585826,
      focusEn: 'ELPAC progress, reclassification, fewer Long-Term English Learners',
      focusEs: 'Progreso en ELPAC, reclasificación, menos estudiantes de inglés a largo plazo (LTEL)' },
  ],
  total: 69329359,
  byFund: { lcff: 67324965, otherState: 1068788, federal: 935606 },
  scEntitlement: 9874917,
  scPercent: '12.122%',
};

const MEASURE_C = {
  yes: 15695, no: 8336, yesPct: '65.31%', noPct: '34.69%',
};

// ---- Formatting helpers and arithmetic checks ----
const fmt = (n) => Math.abs(n).toLocaleString('en-US');
/** $1,234 or ($1,234) for negatives */
const usd = (n) => (n < 0 ? `($${fmt(n)})` : `$${fmt(n)}`);
/** $150.3M with `d` decimals */
const mil = (n, d = 1) => `${n < 0 ? '(' : ''}$${(Math.abs(n) / 1e6).toFixed(d)}M${n < 0 ? ')' : ''}`;
const signed = (n) => (n < 0 ? usd(n) : `+${usd(n)}`);
const pct = (part, whole) => `${((part / whole) * 100).toFixed(1)}%`;
const sum = (a) => a.reduce((s, x) => s + x, 0);

/** Fail the build unless got - want equals the documented gap (0 unless the source itself is off). */
function check(label, got, want, knownGap = 0) {
  if (got - want !== knownGap) throw new Error(`build-budget.mjs arithmetic: ${label} is ${got}, expected ${want}${knownGap ? ` + ${knownGap}` : ''}`);
}
// The Unaudited Actuals revenue table's rows add to $1 more than its printed
// total: its Local Revenues + Measure U split ($13,472,245 + $1,658,889) is $1
// over SACS local revenue ($15,131,133). The page prints the book's total and
// says so in the source note.
const ACTUAL_REVENUE_ROUNDING = 1;
check('2025-26 revenue rows', sum(REVENUE_ROWS.map(r => r[2])), REVENUE_TOTAL.actual, ACTUAL_REVENUE_ROUNDING);
check('2026-27 revenue rows', sum(REVENUE_ROWS.map(r => r[3])), REVENUE_TOTAL.adopted);
check('2025-26 revenue excl. transfer', REVENUE_TOTAL.actual - ACTUAL_TRANSFER_IN, ACTUALS.revenue);
check('2025-26 expenditure rows', sum(EXPENDITURE_ROWS.map(r => r[2])), EXPENDITURE_TOTAL.actual);
check('2026-27 expenditure rows', sum(EXPENDITURE_ROWS.map(r => r[3])), EXPENDITURE_TOTAL.adopted);
check('2025-26 close', ACTUALS.beginningBalance + ACTUALS.revenue + ACTUALS.transferIn - ACTUALS.expenditures, ACTUALS.endingBalance);
check('2025-26 components', sum(ACTUALS.components.map(c => c[2])), ACTUALS.endingBalance);
MYP.years.forEach((y, i) => {
  check(`MYP ${y} roll-forward`, MYP.beginning[i] + MYP.revenue[i] - MYP.expenditures[i], MYP.ending[i], MYP.roundingGap[i]);
  if (i > 0) check(`MYP ${y} beginning`, MYP.beginning[i], MYP.ending[i - 1]);
});
check('MYP 2026-27 revenue', MYP.revenue[1], REVENUE_TOTAL.adopted);
check('MYP 2026-27 expenditures', MYP.expenditures[1], EXPENDITURE_TOTAL.adopted);
check('LCAP goals', sum(LCAP.goals.map(g => g.amount)), LCAP.total);
check('LCAP funds', LCAP.byFund.lcff + LCAP.byFund.otherState + LCAP.byFund.federal, LCAP.total);

const adoptedNet = REVENUE_TOTAL.adopted - EXPENDITURE_TOTAL.adopted;            // -983,297
const actualNet = ACTUALS.endingBalance - ACTUALS.beginningBalance;              // +1,269,074
const actualOperating = ACTUALS.revenue - ACTUALS.expenditures;                  // -9,730,926
const actualVsEstimate = ACTUALS.endingBalance - ACTUALS.estimatedActualsEnding; // +5,629,460
const actualReserve = ACTUALS.components[3][2] + ACTUALS.components[4][2];
const actualReservePct = `${((actualReserve / ACTUALS.expenditures) * 100).toFixed(2)}%`;
const adoptedReserve = MYP.reserveEU[1] + MYP.unassigned[1];
const perPupilAdopted = Math.round(EXPENDITURE_TOTAL.adopted / ADOPTED_ENROLLMENT);
const perPupilActual = Math.round(ACTUALS.expenditures / ACTUALS.enrollment);
const personnelAdopted = EXPENDITURE_ROWS.slice(0, 3).reduce((s, r) => s + r[3], 0);
const personnelPct = pct(personnelAdopted, EXPENDITURE_TOTAL.adopted);
const propTaxAdopted = REVENUE_ROWS[2][3] + REVENUE_ROWS[3][3];
const mcTotal = MEASURE_C.yes + MEASURE_C.no;
const mcNeeded = Math.ceil((mcTotal * 2) / 3);
// Carried forward from the actual 2025-26 close, the adopted plan (same revenue
// and expenditures) ends 2026-27 at this balance; the Unaudited Actuals' SACS
// Form 01 "2026-27 Budget" column shows exactly this ($17,394,640).
const adoptedEndFromActual = ACTUALS.endingBalance + adoptedNet;
check('2026-27 carried forward from actuals (SACS Form 01)', adoptedEndFromActual, 17394640);

/** A two-column (actual vs adopted) amount table. rows: [en, es, actual, adopted] */
function compareTable(lang, rows, totals, totalLabel, { pctOf = 'adopted' } = {}) {
  const es = lang === 'es';
  const i = es ? 1 : 0;
  const head = es
    ? `<tr><th>Categoría</th><th class="num">${ACTUALS_SOURCE.fiscalYear}<br>real</th><th class="num">${BUDGET_SOURCE.fiscalYear}<br>adoptado</th><th class="num">% de ${BUDGET_SOURCE.fiscalYear}</th></tr>`
    : `<tr><th>Category</th><th class="num">${ACTUALS_SOURCE.fiscalYear}<br>actual</th><th class="num">${BUDGET_SOURCE.fiscalYear}<br>adopted</th><th class="num">% of ${BUDGET_SOURCE.fiscalYear}</th></tr>`;
  const body = rows.map(r => `<tr><td>${r[i]}</td><td class="num">${usd(r[2])}</td><td class="num">${r[3] === 0 ? '&mdash;' : usd(r[3])}</td><td class="num">${r[3] === 0 ? '&mdash;' : pct(r[3], totals[pctOf])}</td></tr>`).join('\n        ');
  return `<div class="table-wrap">
    <table>
      <thead>
        ${head}
      </thead>
      <tbody>
        ${body}
        <tr class="total-row"><td>${totalLabel}</td><td class="num">${usd(totals.actual)}</td><td class="num">${usd(totals.adopted)}</td><td class="num">100%</td></tr>
      </tbody>
    </table>
  </div>`;
}

function mypTable(lang) {
  const es = lang === 'es';
  const cols = MYP.years.map((y, i) => (i === 0
    ? (es ? `${y}<br>estimado (junio)` : `${y}<br>est. (June)`)
    : i === 1 ? (es ? `${y}<br>adoptado` : `${y}<br>adopted`) : (es ? `${y}<br>proyección` : `${y}<br>projection`)));
  const row = (label, vals, f = usd) => `<tr><td>${label}</td>${vals.map(v => `<td class="num">${f(v)}</td>`).join('')}</tr>`;
  const net = MYP.years.map((_, i) => MYP.revenue[i] - MYP.expenditures[i]);
  const netCell = (v) => `<span style="color:var(${v < 0 ? '--coral' : '--green-mid'})">${signed(v)}</span>`;
  return `<div class="table-wrap">
    <table>
      <thead>
        <tr><th></th>${cols.map(c => `<th class="num">${c}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${row(es ? 'Ingresos Totales (con transferencias)' : 'Total Revenues (incl. transfers in)', MYP.revenue)}
        ${row(es ? 'Gastos Totales' : 'Total Expenditures', MYP.expenditures)}
        ${row(es ? 'Cambio Neto en el Balance' : 'Net Change in Fund Balance', net, netCell)}
        ${row(es ? 'Balance Inicial' : 'Beginning Balance', MYP.beginning)}
        ${row(es ? 'Balance Final' : 'Ending Balance', MYP.ending)}
        ${row(es ? 'Reserva (3% + sin asignar)' : 'Reserve (3% + unassigned)', MYP.years.map((_, i) => MYP.reserveEU[i] + MYP.unassigned[i]))}
        ${row(es ? '% de Reserva' : 'Reserve %', MYP.reservePct, v => v)}
      </tbody>
    </table>
  </div>`;
}

function assumptionsTable(lang) {
  const es = lang === 'es';
  return `<div class="table-wrap">
    <table>
      <thead>
        <tr><th>${es ? 'Supuesto' : 'Assumption'}</th>${MYP.years.map(y => `<th class="num">${y}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${ASSUMPTIONS.map(a => `<tr><td>${es ? a[1] : a[0]}</td>${a.slice(2).map(v => `<td class="num">${v}</td>`).join('')}</tr>`).join('\n        ')}
      </tbody>
    </table>
  </div>`;
}

function lcapTable(lang) {
  const es = lang === 'es';
  return `<div class="table-wrap">
    <table>
      <thead>
        <tr><th>${es ? 'Meta LCAP' : 'LCAP Goal'}</th><th class="num">${es ? 'Monto' : 'Amount'}</th><th>${es ? 'Enfoque' : 'Focus'}</th></tr>
      </thead>
      <tbody>
        ${LCAP.goals.map(g => `<tr><td>${es ? 'Meta' : 'Goal'} ${g.n}: ${es ? g.es : g.en}</td><td class="num">${usd(g.amount)}</td><td>${es ? g.focusEs : g.focusEn}</td></tr>`).join('\n        ')}
        <tr class="total-row"><td>${es ? 'Total LCAP' : 'Total LCAP'}</td><td class="num">${usd(LCAP.total)}</td><td></td></tr>
      </tbody>
    </table>
  </div>`;
}

function componentsTable(lang) {
  const es = lang === 'es';
  return `<div class="table-wrap">
    <table>
      <thead>
        <tr><th>${es ? `Balance final al 30 de junio de 2026` : 'Ending balance, June 30, 2026'}</th><th class="num">${es ? 'Monto' : 'Amount'}</th></tr>
      </thead>
      <tbody>
        ${ACTUALS.components.map(c => `<tr><td>${es ? c[1] : c[0]}</td><td class="num">${usd(c[2])}</td></tr>`).join('\n        ')}
        <tr class="total-row"><td>${es ? 'Balance Final Total' : 'Total Ending Balance'}</td><td class="num">${usd(ACTUALS.endingBalance)}</td></tr>
      </tbody>
    </table>
  </div>`;
}

const docLink = (href, label) => `<a href="${href}" target="_blank" rel="noopener">${label}</a>`;

// ---- Banner: what this page is built from (bilingual) ----
function sourceBanner(lang) {
  const es = lang === 'es';
  const figs = es
    ? [[mil(REVENUE_TOTAL.adopted), `Ingresos ${BUDGET_SOURCE.fiscalYear}`], [mil(EXPENDITURE_TOTAL.adopted), `Gastos ${BUDGET_SOURCE.fiscalYear}`], [ADOPTED_RESERVE_PCT, `Reserva ${BUDGET_SOURCE.fiscalYear} (mín. 3%)`], [mil(ACTUALS.endingBalance, 2), `Balance real al cierre de ${ACTUALS_SOURCE.fiscalYear}`]]
    : [[mil(REVENUE_TOTAL.adopted), `${BUDGET_SOURCE.fiscalYear} revenues`], [mil(EXPENDITURE_TOTAL.adopted), `${BUDGET_SOURCE.fiscalYear} expenditures`], [ADOPTED_RESERVE_PCT, `${BUDGET_SOURCE.fiscalYear} reserve (3% min.)`], [mil(ACTUALS.endingBalance, 2), `${ACTUALS_SOURCE.fiscalYear} actual ending balance`]];
  const docs = [
    docLink(DOCS.adoptedBook, es ? `Libro del ${budgetName('es')}` : `${budgetName('en')} book`),
    docLink(DOCS.uaBook, es ? `Libro del ${actualsName('es')}` : `${actualsName('en')} book`),
    docLink(DOCS.lcap, es ? `LCAP ${LCAP_YEAR} adoptado` : `Adopted ${LCAP_YEAR} LCAP`),
  ].join(' · ');
  return `
<div class="proposed-banner">
  <span class="pb-tag">${es ? 'Fuentes de esta página' : 'What this page is built from'}</span>
  <h2>${es ? `${budgetName('es')} y ${actualsName('es')}` : `${budgetName('en')} and ${actualsName('en')}`}</h2>
  <p class="pb-dates">${es
    ? `Presupuesto adoptado por la Junta: ${DATES.adopted.es} (4-0) · Cierre no auditado aprobado: ${DATES.actualsApproved.es}`
    : `Budget adopted by the Board: ${DATES.adopted.en} (4-0) · Unaudited Actuals approved: ${DATES.actualsApproved.en}`}</p>
  <div class="pb-figs">
    ${figs.map(([v, l]) => `<div class="pb-fig"><span class="pb-val">${v}</span><span class="pb-lbl">${l}</span></div>`).join('\n    ')}
  </div>
  <p class="pb-docs">${es ? 'Documentos: ' : 'Documents: '}${docs}</p>
  <p class="pb-note">${es
    ? 'El próximo informe del distrito es el Primer Informe Interino, que se presenta en diciembre. Las cifras que vienen de un informe anterior dicen de cuál y de qué fecha son.'
    : 'The district’s next report is the First Interim, presented in December. Any figure on this page from an older report names that report and its date.'}</p>
</div>`;
}

// 2025-26 SPSA budget summaries (same table in both languages; school names are proper nouns).
const SPSA_ROWS = `        <tr><td>Orion</td><td class="num">$1,062K</td><td class="num">$1,934</td><td class="num">&mdash;</td><td class="num">$150K</td><td class="num">$721K</td><td class="num">$131K</td><td class="num">$59K</td></tr>
        <tr><td>Adelante Selby</td><td class="num">$854K</td><td class="num">$1,356</td><td class="num">$73K</td><td class="num">$383K</td><td class="num">$165K</td><td class="num">$147K</td><td class="num">$86K</td></tr>
        <tr><td>McKinley MIT</td><td class="num">$795K</td><td class="num">$1,982</td><td class="num">$27K</td><td class="num">$616K</td><td class="num">&mdash;</td><td class="num">$75K</td><td class="num">$77K</td></tr>
        <tr><td>Hoover</td><td class="num">$734K</td><td class="num">$1,114</td><td class="num">$128K</td><td class="num">$307K</td><td class="num">&mdash;</td><td class="num">$183K</td><td class="num">$116K</td></tr>
        <tr><td>Roy Cloud</td><td class="num">$695K</td><td class="num">$1,046</td><td class="num">&mdash;</td><td class="num">$292K</td><td class="num">$215K</td><td class="num">$117K</td><td class="num">$71K</td></tr>
        <tr><td>Henry Ford</td><td class="num">$681K</td><td class="num">$1,476</td><td class="num">$61K</td><td class="num">$324K</td><td class="num">$75K</td><td class="num">$147K</td><td class="num">$75K</td></tr>
        <tr><td>Clifford</td><td class="num">$665K</td><td class="num">$1,001</td><td class="num">$73K</td><td class="num">$129K</td><td class="num">$196K</td><td class="num">$173K</td><td class="num">$93K</td></tr>
        <tr><td>North Star</td><td class="num">$564K</td><td class="num">$1,020</td><td class="num">&mdash;</td><td class="num">$44K</td><td class="num">$326K</td><td class="num">$135K</td><td class="num">$59K</td></tr>
        <tr><td>Kennedy</td><td class="num">$563K</td><td class="num">$714</td><td class="num">$76K</td><td class="num">$159K</td><td class="num">$20K</td><td class="num">$192K</td><td class="num">$117K</td></tr>
        <tr><td>Roosevelt</td><td class="num">$410K</td><td class="num">$1,192</td><td class="num">$55K</td><td class="num">$158K</td><td class="num">&mdash;</td><td class="num">$109K</td><td class="num">$88K</td></tr>
        <tr><td>Garfield</td><td class="num">$243K</td><td class="num">$936</td><td class="num">$55K</td><td class="num">$19K</td><td class="num">&mdash;</td><td class="num">$79K</td><td class="num">$90K</td></tr>
        <tr><td>Taft</td><td class="num">$238K</td><td class="num">$733</td><td class="num">$69K</td><td class="num">&mdash;</td><td class="num">&mdash;</td><td class="num">$97K</td><td class="num">$72K</td></tr>`;

// ---- English body content ----
function enBody() {
  return `
<header class="site-header">
  <div class="header-inner">
    <div class="header-district">Redwood City School District</div>
    <h1 class="header-title">District Budget Deep Dive</h1>
    <p class="header-subtitle">A comprehensive guide to how RCSD raises and spends about $150 million a year, including school bonds, parcel taxes, and the multi-year fiscal outlook.</p>
    <div class="header-meta">
      <div class="header-stat">
        <span class="header-stat-value">${mil(EXPENDITURE_TOTAL.adopted)}</span>
        <span class="header-stat-label">${BUDGET_SOURCE.fiscalYear} Expenditures</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">${usd(perPupilAdopted)}</span>
        <span class="header-stat-label">Per-Pupil Spending</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">${ADOPTED_RESERVE_PCT}</span>
        <span class="header-stat-label">Reserve (3% Min.)</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">${mil(-adoptedNet)}</span>
        <span class="header-stat-label">Planned Deficit ${BUDGET_SOURCE.fiscalYear}</span>
      </div>
    </div>
  </div>
</header>

<div class="disclaimer">
  Data sourced from the ${budgetName('en')} (adopted ${DATES.adopted.en}), the ${actualsName('en')} (approved ${DATES.actualsApproved.en}), the adopted ${LCAP_YEAR} LCAP, 2025-26 SPSAs, and San Mateo County&rsquo;s certified election results. This is an independent community resource, not an official district publication.
</div>

${sourceBanner('en')}

<nav class="toc" aria-label="Page sections">
  <div class="toc-inner">
    <a href="#overview">Overview</a>
    <a href="#revenue">Revenue</a>
    <a href="#bonds">Bonds</a>
    <a href="#parcel-tax">Parcel Tax</a>
    <a href="#spending">Spending</a>
    <a href="#outlook">Outlook</a>
    <a href="#schools">Schools</a>
    <a href="#documents">Documents</a>
    <a href="#glossary">Glossary</a>
    <a href="/vendors/" class="toc-ext">Vendor Spending &rarr;</a>
  </div>
</nav>

<main class="content">

${sectionOverviewEN()}
${sectionRevenueEN()}
${sectionBondsEN()}
${sectionParcelTaxEN()}
${sectionSpendingEN()}
${sectionOutlookEN()}
${sectionSchoolsEN()}
${sectionDocumentsEN()}
${sectionGlossaryEN()}

</main>`;
}

// ---- Section 1: Overview ----
function sectionOverviewEN() {
  return `
<section class="section" id="overview">
  <div class="section-rule"></div>
  <span class="section-num">01</span>
  <h2>Budget Overview</h2>

  <p>The Redwood City School District (RCSD) runs 12 TK-8 schools. Its ${budgetName('en')}, adopted by the Board on ${DATES.adopted.en}, plans <strong>${mil(EXPENDITURE_TOTAL.adopted)}</strong> in General Fund spending against ${mil(REVENUE_TOTAL.adopted)} in revenue, for a planned deficit of about ${mil(-adoptedNet)}. It assumes ${ADOPTED_ENROLLMENT.toLocaleString('en-US')} students, down from ${ACTUALS.enrollment.toLocaleString('en-US')} in 2025-26.</p>

  <h3>Community-Funded (Basic Aid) Status</h3>
  <p>RCSD is one of roughly 100 "community-funded" (formerly "Basic Aid") districts in California. This means local property tax revenue <em>exceeds</em> what the state would otherwise provide through the Local Control Funding Formula (LCFF). The district keeps all of its local property tax revenue. In the state's ${STATE_LCFF.period.en} calculation, RCSD's local revenue came in ${mil(STATE_LCFF.excess, 1)} above its LCFF entitlement of ${mil(STATE_LCFF.entitlement, 1)}, so the formula owes it no state aid. RCSD does still get two LCFF payments from the state: ${mil(STATE_LCFF.epa, 1)} from the Education Protection Account, which every district receives, and a <em>minimum state aid</em> guarantee of ${mil(STATE_LCFF.minStateAid, 1)} (see Revenue below).</p>

  <div class="callout">
    <p><strong>What does Basic Aid mean in practice?</strong> RCSD's funding rises and falls with local property values, not with state budget decisions. When property values grow, so does district revenue. But unlike state-funded districts, RCSD does not receive automatic cost-of-living adjustments from Sacramento. RCSD still has an LCFF Supplemental and Concentration entitlement, projected at ${mil(LCAP.scEntitlement, 2)} for ${LCAP_YEAR} in the adopted LCAP, based on its share of unduplicated pupils (low-income, English Learner, foster, and homeless students; ${ASSUMPTIONS[2][3]} in the adopted budget's assumptions). In a community-funded district that entitlement is funded from the district's own property tax revenue rather than as a separate state check. Its main effect is to set the LCAP minimum-proportionality spending floor for those students.</p>
  </div>

  <h3>Budget at a Glance</h3>
  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>General Fund</th><th class="num">${ACTUALS_SOURCE.fiscalYear}<br>actual</th><th class="num">${BUDGET_SOURCE.fiscalYear}<br>adopted</th></tr>
      </thead>
      <tbody>
        <tr><td>Revenue</td><td class="num">${usd(ACTUALS.revenue)}</td><td class="num">${usd(REVENUE_TOTAL.adopted)}</td></tr>
        <tr><td>Transfer in (RDA negotiated agreements)</td><td class="num">${usd(ACTUALS.transferIn)}</td><td class="num">$0</td></tr>
        <tr><td>Expenditures</td><td class="num">${usd(ACTUALS.expenditures)}</td><td class="num">${usd(EXPENDITURE_TOTAL.adopted)}</td></tr>
        <tr><td>Net Change in Fund Balance</td><td class="num" style="color:var(--green-mid)">${signed(actualNet)}</td><td class="num" style="color:var(--coral)">${usd(adoptedNet)}</td></tr>
        <tr><td>Beginning Fund Balance</td><td class="num">${usd(ACTUALS.beginningBalance)}</td><td class="num">${usd(MYP.beginning[1])}*</td></tr>
        <tr><td>Ending Fund Balance</td><td class="num">${usd(ACTUALS.endingBalance)}</td><td class="num">${usd(MYP.ending[1])}*</td></tr>
        <tr><td>Reserve (3% min. + unassigned)</td><td class="num">${usd(actualReserve)} (${actualReservePct})</td><td class="num">${usd(adoptedReserve)} (${ADOPTED_RESERVE_PCT})</td></tr>
        <tr><td>Per-Pupil Spending&dagger;</td><td class="num">~${usd(perPupilActual)}</td><td class="num">~${usd(perPupilAdopted)}</td></tr>
        <tr><td>District Enrollment</td><td class="num">${ACTUALS.enrollment.toLocaleString('en-US')}</td><td class="num">${ADOPTED_ENROLLMENT.toLocaleString('en-US')} (projected)</td></tr>
        <tr><td>Average Daily Attendance</td><td class="num">${ACTUALS.ada}</td><td class="num">${ASSUMPTIONS[1][3]} (assumed)</td></tr>
      </tbody>
    </table>
  </div>
  <p class="source">* The budget was built in June on the <em>estimated</em> 2025-26 close (${usd(ACTUALS.estimatedActualsEnding)}). The actual close came in at ${usd(ACTUALS.endingBalance)}. Started from the actual balance, the same ${BUDGET_SOURCE.fiscalYear} plan ends the year at ${usd(adoptedEndFromActual)}, as the state report filed with the Unaudited Actuals shows. &dagger; rcsd.info calculation: General Fund expenditures &divide; enrollment.</p>
  <p class="source">Sources: ${docLink(DOCS.adoptedBook, budgetName('en'))}, adopted ${DATES.adopted.en} (pp. 9, 11, 12, 15); ${docLink(DOCS.uaBook, actualsName('en'))}, approved ${DATES.actualsApproved.en} (pp. 7-10). Revenue for ${ACTUALS_SOURCE.fiscalYear} is shown the way the Unaudited Actuals' executive summary reports it, without the ${mil(ACTUALS.transferIn)} transfer, which has its own row.</p>

  <h3>How ${ACTUALS_SOURCE.fiscalYear} Actually Ended</h3>
  <p>The ${actualsName('en')} close the books on the year that ended June 30, 2026. Spending exceeded revenue by ${usd(-actualOperating)}, but an ${mil(ACTUALS.transferIn)} transfer in from the district's RDA negotiated-agreement funds more than covered the gap, so the General Fund balance <strong>grew ${mil(actualNet, 2)}</strong>, from ${mil(ACTUALS.beginningBalance, 2)} to ${mil(ACTUALS.endingBalance, 2)}. That is about $5.63 million better than the June estimate, mostly because expenditures came in $9.54 million under projection (chiefly services and operating costs, books and supplies, and benefits). Reserves ended at ${actualReservePct} of expenditures (the book rounds this to 4.0%), above the 3% state minimum.</p>
  ${componentsTable('en')}
  <p>The district also certified that its 2025-26 spending subject to the state's Gann (Proposition 4) appropriations limit was exactly at that limit, ${ACTUALS.gannLimit} (${docLink(DOCS.gann, 'Resolution No. 10')}, adopted ${DATES.actualsApproved.en}).</p>
  <p class="source">Source: ${docLink(DOCS.uaBook, actualsName('en'))} (executive summary p. 7; Fund 01 summary p. 8; SACS Form 01 components of ending fund balance), approved by the Board ${DATES.actualsApproved.en}. ${docLink(DOCS.uaPresentation, 'Board presentation')}.</p>

  <h3>What This Page Covers (And What It Doesn't)</h3>
  <p>The numbers above describe <strong>Fund 01, the General Fund</strong> &mdash; RCSD's main operating fund and the source for teacher salaries, instructional programs, and day-to-day operations. The General Fund is the right lens for "what's the district's budget?" because it's by far the largest fund and drives most policy decisions. But the district also operates several separately-accounted funds that don't appear in the ${mil(EXPENDITURE_TOTAL.adopted)} figure (balances at June 30, 2026):</p>
  <ul>
    <li><strong>Fund 12 &mdash; Child Development Center (CDC):</strong> the State Preschool Program (CSPP) and other early-childhood operations, funded primarily by state preschool grants and parent fees. Balance ${mil(ACTUALS.otherFunds.f12, 2)}.</li>
    <li><strong>Fund 13 &mdash; Cafeteria / Child Nutrition Services (CNS):</strong> the school meals program, funded by federal and state meal reimbursements plus meal sales. Balance ${mil(ACTUALS.otherFunds.f13, 2)}.</li>
    <li><strong>Fund 21 &mdash; Building Fund:</strong> proceeds from voter-approved general obligation bonds (Measures S and T), restricted to capital improvements. Covered separately in the <a href="#bonds">Bonds &amp; Construction</a> section.</li>
    <li><strong>Funds 25, 35 and 40 &mdash; capital funds:</strong> Capital Facilities (${mil(ACTUALS.otherFunds.f25, 2)}), County School Facilities (${mil(ACTUALS.otherFunds.f35, 2)}) and Special Reserve for Capital Outlay (${mil(ACTUALS.otherFunds.f40, 2)}).</li>
  </ul>
  <p>Other smaller funds (debt service, deferred maintenance, etc.) exist but are non-material to district operations. Unless otherwise noted, the rest of this page describes Fund 01.</p>
  <p class="source">Other-fund balances: ${docLink(DOCS.uaBook, actualsName('en'))}, Summary of Other Funds (p. 13).</p>
</section>`;
}

// ---- Section 2: Revenue ----
function sectionRevenueEN() {
  return `
<section class="section" id="revenue">
  <div class="section-rule"></div>
  <span class="section-num">02</span>
  <h2>Where the Money Comes From</h2>

  <p>The ${budgetName('en')} expects <strong>${mil(REVENUE_TOTAL.adopted)}</strong> in General Fund revenue from local property taxes, state and federal funds, and local sources. Because RCSD is a community-funded district, local property taxes are the single largest source. The ${ACTUALS_SOURCE.fiscalYear} column shows what actually came in last year.</p>

  ${compareTable('en', REVENUE_ROWS, REVENUE_TOTAL, 'Total Revenue and Transfers In')}
  <p class="source">Sources: ${docLink(DOCS.adoptedBook, budgetName('en'))}, General Fund Sources of Revenue (p. 11); ${docLink(DOCS.uaBook, actualsName('en'))}, General Fund Sources of Revenue (p. 9). Both books' revenue tables use these categories; the ${ACTUALS_SOURCE.fiscalYear} total includes the ${mil(ACTUALS.transferIn)} transfer, so it is ${mil(ACTUALS.transferIn)} higher than the ${usd(ACTUALS.revenue)} in the Unaudited Actuals' executive summary. Percentages are rounded. The ${ACTUALS_SOURCE.fiscalYear} rows add to $${ACTUAL_REVENUE_ROUNDING} more than the book's printed total, a rounding difference in the book. <strong>Note on minimum state aid:</strong> the books call this line "LCFF State Aid". The state's ${docLink(DOCS.cdeExhibit, 'Principal Apportionment exhibit')} (${STATE_LCFF.period.en}, School District LCFF Calculation) shows what it is: not formula aid, which is $0 for RCSD, but <em>Categorical Minimum State Aid</em> (${usd(STATE_LCFF.minStateAid)}, line J-9). When LCFF replaced the old funding system in 2013, the law (Education Code 42238.03(e)) guaranteed every district at least the state aid it had been getting; for a community-funded district that is the state money it got for special programs in 2012-13. It is a different figure from the Supplemental &amp; Concentration entitlement described below.</p>

  <h3>Property Taxes &mdash; The Foundation</h3>
  <p>Local property taxes (LCFF property taxes plus Special Education property taxes) are budgeted at ${mil(propTaxAdopted)}, or ${pct(propTaxAdopted, REVENUE_TOTAL.adopted)} of ${BUDGET_SOURCE.fiscalYear} General Fund revenue. San Mateo County collects property taxes and distributes the district's share. Because RCSD is community-funded, it keeps all allocated property tax revenue rather than returning a portion to the state. The LCFF property-tax line is shown net of the "in-lieu" property taxes the district passes to charter schools.</p>
  <p>The district assumes ${ASSUMPTIONS[7][3]} annual property tax growth in its multi-year projections. However, as the district notes, "the vast majority of homes in the RCSD attendance zone were purchased when property values were much lower," meaning assessed values (and thus tax revenue) may be lower than neighboring districts with higher turnover.</p>

  <h3>LCFF Supplemental &amp; Concentration Entitlement</h3>
  <p>The adopted ${LCAP_YEAR} LCAP projects RCSD's LCFF Supplemental and Concentration amount at <strong>${usd(LCAP.scEntitlement)}</strong>. This is the <em>entitlement amount</em> calculated by the LCFF formula from the share of RCSD's students who are unduplicated pupils (qualifying as low-income, English Learner, foster youth, or homeless). For state-funded districts this would arrive as separate state cash; for a community-funded district like RCSD the entitlement is funded from the district's own property tax revenue. The amount still has real consequences: it sets the LCAP minimum-proportionality spending floor, meaning the district must show at least this much being directed toward increased or improved services for unduplicated pupils. For ${LCAP_YEAR} the LCAP sets the required percentage to increase or improve services at ${LCAP.scPercent}.</p>
  <p class="source">Source: ${docLink(DOCS.lcap, `Adopted ${LCAP_YEAR} LCAP`)}, Increased or Improved Services (p. 74) and Total Planned Expenditures Table (p. 95).</p>

  <h3>Federal Funds</h3>
  <p>Federal revenues (${mil(REVENUE_ROWS[4][3])}, ${pct(REVENUE_ROWS[4][3], REVENUE_TOTAL.adopted)} of the ${BUDGET_SOURCE.fiscalYear} budget) include Title I grants for high-poverty schools, Title III for English Learner programs, and IDEA funding for special education. Seven of the district's 12 schools receive Title I funding (2025-26 SPSAs). Federal funds are "restricted," meaning they must be spent on specific federally mandated purposes.</p>

  <h3>RDA Transfers</h3>
  <p>In ${ACTUALS_SOURCE.fiscalYear} the General Fund received an <strong>${mil(ACTUALS.transferIn)} transfer</strong> from Fund 25, where the district holds money from its negotiated agreements with the former redevelopment agency (RDA). That was ${pct(ACTUALS.transferIn, REVENUE_TOTAL.actual)} of the year's revenue and transfers. The ${budgetName('en')} and its two projection years include <strong>no such transfer</strong>, which is the largest single reason ${BUDGET_SOURCE.fiscalYear} revenue is lower than ${ACTUALS_SOURCE.fiscalYear}'s.</p>

  <div class="callout callout-coral">
    <p><strong>What are restricted vs. unrestricted funds?</strong> "Restricted" funds come with legal strings attached: federal Title I money must serve low-income students, bond money can only pay for facilities, and Measure U funds can only support the programs voters approved. "Unrestricted" funds (primarily property taxes) can be used for any lawful purpose. Of the ${mil(ACTUALS.endingBalance, 2)} General Fund balance at June 30, 2026, ${mil(ACTUALS.components[1][2], 2)} is restricted, leaving a modest unrestricted cushion.</p>
  </div>
</section>`;
}

// ---- Section 3: Bonds ----
function sectionBondsEN() {
  return `
<section class="section" id="bonds">
  <div class="section-rule"></div>
  <span class="section-num">03</span>
  <h2>School Bonds &mdash; Measures T &amp; S</h2>

  <p>RCSD voters have approved two general obligation (GO) bond measures totaling <strong>$491 million</strong> to modernize school facilities. Bond funds are legally restricted to capital projects and <em>cannot</em> be used for salaries, pensions, or operating expenses.</p>

  <h3>How School Bonds Work</h3>
  <p>A general obligation bond is essentially a loan from investors that the district repays over time using property tax revenue. Voters must approve bonds by a 55% supermajority. The state constitution limits the tax rate to $30 per $100,000 of assessed value for elementary districts ($60 for unified). Bond money goes into a separate Building Fund (Fund 21) &mdash; completely separate from the General Fund that pays for teachers and programs.</p>

  <div class="callout">
    <p><strong>Bond money CAN pay for:</strong> New construction, renovations, HVAC systems, electrical upgrades, safety improvements, technology infrastructure, furniture, and equipment permanently affixed to buildings.</p>
    <p><strong>Bond money CANNOT pay for:</strong> Teacher or administrator salaries, pensions, benefits, textbooks, professional development, or any ongoing operating costs.</p>
  </div>

  <h3>Measure T (Phase I) &mdash; Passed November 2015</h3>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Detail</th><th>Measure T</th></tr></thead>
      <tbody>
        <tr><td>Amount</td><td class="num">$193 million</td></tr>
        <tr><td>Voter Approval</td><td class="num">63.5% Yes</td></tr>
        <tr><td>Tax Rate</td><td class="num">$30 per $100K assessed value</td></tr>
        <tr><td>Max. Repayment Period</td><td class="num">40 years</td></tr>
        <tr><td>Election Date</td><td>November 3, 2015</td></tr>
      </tbody>
    </table>
  </div>
  <p>Measure T funded Phase I of the district's Facilities Master Plan, addressing the most urgent needs at aging campuses. Projects included classroom renovations, roof repairs, fire and earthquake safety upgrades, technology infrastructure, and modernized learning spaces. Completed projects include major modernizations at Hoover, Taft, Clifford, Roosevelt, Garfield, and Adelante Selby, among others.</p>
  <p class="source">Source: <a href="https://ballotpedia.org/Redwood_City_Elementary_School_District_Bond_Issue,_Measure_T_(November_2015)">Ballotpedia: Measure T (2015)</a>.</p>

  <h3>Measure S (Phase II) &mdash; Passed November 2022</h3>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Detail</th><th>Measure S</th></tr></thead>
      <tbody>
        <tr><td>Amount</td><td class="num">$298 million</td></tr>
        <tr><td>Voter Approval</td><td class="num">60.4% Yes</td></tr>
        <tr><td>Tax Rate</td><td class="num">$24 per $100K assessed value</td></tr>
        <tr><td>Annual Revenue (est.)</td><td class="num">~$16 million/year</td></tr>
        <tr><td>Election Date</td><td>November 8, 2022</td></tr>
      </tbody>
    </table>
  </div>
  <p>Measure S continues the modernization work that Measure T began. The district identified approximately $400 million in remaining facility needs. Projects include upgrading STEAM classrooms and labs, providing dedicated music and art spaces, modernizing HVAC and air filtration, and bringing all schools to the same safety and learning standards. Active projects include work at McKinley MIT, Henry Ford, Orion, and Garfield.</p>
  <p class="source">Source: <a href="https://ballotpedia.org/Redwood_City_Elementary_School_District,_California,_Measure_S,_Bond_Measure_(November_2022)">Ballotpedia: Measure S (2022)</a>.</p>

  <h3>Building Fund (Fund 21) Status</h3>
  <p>At June 30, 2026, the Building Fund/Bond Fund held <strong>${mil(ACTUALS.otherFunds.f21, 2)}</strong> (${actualsName('en')}), down from $46.8 million projected at the 2025-26 Second Interim (March 2026) as construction and modernization work funded by Measures T and S continued. The ${budgetName('en')} projects the fund falling to ${mil(FUND21_ADOPTED_END, 2)} by June 30, 2027 as projects draw it down.</p>
  <p class="source">Sources: ${docLink(DOCS.uaBook, actualsName('en'))}, Summary of Other Funds (p. 13); ${docLink(DOCS.adoptedBook, budgetName('en'))}, Summary of Other Funds (p. 16).</p>

  <h3>Citizens' Bond Oversight Committee</h3>
  <p>California law requires an independent Citizens' Bond Oversight Committee (CBOC) to review bond spending and publish annual reports. RCSD's CBOC has nine members representing senior citizens, parents, taxpayers, and community members. The committee meets quarterly at the District Office and publishes annual reports for both Measure T and Measure S. Meeting agendas and minutes are available on the <a href="https://www.rcsdk8.net/our-programs-and-services/school-modernization-and-construction/phase-i-measure-t/measure-t-oversight-committee">district website</a>.</p>
</section>`;
}

// ---- Section 4: Parcel Tax ----
function sectionParcelTaxEN() {
  return `
<section class="section" id="parcel-tax">
  <div class="section-rule"></div>
  <span class="section-num">04</span>
  <h2>Parcel Tax &mdash; Measure U &amp; Measure C (2026)</h2>

  <h3>How Parcel Taxes Work</h3>
  <p>A parcel tax is a flat or formula-based tax levied on each parcel of land within a district, regardless of the property's assessed value. Unlike bonds, parcel tax revenue goes into the General Fund and can be used for operations such as teacher salaries and programs. Parcel taxes require a two-thirds supermajority to pass, a higher bar than the 55% needed for bonds.</p>

  <h3>Current Measure U (2016)</h3>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Detail</th><th>Measure U</th></tr></thead>
      <tbody>
        <tr><td>Amount</td><td class="num">$85 per parcel per year</td></tr>
        <tr><td>Revenue, ${ACTUALS_SOURCE.fiscalYear} actual</td><td class="num">${usd(REVENUE_ROWS[8][2])}</td></tr>
        <tr><td>Revenue, ${BUDGET_SOURCE.fiscalYear} budget</td><td class="num">${usd(REVENUE_ROWS[8][3])}</td></tr>
        <tr><td>Voter Approval</td><td class="num">79.8% Yes</td></tr>
        <tr><td>Duration</td><td>14 years (July 2017 &ndash; June 2030)</td></tr>
        <tr><td>Election Date</td><td>November 8, 2016</td></tr>
        <tr><td>Predecessor</td><td>Renewed a $67/parcel tax from 2012</td></tr>
      </tbody>
    </table>
  </div>

  <p>Measure U funds enhance math, science, reading, and writing instruction; attract and retain qualified teachers; support arts and music programs; and update classroom technology. The tax explicitly prohibits spending on administrative salaries. An independent <a href="https://www.rcsdk8.net/our-programs-and-services/business-services/measure-u-parcel-tax/measure-u-citizens-oversight-committee">Citizens' Oversight Committee</a> monitors fund use.</p>

  <p><strong>Exemptions:</strong> Seniors age 65+, individuals receiving Supplemental Security Income for disability, and those receiving Social Security Disability Insurance with income below 250% of federal poverty guidelines may apply for exemption.</p>

  <h3>Measure C &mdash; June 2026 Parcel Tax (Did Not Pass)</h3>

  <div class="callout callout-amber">
    <p><strong>Measure C failed.</strong> In San Mateo County's official results, certified on ${DATES.measureCCertified.en}, Measure C received <strong>${MEASURE_C.yesPct} Yes</strong> (${fmt(MEASURE_C.yes)} to ${fmt(MEASURE_C.no)}). A parcel tax needs a <strong>two-thirds (66.67%) supermajority</strong>: of the ${fmt(mcTotal)} votes cast on the measure, that would have been ${fmt(mcNeeded)} Yes votes. The RCSD Board had placed the measure on the ballot at a February 26, 2026 special meeting; it would have been <em>in addition to</em> Measure U, which continues through 2030.</p>
  </div>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Detail</th><th>Measure C (2026)</th></tr></thead>
      <tbody>
        <tr><td>Tax Rate</td><td>17.5 cents per square foot of building space</td></tr>
        <tr><td>Vacant/Unimproved Parcels</td><td class="num">$25/year flat rate</td></tr>
        <tr><td>Expected Revenue</td><td class="num">$12.2 million/year</td></tr>
        <tr><td>Duration</td><td>8 years (July 2026 &ndash; June 2034)</td></tr>
        <tr><td>Vote Required</td><td>Two-thirds (66.67%)</td></tr>
        <tr><td>Election Date</td><td>June 2, 2026</td></tr>
        <tr><td>Certified Result</td><td style="color:var(--coral)">Failed: ${MEASURE_C.yesPct} Yes (${fmt(MEASURE_C.yes)}&ndash;${fmt(MEASURE_C.no)}), 1.36 points under two-thirds</td></tr>
      </tbody>
    </table>
  </div>

  <p>Measure C would have raised approximately <strong>$12.2 million per year</strong> for eight years &mdash; about $175 a year for a 1,000-square-foot home, with exemptions for seniors and people receiving federal disability support. The district had earmarked the revenue to attract and retain teachers, counselors, and staff; protect science, math, and STEM instruction; preserve reading and writing programs; and keep class sizes manageable.</p>

  <h3>What the Result Means for the Budget</h3>
  <p>Measure C revenue was never built into the district's budget. The ${budgetName('en')} lists Measure U (${usd(REVENUE_ROWS[8][3])}) as its only parcel tax and still keeps reserves above the 3% legal minimum in all three years of its projection (see the <a href="#outlook">Multi-Year Fiscal Outlook</a>). So the result does not by itself trigger new cuts. What it does mean is that the roughly $12.2M a year Measure C would have raised is money the district will <em>not</em> have to restore programs and staffing trimmed in the February 2026 Fiscal Stabilization Plan, or to replace the ${mil(ACTUALS.transferIn)} RDA transfer that ends after ${ACTUALS_SOURCE.fiscalYear}. Measure U ($1.6M/year) continues through 2030.</p>

  <h3>Community Resources</h3>
  <ul>
    <li><strong>Strong Schools for Redwood City</strong> (pro-measure campaign): <a href="https://www.strongschools4rwc.org/en/" target="_blank">strongschools4rwc.org</a></li>
    <li><strong>Official election results</strong>: ${docLink(DOCS.measureCResults, 'San Mateo County Elections, June 2, 2026 results')}</li>
  </ul>

  <p class="source">Source: ${docLink(DOCS.measureCResults, 'San Mateo County Assessor-Clerk-Recorder &amp; Elections, June 2, 2026 Official Results')}, certified ${DATES.measureCCertified.en}; ${docLink(DOCS.measureCSummary, 'Election Summary Report (final)')}: Yes ${fmt(MEASURE_C.yes)} (${MEASURE_C.yesPct}), No ${fmt(MEASURE_C.no)} (${MEASURE_C.noPct}). Earlier election-night coverage: <a href="https://www.rwcpulse.com/election/2026/06/03/redwood-city-school-parcel-tax-trails-approval-threshold/" target="_blank">Redwood City Pulse, June 3, 2026</a>.</p>
</section>`;
}

// ---- Section 5: Spending ----
function sectionSpendingEN() {
  return `
<section class="section" id="spending">
  <div class="section-rule"></div>
  <span class="section-num">05</span>
  <h2>Where the Money Goes</h2>

  <p>RCSD's ${mil(EXPENDITURE_TOTAL.adopted)} in budgeted ${BUDGET_SOURCE.fiscalYear} General Fund spending is dominated by personnel costs: salaries and benefits account for <strong>${personnelPct}</strong> of it. This is typical for school districts, where the primary "product" is instruction delivered by people.</p>

  <h3>Expenditure Breakdown</h3>
  ${compareTable('en', EXPENDITURE_ROWS, EXPENDITURE_TOTAL, 'Total Expenditures')}
  <p class="source">Sources: ${docLink(DOCS.adoptedBook, budgetName('en'))}, General Fund Expenditures (p. 12); ${docLink(DOCS.uaBook, actualsName('en'))}, General Fund Expenditures (p. 10). "Other Outgo &amp; Indirect Costs" nets indirect-cost credits against outgo, which is why it can be negative. Percentages are rounded.</p>

  <h3>Benefits: The Hidden Cost Driver</h3>
  <p>Employee benefits (${mil(EXPENDITURE_ROWS[2][3])} budgeted) are more than a quarter of all spending and include CalSTRS pension contributions (${ASSUMPTIONS[4][3]} employer rate), CalPERS pension contributions (${ASSUMPTIONS[5][3]} in ${BUDGET_SOURCE.fiscalYear}), health and welfare benefits, and other statutory benefits. The budget assumes CalSTRS stays at ${ASSUMPTIONS[4][3]} and CalPERS moves to ${ASSUMPTIONS[5][4]} in 2027-28 and ${ASSUMPTIONS[5][5]} in 2028-29.</p>

  <h3>Services &amp; Operating Expenses</h3>
  <p>The ${mil(EXPENDITURE_ROWS[4][3])} budgeted for services and operations (${mil(EXPENDITURE_ROWS[4][2])} actually spent in ${ACTUALS_SOURCE.fiscalYear}) includes contracted services, professional and operating expenses, and insurance. This category covers everything from special education service providers to utilities, transportation, legal fees, and technology contracts.</p>

  <div class="callout callout-amber">
    <p><strong>See it check by check.</strong> Those services &mdash; plus every other warrant the district writes &mdash; are itemized on the <a href="/vendors/">Vendor Spending</a> page: every check the board has ratified since 2020, searchable by vendor with year-by-year totals. (Accounts-payable only &mdash; it excludes payroll, the bulk of the budget above.)</p>
  </div>

  <h3>LCAP Spending Breakdown</h3>
  <p>The district's adopted ${LCAP_YEAR} Local Control and Accountability Plan (LCAP) plans <strong>${usd(LCAP.total)}</strong> of actions across three goals (${mil(LCAP.byFund.lcff)} LCFF, ${mil(LCAP.byFund.otherState, 2)} other state, ${mil(LCAP.byFund.federal, 2)} federal). These are not extra dollars on top of the General Fund: most of the total is core classroom staffing that also appears in the expenditure table above.</p>
  ${lcapTable('en')}
  <p class="source">Source: ${docLink(DOCS.lcap, `Adopted ${LCAP_YEAR} LCAP`)} (Board approval ${DATES.adopted.en}), Total Planned Expenditures Table (p. 95). Goal amounts are the sums of each goal's actions in the plan's Goals and Actions tables; together they equal the plan's ${usd(LCAP.total)} total.</p>
</section>`;
}

// ---- Section 6: Multi-Year Outlook ----
function sectionOutlookEN() {
  return `
<section class="section" id="outlook">
  <div class="section-rule"></div>
  <span class="section-num">06</span>
  <h2>Multi-Year Fiscal Outlook</h2>

  <p>The ${budgetName('en')} plans a small deficit of ${usd(-adoptedNet)} in ${BUDGET_SOURCE.fiscalYear}, paid from the fund balance, then surpluses in both projection years as revenue grows faster than spending. The reserve dips from ${MYP.reservePct[0]} to ${MYP.reservePct[1]}, then climbs to ${MYP.reservePct[2]} and ${MYP.reservePct[3]} &mdash; above the 3% legal minimum in every year. The budget book's executive summary says the deficit "is planned and will be supported by the available fund balance."</p>

  <h3>Three-Year Projection (as adopted)</h3>
  ${mypTable('en')}
  <p class="source">Source: ${docLink(DOCS.adoptedBook, budgetName('en'))}, Multi-Year Projections (p. 15); the same totals appear in the ${docLink(DOCS.hearingMyp, 'June 17 hearing projection')}. The first column is the June <em>estimate</em> of 2025-26 that the budget was built on. Revenues include transfers in ($11.0M in 2025-26, none after). The book's 2028-29 ending balance is $1 more than its beginning balance plus net change, a rounding difference in the book.</p>

  <div class="callout">
    <p><strong>Since adoption, 2025-26 closed better than planned.</strong> The ${actualsName('en')} put the June 30, 2026 balance at ${usd(ACTUALS.endingBalance)}, about $5.63 million above the ${usd(ACTUALS.estimatedActualsEnding)} this projection starts from. Carried forward from the actual balance, the same ${BUDGET_SOURCE.fiscalYear} plan would end the year at ${usd(adoptedEndFromActual)}. The district will fold the actuals into its First Interim projection in December. None of this depends on the June 2026 parcel tax (Measure C), which failed.</p>
  </div>

  <h3>Fiscal Stabilization Plan (February 2026)</h3>
  <p>On February 4, 2026, the board adopted a $6.04 million Fiscal Stabilization Plan ($6.11M ongoing) that eliminates 31.75 FTE positions. The 2025-26 Second Interim (${DATES.secondInterim.en}) was the first multi-year projection to build these reductions in. Key elements include:</p>
  <ul style="margin-bottom:1rem;max-width:640px">
    <li>About $3.5M from restructuring and reduced services at the district office</li>
    <li>About $2.9M from adjustments at school sites, the largest share (17 teaching positions, ~$2.3M) absorbed through enrollment-driven attrition</li>
    <li>Increased K-2 class sizes from 25:1 to 28:1</li>
    <li>Elimination of some counselor and mental-health positions; several school sites move to contracted mental-health services</li>
  </ul>
  <p class="source">Sources: <a href="https://www.rwcpulse.com/education/2026/02/05/redwood-city-school-districts-cuts-another-6m-from-budget/">Redwood City Pulse, Feb. 5, 2026</a>; Approved Fiscal Stabilization Plan (Feb. 4, 2026), Second Interim board packet.</p>

  <h3>Structural Deficit Drivers</h3>
  <div class="trend-item">
    <div class="trend-label trend-down">Declining Enrollment</div>
    <p>The adopted budget assumes enrollment keeps falling &mdash; from ${ASSUMPTIONS[0][2]} in 2025-26 to ${ASSUMPTIONS[0][3]} in 2026-27 and ${ASSUMPTIONS[0][5]} by 2028-29. Each lost student represents roughly $15,000-$16,000 in LCFF-equivalent funding. Fixed costs (facilities, administration, transportation) do not decline proportionally.</p>
  </div>
  <div class="trend-item">
    <div class="trend-label trend-down">Rising Personnel Costs</div>
    <p>Salary step-and-column increases (${ASSUMPTIONS[6][3]} a year), pension contribution rates that stay high (CalSTRS ${ASSUMPTIONS[4][3]}; CalPERS ${ASSUMPTIONS[5][3]} to ${ASSUMPTIONS[5][4]}), and health benefit inflation drive expenditures upward even as enrollment falls. Salaries and benefits are ${personnelPct} of the ${BUDGET_SOURCE.fiscalYear} budget.</p>
  </div>
  <div class="trend-item">
    <div class="trend-label trend-down">RDA Transfer Ends</div>
    <p>The ${mil(ACTUALS.transferIn)} RDA transfer that the General Fund received in ${ACTUALS_SOURCE.fiscalYear} is zero in ${BUDGET_SOURCE.fiscalYear} and both projection years. It was ${pct(ACTUALS.transferIn, REVENUE_TOTAL.actual)} of ${ACTUALS_SOURCE.fiscalYear} revenue and transfers, and it is the largest single reason ${BUDGET_SOURCE.fiscalYear} revenue is lower.</p>
  </div>
  <div class="trend-item">
    <div class="trend-label trend-down">One-Time Funds Expiring</div>
    <p>Federal pandemic-era funds (ESSER) and other one-time grants that supported positions and programs have been fully spent. Positions funded by these one-time sources must now be absorbed by the General Fund or eliminated.</p>
  </div>

  <h3>Key Budget Assumptions</h3>
  ${assumptionsTable('en')}
  <p class="source">Source: ${docLink(DOCS.adoptedBook, budgetName('en'))}, Budget Assumptions (p. 9).</p>
</section>`;
}


// ---- Section 7: School-Level Funding ----
function sectionSchoolsEN() {
  return `
<section class="section" id="schools">
  <div class="section-rule"></div>
  <span class="section-num">07</span>
  <h2>School-Level Funding (2025-26 SPSA Budgets)</h2>

  <p>Each school's Single Plan for Student Achievement (SPSA) budget captures <em>supplemental</em> site-level spending, including enrichment, counseling, professional development, and materials. These budgets do <strong>not</strong> include base operating costs like teacher salaries and facilities, which come from the General Fund. The 2026-27 school plans have not been adopted yet, so this table shows the 2025-26 plans.</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>School</th><th class="num">Total SPSA</th><th class="num">Per Pupil</th><th class="num">Title I</th><th class="num">District</th><th class="num">PTO/PTA</th><th class="num">Measure U</th><th class="num">Prop 28</th></tr>
      </thead>
      <tbody>
${SPSA_ROWS}
      </tbody>
    </table>
  </div>
  <p class="source">Source: 2025-26 School Plans for Student Achievement (SPSAs). Budget data extracted from SPSA Budget Summary pages.</p>

  <h3>Understanding the Funding Sources</h3>
  <p><strong>Title I:</strong> Federal grants for schools with high percentages of low-income students. Seven RCSD schools receive Title I funds. North Star, Roy Cloud, and Orion do not qualify.</p>
  <p><strong>District (ATSI/Categorical):</strong> Additional district funding targeted at schools identified for Additional Targeted Support and Improvement (ATSI). McKinley receives the largest allocation ($610K) as an ATSI-identified school.</p>
  <p><strong>PTO/PTA:</strong> Parent fundraising varies dramatically: North Star's PTA raises $326K (58% of its entire SPSA), while Garfield, Taft, Hoover, and Roosevelt report $0 in parent fundraising.</p>
  <p><strong>Measure U:</strong> Parcel tax funds distributed to schools for enrichment, music, art, and technology. Most schools receive between $48K and $192K.</p>
  <p><strong>Prop 28 (Arts):</strong> State Proposition 28 (2022) funds dedicated to arts and music education, distributed based on enrollment and demographics.</p>

  <div class="callout">
    <p><strong>The equity picture is complicated.</strong> High-need schools receive more public categorical funding (Title I, ATSI) but still cannot close achievement gaps. Low-need schools like North Star receive the lowest per-pupil <em>public</em> funding and depend heavily on parent fundraising for basics like counselors and enrichment. Neither end is adequately served by the current model.</p>
  </div>
</section>`;
}

// ---- Section 8: Documents ----
function sectionDocumentsEN() {
  return `
<section class="section" id="documents">
  <div class="section-rule"></div>
  <span class="section-num">08</span>
  <h2>Key Documents &amp; Links</h2>

  <h3>Budget Documents</h3>
  <ul style="margin-bottom:1.5rem">
    <li>${docLink(DOCS.adoptedBook, `${budgetName('en')} book`)} &mdash; adopted by the Board ${DATES.adopted.en} (${docLink(DOCS.minutes0624, 'minutes')})</li>
    <li>${docLink(DOCS.hearingMyp, `${BUDGET_SOURCE.fiscalYear} multi-year projection`)} &mdash; detailed version from the June 17, 2026 public hearing</li>
    <li>${docLink(DOCS.uaBook, `${actualsName('en')} book`)} and ${docLink(DOCS.uaPresentation, 'presentation')} &mdash; approved ${DATES.actualsApproved.en}</li>
    <li>${docLink(DOCS.gann, 'Resolution No. 10: 2025-26 Gann appropriations limit')}</li>
    <li><a href="${DOCS.districtBudget}">Adopted Budgets &amp; Interim Reports</a> (District website)</li>
    <li><a href="https://www.rcsdk8.net/our-programs-and-services/business-services/district-funding">District Funding Overview</a> &mdash; explains community-funded status</li>
    <li><a href="https://www.rcsdk8.net/our-programs-and-services/business-services/rcsd-as-a-community-funded-district">RCSD as a Community-Funded District</a></li>
  </ul>

  <h3>Bond &amp; Parcel Tax</h3>
  <ul style="margin-bottom:1.5rem">
    <li><a href="https://www.rcsdk8.net/our-programs-and-services/school-modernization-and-construction/phase-ii-measure-s">Measure S (2022 Bond) &mdash; Projects &amp; Updates</a></li>
    <li><a href="https://www.rcsdk8.net/our-programs-and-services/school-modernization-and-construction/phase-i-measure-t/measure-t-oversight-committee">Citizens' Bond Oversight Committee</a> (Measures T &amp; S)</li>
    <li><a href="https://www.rcsdk8.net/our-programs-and-services/business-services/measure-u-parcel-tax">Measure U Parcel Tax</a></li>
    <li><a href="https://www.rcsdk8.net/our-programs-and-services/business-services/measure-u-parcel-tax/measure-u-citizens-oversight-committee">Measure U Citizens' Oversight Committee</a></li>
    <li><a href="https://www.rcsdk8.net/our-programs-and-services/business-services/measure-u-parcel-tax/measure-u-exemptions">Measure U Exemptions (Seniors &amp; Disabled)</a></li>
  </ul>

  <h3>LCAP &amp; Accountability</h3>
  <ul style="margin-bottom:1.5rem">
    <li>${docLink(DOCS.lcap, `Adopted ${LCAP_YEAR} LCAP`)} &mdash; Local Control and Accountability Plan, approved ${DATES.adopted.en}</li>
    <li><a href="${caDashboardUrl(RCSD_DISTRICT_CDS)}">California School Dashboard &mdash; RCSD</a></li>
  </ul>

  <h3>Board Meetings</h3>
  <ul style="margin-bottom:1.5rem">
    <li><a href="https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030397">GAMUT Board Portal</a> &mdash; Agendas, minutes, and official documents</li>
    <li><a href="https://www.youtube.com/@RedwoodCitySchoolDistrict">RCSD YouTube Channel</a> &mdash; Board meeting recordings</li>
    <li><a href="/meetings/">RCSD.info Meeting Index</a> &mdash; Searchable meeting transcripts and timestamps</li>
  </ul>

  <h3>Elections &amp; External Coverage</h3>
  <ul style="margin-bottom:1.5rem">
    <li>${docLink(DOCS.measureCResults, 'San Mateo County Elections: June 2, 2026 official results')} &mdash; certified ${DATES.measureCCertified.en}</li>
    <li><a href="https://www.rwcpulse.com/election/2026/06/03/redwood-city-school-parcel-tax-trails-approval-threshold/" target="_blank">RWC Pulse: Measure C Trails Approval Threshold</a> (election-night, June 3, 2026)</li>
    <li><a href="https://www.rwcpulse.com/education/2026/02/27/redwood-city-school-district-puts-parcel-tax-measure-on-june-ballot/" target="_blank">RWC Pulse: Parcel Tax on June Ballot</a> (Feb. 2026)</li>
    <li><a href="https://www.rwcpulse.com/education/2026/02/05/redwood-city-school-districts-cuts-another-6m-from-budget/" target="_blank">RWC Pulse: District Cuts $6M from Budget</a> (Feb. 2026)</li>
  </ul>
</section>`;
}

// ---- Section 9: Glossary ----
function sectionGlossaryEN() {
  return `
<section class="section" id="glossary">
  <div class="section-rule"></div>
  <span class="section-num">09</span>
  <h2>Budget Glossary</h2>

  <div class="glossary">
    <div class="glossary-item">
      <div class="glossary-term">ADA (Average Daily Attendance)</div>
      <div class="glossary-def">The average number of students attending school each day, used as the basis for state funding calculations. RCSD's ADA rate was ${ACTUALS.ada} in 2025-26; the ${budgetName('en')} assumes ${ASSUMPTIONS[1][3]}.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">ATSI</div>
      <div class="glossary-def">Additional Targeted Support and Improvement. A state designation for schools with student subgroups performing in the lowest performance levels. McKinley MIT is ATSI-identified.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Basic Aid / Community-Funded</div>
      <div class="glossary-def">A district whose local property tax revenue exceeds the state LCFF entitlement. RCSD keeps all property tax revenue instead of receiving most funding from the state.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">CalPERS</div>
      <div class="glossary-def">California Public Employees' Retirement System. Provides pensions for classified (non-teaching) staff. Employer rate: ${ASSUMPTIONS[5][3]} of salary in ${BUDGET_SOURCE.fiscalYear}.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">CalSTRS</div>
      <div class="glossary-def">California State Teachers' Retirement System. Provides pensions for certificated (teaching) staff. Employer rate: ${ASSUMPTIONS[4][3]} of salary.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Deficit Spending</div>
      <div class="glossary-def">When expenditures exceed revenues in a given year. The gap is covered by drawing down the fund balance (reserves). The ${budgetName('en')} plans ${usd(-adoptedNet)} of deficit spending. In 2025-26, spending exceeded revenue by ${mil(-actualOperating, 2)}, but an ${mil(ACTUALS.transferIn)} transfer in meant the fund balance still grew.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Fund Balance</div>
      <div class="glossary-def">The district's accumulated savings, similar to a checking account balance. Includes restricted funds (earmarked for specific purposes) and unrestricted funds available for general use.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Gann Limit</div>
      <div class="glossary-def">A state constitutional cap (Proposition 4, 1979) on how much tax revenue a public agency may spend each year. RCSD's 2025-26 spending subject to the limit was exactly at its ${ACTUALS.gannLimit} limit.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">General Fund</div>
      <div class="glossary-def">The primary operating fund for the district (Fund 01). Covers salaries, benefits, instructional materials, and day-to-day operations. Separate from bond funds and other special funds.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">General Obligation (GO) Bond</div>
      <div class="glossary-def">A voter-approved bond backed by property taxes used exclusively for capital improvements (buildings, infrastructure). Requires 55% voter approval. Measures T and S are GO bonds.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">LCAP</div>
      <div class="glossary-def">Local Control and Accountability Plan. A required three-year plan describing how the district will use funds to improve outcomes, with specific goals, actions, and metrics.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">LCFF</div>
      <div class="glossary-def">Local Control Funding Formula. California's primary school funding system, providing base, supplemental, and concentration grants. For Basic Aid districts like RCSD, local taxes exceed the LCFF entitlement.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Parcel Tax</div>
      <div class="glossary-def">A flat or formula-based tax on each land parcel, used for General Fund operations (unlike bonds). Requires two-thirds voter approval. Measure U is RCSD's current parcel tax ($85/parcel/year); Measure C, a second parcel tax on the June 2026 ballot, failed with ${MEASURE_C.yesPct} Yes.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">RDA (Redevelopment Agency)</div>
      <div class="glossary-def">Former city agency whose dissolution led to negotiated payments to the district, held in Fund 25. The General Fund received an ${mil(ACTUALS.transferIn)} transfer from them in 2025-26; the ${budgetName('en')} includes none for 2026-27 through 2028-29.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Reserve Requirement (3%)</div>
      <div class="glossary-def">California law requires districts to maintain a Reserve for Economic Uncertainty of at least 3% of expenditures. RCSD's reserve was ${actualReservePct} at the close of 2025-26; the ${budgetName('en')} projects ${MYP.reservePct[1]} for ${BUDGET_SOURCE.fiscalYear}, rising to ${MYP.reservePct[3]} by 2028-29.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Restricted vs. Unrestricted</div>
      <div class="glossary-def">Restricted funds have legal constraints on their use (e.g., federal grants, bond proceeds). Unrestricted funds (mostly property taxes) can be used for any lawful educational purpose.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">S&amp;C Entitlement</div>
      <div class="glossary-def">Supplemental and Concentration amounts under LCFF, calculated based on a district's percentage of unduplicated pupils (low-income, EL, foster, homeless). For state-funded districts this is an additional state grant; for community-funded districts like RCSD it's an entitlement funded from local property tax that sets the LCAP minimum-proportionality spending floor. RCSD's ${LCAP_YEAR} S&amp;C entitlement is projected at ${mil(LCAP.scEntitlement, 2)} (adopted LCAP).</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">SPSA</div>
      <div class="glossary-def">Single Plan for Student Achievement. Each school's site-level plan and budget for supplemental programs, funded through Title I, district allocations, parent organizations, and other sources.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Title I</div>
      <div class="glossary-def">Federal program providing supplemental funding to schools with high percentages of low-income students. Seven of RCSD's 12 schools receive Title I funds.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Unaudited Actuals</div>
      <div class="glossary-def">The district's year-end report of what it actually took in and spent, filed each September before the independent audit. The ${actualsName('en')} closed the year that ended June 30, 2026.</div>
    </div>
  </div>
</section>`;
}


// ---- Spanish body content ----
function esBody() {
  return `
<header class="site-header">
  <div class="header-inner">
    <div class="header-district">Distrito Escolar de Redwood City</div>
    <h1 class="header-title">Presupuesto del Distrito en Detalle</h1>
    <p class="header-subtitle">Una guía completa sobre cómo RCSD recauda y gasta unos $150 millones al año, incluyendo bonos escolares, impuestos parcelarios y la perspectiva fiscal multianual.</p>
    <div class="header-meta">
      <div class="header-stat">
        <span class="header-stat-value">${mil(EXPENDITURE_TOTAL.adopted)}</span>
        <span class="header-stat-label">Gastos ${BUDGET_SOURCE.fiscalYear}</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">${usd(perPupilAdopted)}</span>
        <span class="header-stat-label">Gasto por Alumno</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">${ADOPTED_RESERVE_PCT}</span>
        <span class="header-stat-label">Reserva (Mín. 3%)</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">${mil(-adoptedNet)}</span>
        <span class="header-stat-label">Déficit Planeado ${BUDGET_SOURCE.fiscalYear}</span>
      </div>
    </div>
  </div>
</header>

<div class="disclaimer">
  Datos obtenidos del ${budgetName('es')} (adoptado el ${DATES.adopted.es}), el ${actualsName('es')} (aprobado el ${DATES.actualsApproved.es}), el LCAP ${LCAP_YEAR} adoptado, los SPSA 2025-26 y los resultados electorales certificados del Condado de San Mateo. Este es un recurso comunitario independiente, no una publicación oficial del distrito.
</div>

${sourceBanner('es')}

<nav class="toc" aria-label="Secciones de la página">
  <div class="toc-inner">
    <a href="#resumen">Resumen</a>
    <a href="#ingresos">Ingresos</a>
    <a href="#bonos">Bonos</a>
    <a href="#impuesto">Impuesto</a>
    <a href="#gastos">Gastos</a>
    <a href="#perspectiva">Perspectiva</a>
    <a href="#escuelas">Escuelas</a>
    <a href="#documentos">Documentos</a>
    <a href="#glosario">Glosario</a>
    <a href="/proveedores/" class="toc-ext">Gastos a Proveedores &rarr;</a>
  </div>
</nav>

<main class="content">

${sectionOverviewES()}
${sectionRevenueES()}
${sectionBondsES()}
${sectionParcelTaxES()}
${sectionSpendingES()}
${sectionOutlookES()}
${sectionSchoolsES()}
${sectionDocumentsES()}
${sectionGlossaryES()}

</main>`;
}

// ---- Spanish Section 1 ----
function sectionOverviewES() {
  return `
<section class="section" id="resumen">
  <div class="section-rule"></div>
  <span class="section-num">01</span>
  <h2>Resumen del Presupuesto</h2>

  <p>El Distrito Escolar de Redwood City (RCSD) tiene 12 escuelas de TK a 8.º grado. Su ${budgetName('es')}, que la Junta aprobó el ${DATES.adopted.es}, planea gastar <strong>${mil(EXPENDITURE_TOTAL.adopted)}</strong> del Fondo General con ${mil(REVENUE_TOTAL.adopted)} de ingresos, o sea un déficit planeado de unos ${mil(-adoptedNet)}. Cuenta con ${ADOPTED_ENROLLMENT.toLocaleString('en-US')} estudiantes, menos que los ${ACTUALS.enrollment.toLocaleString('en-US')} de 2025-26.</p>

  <h3>Estatus de Distrito Financiado por la Comunidad (Basic Aid)</h3>
  <p>RCSD es uno de aproximadamente 100 distritos "financiados por la comunidad" (anteriormente "Basic Aid") en California. Esto significa que los ingresos locales por impuestos a la propiedad <em>superan</em> lo que el estado proporcionaría a través de la Fórmula de Financiamiento de Control Local (LCFF). El distrito retiene todos sus ingresos por impuestos a la propiedad. En el cálculo estatal ${STATE_LCFF.period.es}, los ingresos locales de RCSD quedaron ${mil(STATE_LCFF.excess, 1)} arriba de su derecho LCFF de ${mil(STATE_LCFF.entitlement, 1)}, así que la fórmula no le debe ayuda estatal. Aun así, RCSD sí recibe dos pagos LCFF del estado: ${mil(STATE_LCFF.epa, 1)} de la Cuenta de Protección Educativa, que reciben todos los distritos, y una garantía de <em>ayuda estatal mínima</em> de ${mil(STATE_LCFF.minStateAid, 1)} (vea Ingresos abajo).</p>

  <div class="callout">
    <p><strong>¿Qué significa Basic Aid en la práctica?</strong> El financiamiento de RCSD sube y baja con los valores de las propiedades locales, no con las decisiones del presupuesto estatal. Cuando los valores de las propiedades crecen, también lo hacen los ingresos del distrito. Pero a diferencia de los distritos financiados por el estado, RCSD no recibe ajustes automáticos por costo de vida de Sacramento. RCSD tiene un derecho ("entitlement") de Suplementario y Concentración LCFF, que el LCAP adoptado calcula en ${mil(LCAP.scEntitlement, 2)} para ${LCAP_YEAR}, basado en su porcentaje de alumnos no duplicados (de bajos ingresos, estudiantes de inglés, en cuidado temporal o sin hogar; ${ASSUMPTIONS[2][3]} según los supuestos del presupuesto adoptado). En un distrito financiado por la comunidad este derecho se paga de los propios impuestos a la propiedad del distrito y no como un cheque aparte del estado. Su efecto principal es establecer el piso mínimo de gasto proporcional que el LCAP debe destinar a esos estudiantes.</p>
  </div>

  <h3>Presupuesto de un Vistazo</h3>
  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Fondo General</th><th class="num">${ACTUALS_SOURCE.fiscalYear}<br>real</th><th class="num">${BUDGET_SOURCE.fiscalYear}<br>adoptado</th></tr>
      </thead>
      <tbody>
        <tr><td>Ingresos</td><td class="num">${usd(ACTUALS.revenue)}</td><td class="num">${usd(REVENUE_TOTAL.adopted)}</td></tr>
        <tr><td>Transferencia (acuerdos negociados RDA)</td><td class="num">${usd(ACTUALS.transferIn)}</td><td class="num">$0</td></tr>
        <tr><td>Gastos</td><td class="num">${usd(ACTUALS.expenditures)}</td><td class="num">${usd(EXPENDITURE_TOTAL.adopted)}</td></tr>
        <tr><td>Cambio Neto en el Balance</td><td class="num" style="color:var(--green-mid)">${signed(actualNet)}</td><td class="num" style="color:var(--coral)">${usd(adoptedNet)}</td></tr>
        <tr><td>Balance Inicial del Fondo</td><td class="num">${usd(ACTUALS.beginningBalance)}</td><td class="num">${usd(MYP.beginning[1])}*</td></tr>
        <tr><td>Balance Final del Fondo</td><td class="num">${usd(ACTUALS.endingBalance)}</td><td class="num">${usd(MYP.ending[1])}*</td></tr>
        <tr><td>Reserva (mín. 3% + sin asignar)</td><td class="num">${usd(actualReserve)} (${actualReservePct})</td><td class="num">${usd(adoptedReserve)} (${ADOPTED_RESERVE_PCT})</td></tr>
        <tr><td>Gasto por Alumno&dagger;</td><td class="num">~${usd(perPupilActual)}</td><td class="num">~${usd(perPupilAdopted)}</td></tr>
        <tr><td>Inscripción del Distrito</td><td class="num">${ACTUALS.enrollment.toLocaleString('en-US')}</td><td class="num">${ADOPTED_ENROLLMENT.toLocaleString('en-US')} (proyectada)</td></tr>
        <tr><td>Asistencia Diaria Promedio</td><td class="num">${ACTUALS.ada}</td><td class="num">${ASSUMPTIONS[1][3]} (supuesto)</td></tr>
      </tbody>
    </table>
  </div>
  <p class="source">* El presupuesto se armó en junio con el cierre <em>estimado</em> de 2025-26 (${usd(ACTUALS.estimatedActualsEnding)}). El cierre real fue de ${usd(ACTUALS.endingBalance)}. Si se parte del balance real, el mismo plan ${BUDGET_SOURCE.fiscalYear} termina el año con ${usd(adoptedEndFromActual)}, como muestra el informe estatal presentado con el cierre no auditado. &dagger; Cálculo de rcsd.info: gastos del Fondo General &divide; inscripción.</p>
  <p class="source">Fuentes: ${docLink(DOCS.adoptedBook, budgetName('es'))}, adoptado el ${DATES.adopted.es} (págs. 9, 11, 12, 15); ${docLink(DOCS.uaBook, actualsName('es'))}, aprobado el ${DATES.actualsApproved.es} (págs. 7-10). Los ingresos de ${ACTUALS_SOURCE.fiscalYear} aparecen como en el resumen ejecutivo del cierre no auditado, sin la transferencia de ${mil(ACTUALS.transferIn)}, que tiene su propia línea.</p>

  <h3>Cómo Terminó de Verdad ${ACTUALS_SOURCE.fiscalYear}</h3>
  <p>El ${actualsName('es')} cierra las cuentas del año que terminó el 30 de junio de 2026. Los gastos superaron a los ingresos por ${usd(-actualOperating)}, pero una transferencia de ${mil(ACTUALS.transferIn)} de los fondos de acuerdos negociados RDA del distrito cubrió esa diferencia y más, así que el balance del Fondo General <strong>creció ${mil(actualNet, 2)}</strong>, de ${mil(ACTUALS.beginningBalance, 2)} a ${mil(ACTUALS.endingBalance, 2)}. Eso es unos $5.63 millones mejor que lo estimado en junio, sobre todo porque se gastaron $9.54 millones menos de lo proyectado (más que nada en servicios y gastos operativos, libros y materiales, y beneficios). La reserva cerró en ${actualReservePct} de los gastos (el libro lo redondea a 4.0%), arriba del mínimo estatal del 3%.</p>
  ${componentsTable('es')}
  <p>El distrito también certificó que su gasto 2025-26 sujeto al límite de asignaciones Gann (Proposición 4) quedó justo en ese límite, ${ACTUALS.gannLimit} (${docLink(DOCS.gann, 'Resolución No. 10')}, adoptada el ${DATES.actualsApproved.es}).</p>
  <p class="source">Fuente: ${docLink(DOCS.uaBook, actualsName('es'))} (resumen ejecutivo pág. 7; resumen del Fondo 01 pág. 8; componentes del balance final en el Formulario 01 de SACS), aprobado por la Junta el ${DATES.actualsApproved.es}. ${docLink(DOCS.uaPresentation, 'Presentación a la Junta')}.</p>

  <h3>Qué cubre esta página (y qué no)</h3>
  <p>Los números arriba describen el <strong>Fondo 01, el Fondo General</strong> &mdash; el fondo operativo principal de RCSD y la fuente de los salarios de maestros, programas de instrucción y operaciones diarias. El Fondo General es el lente correcto para "¿cuál es el presupuesto del distrito?" porque es por mucho el fondo más grande y el que guía la mayoría de las decisiones. Pero el distrito también tiene otros fondos con contabilidad separada que no aparecen en la cifra de ${mil(EXPENDITURE_TOTAL.adopted)} (balances al 30 de junio de 2026):</p>
  <ul>
    <li><strong>Fondo 12 &mdash; Centro de Desarrollo Infantil (CDC):</strong> el Programa Estatal de Preescolar (CSPP) y otras operaciones de la primera infancia, financiadas principalmente por subvenciones estatales para preescolar y cuotas de los padres. Balance ${mil(ACTUALS.otherFunds.f12, 2)}.</li>
    <li><strong>Fondo 13 &mdash; Cafetería / Servicios de Nutrición Infantil (CNS):</strong> el programa de comidas escolares, financiado por reembolsos de comidas federales y estatales más ventas de comidas. Balance ${mil(ACTUALS.otherFunds.f13, 2)}.</li>
    <li><strong>Fondo 21 &mdash; Fondo de Construcción:</strong> dinero de bonos de obligación general aprobados por los votantes (Medidas S y T), restringido a mejoras de capital. Cubierto por separado en la sección <a href="#bonos">Bonos y Construcción</a>.</li>
    <li><strong>Fondos 25, 35 y 40 &mdash; fondos de capital:</strong> Instalaciones de Capital (${mil(ACTUALS.otherFunds.f25, 2)}), Instalaciones Escolares del Condado (${mil(ACTUALS.otherFunds.f35, 2)}) y Reserva Especial para Proyectos de Capital (${mil(ACTUALS.otherFunds.f40, 2)}).</li>
  </ul>
  <p>Existen otros fondos más pequeños (servicio de la deuda, mantenimiento diferido, etc.) pero no pesan mucho en las operaciones del distrito. A menos que se indique lo contrario, el resto de esta página describe el Fondo 01.</p>
  <p class="source">Balances de otros fondos: ${docLink(DOCS.uaBook, actualsName('es'))}, Resumen de Otros Fondos (pág. 13).</p>
</section>`;
}

// ---- Spanish Section 2 ----
function sectionRevenueES() {
  return `
<section class="section" id="ingresos">
  <div class="section-rule"></div>
  <span class="section-num">02</span>
  <h2>De Dónde Viene el Dinero</h2>

  <p>El ${budgetName('es')} espera <strong>${mil(REVENUE_TOTAL.adopted)}</strong> de ingresos del Fondo General, que vienen de impuestos locales a la propiedad, fondos estatales y federales, y fuentes locales. Como RCSD es un distrito financiado por la comunidad, los impuestos locales a la propiedad son la fuente más grande. La columna ${ACTUALS_SOURCE.fiscalYear} muestra lo que de verdad entró el año pasado.</p>

  ${compareTable('es', REVENUE_ROWS, REVENUE_TOTAL, 'Total de Ingresos y Transferencias')}
  <p class="source">Fuentes: ${docLink(DOCS.adoptedBook, budgetName('es'))}, Fuentes de Ingresos del Fondo General (pág. 11); ${docLink(DOCS.uaBook, actualsName('es'))}, Fuentes de Ingresos del Fondo General (pág. 9). Las dos tablas de los libros usan estas categorías; el total de ${ACTUALS_SOURCE.fiscalYear} incluye la transferencia de ${mil(ACTUALS.transferIn)}, por eso es ${mil(ACTUALS.transferIn)} más alto que los ${usd(ACTUALS.revenue)} del resumen ejecutivo del cierre no auditado. Los porcentajes están redondeados. Las líneas de ${ACTUALS_SOURCE.fiscalYear} suman $${ACTUAL_REVENUE_ROUNDING} más que el total impreso en el libro, por redondeo en el propio libro. <strong>Nota sobre la ayuda estatal mínima:</strong> los libros llaman a esta línea "LCFF State Aid". La ${docLink(DOCS.cdeExhibit, 'hoja de distribución de fondos del estado')} (${STATE_LCFF.period.es}, School District LCFF Calculation) muestra qué es: no es ayuda de la fórmula, que para RCSD es $0, sino la <em>ayuda estatal mínima</em> ("Categorical Minimum State Aid", ${usd(STATE_LCFF.minStateAid)}, línea J-9). Cuando LCFF reemplazó el sistema anterior en 2013, la ley (Código de Educación 42238.03(e)) le garantizó a cada distrito por lo menos la ayuda estatal que ya recibía; para un distrito financiado por la comunidad, eso es el dinero estatal que recibía en 2012-13 para programas especiales. Es una cifra distinta al derecho Suplementario y de Concentración que se describe abajo.</p>

  <h3>Impuestos a la Propiedad &mdash; La Base</h3>
  <p>Los impuestos locales a la propiedad (impuestos LCFF más los de Educación Especial) están presupuestados en ${mil(propTaxAdopted)}, o el ${pct(propTaxAdopted, REVENUE_TOTAL.adopted)} de los ingresos del Fondo General en ${BUDGET_SOURCE.fiscalYear}. El Condado de San Mateo cobra los impuestos y le pasa al distrito su parte. La línea de impuestos LCFF aparece después de restar los impuestos "in-lieu" que el distrito le pasa a las escuelas charter. El distrito supone un crecimiento de ${ASSUMPTIONS[7][3]} al año en el impuesto a la propiedad.</p>

  <h3>Derecho ("Entitlement") Suplementario y de Concentración LCFF</h3>
  <p>El LCAP ${LCAP_YEAR} adoptado calcula el monto Suplementario y de Concentración LCFF de RCSD en <strong>${usd(LCAP.scEntitlement)}</strong>. Es el <em>monto del derecho</em> ("entitlement") que calcula la fórmula LCFF según el porcentaje de estudiantes de RCSD que son alumnos no duplicados (de bajos ingresos, estudiantes de inglés, jóvenes en cuidado temporal o sin hogar). Para los distritos financiados por el estado, esto llegaría como dinero estatal aparte; para un distrito financiado por la comunidad como RCSD, el derecho se paga con los propios impuestos a la propiedad del distrito. El monto sigue teniendo consecuencias reales: establece el piso mínimo de gasto proporcional del LCAP, o sea que el distrito debe demostrar que al menos esta cantidad se usa para aumentar o mejorar los servicios para los alumnos no duplicados. Para ${LCAP_YEAR}, el LCAP fija ese porcentaje requerido en ${LCAP.scPercent}.</p>
  <p class="source">Fuente: ${docLink(DOCS.lcap, `LCAP ${LCAP_YEAR} adoptado`)}, Servicios Aumentados o Mejorados (pág. 74) y Tabla de Gastos Planeados (pág. 95).</p>

  <h3>Fondos Federales</h3>
  <p>Los ingresos federales (${mil(REVENUE_ROWS[4][3])}, ${pct(REVENUE_ROWS[4][3], REVENUE_TOTAL.adopted)} del presupuesto ${BUDGET_SOURCE.fiscalYear}) incluyen subsidios Título I para escuelas de alta pobreza, Título III para programas de Estudiantes de Inglés e IDEA para educación especial.</p>

  <h3>Transferencias RDA</h3>
  <p>En ${ACTUALS_SOURCE.fiscalYear} el Fondo General recibió una <strong>transferencia de ${mil(ACTUALS.transferIn)}</strong> del Fondo 25, donde el distrito guarda el dinero de sus acuerdos negociados con la antigua agencia de redesarrollo (RDA). Fue el ${pct(ACTUALS.transferIn, REVENUE_TOTAL.actual)} de los ingresos y transferencias del año. El ${budgetName('es')} y sus dos años de proyección <strong>no incluyen ninguna transferencia así</strong>, y esa es la razón más grande por la que los ingresos de ${BUDGET_SOURCE.fiscalYear} son más bajos que los de ${ACTUALS_SOURCE.fiscalYear}.</p>

  <div class="callout callout-coral">
    <p><strong>¿Qué son los fondos restringidos vs. no restringidos?</strong> Los fondos "restringidos" tienen restricciones legales sobre su uso (por ejemplo, el dinero federal de Título I debe servir a estudiantes de bajos ingresos). Los fondos "no restringidos" (principalmente impuestos a la propiedad) pueden usarse para cualquier propósito legal. De los ${mil(ACTUALS.endingBalance, 2)} del balance del Fondo General al 30 de junio de 2026, ${mil(ACTUALS.components[1][2], 2)} están restringidos.</p>
  </div>
</section>`;
}

// ---- Spanish Section 3 ----
function sectionBondsES() {
  return `
<section class="section" id="bonos">
  <div class="section-rule"></div>
  <span class="section-num">03</span>
  <h2>Bonos Escolares &mdash; Medidas T y S</h2>

  <p>Los votantes de RCSD han aprobado dos medidas de bonos de obligación general (GO) por un total de <strong>$491 millones</strong> para modernizar las instalaciones escolares. Los fondos de bonos están legalmente restringidos a proyectos de capital y <em>no pueden</em> usarse para salarios, pensiones o gastos operativos.</p>

  <h3>Cómo Funcionan los Bonos Escolares</h3>
  <p>Un bono de obligación general es esencialmente un préstamo de inversionistas que el distrito paga con el tiempo usando ingresos de impuestos a la propiedad. Los votantes deben aprobar los bonos con una supermayoría del 55%.</p>

  <div class="callout">
    <p><strong>El dinero de bonos PUEDE pagar:</strong> Construcción nueva, renovaciones, sistemas HVAC, mejoras eléctricas, mejoras de seguridad, infraestructura tecnológica.</p>
    <p><strong>El dinero de bonos NO PUEDE pagar:</strong> Salarios de maestros o administradores, pensiones, beneficios, libros de texto, desarrollo profesional o gastos operativos continuos.</p>
  </div>

  <h3>Medida T (Fase I) &mdash; Aprobada en Noviembre 2015</h3>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Detalle</th><th>Medida T</th></tr></thead>
      <tbody>
        <tr><td>Monto</td><td class="num">$193 millones</td></tr>
        <tr><td>Aprobación de Votantes</td><td class="num">63.5% Sí</td></tr>
        <tr><td>Tasa de Impuesto</td><td class="num">$30 por $100K de valor tasado</td></tr>
        <tr><td>Período Máx. de Pago</td><td class="num">40 años</td></tr>
      </tbody>
    </table>
  </div>
  <p>La Medida T financió la Fase I del Plan Maestro de Instalaciones del distrito. Los proyectos completados incluyen modernizaciones en Hoover, Taft, Clifford, Roosevelt, Garfield y Adelante Selby.</p>

  <h3>Medida S (Fase II) &mdash; Aprobada en Noviembre 2022</h3>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Detalle</th><th>Medida S</th></tr></thead>
      <tbody>
        <tr><td>Monto</td><td class="num">$298 millones</td></tr>
        <tr><td>Aprobación de Votantes</td><td class="num">60.4% Sí</td></tr>
        <tr><td>Tasa de Impuesto</td><td class="num">$24 por $100K de valor tasado</td></tr>
        <tr><td>Ingresos Anuales (est.)</td><td class="num">~$16 millones/año</td></tr>
      </tbody>
    </table>
  </div>
  <p>La Medida S continúa el trabajo de modernización que inició la Medida T. Los proyectos activos incluyen trabajo en McKinley MIT, Henry Ford, Orion y Garfield.</p>

  <h3>Estado del Fondo de Construcción (Fondo 21)</h3>
  <p>Al 30 de junio de 2026, el Fondo de Construcción/Bonos tenía <strong>${mil(ACTUALS.otherFunds.f21, 2)}</strong> (${actualsName('es')}), menos que los $46.8 millones proyectados en el Segundo Informe Interino 2025-26 (marzo de 2026), porque siguió la construcción y modernización pagada con las Medidas T y S. El ${budgetName('es')} proyecta que el fondo baje a ${mil(FUND21_ADOPTED_END, 2)} para el 30 de junio de 2027 conforme avanzan los proyectos.</p>
  <p class="source">Fuentes: ${docLink(DOCS.uaBook, actualsName('es'))}, Resumen de Otros Fondos (pág. 13); ${docLink(DOCS.adoptedBook, budgetName('es'))}, Resumen de Otros Fondos (pág. 16).</p>

  <h3>Comité de Supervisión Ciudadana de Bonos</h3>
  <p>La ley de California requiere un Comité de Supervisión Ciudadana de Bonos (CBOC) independiente para revisar los gastos de bonos y publicar informes anuales. El CBOC de RCSD tiene nueve miembros y se reúne trimestralmente. Las agendas y actas de reuniones están disponibles en el <a href="https://www.rcsdk8.net/our-programs-and-services/school-modernization-and-construction/phase-i-measure-t/measure-t-oversight-committee">sitio web del distrito</a>.</p>
</section>`;
}

// ---- Spanish Section 4 ----
function sectionParcelTaxES() {
  return `
<section class="section" id="impuesto">
  <div class="section-rule"></div>
  <span class="section-num">04</span>
  <h2>Impuesto Parcelario &mdash; Medida U y Medida C (2026)</h2>

  <h3>Cómo Funcionan los Impuestos Parcelarios</h3>
  <p>Un impuesto parcelario es un impuesto fijo o basado en fórmula que se cobra por cada parcela de tierra dentro de un distrito. A diferencia de los bonos, los ingresos del impuesto parcelario van al Fondo General y pueden usarse para operaciones como salarios de maestros y programas. Los impuestos parcelarios requieren una supermayoría de dos tercios para ser aprobados.</p>

  <h3>Medida U Actual (2016)</h3>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Detalle</th><th>Medida U</th></tr></thead>
      <tbody>
        <tr><td>Monto</td><td class="num">$85 por parcela por año</td></tr>
        <tr><td>Ingresos, real ${ACTUALS_SOURCE.fiscalYear}</td><td class="num">${usd(REVENUE_ROWS[8][2])}</td></tr>
        <tr><td>Ingresos, presupuesto ${BUDGET_SOURCE.fiscalYear}</td><td class="num">${usd(REVENUE_ROWS[8][3])}</td></tr>
        <tr><td>Aprobación de Votantes</td><td class="num">79.8% Sí</td></tr>
        <tr><td>Duración</td><td>14 años (julio 2017 &ndash; junio 2030)</td></tr>
      </tbody>
    </table>
  </div>
  <p>Los fondos de la Medida U mejoran la instrucción en matemáticas, ciencias, lectura y escritura; atraen y retienen maestros calificados; apoyan programas de artes y música; y actualizan la tecnología en las aulas.</p>
  <p><strong>Exenciones:</strong> Personas mayores de 65 años e individuos que reciben apoyo federal por discapacidad pueden solicitar la exención.</p>

  <h3>Medida C &mdash; Impuesto Parcelario de Junio 2026 (No Pasó)</h3>

  <div class="callout callout-amber">
    <p><strong>La Medida C no pasó.</strong> En los resultados oficiales del Condado de San Mateo, certificados el ${DATES.measureCCertified.es}, la Medida C sacó <strong>${MEASURE_C.yesPct} de votos a favor</strong> (${fmt(MEASURE_C.yes)} a favor y ${fmt(MEASURE_C.no)} en contra). Un impuesto parcelario necesita una <strong>supermayoría de dos tercios (66.67%)</strong>: de los ${fmt(mcTotal)} votos sobre la medida, eso habrían sido ${fmt(mcNeeded)} votos a favor. La Junta de RCSD había puesto la medida en la boleta en una reunión especial el 26 de febrero de 2026; habría sido <em>adicional</em> a la Medida U, que sigue vigente hasta 2030.</p>
  </div>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Detalle</th><th>Medida C (2026)</th></tr></thead>
      <tbody>
        <tr><td>Tasa de Impuesto</td><td>17.5 centavos por pie cuadrado de edificio</td></tr>
        <tr><td>Parcelas Vacías</td><td class="num">$25/año tarifa fija</td></tr>
        <tr><td>Ingresos Esperados</td><td class="num">$12.2 millones/año</td></tr>
        <tr><td>Duración</td><td>8 años (julio 2026 &ndash; junio 2034)</td></tr>
        <tr><td>Voto Requerido</td><td>Dos tercios (66.67%)</td></tr>
        <tr><td>Fecha de Elección</td><td>2 de junio de 2026</td></tr>
        <tr><td>Resultado Certificado</td><td style="color:var(--coral)">No pasó: ${MEASURE_C.yesPct} a favor (${fmt(MEASURE_C.yes)}&ndash;${fmt(MEASURE_C.no)}), 1.36 puntos bajo dos tercios</td></tr>
      </tbody>
    </table>
  </div>

  <p>La Medida C habría recaudado aproximadamente <strong>$12.2 millones al año</strong> durante ocho años &mdash; unos $175 al año para una casa de 1,000 pies cuadrados, con exenciones para personas mayores y personas que reciben apoyo federal por discapacidad. El distrito había destinado ese dinero a atraer y retener maestros, consejeros y personal; proteger la instrucción en ciencias, matemáticas y STEM; preservar los programas de lectura y escritura; y mantener tamaños de clase manejables.</p>

  <h3>Qué Significa el Resultado para el Presupuesto</h3>
  <p>El dinero de la Medida C nunca estuvo en el presupuesto del distrito. El ${budgetName('es')} tiene la Medida U (${usd(REVENUE_ROWS[8][3])}) como su único impuesto parcelario y aun así mantiene las reservas arriba del mínimo legal del 3% en los tres años de su proyección (ver <a href="#perspectiva">Perspectiva Fiscal Multianual</a>). O sea, el resultado no provoca nuevos recortes por sí solo. Lo que sí significa es que los aproximadamente $12.2M al año que habría aportado la Medida C son dinero que el distrito <em>no</em> tendrá para restaurar programas y personal recortados en el Plan de Estabilización Fiscal de febrero de 2026, ni para reemplazar la transferencia RDA de ${mil(ACTUALS.transferIn)} que se acaba después de ${ACTUALS_SOURCE.fiscalYear}. La Medida U ($1.6M/año) sigue hasta 2030.</p>

  <h3>Recursos de la Comunidad</h3>
  <ul>
    <li><strong>Strong Schools for Redwood City</strong> (campaña a favor): <a href="https://www.strongschools4rwc.org/es/" target="_blank">strongschools4rwc.org</a></li>
    <li><strong>Resultados electorales oficiales</strong>: ${docLink(DOCS.measureCResults, 'Elecciones del Condado de San Mateo, resultados del 2 de junio de 2026')}</li>
  </ul>

  <p class="source">Fuente: ${docLink(DOCS.measureCResults, 'Registro y Elecciones del Condado de San Mateo, resultados oficiales del 2 de junio de 2026')}, certificados el ${DATES.measureCCertified.es}; ${docLink(DOCS.measureCSummary, 'Informe Resumen de la Elección (final)')}: a favor ${fmt(MEASURE_C.yes)} (${MEASURE_C.yesPct}), en contra ${fmt(MEASURE_C.no)} (${MEASURE_C.noPct}). Cobertura de la noche electoral: <a href="https://www.rwcpulse.com/election/2026/06/03/redwood-city-school-parcel-tax-trails-approval-threshold/" target="_blank">Redwood City Pulse, 3 de junio de 2026</a>.</p>
</section>`;
}

// ---- Spanish Section 5 ----
function sectionSpendingES() {
  return `
<section class="section" id="gastos">
  <div class="section-rule"></div>
  <span class="section-num">05</span>
  <h2>En Qué se Gasta el Dinero</h2>

  <p>Los ${mil(EXPENDITURE_TOTAL.adopted)} de gastos del Fondo General presupuestados para ${BUDGET_SOURCE.fiscalYear} están dominados por costos de personal: los salarios y beneficios son el <strong>${personnelPct}</strong> del total.</p>

  ${compareTable('es', EXPENDITURE_ROWS, EXPENDITURE_TOTAL, 'Gastos Totales')}
  <p class="source">Fuentes: ${docLink(DOCS.adoptedBook, budgetName('es'))}, Gastos del Fondo General (pág. 12); ${docLink(DOCS.uaBook, actualsName('es'))}, Gastos del Fondo General (pág. 10). "Otros Pagos y Costos Indirectos" resta créditos por costos indirectos, por eso puede salir negativo. Los porcentajes están redondeados.</p>

  <h3>Beneficios: El Costo Oculto</h3>
  <p>Los beneficios de empleados (${mil(EXPENDITURE_ROWS[2][3])} presupuestados) son más de una cuarta parte de todos los gastos e incluyen contribuciones de pensión CalSTRS (tasa patronal del ${ASSUMPTIONS[4][3]}), CalPERS (${ASSUMPTIONS[5][3]} en ${BUDGET_SOURCE.fiscalYear}), beneficios de salud y otros beneficios obligatorios. El presupuesto supone que CalSTRS se queda en ${ASSUMPTIONS[4][3]} y que CalPERS pasa a ${ASSUMPTIONS[5][4]} en 2027-28 y ${ASSUMPTIONS[5][5]} en 2028-29.</p>

  <div class="callout callout-amber">
    <p><strong>Véalo cheque por cheque.</strong> Los ${mil(EXPENDITURE_ROWS[4][3])} presupuestados en servicios &mdash; y cada otro cheque que emite el distrito &mdash; están detallados en la página de <a href="/proveedores/">Gastos a Proveedores</a>: cada cheque que la junta ha aprobado desde 2020, con búsqueda por proveedor y totales por año. (Solo cuentas por pagar &mdash; excluye la nómina, la mayor parte del presupuesto de arriba.)</p>
  </div>

  <h3>Desglose de Gastos LCAP</h3>
  <p>El LCAP ${LCAP_YEAR} adoptado del distrito planea <strong>${usd(LCAP.total)}</strong> en acciones para tres metas (${mil(LCAP.byFund.lcff)} de LCFF, ${mil(LCAP.byFund.otherState, 2)} de otros fondos estatales, ${mil(LCAP.byFund.federal, 2)} federales). No es dinero extra encima del Fondo General: la mayor parte es el personal básico de los salones, que también aparece en la tabla de gastos de arriba.</p>
  ${lcapTable('es')}
  <p class="source">Fuente: ${docLink(DOCS.lcap, `LCAP ${LCAP_YEAR} adoptado`)} (aprobado por la Junta el ${DATES.adopted.es}), Tabla de Gastos Planeados (pág. 95). El monto de cada meta es la suma de sus acciones en las tablas de Metas y Acciones del plan; juntas dan el total de ${usd(LCAP.total)}.</p>
</section>`;
}

// ---- Spanish Section 6 ----
function sectionOutlookES() {
  return `
<section class="section" id="perspectiva">
  <div class="section-rule"></div>
  <span class="section-num">06</span>
  <h2>Perspectiva Fiscal Multianual</h2>

  <p>El ${budgetName('es')} planea un déficit pequeño de ${usd(-adoptedNet)} en ${BUDGET_SOURCE.fiscalYear}, pagado con el balance del fondo, y luego superávits en los dos años de proyección porque los ingresos crecen más rápido que los gastos. La reserva baja de ${MYP.reservePct[0]} a ${MYP.reservePct[1]} y luego sube a ${MYP.reservePct[2]} y ${MYP.reservePct[3]} &mdash; arriba del mínimo legal del 3% todos los años. El resumen ejecutivo del libro dice que el déficit es planeado y que se cubrirá con el balance disponible del fondo.</p>

  <h3>Proyección a Tres Años (como se adoptó)</h3>
  ${mypTable('es')}
  <p class="source">Fuente: ${docLink(DOCS.adoptedBook, budgetName('es'))}, Proyecciones Multianuales (pág. 15); los mismos totales aparecen en la ${docLink(DOCS.hearingMyp, 'proyección de la audiencia del 17 de junio')}. La primera columna es el <em>estimado</em> de 2025-26 que se usó en junio para armar el presupuesto. Los ingresos incluyen transferencias ($11.0M en 2025-26, ninguna después). El balance final 2028-29 del libro es $1 más que su balance inicial más el cambio neto, por redondeo en el propio libro.</p>

  <div class="callout">
    <p><strong>Desde la adopción, 2025-26 cerró mejor de lo planeado.</strong> El ${actualsName('es')} dejó el balance al 30 de junio de 2026 en ${usd(ACTUALS.endingBalance)}, unos $5.63 millones arriba de los ${usd(ACTUALS.estimatedActualsEnding)} de los que parte esta proyección. Si se parte del balance real, el mismo plan ${BUDGET_SOURCE.fiscalYear} terminaría el año con ${usd(adoptedEndFromActual)}. El distrito incluirá el cierre real en la proyección de su Primer Informe Interino en diciembre. Nada de esto depende del impuesto parcelario de junio 2026 (Medida C), que no pasó.</p>
  </div>

  <h3>Plan de Estabilización Fiscal (febrero de 2026)</h3>
  <p>El 4 de febrero de 2026, la Junta adoptó un Plan de Estabilización Fiscal de $6.04 millones ($6.11M continuos) que elimina 31.75 posiciones FTE. El Segundo Informe Interino 2025-26 (${DATES.secondInterim.es}) fue la primera proyección multianual que incluyó estos recortes. Incluye cerca de $3.5M por reestructuración y reducción de servicios en la oficina del distrito, y cerca de $2.9M por ajustes en las escuelas (la mayor parte, 17 puestos docentes de ~$2.3M, absorbida por la baja natural de inscripción).</p>
  <p class="source">Fuentes: <a href="https://www.rwcpulse.com/education/2026/02/05/redwood-city-school-districts-cuts-another-6m-from-budget/">Redwood City Pulse, 5 de febrero de 2026</a>; Plan de Estabilización Fiscal aprobado (4 de febrero de 2026), paquete del Segundo Informe Interino.</p>

  <h3>Factores del Déficit Estructural</h3>
  <div class="trend-item">
    <div class="trend-label trend-down">Inscripción en Descenso</div>
    <p>El presupuesto adoptado supone que la inscripción sigue bajando &mdash; de ${ASSUMPTIONS[0][2]} en 2025-26 a ${ASSUMPTIONS[0][3]} en 2026-27 y ${ASSUMPTIONS[0][5]} para 2028-29. Cada estudiante perdido representa ~$15,000-$16,000 en financiamiento equivalente a LCFF. Los costos fijos (instalaciones, administración, transporte) no bajan en la misma proporción.</p>
  </div>
  <div class="trend-item">
    <div class="trend-label trend-down">Costos de Personal en Aumento</div>
    <p>Los aumentos salariales escalonados (${ASSUMPTIONS[6][3]} al año), tasas de pensión que siguen altas (CalSTRS ${ASSUMPTIONS[4][3]}; CalPERS ${ASSUMPTIONS[5][3]} a ${ASSUMPTIONS[5][4]}) y el aumento en el costo de los seguros médicos empujan los gastos hacia arriba aunque baje la inscripción. Los salarios y beneficios son el ${personnelPct} del presupuesto ${BUDGET_SOURCE.fiscalYear}.</p>
  </div>
  <div class="trend-item">
    <div class="trend-label trend-down">Se Acaba la Transferencia RDA</div>
    <p>La transferencia RDA de ${mil(ACTUALS.transferIn)} que recibió el Fondo General en ${ACTUALS_SOURCE.fiscalYear} es cero en ${BUDGET_SOURCE.fiscalYear} y en los dos años de proyección. Fue el ${pct(ACTUALS.transferIn, REVENUE_TOTAL.actual)} de los ingresos y transferencias de ${ACTUALS_SOURCE.fiscalYear}, y es la razón más grande por la que bajan los ingresos de ${BUDGET_SOURCE.fiscalYear}.</p>
  </div>
  <div class="trend-item">
    <div class="trend-label trend-down">Se Acaban los Fondos de Una Sola Vez</div>
    <p>Los fondos federales de la pandemia (ESSER) y otros subsidios de una sola vez que pagaban puestos y programas ya se gastaron. Esos puestos ahora los tiene que absorber el Fondo General o se eliminan.</p>
  </div>

  <h3>Supuestos Clave del Presupuesto</h3>
  ${assumptionsTable('es')}
  <p class="source">Fuente: ${docLink(DOCS.adoptedBook, budgetName('es'))}, Supuestos del Presupuesto (pág. 9).</p>
</section>`;
}

// ---- Spanish Section 7 ----
function sectionSchoolsES() {
  return `
<section class="section" id="escuelas">
  <div class="section-rule"></div>
  <span class="section-num">07</span>
  <h2>Financiamiento por Escuela (Presupuestos SPSA 2025-26)</h2>

  <p>El presupuesto SPSA de cada escuela captura el gasto <em>suplementario</em> a nivel de sitio. Estos presupuestos <strong>no</strong> incluyen costos operativos base como salarios de maestros e instalaciones. Los planes escolares 2026-27 todavía no se adoptan, así que esta tabla muestra los planes 2025-26.</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Escuela</th><th class="num">Total SPSA</th><th class="num">Por Alumno</th><th class="num">Título I</th><th class="num">Distrito</th><th class="num">PTO/PTA</th><th class="num">Med. U</th><th class="num">Prop 28</th></tr>
      </thead>
      <tbody>
${SPSA_ROWS}
      </tbody>
    </table>
  </div>
  <p class="source">Fuente: Planes Escolares para el Logro Estudiantil (SPSAs) 2025-26. Datos presupuestarios extraídos de las páginas de Resumen del Presupuesto del SPSA.</p>

  <h3>Entendiendo las Fuentes de Financiamiento</h3>
  <p><strong>Título I:</strong> Subsidios federales para escuelas con altos porcentajes de estudiantes de bajos ingresos. Siete escuelas de RCSD reciben fondos de Título I.</p>
  <p><strong>Distrito (ATSI/Categóricos):</strong> Financiamiento adicional del distrito dirigido a escuelas identificadas para Apoyo Adicional Dirigido y Mejora (ATSI). McKinley recibe la mayor asignación ($610K).</p>
  <p><strong>PTO/PTA:</strong> La recaudación de fondos de padres varía muchísimo: el PTA de North Star recauda $326K (58% de su SPSA), mientras que Garfield, Taft, Hoover y Roosevelt reportan $0.</p>
  <p><strong>Medida U:</strong> Fondos del impuesto parcelario distribuidos a las escuelas para enriquecimiento, música, arte y tecnología.</p>
  <p><strong>Prop 28 (Artes):</strong> Fondos estatales de la Proposición 28 (2022) dedicados a la educación artística y musical.</p>

  <div class="callout">
    <p><strong>La situación de equidad es complicada.</strong> Las escuelas de alta necesidad reciben más financiamiento público categórico (Título I, ATSI) pero aún no pueden cerrar las brechas de rendimiento. Las escuelas de menor necesidad como North Star reciben el menor financiamiento público por alumno y dependen fuertemente de la recaudación de padres.</p>
  </div>
</section>`;
}

// ---- Spanish Section 8 ----
function sectionDocumentsES() {
  return `
<section class="section" id="documentos">
  <div class="section-rule"></div>
  <span class="section-num">08</span>
  <h2>Documentos y Enlaces Clave</h2>

  <h3>Documentos del Presupuesto</h3>
  <ul style="margin-bottom:1.5rem">
    <li>${docLink(DOCS.adoptedBook, `Libro del ${budgetName('es')}`)} &mdash; adoptado por la Junta el ${DATES.adopted.es} (${docLink(DOCS.minutes0624, 'acta')})</li>
    <li>${docLink(DOCS.hearingMyp, `Proyección multianual ${BUDGET_SOURCE.fiscalYear}`)} &mdash; versión detallada de la audiencia pública del 17 de junio de 2026</li>
    <li>${docLink(DOCS.uaBook, `Libro del ${actualsName('es')}`)} y ${docLink(DOCS.uaPresentation, 'presentación')} &mdash; aprobado el ${DATES.actualsApproved.es}</li>
    <li>${docLink(DOCS.gann, 'Resolución No. 10: límite de asignaciones Gann 2025-26')}</li>
    <li><a href="${DOCS.districtBudget}">Presupuestos Adoptados e Informes Interinos</a> (sitio del distrito)</li>
    <li><a href="https://www.rcsdk8.net/our-programs-and-services/business-services/district-funding">Resumen de Financiamiento del Distrito</a></li>
  </ul>

  <h3>Bonos e Impuesto Parcelario</h3>
  <ul style="margin-bottom:1.5rem">
    <li><a href="https://www.rcsdk8.net/our-programs-and-services/school-modernization-and-construction/phase-ii-measure-s">Medida S (Bono 2022) &mdash; Proyectos y Actualizaciones</a></li>
    <li><a href="https://www.rcsdk8.net/our-programs-and-services/school-modernization-and-construction/phase-i-measure-t/measure-t-oversight-committee">Comité de Supervisión Ciudadana de Bonos</a></li>
    <li><a href="https://www.rcsdk8.net/our-programs-and-services/business-services/measure-u-parcel-tax">Impuesto Parcelario Medida U</a></li>
    <li><a href="https://www.rcsdk8.net/our-programs-and-services/business-services/measure-u-parcel-tax/measure-u-exemptions">Exenciones de la Medida U</a></li>
  </ul>

  <h3>LCAP y Rendición de Cuentas</h3>
  <ul style="margin-bottom:1.5rem">
    <li>${docLink(DOCS.lcap, `LCAP ${LCAP_YEAR} adoptado`)} &mdash; aprobado el ${DATES.adopted.es}</li>
    <li><a href="${caDashboardUrl(RCSD_DISTRICT_CDS)}">Panel de Control Escolar de California &mdash; RCSD</a></li>
  </ul>

  <h3>Reuniones de la Mesa Directiva</h3>
  <ul style="margin-bottom:1.5rem">
    <li><a href="https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030397">Portal GAMUT</a> &mdash; Agendas, actas y documentos oficiales</li>
    <li><a href="https://www.youtube.com/@RedwoodCitySchoolDistrict">Canal de YouTube de RCSD</a> &mdash; Grabaciones de reuniones</li>
    <li><a href="/reuniones/">Índice de Reuniones RCSD.info</a></li>
  </ul>

  <h3>Elecciones y Cobertura Externa</h3>
  <ul style="margin-bottom:1.5rem">
    <li>${docLink(DOCS.measureCResults, 'Elecciones del Condado de San Mateo: resultados oficiales del 2 de junio de 2026')} &mdash; certificados el ${DATES.measureCCertified.es}</li>
    <li><a href="https://www.rwcpulse.com/election/2026/06/03/redwood-city-school-parcel-tax-trails-approval-threshold/" target="_blank">RWC Pulse: la Medida C va abajo del umbral</a> (noche electoral, 3 de junio de 2026; en inglés)</li>
  </ul>
</section>`;
}

// ---- Spanish Section 9 ----
function sectionGlossaryES() {
  return `
<section class="section" id="glosario">
  <div class="section-rule"></div>
  <span class="section-num">09</span>
  <h2>Glosario del Presupuesto</h2>

  <div class="glossary">
    <div class="glossary-item">
      <div class="glossary-term">ADA (Asistencia Diaria Promedio)</div>
      <div class="glossary-def">El número promedio de estudiantes que asisten a la escuela cada día, que se usa como base para calcular el financiamiento estatal. La tasa ADA de RCSD fue ${ACTUALS.ada} en 2025-26; el ${budgetName('es')} supone ${ASSUMPTIONS[1][3]}.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">ATSI</div>
      <div class="glossary-def">Apoyo Adicional Dirigido y Mejora. Una designación estatal para escuelas con subgrupos de estudiantes en los niveles más bajos de rendimiento.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Basic Aid / Financiado por la Comunidad</div>
      <div class="glossary-def">Un distrito cuyos ingresos por impuestos locales a la propiedad superan el derecho estatal LCFF. RCSD retiene todos los ingresos por impuestos a la propiedad.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">CalPERS</div>
      <div class="glossary-def">Sistema de Jubilación de Empleados Públicos de California. Da pensiones al personal clasificado. Tasa del empleador: ${ASSUMPTIONS[5][3]} en ${BUDGET_SOURCE.fiscalYear}.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">CalSTRS</div>
      <div class="glossary-def">Sistema de Jubilación de Maestros del Estado de California. Da pensiones al personal certificado. Tasa del empleador: ${ASSUMPTIONS[4][3]}.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Cierre No Auditado (Unaudited Actuals)</div>
      <div class="glossary-def">El informe de fin de año del distrito con lo que de verdad entró y se gastó, que se presenta cada septiembre antes de la auditoría independiente. El ${actualsName('es')} cerró el año que terminó el 30 de junio de 2026.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Gasto Deficitario</div>
      <div class="glossary-def">Cuando los gastos superan los ingresos en un año. La diferencia se cubre con el balance del fondo. El ${budgetName('es')} planea ${usd(-adoptedNet)} de gasto deficitario. En 2025-26 los gastos superaron a los ingresos por ${mil(-actualOperating, 2)}, pero con la transferencia de ${mil(ACTUALS.transferIn)} el balance del fondo creció de todos modos.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Balance del Fondo</div>
      <div class="glossary-def">Los ahorros acumulados del distrito. Incluye fondos restringidos (designados para propósitos específicos) y fondos no restringidos disponibles para uso general.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Fondo General</div>
      <div class="glossary-def">El fondo operativo principal del distrito (Fondo 01). Cubre salarios, beneficios, materiales de instrucción y operaciones diarias.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Límite Gann</div>
      <div class="glossary-def">Un tope de la constitución estatal (Proposición 4, 1979) a cuánto dinero de impuestos puede gastar una agencia pública cada año. El gasto 2025-26 de RCSD sujeto al límite quedó justo en su límite de ${ACTUALS.gannLimit}.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Bono de Obligación General (GO)</div>
      <div class="glossary-def">Un bono aprobado por votantes respaldado por impuestos a la propiedad usado exclusivamente para mejoras de capital. Requiere aprobación del 55% de los votantes.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">LCAP</div>
      <div class="glossary-def">Plan de Control Local y Rendición de Cuentas. Un plan de tres años, obligatorio, que describe cómo el distrito usará los fondos para mejorar los resultados.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">LCFF</div>
      <div class="glossary-def">Fórmula de Financiamiento de Control Local. El sistema principal de financiamiento escolar de California.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Impuesto Parcelario</div>
      <div class="glossary-def">Un impuesto fijo o basado en fórmula por cada parcela de tierra, usado para operaciones del Fondo General. Requiere aprobación de dos tercios de los votantes. La Medida U es el impuesto parcelario actual; la Medida C, en la boleta de junio de 2026, no pasó (${MEASURE_C.yesPct} a favor).</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">RDA (Agencia de Redesarrollo)</div>
      <div class="glossary-def">Antigua agencia municipal cuya disolución dejó pagos negociados al distrito, guardados en el Fondo 25. El Fondo General recibió una transferencia de ${mil(ACTUALS.transferIn)} de ahí en 2025-26; el ${budgetName('es')} no incluye ninguna para 2026-27 a 2028-29.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Requisito de Reserva (3%)</div>
      <div class="glossary-def">La ley de California requiere que los distritos mantengan una Reserva para Incertidumbre Económica de al menos 3% de los gastos. La reserva de RCSD fue ${actualReservePct} al cierre de 2025-26; el ${budgetName('es')} proyecta ${MYP.reservePct[1]} para ${BUDGET_SOURCE.fiscalYear}, subiendo a ${MYP.reservePct[3]} para 2028-29.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Restringido vs. No Restringido</div>
      <div class="glossary-def">Los fondos restringidos tienen restricciones legales sobre su uso. Los fondos no restringidos pueden usarse para cualquier propósito educativo legal.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Derecho S&amp;C</div>
      <div class="glossary-def">Montos Suplementarios y de Concentración de LCFF, calculados según el porcentaje de alumnos no duplicados (de bajos ingresos, estudiantes de inglés, en cuidado temporal o sin hogar). En un distrito financiado por la comunidad como RCSD es un derecho ("entitlement") que se paga con los impuestos locales a la propiedad, no dinero estatal aparte, y fija el piso mínimo de gasto proporcional del LCAP. El LCAP ${LCAP_YEAR} adoptado lo calcula en ${mil(LCAP.scEntitlement, 2)}.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">SPSA</div>
      <div class="glossary-def">Plan Escolar para el Logro Estudiantil. El plan y presupuesto a nivel de sitio de cada escuela para programas suplementarios.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Título I</div>
      <div class="glossary-def">Programa federal que da financiamiento suplementario a escuelas con altos porcentajes de estudiantes de bajos ingresos. Siete escuelas de RCSD reciben fondos de Título I.</div>
    </div>
  </div>
</section>`;
}


// ---- Page configs ----
const PAGES = [
  {
    lang: 'en',
    bodyFn: enBody,
    outFile: 'docs/budget/index.html',
    title: `RCSD Budget Deep Dive ${BUDGET_SOURCE.fiscalYear} \u2014 Redwood City School District`,
    description: `Budget guide for the Redwood City School District: the ${BUDGET_SOURCE.fiscalYear} adopted budget, ${ACTUALS_SOURCE.fiscalYear} actual results, revenue sources, school bonds (Measures S & T), parcel taxes (Measure U; Measure C failed in June 2026), spending, and the multi-year outlook.`,
    canonical: 'https://rcsd.info/budget/',
    ogLocale: 'en_US',
    hreflang: [
      { lang: 'en', href: 'https://rcsd.info/budget/' },
      { lang: 'es', href: 'https://rcsd.info/presupuesto/' },
    ],
    altLangHref: '/presupuesto/',
  },
  {
    lang: 'es',
    bodyFn: esBody,
    outFile: 'docs/presupuesto/index.html',
    title: `Presupuesto del Distrito RCSD ${BUDGET_SOURCE.fiscalYear} \u2014 Distrito Escolar de Redwood City`,
    description: `Gu\u00eda del presupuesto del Distrito Escolar de Redwood City: el presupuesto adoptado ${BUDGET_SOURCE.fiscalYear}, el cierre real ${ACTUALS_SOURCE.fiscalYear}, fuentes de ingresos, bonos escolares, impuestos parcelarios (Medida U; la Medida C no pas\u00f3 en junio de 2026), gastos y perspectiva multianual.`,
    canonical: 'https://rcsd.info/presupuesto/',
    ogLocale: 'es_US',
    hreflang: [
      { lang: 'es', href: 'https://rcsd.info/presupuesto/' },
      { lang: 'en', href: 'https://rcsd.info/budget/' },
    ],
    altLangHref: '/budget/',
  },
];

for (const page of PAGES) {
  const bodyContent = page.bodyFn();

  const html = `<!DOCTYPE html>
<html lang="${page.lang}">
<head>
${headMeta({
  title: page.title,
  description: page.description,
  canonical: page.canonical,
  ogLocale: page.ogLocale,
  ogImageKey: `page-budget${page.lang === 'es' ? '-es' : ''}`,
  hreflang: page.hreflang,
  pageCSS: budgetCSS,
})}
</head>
<body>

${siteNav({ activePage: 'budget', lang: page.lang, altLangHref: page.altLangHref })}

${bodyContent}

${siteFooter({ lang: page.lang })}

<script>
(function () {
  var toc = document.querySelector('.toc');
  if (!toc || !('IntersectionObserver' in window)) return;
  var links = Array.prototype.slice.call(toc.querySelectorAll('a[href^="#"]'));
  var byId = {};
  var sections = [];
  links.forEach(function (a) {
    var id = a.getAttribute('href').slice(1);
    var sec = document.getElementById(id);
    if (sec) { byId[id] = a; sections.push(sec); }
  });
  if (!sections.length) return;

  var current = null;
  function setActive(id) {
    if (id === current) return;
    current = id;
    links.forEach(function (a) { a.classList.remove('active'); });
    var link = byId[id];
    if (!link) return;
    link.classList.add('active');
    var inner = link.parentNode;
    if (inner && inner.scrollWidth > inner.clientWidth) {
      var left = link.offsetLeft - (inner.clientWidth / 2) + (link.clientWidth / 2);
      inner.scrollTo({ left: left, behavior: 'smooth' });
    }
  }

  function pick() {
    // Trigger line sits just below the sticky nav; the current section is the
    // last one whose top has scrolled up past that line.
    var line = toc.offsetHeight + 24;
    var activeId = sections[0].id;
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].getBoundingClientRect().top - line <= 0) activeId = sections[i].id;
      else break;
    }
    setActive(activeId);
  }

  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { pick(); ticking = false; });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  pick();
})();
</script>

</body>
</html>`;

  mkdirSync(resolve(ROOT, 'docs/budget'), { recursive: true });
  mkdirSync(resolve(ROOT, 'docs/presupuesto'), { recursive: true });
  writeFileSync(resolve(ROOT, page.outFile), html);
  console.log(`Wrote ${page.outFile}`);
}
