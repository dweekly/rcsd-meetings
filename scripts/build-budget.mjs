#!/usr/bin/env node
/**
 * Generate docs/budget/index.html and docs/presupuesto/index.html
 * Comprehensive district budget deep-dive pages.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { headMeta, siteNav, siteFooter } from './html-parts.mjs';

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
  }
  .site-footer { font-size: 0.8rem; text-align: left; }
  .footer-nav { margin-top: 1rem; }
  .footer-nav a { font-size: 0.68rem; margin: 0 1.5rem 0 0; }
`;

// ---- 2026-27 Proposed Budget banner (bilingual) ----
// Figures: 2026-27 Multi-Year Projection (combined Unrestricted+Restricted),
//   data/board-memos/2026-06-17.json item "Public Hearing - RCSD 2026/27 Proposed Budget".
//   Total Revenues $150,289,231; Total Expenditures $151,272,528 (net -$983,297).
//   Reserve above 3% minimum $4,791,899 — 2026-27 Statement of Reasons for Excess Reserves.
//   Budget Book cover: Public Hearing June 17, 2026; Scheduled Adoption June 24, 2026.
// Source PDFs live on R2 under board-packets/2026-06-17/ (uploaded with the agenda).
const PROPOSED_DOCS_BASE = 'https://data.rcsd.info/board-packets/2026-06-17';
function proposedBudgetBanner(lang) {
  const es = lang === 'es';
  const docLink = (file, label) =>
    `<a href="${PROPOSED_DOCS_BASE}/${file}" target="_blank" rel="noopener">${label}</a>`;
  const figs = es
    ? [['$150.3M', 'Ingresos'], ['$151.3M', 'Gastos'], ['$4.79M', 'Reserva sobre el mínimo del 3%']]
    : [['$150.3M', 'Revenues'], ['$151.3M', 'Expenditures'], ['$4.79M', 'Reserve above 3% min.']];
  const docs = [
    docLink('2026-27-Budget-Book.pdf', es ? 'Libro de Presupuesto' : 'Budget Book'),
    docLink('2026-27-MYP-Budget-Adoption.pdf', es ? 'Proyección Multianual' : 'Multi-Year Projection'),
    docLink('2026-27-Statement-of-Reasons-for-Excess-Reserves.pdf', es ? 'Razones de Reservas Excedentes' : 'Statement of Reasons for Excess Reserves'),
    docLink('LCAP-Final-REPORT-June-2026.pdf', es ? 'LCAP 2026-27' : '2026-27 LCAP'),
  ].join(' · ');
  return `
<div class="proposed-banner">
  <span class="pb-tag">${es ? 'Presupuesto Propuesto 2026-27' : '2026-27 Proposed Budget'}</span>
  <h2>${es ? 'Presupuesto Propuesto 2026–27' : '2026–27 Proposed Budget'}</h2>
  <p class="pb-dates">${es
    ? 'Audiencia pública: 17 de junio de 2026 · Adopción programada: 24 de junio de 2026'
    : 'Public hearing: June 17, 2026 · Adoption scheduled: June 24, 2026'}</p>
  <div class="pb-figs">
    ${figs.map(([v, l]) => `<div class="pb-fig"><span class="pb-val">${v}</span><span class="pb-lbl">${l}</span></div>`).join('\n    ')}
  </div>
  <p class="pb-docs">${es ? 'Documentos: ' : 'Documents: '}${docs}</p>
  <p class="pb-note">${es
    ? 'Cifras propuestas — aún no adoptadas. El resto de esta página refleja el Segundo Informe Interino 2025-26 ya adoptado y se actualizará cuando la Junta adopte el presupuesto 2026-27.'
    : 'Proposed figures — not yet adopted. The rest of this page reflects the adopted 2025-26 Second Interim and will be refreshed once the Board adopts the 2026-27 budget.'}</p>
</div>`;
}

// ---- English body content ----
function enBody() {
  return `
<header class="site-header">
  <div class="header-inner">
    <div class="header-district">Redwood City School District</div>
    <h1 class="header-title">District Budget Deep Dive</h1>
    <p class="header-subtitle">A comprehensive guide to how RCSD raises and spends $160 million per year, including school bonds, parcel taxes, and the multi-year fiscal outlook.</p>
    <div class="header-meta">
      <div class="header-stat">
        <span class="header-stat-value">$159.8M</span>
        <span class="header-stat-label">Total Expenditures</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">$25,330</span>
        <span class="header-stat-label">Per-Pupil Spending</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">3.51%</span>
        <span class="header-stat-label">Reserve (3% Min.)</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">$1.7M</span>
        <span class="header-stat-label">Deficit This Year</span>
      </div>
    </div>
  </div>
</header>

<div class="disclaimer">
  Data sourced from the 2025-26 Second Interim Financial Report (March 2026), adopted LCAP, SPSAs, and official San Mateo County ballot records. This is an independent community resource, not an official district publication.
</div>

${proposedBudgetBanner('en')}

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

  <p>The Redwood City School District (RCSD) serves approximately 6,310 students in grades TK-8 across 12 schools. The district operates on a General Fund budget of <strong>$159.8 million</strong> in expenditures for the 2025-26 school year.</p>

  <h3>Community-Funded (Basic Aid) Status</h3>
  <p>RCSD is one of roughly 100 "community-funded" (formerly "Basic Aid") districts in California. This means local property tax revenue <em>exceeds</em> what the state would otherwise provide through the Local Control Funding Formula (LCFF). The district keeps all of its local property tax revenue rather than receiving a state check.</p>

  <div class="callout">
    <p><strong>What does Basic Aid mean in practice?</strong> RCSD's funding rises and falls with local property values, not with state budget decisions. When property values grow, so does district revenue. But unlike state-funded districts, RCSD does not receive automatic cost-of-living adjustments from Sacramento. RCSD still has an LCFF Supplemental and Concentration entitlement of approximately $10.2M based on its 60.3% unduplicated pupils (low-income, English Learner, foster, and homeless students), but in a community-funded district that entitlement is funded from the district's own property tax revenue rather than as a separate state check. Its main effect is to set the LCAP minimum-proportionality spending floor for those students.</p>
  </div>

  <h3>Budget at a Glance</h3>
  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Metric</th><th class="num">2025-26</th></tr>
      </thead>
      <tbody>
        <tr><td>Total Revenue</td><td class="num">$158.1M</td></tr>
        <tr><td>Total Expenditures</td><td class="num">$159.8M</td></tr>
        <tr><td>Operating Deficit</td><td class="num" style="color:var(--coral)">($1.7M)</td></tr>
        <tr><td>Beginning Fund Balance</td><td class="num">$17.1M</td></tr>
        <tr><td>Ending Fund Balance</td><td class="num">$15.4M</td></tr>
        <tr><td>Reserve (3% min. + undesignated)</td><td class="num">$5.6M (3.51%)</td></tr>
        <tr><td>Per-Pupil Spending</td><td class="num">~$25,330</td></tr>
        <tr><td>District Enrollment</td><td class="num">6,310</td></tr>
        <tr><td>Average Daily Attendance</td><td class="num">94.70%</td></tr>
      </tbody>
    </table>
  </div>
  <p class="source">Source: <a href="https://www.rcsdk8.net/our-programs-and-services/business-services/district-budget">2025-26 Second Interim Financial Report</a>, approved March 25, 2026.</p>

  <h3>What This Page Covers (And What It Doesn't)</h3>
  <p>The numbers above describe <strong>Fund 01, the General Fund</strong> &mdash; RCSD's main operating fund and the source for teacher salaries, instructional programs, and day-to-day operations. The General Fund is the right lens for "what's the district's budget?" because it's by far the largest fund and drives most policy decisions. But the district also operates a few separately-accounted funds that don't appear in the $159.8M figure:</p>
  <ul>
    <li><strong>Fund 12 &mdash; Child Development Center (CDC):</strong> the State Preschool Program (CSPP) and other early-childhood operations, funded primarily by state preschool grants and parent fees.</li>
    <li><strong>Fund 13 &mdash; Cafeteria / Child Nutrition Services (CNS):</strong> the school meals program, funded by federal and state meal reimbursements plus meal sales.</li>
    <li><strong>Fund 21 &mdash; Building Fund:</strong> proceeds from voter-approved general obligation bonds (Measures S and T), restricted to capital improvements. Covered separately in the <a href="#bonds">Bonds &amp; Construction</a> section.</li>
  </ul>
  <p>Other smaller funds (debt service, special reserves, etc.) exist but are non-material to district operations. Unless otherwise noted, the rest of this page describes Fund 01.</p>
</section>`;
}

// ---- Section 2: Revenue ----
function sectionRevenueEN() {
  return `
<section class="section" id="revenue">
  <div class="section-rule"></div>
  <span class="section-num">02</span>
  <h2>Where the Money Comes From</h2>

  <p>RCSD's $158.1 million in General Fund revenue comes from a mix of local property taxes, state grants, federal funds, and transfers. Because RCSD is a community-funded district, local property taxes form the single largest source.</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Revenue Source</th><th class="num">Amount</th><th class="num">% of Total</th><th>Visual</th></tr>
      </thead>
      <tbody>
        <tr><td>LCFF Base (Property Taxes)</td><td class="num">$87,127,120</td><td class="num">55.1%</td><td class="bar-cell"><span class="bar bar-green" style="width:55%"></span></td></tr>
        <tr><td>LCFF Ed. Protection Acct.</td><td class="num">$1,198,220</td><td class="num">0.8%</td><td class="bar-cell"><span class="bar bar-green" style="width:1%"></span></td></tr>
        <tr><td>LCFF Supplemental &amp; Concentration</td><td class="num">$10,106,685</td><td class="num">6.4%</td><td class="bar-cell"><span class="bar bar-green" style="width:6%"></span></td></tr>
        <tr><td>Special Ed Property Taxes</td><td class="num">$5,548,180</td><td class="num">3.5%</td><td class="bar-cell"><span class="bar bar-green" style="width:4%"></span></td></tr>
        <tr><td>Other State Revenues</td><td class="num">$18,287,039</td><td class="num">11.6%</td><td class="bar-cell"><span class="bar bar-amber" style="width:12%"></span></td></tr>
        <tr><td>Lottery</td><td class="num">$1,585,815</td><td class="num">1.0%</td><td class="bar-cell"><span class="bar bar-amber" style="width:1%"></span></td></tr>
        <tr><td>Federal Revenues</td><td class="num">$4,808,647</td><td class="num">3.0%</td><td class="bar-cell"><span class="bar bar-coral" style="width:3%"></span></td></tr>
        <tr><td>Local Revenues</td><td class="num">$16,850,820</td><td class="num">10.7%</td><td class="bar-cell"><span class="bar bar-green" style="width:11%"></span></td></tr>
        <tr><td>Measure U Parcel Tax</td><td class="num">$1,621,922</td><td class="num">1.0%</td><td class="bar-cell"><span class="bar bar-amber" style="width:1%"></span></td></tr>
        <tr><td>Transfers - RDA</td><td class="num">$11,000,000</td><td class="num">7.0%</td><td class="bar-cell"><span class="bar bar-coral" style="width:7%"></span></td></tr>
        <tr class="total-row"><td>Total Revenue</td><td class="num">$158,134,448</td><td class="num">100%</td><td></td></tr>
      </tbody>
    </table>
  </div>
  <p class="source">Source: 2025-26 Second Interim, General Fund Sources of Revenue (presentation, slide 6).</p>

  <h3>Property Taxes &mdash; The Foundation</h3>
  <p>Local property taxes (the LCFF Base plus Special Education property taxes) total approximately $92.7 million, or 59% of all General Fund revenue. San Mateo County collects property taxes and distributes the district's share. Because RCSD is community-funded, it keeps all allocated property tax revenue rather than returning a portion to the state.</p>
  <p>The district assumes 5% annual property tax growth in its multi-year projections. However, as the district notes, "the vast majority of homes in the RCSD attendance zone were purchased when property values were much lower," meaning assessed values (and thus tax revenue) may be lower than neighboring districts with higher turnover.</p>

  <h3>LCFF Supplemental &amp; Concentration Entitlement</h3>
  <p>The $10.2 million on the revenue table for "LCFF Supplemental & Concentration" is the <em>entitlement amount</em> calculated by the LCFF formula based on the 60.3% of RCSD's students who are unduplicated pupils (qualifying as low-income, English Learner, foster youth, or homeless). For state-funded districts this would arrive as separate state cash; for a community-funded district like RCSD the entitlement is funded from the district's own property tax revenue and is reported on this line for accounting purposes. The amount still has real consequences: it sets the LCAP minimum-proportionality spending floor, meaning the district must show at least this much being directed toward increased or improved services for unduplicated pupils.</p>

  <h3>Federal Funds</h3>
  <p>Federal revenues ($4.8 million, 3% of budget) include Title I grants for high-poverty schools, Title III for English Learner programs, and IDEA funding for special education. Seven of the district's 12 schools receive Title I funding. Federal funds are "restricted," meaning they must be spent on specific federally mandated purposes.</p>

  <h3>RDA Transfers</h3>
  <p>The $11 million in Redevelopment Agency (RDA) transfers represents 7% of total revenue. These are pass-through payments from the former city redevelopment agency. This funding source is <strong>temporary</strong> and is expected to phase out entirely in future years, creating a significant revenue cliff.</p>

  <div class="callout callout-coral">
    <p><strong>What are restricted vs. unrestricted funds?</strong> "Restricted" funds come with legal strings attached: federal Title I money must serve low-income students, bond money can only pay for facilities, and Measure U funds can only support the programs voters approved. "Unrestricted" funds (primarily property taxes) can be used for any lawful purpose. Of the $15.4M ending fund balance, $8.8M is restricted, leaving a modest unrestricted cushion.</p>
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
  <p>As of the 2025-26 Second Interim (March 2026), the Building Fund/Bond Fund held a balance of <strong>$46.8 million</strong>, reflecting active construction and modernization work funded by Measures T and S.</p>

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
        <tr><td>Annual Revenue</td><td class="num">~$1.6M (budgeted $1.62M)</td></tr>
        <tr><td>Voter Approval</td><td class="num">79.8% Yes</td></tr>
        <tr><td>Duration</td><td>14 years (July 2017 &ndash; June 2030)</td></tr>
        <tr><td>Election Date</td><td>November 8, 2016</td></tr>
        <tr><td>Predecessor</td><td>Renewed a $67/parcel tax from 2012</td></tr>
      </tbody>
    </table>
  </div>

  <p>Measure U funds enhance math, science, reading, and writing instruction; attract and retain qualified teachers; support arts and music programs; and update classroom technology. The tax explicitly prohibits spending on administrative salaries. An independent <a href="https://www.rcsdk8.net/our-programs-and-services/business-services/measure-u-parcel-tax/measure-u-citizens-oversight-committee">Citizens' Oversight Committee</a> monitors fund use.</p>

  <p><strong>Exemptions:</strong> Seniors age 65+, individuals receiving Supplemental Security Income for disability, and those receiving Social Security Disability Insurance with income below 250% of federal poverty guidelines may apply for exemption.</p>

  <h3>Measure C &mdash; June 2026 Parcel Tax (Just Short; Count Ongoing)</h3>

  <div class="callout callout-amber">
    <p><strong>Measure C is just short of passing as San Mateo County continues to count.</strong> In the county's June 10, 2026 results release, Measure C stood at <strong>63.84% Yes</strong> (11,913 votes for to 6,748 against) &mdash; about 2.8 points under the <strong>two-thirds (66.67%) supermajority</strong> a parcel tax requires. Ballots are still being tabulated, so totals are not final. The RCSD Board placed the measure on the ballot at a February 26, 2026 special meeting; it would be <em>in addition to</em> Measure U, which runs through 2030.</p>
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
        <tr><td>Result (count ongoing)</td><td style="color:var(--coral)">63.84% Yes (11,913&ndash;6,748) &mdash; ~2.8 pts under two-thirds</td></tr>
      </tbody>
    </table>
  </div>

  <p>Measure C would have raised approximately <strong>$12.2 million per year</strong> for eight years &mdash; about $175 a year for a 1,000-square-foot home, with exemptions for seniors and people receiving federal disability support. The district had earmarked the revenue to attract and retain teachers, counselors, and staff; protect science, math, and STEM instruction; preserve reading and writing programs; and keep class sizes manageable.</p>

  <h3>What the Result Means for the Budget</h3>
  <p>Measure C revenue was <em>not</em> built into the district's three-year budget projection. The board had already adopted a $6.04 million Fiscal Stabilization Plan on February 4, 2026, and the 2025-26 Second Interim multi-year projection balances <strong>without</strong> any parcel-tax money &mdash; it carries no unidentified cuts and keeps reserves above the 3% legal minimum in all three years (see the <a href="#outlook">Multi-Year Fiscal Outlook</a>). In other words, the outcome at the ballot box does not trigger new cuts; rather, if Measure C does not pass, the roughly $12.2M it would have added each year is revenue the district will <em>not</em> have to restore programs and staffing trimmed in the stabilization plan, or to offset the looming RDA-transfer cliff. The existing Measure U ($1.6M/year) continues through 2030 regardless of the June 2026 outcome.</p>

  <h3>Community Resources</h3>
  <ul>
    <li><strong>Strong Schools for Redwood City</strong> (pro-measure campaign): <a href="https://www.strongschools4rwc.org/en/" target="_blank">strongschools4rwc.org</a></li>
    <li><strong>Official election results</strong>: <a href="https://www.smcacre.gov/elections" target="_blank">San Mateo County Assessor-Clerk-Recorder &amp; Elections</a></li>
  </ul>

  <p class="source">Source: <a href="https://www.smcacre.gov/elections" target="_blank">San Mateo County Registration &amp; Elections</a>, official results as of the June 10, 2026 release (63.84% Yes, 11,913&ndash;6,748). Earlier election-night coverage: <a href="https://www.rwcpulse.com/election/2026/06/03/redwood-city-school-parcel-tax-trails-approval-threshold/" target="_blank">Redwood City Pulse, June 3, 2026</a>. Vote totals are unofficial pending the county's final canvass.</p>
</section>`;
}

// ---- Section 5: Spending ----
function sectionSpendingEN() {
  return `
<section class="section" id="spending">
  <div class="section-rule"></div>
  <span class="section-num">05</span>
  <h2>Where the Money Goes</h2>

  <p>RCSD's $159.8 million in General Fund expenditures is dominated by personnel costs: salaries and benefits account for <strong>76.4%</strong> of all spending. This is typical for school districts, where the primary "product" is instruction delivered by people.</p>

  <h3>Expenditure Breakdown</h3>
  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Category</th><th class="num">Amount</th><th class="num">% of Total</th><th>Visual</th></tr>
      </thead>
      <tbody>
        <tr><td>Certificated Salaries (teachers, admin)</td><td class="num">$53,745,487</td><td class="num">33.6%</td><td class="bar-cell"><span class="bar bar-green" style="width:34%"></span></td></tr>
        <tr><td>Classified Salaries (support staff)</td><td class="num">$28,741,030</td><td class="num">18.0%</td><td class="bar-cell"><span class="bar bar-green" style="width:18%"></span></td></tr>
        <tr><td>Employee Benefits</td><td class="num">$39,578,283</td><td class="num">24.8%</td><td class="bar-cell"><span class="bar bar-amber" style="width:25%"></span></td></tr>
        <tr><td>Services &amp; Operating Expenses</td><td class="num">$31,271,358</td><td class="num">19.6%</td><td class="bar-cell"><span class="bar bar-amber" style="width:20%"></span></td></tr>
        <tr><td>Books &amp; Supplies</td><td class="num">$5,772,632</td><td class="num">3.6%</td><td class="bar-cell"><span class="bar bar-coral" style="width:4%"></span></td></tr>
        <tr><td>Capital Outlay</td><td class="num">$921,767</td><td class="num">0.6%</td><td class="bar-cell"><span class="bar bar-coral" style="width:1%"></span></td></tr>
        <tr class="total-row"><td>Total Expenditures</td><td class="num">$159,841,595</td><td class="num">100%</td><td></td></tr>
      </tbody>
    </table>
  </div>
  <p class="source">Source: 2025-26 Second Interim, General Fund Expenditures (presentation, slides 7-8). Category rows exclude a small net other-outgo/indirect-cost credit.</p>

  <h3>Benefits: The Hidden Cost Driver</h3>
  <p>Employee benefits ($39.6M) represent about a quarter of all spending and include CalSTRS pension contributions (19.10% employer rate), CalPERS pension contributions (26.81%), health and welfare benefits, and other statutory benefits. Both CalSTRS and CalPERS rates are projected to keep rising through 2027-28 (CalPERS to 26.90%).</p>

  <h3>Services &amp; Operating Expenses</h3>
  <p>The $31.3 million in services and operations includes contracted services, professional and operating expenses, and insurance. This category covers everything from special education service providers to utilities, transportation, legal fees, and technology contracts.</p>

  <div class="callout callout-amber">
    <p><strong>See it check by check.</strong> That $31.3M in services &mdash; plus every other warrant the district writes &mdash; is itemized on the <a href="/vendors/">Vendor Spending</a> page: every check the board has ratified since 2020, searchable by vendor with year-by-year totals. (Accounts-payable only &mdash; it excludes payroll, the bulk of the budget above.)</p>
  </div>

  <h3>LCAP Spending Breakdown</h3>
  <p>The district's Local Control and Accountability Plan (LCAP) allocates $65.9 million of the total budget across three goals:</p>
  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>LCAP Goal</th><th class="num">Amount</th><th>Focus</th></tr>
      </thead>
      <tbody>
        <tr><td>Goal 3: Academics</td><td class="num">$57.3M</td><td>Instruction, curriculum, credentialed teachers, CAASPP improvement</td></tr>
        <tr><td>Goal 1: Engagement</td><td class="num">$7.5M</td><td>Attendance, school climate, family engagement, suspensions</td></tr>
        <tr><td>Goal 2: EL Programs</td><td class="num">$3.2M</td><td>English Learner progress, reclassification, LTEL reduction</td></tr>
        <tr class="total-row"><td>Total LCAP</td><td class="num">$65.9M</td><td></td></tr>
      </tbody>
    </table>
  </div>
  <p class="source">Source: 2025-26 Adopted LCAP.</p>
</section>`;
}

// ---- Section 6: Multi-Year Outlook ----
function sectionOutlookEN() {
  return `
<section class="section" id="outlook">
  <div class="section-rule"></div>
  <span class="section-num">06</span>
  <h2>Multi-Year Fiscal Outlook</h2>

  <p>At the 2025-26 Second Interim (March 2026), the district's multi-year projection has turned a corner. After the board adopted a $6.04 million Fiscal Stabilization Plan on February 4, 2026, the three-year outlook <strong>no longer carries any unidentified cuts</strong>: the reductions are fully identified and baked in, the fund balance grows rather than shrinks in both projection years, and the reserve climbs from 3.51% to 5.81% &mdash; comfortably above the 3% legal minimum throughout. On that basis the district filed a <strong>Positive Certification</strong>, certifying it can meet its financial obligations for 2025-26 and the two subsequent years.</p>

  <h3>Three-Year Projection</h3>
  <div class="table-wrap">
    <table>
      <thead>
        <tr><th></th><th class="num">2025-26</th><th class="num">2026-27</th><th class="num">2027-28</th></tr>
      </thead>
      <tbody>
        <tr><td>Total Revenues</td><td class="num">$158.1M</td><td class="num">$154.2M</td><td class="num">$161.1M</td></tr>
        <tr><td>Total Expenditures</td><td class="num">$159.8M</td><td class="num">$153.5M</td><td class="num">$154.4M</td></tr>
        <tr><td>Identified Stabilization (in expenditures)</td><td class="num">&mdash;</td><td class="num">($6.04M)</td><td class="num">($6.11M)</td></tr>
        <tr><td>Net Change in Fund Balance</td><td class="num" style="color:var(--coral)">($1.7M)</td><td class="num" style="color:var(--green-mid)">+$0.6M</td><td class="num" style="color:var(--green-mid)">+$6.7M</td></tr>
        <tr><td>Beginning Balance</td><td class="num">$17.1M</td><td class="num">$15.4M</td><td class="num">$16.0M</td></tr>
        <tr><td>Ending Balance</td><td class="num">$15.4M</td><td class="num">$16.0M</td><td class="num">$22.7M</td></tr>
        <tr><td>Reserve %</td><td class="num">3.51%</td><td class="num">3.74%</td><td class="num">5.81%</td></tr>
      </tbody>
    </table>
  </div>
  <p class="source">The "Identified Stabilization" line is the board-approved Fiscal Stabilization Plan (Feb. 4, 2026), shown as a reduction to expenditures. Source: 2025-26 Second Interim Multi-Year Projection (March 25, 2026), p. 1.</p>

  <div class="callout">
    <p><strong>The drawdown has been arrested.</strong> A year ago the fund balance was sliding toward the 3% reserve floor with millions in cuts still unidentified. With the stabilization plan in place, the Second Interim projects the ending balance <em>growing</em> from $15.4M to $22.7M by 2027-28 and the reserve rising to 5.81%. The structural pressures below are real, but the district now has a credible, fully-identified path to balance &mdash; it does not depend on the June 2026 parcel tax (Measure C), which is running just short of the two-thirds bar as the count continues.</p>
  </div>

  <h3>Fiscal Stabilization Plan</h3>
  <p>On February 4, 2026, the board adopted a $6.04 million Fiscal Stabilization Plan ($6.11M ongoing) that eliminates 31.75 FTE positions. These are the reductions now reflected in the three-year projection above. Key elements include:</p>
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
    <p>Enrollment continues to decline &mdash; from 6,310 in 2025-26 to a projected 6,212 by 2027-28 (the Second Interim assumes a gentler slide than earlier projections). Each lost student represents roughly $15,000-$16,000 in LCFF-equivalent funding. Fixed costs (facilities, administration, transportation) do not decline proportionally.</p>
  </div>
  <div class="trend-item">
    <div class="trend-label trend-down">Rising Personnel Costs</div>
    <p>Salary step-and-column increases (1.5% annually), growing pension contribution rates (CalPERS rising to 26.90%), and health benefit inflation drive expenditures upward even as enrollment falls. Salaries and benefits consume about 76% of the budget.</p>
  </div>
  <div class="trend-item">
    <div class="trend-label trend-down">RDA Transfer Cliff</div>
    <p>The $11 million in Redevelopment Agency transfers drops to zero in 2026-27 and beyond in the multi-year projection. This single revenue loss represents 7% of the entire General Fund budget and is the primary driver of the 2026-27 revenue decline.</p>
  </div>
  <div class="trend-item">
    <div class="trend-label trend-down">One-Time Funds Expiring</div>
    <p>Federal pandemic-era funds (ESSER) and other one-time grants that supported positions and programs have been fully spent. Positions funded by these one-time sources must now be absorbed by the General Fund or eliminated.</p>
  </div>

  <h3>Key Budget Assumptions</h3>
  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Assumption</th><th class="num">2025-26</th><th class="num">2026-27</th><th class="num">2027-28</th></tr>
      </thead>
      <tbody>
        <tr><td>District Enrollment</td><td class="num">6,310</td><td class="num">6,239</td><td class="num">6,212</td></tr>
        <tr><td>LCFF COLA</td><td class="num">2.30%</td><td class="num">2.41%</td><td class="num">3.06%</td></tr>
        <tr><td>CalSTRS Rate</td><td class="num">19.10%</td><td class="num">19.10%</td><td class="num">19.10%</td></tr>
        <tr><td>CalPERS Rate</td><td class="num">26.81%</td><td class="num">26.40%</td><td class="num">26.90%</td></tr>
        <tr><td>Property Tax Growth</td><td class="num">5.00%</td><td class="num">5.00%</td><td class="num">5.00%</td></tr>
        <tr><td>Step &amp; Column</td><td class="num">1.50%</td><td class="num">1.50%</td><td class="num">1.50%</td></tr>
      </tbody>
    </table>
  </div>
  <p class="source">Source: 2025-26 Second Interim Budget Assumptions (presentation, slide 4).</p>
</section>`;
}

// ---- Section 7: School-Level Funding ----
function sectionSchoolsEN() {
  return `
<section class="section" id="schools">
  <div class="section-rule"></div>
  <span class="section-num">07</span>
  <h2>School-Level Funding (SPSA Budgets)</h2>

  <p>Each school's Single Plan for Student Achievement (SPSA) budget captures <em>supplemental</em> site-level spending, including enrichment, counseling, professional development, and materials. These budgets do <strong>not</strong> include base operating costs like teacher salaries and facilities, which come from the General Fund.</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>School</th><th class="num">Total SPSA</th><th class="num">Per Pupil</th><th class="num">Title I</th><th class="num">District</th><th class="num">PTO/PTA</th><th class="num">Measure U</th><th class="num">Prop 28</th></tr>
      </thead>
      <tbody>
        <tr><td>Orion</td><td class="num">$1,062K</td><td class="num">$1,934</td><td class="num">&mdash;</td><td class="num">$150K</td><td class="num">$721K</td><td class="num">$131K</td><td class="num">$59K</td></tr>
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
        <tr><td>Taft</td><td class="num">$238K</td><td class="num">$733</td><td class="num">$69K</td><td class="num">&mdash;</td><td class="num">&mdash;</td><td class="num">$97K</td><td class="num">$72K</td></tr>
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
    <li><a href="https://www.rcsdk8.net/our-programs-and-services/business-services/district-budget">2025-26 Adopted Budget &amp; Interim Reports</a> (District website)</li>
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
    <li><a href="https://www.rcsdk8.net">2025-26 Adopted LCAP</a> &mdash; Local Control and Accountability Plan</li>
    <li><a href="https://www.caschooldashboard.org/reports/41689660000000/2024">California School Dashboard &mdash; RCSD</a></li>
  </ul>

  <h3>Board Meetings</h3>
  <ul style="margin-bottom:1.5rem">
    <li><a href="https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030397">GAMUT Board Portal</a> &mdash; Agendas, minutes, and official documents</li>
    <li><a href="https://www.youtube.com/@RedwoodCitySchoolDistrict">RCSD YouTube Channel</a> &mdash; Board meeting recordings</li>
    <li><a href="/meetings/">RCSD.info Meeting Index</a> &mdash; Searchable meeting transcripts and timestamps</li>
  </ul>

  <h3>External Coverage</h3>
  <ul style="margin-bottom:1.5rem">
    <li><a href="https://www.smcacre.gov/elections" target="_blank">San Mateo County Registration &amp; Elections</a> &mdash; official Measure C results</li>
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
      <div class="glossary-def">The average number of students attending school each day, used as the basis for state funding calculations. RCSD's ADA rate is about 94.70%.</div>
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
      <div class="glossary-def">California Public Employees' Retirement System. Provides pensions for classified (non-teaching) staff. Employer rate: 26.81% of salary.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">CalSTRS</div>
      <div class="glossary-def">California State Teachers' Retirement System. Provides pensions for certificated (teaching) staff. Employer rate: 19.10% of salary.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Deficit Spending</div>
      <div class="glossary-def">When expenditures exceed revenues in a given year. The gap is covered by drawing down the fund balance (reserves). RCSD is deficit spending by $1.7M in 2025-26.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Fund Balance</div>
      <div class="glossary-def">The district's accumulated savings, similar to a checking account balance. Includes restricted funds (earmarked for specific purposes) and unrestricted funds available for general use.</div>
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
      <div class="glossary-def">A flat or formula-based tax on each land parcel, used for General Fund operations (unlike bonds). Requires two-thirds voter approval. Measure U is RCSD's current parcel tax ($85/parcel/year).</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">RDA (Redevelopment Agency)</div>
      <div class="glossary-def">Former city agency whose dissolution resulted in pass-through property tax payments to the district. RCSD receives $11M in 2025-26, but this is expected to decline to zero.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Reserve Requirement (3%)</div>
      <div class="glossary-def">California law requires districts to maintain a Reserve for Economic Uncertainty of at least 3% of expenditures. At the 2025-26 Second Interim, RCSD's total reserve is 3.51%, above the 3% legal minimum and projected to rise to 5.81% by 2027-28.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Restricted vs. Unrestricted</div>
      <div class="glossary-def">Restricted funds have legal constraints on their use (e.g., federal grants, bond proceeds). Unrestricted funds (mostly property taxes) can be used for any lawful educational purpose.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">S&amp;C Entitlement</div>
      <div class="glossary-def">Supplemental and Concentration amounts under LCFF, calculated based on a district's percentage of unduplicated pupils (low-income, EL, foster, homeless). For state-funded districts this is an additional state grant; for community-funded districts like RCSD it's an entitlement funded from local property tax that sets the LCAP minimum-proportionality spending floor. RCSD's S&amp;C entitlement is $10.2M.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">SPSA</div>
      <div class="glossary-def">Single Plan for Student Achievement. Each school's site-level plan and budget for supplemental programs, funded through Title I, district allocations, parent organizations, and other sources.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Title I</div>
      <div class="glossary-def">Federal program providing supplemental funding to schools with high percentages of low-income students. Seven of RCSD's 12 schools receive Title I funds.</div>
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
    <p class="header-subtitle">Una gu\u00eda completa sobre c\u00f3mo RCSD recauda y gasta $160 millones al a\u00f1o, incluyendo bonos escolares, impuestos parcelarios y la perspectiva fiscal multianual.</p>
    <div class="header-meta">
      <div class="header-stat">
        <span class="header-stat-value">$159.8M</span>
        <span class="header-stat-label">Gastos Totales</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">$25,330</span>
        <span class="header-stat-label">Gasto por Alumno</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">3.51%</span>
        <span class="header-stat-label">Reserva (M\u00edn. 3%)</span>
      </div>
      <div class="header-stat">
        <span class="header-stat-value">$1.7M</span>
        <span class="header-stat-label">D\u00e9ficit Este A\u00f1o</span>
      </div>
    </div>
  </div>
</header>

<div class="disclaimer">
  Datos obtenidos del Segundo Informe Interino Financiero 2025-26 (marzo 2026), LCAP adoptado, SPSAs y registros electorales oficiales del Condado de San Mateo. Este es un recurso comunitario independiente, no una publicaci\u00f3n oficial del distrito.
</div>

${proposedBudgetBanner('es')}

<nav class="toc" aria-label="Secciones de la p\u00e1gina">
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

  <p>El Distrito Escolar de Redwood City (RCSD) atiende a aproximadamente 6,310 estudiantes en grados TK-8 en 12 escuelas. El distrito opera con un presupuesto del Fondo General de <strong>$159.8 millones</strong> en gastos para el a\u00f1o escolar 2025-26.</p>

  <h3>Estatus de Distrito Financiado por la Comunidad (Basic Aid)</h3>
  <p>RCSD es uno de aproximadamente 100 distritos "financiados por la comunidad" (anteriormente "Basic Aid") en California. Esto significa que los ingresos locales por impuestos a la propiedad <em>superan</em> lo que el estado proporcionar\u00eda a trav\u00e9s de la F\u00f3rmula de Financiamiento de Control Local (LCFF). El distrito retiene todos sus ingresos por impuestos a la propiedad en lugar de recibir un cheque del estado.</p>

  <div class="callout">
    <p><strong>\u00bfQu\u00e9 significa Basic Aid en la pr\u00e1ctica?</strong> El financiamiento de RCSD sube y baja con los valores de las propiedades locales, no con las decisiones del presupuesto estatal. Cuando los valores de las propiedades crecen, tambi\u00e9n lo hacen los ingresos del distrito. Pero a diferencia de los distritos financiados por el estado, RCSD no recibe ajustes autom\u00e1ticos por costo de vida de Sacramento. RCSD tiene un derecho ("entitlement") de Suplementario y Concentraci\u00f3n LCFF de aproximadamente $10.2M basado en su 60.7% de alumnos no duplicados (de bajos ingresos, estudiantes de ingl\u00e9s, en cuidado temporal o sin hogar), pero en un distrito financiado por la comunidad este derecho se paga de los propios impuestos a la propiedad del distrito y no como un cheque aparte del estado. Su efecto principal es establecer el piso m\u00ednimo de gasto proporcional que el LCAP debe destinar a esos estudiantes.</p>
  </div>

  <h3>Presupuesto de un Vistazo</h3>
  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>M\u00e9trica</th><th class="num">2025-26</th></tr>
      </thead>
      <tbody>
        <tr><td>Ingresos Totales</td><td class="num">$158.1M</td></tr>
        <tr><td>Gastos Totales</td><td class="num">$159.8M</td></tr>
        <tr><td>D\u00e9ficit Operativo</td><td class="num" style="color:var(--coral)">($1.7M)</td></tr>
        <tr><td>Balance Inicial del Fondo</td><td class="num">$17.1M</td></tr>
        <tr><td>Balance Final del Fondo</td><td class="num">$15.4M</td></tr>
        <tr><td>Reserva (m\u00edn. 3% + no designada)</td><td class="num">$5.6M (3.51%)</td></tr>
        <tr><td>Gasto por Alumno</td><td class="num">~$25,330</td></tr>
        <tr><td>Inscripci\u00f3n del Distrito</td><td class="num">6,310</td></tr>
        <tr><td>Asistencia Diaria Promedio</td><td class="num">94.70%</td></tr>
      </tbody>
    </table>
  </div>
  <p class="source">Fuente: <a href="https://www.rcsdk8.net/our-programs-and-services/business-services/district-budget">Segundo Informe Interino Financiero 2025-26</a>, aprobado el 25 de marzo de 2026.</p>

  <h3>Qué cubre esta página (y qué no)</h3>
  <p>Los números arriba describen el <strong>Fondo 01, el Fondo General</strong> &mdash; el fondo operativo principal de RCSD y la fuente de los salarios de maestros, programas de instrucción y operaciones diarias. El Fondo General es el lente correcto para "¿cuál es el presupuesto del distrito?" porque es por mucho el fondo más grande y el que guía la mayoría de las decisiones de política. Pero el distrito también opera algunos otros fondos con contabilidad separada que no aparecen en la cifra de $159.8M:</p>
  <ul>
    <li><strong>Fondo 12 &mdash; Centro de Desarrollo Infantil (CDC):</strong> el Programa Estatal de Preescolar (CSPP) y otras operaciones de la primera infancia, financiadas principalmente por subvenciones estatales para preescolar y cuotas de los padres.</li>
    <li><strong>Fondo 13 &mdash; Cafetería / Servicios de Nutrición Infantil (CNS):</strong> el programa de comidas escolares, financiado por reembolsos de comidas federales y estatales más ventas de comidas.</li>
    <li><strong>Fondo 21 &mdash; Fondo de Construcción:</strong> ingresos de bonos de obligación general aprobados por los votantes (Medidas S y T), restringidos a mejoras de capital. Cubierto por separado en la sección <a href="#bonos">Bonos y Construcción</a>.</li>
  </ul>
  <p>Existen otros fondos más pequeños (servicio de la deuda, reservas especiales, etc.) pero son no materiales para las operaciones del distrito. A menos que se indique lo contrario, el resto de esta página describe el Fondo 01.</p>
</section>`;
}

// ---- Spanish Section 2 ----
function sectionRevenueES() {
  return `
<section class="section" id="ingresos">
  <div class="section-rule"></div>
  <span class="section-num">02</span>
  <h2>De D\u00f3nde Viene el Dinero</h2>

  <p>Los $158.1 millones en ingresos del Fondo General de RCSD provienen de una mezcla de impuestos locales a la propiedad, subsidios estatales, fondos federales y transferencias.</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Fuente de Ingresos</th><th class="num">Monto</th><th class="num">% del Total</th></tr>
      </thead>
      <tbody>
        <tr><td>LCFF Base (Impuestos a la Propiedad)</td><td class="num">$87,127,120</td><td class="num">55.1%</td></tr>
        <tr><td>Cuenta de Protecci\u00f3n Educativa LCFF</td><td class="num">$1,198,220</td><td class="num">0.8%</td></tr>
        <tr><td>Suplementario y Concentraci\u00f3n LCFF</td><td class="num">$10,106,685</td><td class="num">6.4%</td></tr>
        <tr><td>Impuestos de Educaci\u00f3n Especial</td><td class="num">$5,548,180</td><td class="num">3.5%</td></tr>
        <tr><td>Otros Ingresos Estatales</td><td class="num">$18,287,039</td><td class="num">11.6%</td></tr>
        <tr><td>Loter\u00eda</td><td class="num">$1,585,815</td><td class="num">1.0%</td></tr>
        <tr><td>Ingresos Federales</td><td class="num">$4,808,647</td><td class="num">3.0%</td></tr>
        <tr><td>Ingresos Locales</td><td class="num">$16,850,820</td><td class="num">10.7%</td></tr>
        <tr><td>Impuesto Parcelario Medida U</td><td class="num">$1,621,922</td><td class="num">1.0%</td></tr>
        <tr><td>Transferencias - RDA</td><td class="num">$11,000,000</td><td class="num">7.0%</td></tr>
        <tr class="total-row"><td>Ingresos Totales</td><td class="num">$158,134,448</td><td class="num">100%</td></tr>
      </tbody>
    </table>
  </div>
  <p class="source">Fuente: Segundo Informe Interino 2025-26, Fuentes de Ingresos del Fondo General (presentaci\u00f3n, l\u00e1mina 6).</p>

  <h3>Impuestos a la Propiedad &mdash; La Base</h3>
  <p>Los impuestos locales a la propiedad (la base LCFF m\u00e1s los impuestos de Educaci\u00f3n Especial) totalizan aproximadamente $92.7 millones, o el 59% de todos los ingresos del Fondo General.</p>

  <h3>Derecho ("Entitlement") Suplementario y de Concentraci\u00f3n LCFF</h3>
  <p>Los $10.2 millones que aparecen en la tabla de ingresos como "Suplementario y Concentraci\u00f3n LCFF" son el <em>monto del derecho</em> ("entitlement") calculado por la f\u00f3rmula LCFF, basado en el 60.3% de los estudiantes de RCSD que son alumnos no duplicados (de bajos ingresos, estudiantes de ingl\u00e9s, j\u00f3venes en cuidado temporal o sin hogar). Para los distritos financiados por el estado, esto llegar\u00eda como dinero estatal aparte; para un distrito financiado por la comunidad como RCSD, el derecho se paga con los propios impuestos a la propiedad del distrito y se reporta en esta l\u00ednea por motivos contables. El monto sigue teniendo consecuencias reales: establece el piso m\u00ednimo de gasto proporcional del LCAP, lo que significa que el distrito debe demostrar que al menos esta cantidad se est\u00e1 destinando a aumentar o mejorar los servicios para los alumnos no duplicados.</p>

  <h3>Fondos Federales</h3>
  <p>Los ingresos federales ($4.8 millones, 3% del presupuesto) incluyen subsidios T\u00edtulo I para escuelas de alta pobreza, T\u00edtulo III para programas de Estudiantes de Ingl\u00e9s e IDEA para educaci\u00f3n especial.</p>

  <h3>Transferencias RDA</h3>
  <p>Los $11 millones en transferencias de la Agencia de Redesarrollo (RDA) representan el 7% de los ingresos totales. Esta fuente de financiamiento es <strong>temporal</strong> y se espera que se elimine por completo en a\u00f1os futuros.</p>

  <div class="callout callout-coral">
    <p><strong>\u00bfQu\u00e9 son los fondos restringidos vs. no restringidos?</strong> Los fondos "restringidos" tienen restricciones legales sobre su uso (por ejemplo, el dinero federal de T\u00edtulo I debe servir a estudiantes de bajos ingresos). Los fondos "no restringidos" (principalmente impuestos a la propiedad) pueden usarse para cualquier prop\u00f3sito legal.</p>
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

  <p>Los votantes de RCSD han aprobado dos medidas de bonos de obligaci\u00f3n general (GO) por un total de <strong>$491 millones</strong> para modernizar las instalaciones escolares. Los fondos de bonos est\u00e1n legalmente restringidos a proyectos de capital y <em>no pueden</em> usarse para salarios, pensiones o gastos operativos.</p>

  <h3>C\u00f3mo Funcionan los Bonos Escolares</h3>
  <p>Un bono de obligaci\u00f3n general es esencialmente un pr\u00e9stamo de inversionistas que el distrito paga con el tiempo usando ingresos de impuestos a la propiedad. Los votantes deben aprobar los bonos con una supermayori\u0301a del 55%.</p>

  <div class="callout">
    <p><strong>El dinero de bonos PUEDE pagar:</strong> Construcci\u00f3n nueva, renovaciones, sistemas HVAC, mejoras el\u00e9ctricas, mejoras de seguridad, infraestructura tecnol\u00f3gica.</p>
    <p><strong>El dinero de bonos NO PUEDE pagar:</strong> Salarios de maestros o administradores, pensiones, beneficios, libros de texto, desarrollo profesional o gastos operativos continuos.</p>
  </div>

  <h3>Medida T (Fase I) &mdash; Aprobada en Noviembre 2015</h3>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Detalle</th><th>Medida T</th></tr></thead>
      <tbody>
        <tr><td>Monto</td><td class="num">$193 millones</td></tr>
        <tr><td>Aprobaci\u00f3n de Votantes</td><td class="num">63.5% S\u00ed</td></tr>
        <tr><td>Tasa de Impuesto</td><td class="num">$30 por $100K de valor tasado</td></tr>
        <tr><td>Per\u00edodo M\u00e1x. de Pago</td><td class="num">40 a\u00f1os</td></tr>
      </tbody>
    </table>
  </div>
  <p>La Medida T financi\u00f3 la Fase I del Plan Maestro de Instalaciones del distrito. Los proyectos completados incluyen modernizaciones en Hoover, Taft, Clifford, Roosevelt, Garfield y Adelante Selby.</p>

  <h3>Medida S (Fase II) &mdash; Aprobada en Noviembre 2022</h3>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Detalle</th><th>Medida S</th></tr></thead>
      <tbody>
        <tr><td>Monto</td><td class="num">$298 millones</td></tr>
        <tr><td>Aprobaci\u00f3n de Votantes</td><td class="num">60.4% S\u00ed</td></tr>
        <tr><td>Tasa de Impuesto</td><td class="num">$24 por $100K de valor tasado</td></tr>
        <tr><td>Ingresos Anuales (est.)</td><td class="num">~$16 millones/a\u00f1o</td></tr>
      </tbody>
    </table>
  </div>
  <p>La Medida S contin\u00faa el trabajo de modernizaci\u00f3n que inici\u00f3 la Medida T. Los proyectos activos incluyen trabajo en McKinley MIT, Henry Ford, Orion y Garfield.</p>

  <h3>Comit\u00e9 de Supervisi\u00f3n Ciudadana de Bonos</h3>
  <p>La ley de California requiere un Comit\u00e9 de Supervisi\u00f3n Ciudadana de Bonos (CBOC) independiente para revisar los gastos de bonos y publicar informes anuales. El CBOC de RCSD tiene nueve miembros y se re\u00fane trimestralmente. Las agendas y actas de reuniones est\u00e1n disponibles en el <a href="https://www.rcsdk8.net/our-programs-and-services/school-modernization-and-construction/phase-i-measure-t/measure-t-oversight-committee">sitio web del distrito</a>.</p>
</section>`;
}

// ---- Spanish Section 4 ----
function sectionParcelTaxES() {
  return `
<section class="section" id="impuesto">
  <div class="section-rule"></div>
  <span class="section-num">04</span>
  <h2>Impuesto Parcelario &mdash; Medida U y Medida C (2026)</h2>

  <h3>C\u00f3mo Funcionan los Impuestos Parcelarios</h3>
  <p>Un impuesto parcelario es un impuesto fijo o basado en f\u00f3rmula que se cobra por cada parcela de tierra dentro de un distrito. A diferencia de los bonos, los ingresos del impuesto parcelario van al Fondo General y pueden usarse para operaciones como salarios de maestros y programas. Los impuestos parcelarios requieren una supermayori\u0301a de dos tercios para ser aprobados.</p>

  <h3>Medida U Actual (2016)</h3>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Detalle</th><th>Medida U</th></tr></thead>
      <tbody>
        <tr><td>Monto</td><td class="num">$85 por parcela por a\u00f1o</td></tr>
        <tr><td>Ingresos Anuales</td><td class="num">~$1.6M (presupuestado $1.62M)</td></tr>
        <tr><td>Aprobaci\u00f3n de Votantes</td><td class="num">79.8% S\u00ed</td></tr>
        <tr><td>Duraci\u00f3n</td><td>14 a\u00f1os (julio 2017 &ndash; junio 2030)</td></tr>
      </tbody>
    </table>
  </div>
  <p>Los fondos de la Medida U mejoran la instrucci\u00f3n en matem\u00e1ticas, ciencias, lectura y escritura; atraen y retienen maestros calificados; apoyan programas de artes y m\u00fasica; y actualizan la tecnolog\u00eda en las aulas.</p>
  <p><strong>Exenciones:</strong> Personas mayores de 65 a\u00f1os e individuos que reciben apoyo federal por discapacidad pueden solicitar la exenci\u00f3n.</p>

  <h3>Medida C &mdash; Impuesto Parcelario de Junio 2026 (Por Poco; Conteo en Curso)</h3>

  <div class="callout callout-amber">
    <p><strong>A la Medida C le falta poco para pasar mientras el Condado de San Mateo sigue contando.</strong> En los resultados publicados por el condado el 10 de junio de 2026, la Medida C estaba en <strong>63.84% de votos a favor</strong> (11,913 a favor y 6,748 en contra) &mdash; unos 2.8 puntos por debajo de la <strong>supermayor\u00eda de dos tercios (66.67%)</strong> que requiere un impuesto parcelario. Todav\u00eda se est\u00e1n contando boletas, as\u00ed que los totales no son finales. La Junta de RCSD puso la medida en la boleta en una reuni\u00f3n especial el 26 de febrero de 2026; ser\u00eda <em>adicional</em> a la Medida U, que sigue vigente hasta 2030.</p>
  </div>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Detalle</th><th>Medida C (2026)</th></tr></thead>
      <tbody>
        <tr><td>Tasa de Impuesto</td><td>17.5 centavos por pie cuadrado de edificio</td></tr>
        <tr><td>Parcelas Vac\u00edas</td><td class="num">$25/a\u00f1o tarifa fija</td></tr>
        <tr><td>Ingresos Esperados</td><td class="num">$12.2 millones/a\u00f1o</td></tr>
        <tr><td>Duraci\u00f3n</td><td>8 a\u00f1os (julio 2026 &ndash; junio 2034)</td></tr>
        <tr><td>Voto Requerido</td><td>Dos tercios (66.67%)</td></tr>
        <tr><td>Fecha de Elecci\u00f3n</td><td>2 de junio de 2026</td></tr>
        <tr><td>Resultado (conteo en curso)</td><td style="color:var(--coral)">63.84% a favor (11,913&ndash;6,748) &mdash; ~2.8 pts bajo dos tercios</td></tr>
      </tbody>
    </table>
  </div>

  <p>La Medida C habr\u00eda recaudado aproximadamente <strong>$12.2 millones al a\u00f1o</strong> durante ocho a\u00f1os &mdash; unos $175 al a\u00f1o para una casa de 1,000 pies cuadrados, con exenciones para personas mayores y personas que reciben apoyo federal por discapacidad. El distrito hab\u00eda destinado ese dinero a atraer y retener maestros, consejeros y personal; proteger la instrucci\u00f3n en ciencias, matem\u00e1ticas y STEM; preservar los programas de lectura y escritura; y mantener tama\u00f1os de clase manejables.</p>

  <h3>Qu\u00e9 Significa el Resultado para el Presupuesto</h3>
  <p>El dinero de la Medida C <em>no</em> estaba incluido en la proyecci\u00f3n presupuestaria a tres a\u00f1os del distrito. La Junta ya hab\u00eda adoptado un Plan de Estabilizaci\u00f3n Fiscal de $6.04 millones el 4 de febrero de 2026, y la proyecci\u00f3n multianual del Segundo Informe Interino 2025-26 cuadra <strong>sin</strong> ning\u00fan dinero de impuestos parcelarios &mdash; no tiene recortes no identificados y mantiene las reservas por encima del m\u00ednimo legal del 3% en los tres a\u00f1os (ver <a href="#perspectiva">Perspectiva Fiscal Multianual</a>). En otras palabras, el resultado en la boleta no provoca nuevos recortes; m\u00e1s bien, si la Medida C no se aprueba, los aproximadamente $12.2M que habr\u00eda aportado cada a\u00f1o son ingresos que el distrito <em>no</em> tendr\u00e1 para restaurar programas y personal reducidos en el plan de estabilizaci\u00f3n, ni para compensar el inminente precipicio de las transferencias RDA. La Medida U actual ($1.6M/a\u00f1o) contin\u00faa hasta 2030 sin importar el resultado de junio 2026.</p>

  <h3>Recursos de la Comunidad</h3>
  <ul>
    <li><strong>Strong Schools for Redwood City</strong> (campa\u00f1a a favor): <a href="https://www.strongschools4rwc.org/es/" target="_blank">strongschools4rwc.org</a></li>
    <li><strong>Resultados electorales oficiales</strong>: <a href="https://www.smcacre.gov/elections" target="_blank">San Mateo County Assessor-Clerk-Recorder &amp; Elections</a></li>
  </ul>

  <p class="source">Fuente: <a href="https://www.smcacre.gov/elections" target="_blank">Registro y Elecciones del Condado de San Mateo</a>, resultados oficiales al 10 de junio de 2026 (63.84% a favor, 11,913&ndash;6,748). Cobertura de la noche electoral: <a href="https://www.rwcpulse.com/election/2026/06/03/redwood-city-school-parcel-tax-trails-approval-threshold/" target="_blank">Redwood City Pulse, 3 de junio de 2026</a>. Los totales de votos son extraoficiales hasta el conteo final del condado.</p>
</section>`;
}

// ---- Spanish Section 5 ----
function sectionSpendingES() {
  return `
<section class="section" id="gastos">
  <div class="section-rule"></div>
  <span class="section-num">05</span>
  <h2>En Qu\u00e9 se Gasta el Dinero</h2>

  <p>Los $159.8 millones en gastos del Fondo General de RCSD est\u00e1n dominados por costos de personal: los salarios y beneficios representan el <strong>76.4%</strong> de todo el gasto.</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Categor\u00eda</th><th class="num">Monto</th><th class="num">% del Total</th></tr>
      </thead>
      <tbody>
        <tr><td>Salarios Certificados (maestros, admin.)</td><td class="num">$53,745,487</td><td class="num">33.6%</td></tr>
        <tr><td>Salarios Clasificados (personal de apoyo)</td><td class="num">$28,741,030</td><td class="num">18.0%</td></tr>
        <tr><td>Beneficios de Empleados</td><td class="num">$39,578,283</td><td class="num">24.8%</td></tr>
        <tr><td>Servicios y Gastos Operativos</td><td class="num">$31,271,358</td><td class="num">19.6%</td></tr>
        <tr><td>Libros y Materiales</td><td class="num">$5,772,632</td><td class="num">3.6%</td></tr>
        <tr><td>Gastos de Capital</td><td class="num">$921,767</td><td class="num">0.6%</td></tr>
        <tr class="total-row"><td>Gastos Totales</td><td class="num">$159,841,595</td><td class="num">100%</td></tr>
      </tbody>
    </table>
  </div>
  <p class="source">Fuente: Segundo Informe Interino 2025-26, Gastos del Fondo General (presentaci\u00f3n, l\u00e1minas 7-8).</p>

  <h3>Beneficios: El Costo Oculto</h3>
  <p>Los beneficios de empleados ($39.6M) representan cerca de una cuarta parte de todos los gastos e incluyen contribuciones de pensi\u00f3n CalSTRS (tasa patronal del 19.10%), CalPERS (26.81%), beneficios de salud y otros beneficios estatutarios. Se proyecta que las tasas de CalSTRS y CalPERS sigan subiendo hasta 2027-28 (CalPERS al 26.90%).</p>

  <div class="callout callout-amber">
    <p><strong>Véalo cheque por cheque.</strong> Esos $31.3M en servicios &mdash; y cada otro cheque que emite el distrito &mdash; están detallados en la página de <a href="/proveedores/">Gastos a Proveedores</a>: cada cheque que la junta ha aprobado desde 2020, con búsqueda por proveedor y totales por año. (Solo cuentas por pagar &mdash; excluye la nómina, la mayor parte del presupuesto de arriba.)</p>
  </div>

  <h3>Desglose de Gastos LCAP</h3>
  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Meta LCAP</th><th class="num">Monto</th><th>Enfoque</th></tr>
      </thead>
      <tbody>
        <tr><td>Meta 3: Acad\u00e9micos</td><td class="num">$57.3M</td><td>Instrucci\u00f3n, curr\u00edculo, maestros certificados</td></tr>
        <tr><td>Meta 1: Participaci\u00f3n</td><td class="num">$7.5M</td><td>Asistencia, clima escolar, participaci\u00f3n familiar</td></tr>
        <tr><td>Meta 2: Programas EL</td><td class="num">$3.2M</td><td>Progreso de Estudiantes de Ingl\u00e9s, reclasificaci\u00f3n</td></tr>
        <tr class="total-row"><td>Total LCAP</td><td class="num">$65.9M</td><td></td></tr>
      </tbody>
    </table>
  </div>
</section>`;
}

// ---- Spanish Section 6 ----
function sectionOutlookES() {
  return `
<section class="section" id="perspectiva">
  <div class="section-rule"></div>
  <span class="section-num">06</span>
  <h2>Perspectiva Fiscal Multianual</h2>

  <p>En el Segundo Informe Interino 2025-26 (marzo 2026), la proyecci\u00f3n multianual del distrito cambi\u00f3 de rumbo. Despu\u00e9s de que la Junta adopt\u00f3 un Plan de Estabilizaci\u00f3n Fiscal de $6.04 millones el 4 de febrero de 2026, la perspectiva a tres a\u00f1os <strong>ya no incluye recortes no identificados</strong>: las reducciones est\u00e1n totalmente identificadas e incorporadas, el balance del fondo crece en lugar de encogerse en los dos a\u00f1os de proyecci\u00f3n, y la reserva sube del 3.51% al 5.81% &mdash; c\u00f3modamente por encima del m\u00ednimo legal del 3% en todo el periodo. Sobre esa base, el distrito present\u00f3 una <strong>Certificaci\u00f3n Positiva</strong>, certificando que puede cumplir sus obligaciones financieras para 2025-26 y los dos a\u00f1os siguientes.</p>

  <h3>Proyecci\u00f3n a Tres A\u00f1os</h3>
  <div class="table-wrap">
    <table>
      <thead>
        <tr><th></th><th class="num">2025-26</th><th class="num">2026-27</th><th class="num">2027-28</th></tr>
      </thead>
      <tbody>
        <tr><td>Ingresos Totales</td><td class="num">$158.1M</td><td class="num">$154.2M</td><td class="num">$161.1M</td></tr>
        <tr><td>Gastos Totales</td><td class="num">$159.8M</td><td class="num">$153.5M</td><td class="num">$154.4M</td></tr>
        <tr><td>Estabilizaci\u00f3n Identificada (en gastos)</td><td class="num">&mdash;</td><td class="num">($6.04M)</td><td class="num">($6.11M)</td></tr>
        <tr><td>Cambio Neto en el Balance</td><td class="num" style="color:var(--coral)">($1.7M)</td><td class="num" style="color:var(--green-mid)">+$0.6M</td><td class="num" style="color:var(--green-mid)">+$6.7M</td></tr>
        <tr><td>Balance Inicial</td><td class="num">$17.1M</td><td class="num">$15.4M</td><td class="num">$16.0M</td></tr>
        <tr><td>Balance Final</td><td class="num">$15.4M</td><td class="num">$16.0M</td><td class="num">$22.7M</td></tr>
        <tr><td>% de Reserva</td><td class="num">3.51%</td><td class="num">3.74%</td><td class="num">5.81%</td></tr>
      </tbody>
    </table>
  </div>
  <p class="source">La l\u00ednea de "Estabilizaci\u00f3n Identificada" es el Plan de Estabilizaci\u00f3n Fiscal aprobado por la Junta (4 de feb. 2026), mostrado como una reducci\u00f3n a los gastos. Fuente: Proyecci\u00f3n Multianual del Segundo Informe Interino 2025-26 (25 de marzo de 2026), p. 1.</p>

  <div class="callout">
    <p><strong>Se detuvo el agotamiento de reservas.</strong> Hace un a\u00f1o el balance del fondo se deslizaba hacia el piso del 3% con millones en recortes todav\u00eda sin identificar. Con el plan de estabilizaci\u00f3n en marcha, el Segundo Informe Interino proyecta que el balance final <em>crece</em> de $15.4M a $22.7M para 2027-28 y que la reserva sube al 5.81%. Las presiones estructurales de abajo son reales, pero el distrito ahora tiene un camino cre\u00edble y totalmente identificado hacia el equilibrio &mdash; que no depende del impuesto parcelario de junio 2026 (Medida C), al que le falta poco para los dos tercios mientras contin\u00faa el conteo.</p>
  </div>

  <h3>Plan de Estabilizaci\u00f3n Fiscal</h3>
  <p>El 4 de febrero de 2026, la Junta adopt\u00f3 un Plan de Estabilizaci\u00f3n Fiscal de $6.04 millones ($6.11M continuos) que elimina 31.75 posiciones FTE. Estas son las reducciones ahora reflejadas en la proyecci\u00f3n a tres a\u00f1os de arriba. Incluye cerca de $3.5M por reestructuraci\u00f3n y reducci\u00f3n de servicios en la oficina del distrito, y cerca de $2.9M por ajustes en las escuelas (la mayor parte, 17 puestos docentes de ~$2.3M, absorbida por la disminuci\u00f3n natural de inscripci\u00f3n).</p>

  <h3>Factores del D\u00e9ficit Estructural</h3>
  <div class="trend-item">
    <div class="trend-label trend-down">Inscripci\u00f3n en Descenso</div>
    <p>La inscripci\u00f3n sigue bajando &mdash; de 6,310 en 2025-26 a una proyecci\u00f3n de 6,212 para 2027-28 (el Segundo Informe Interino asume un descenso m\u00e1s suave que las proyecciones anteriores). Cada estudiante perdido representa ~$15,000-$16,000 en financiamiento equivalente a LCFF. Los costos fijos (instalaciones, administraci\u00f3n, transporte) no bajan en la misma proporci\u00f3n.</p>
  </div>
  <div class="trend-item">
    <div class="trend-label trend-down">Costos de Personal en Aumento</div>
    <p>Los aumentos salariales escalonados (1.5% anual), las tasas crecientes de contribuci\u00f3n a pensiones y la inflaci\u00f3n en beneficios de salud impulsan los gastos al alza.</p>
  </div>
  <div class="trend-item">
    <div class="trend-label trend-down">Precipicio de Transferencias RDA</div>
    <p>Los $11 millones en transferencias RDA caen a cero en 2026-27. Esta \u00fanica p\u00e9rdida de ingresos representa el 7% de todo el presupuesto del Fondo General.</p>
  </div>
</section>`;
}

// ---- Spanish Section 7 ----
function sectionSchoolsES() {
  return `
<section class="section" id="escuelas">
  <div class="section-rule"></div>
  <span class="section-num">07</span>
  <h2>Financiamiento por Escuela (Presupuestos SPSA)</h2>

  <p>El presupuesto SPSA de cada escuela captura el gasto <em>suplementario</em> a nivel de sitio. Estos presupuestos <strong>no</strong> incluyen costos operativos base como salarios de maestros e instalaciones.</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Escuela</th><th class="num">Total SPSA</th><th class="num">Por Alumno</th><th class="num">T\u00edtulo I</th><th class="num">Distrito</th><th class="num">PTO/PTA</th><th class="num">Med. U</th><th class="num">Prop 28</th></tr>
      </thead>
      <tbody>
        <tr><td>Orion</td><td class="num">$1,062K</td><td class="num">$1,934</td><td class="num">&mdash;</td><td class="num">$150K</td><td class="num">$721K</td><td class="num">$131K</td><td class="num">$59K</td></tr>
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
        <tr><td>Taft</td><td class="num">$238K</td><td class="num">$733</td><td class="num">$69K</td><td class="num">&mdash;</td><td class="num">&mdash;</td><td class="num">$97K</td><td class="num">$72K</td></tr>
      </tbody>
    </table>
  </div>
  <p class="source">Fuente: Planes Escolares para el Logro Estudiantil (SPSAs) 2025-26. Datos presupuestarios extraídos de las páginas de Resumen del Presupuesto del SPSA.</p>

  <h3>Entendiendo las Fuentes de Financiamiento</h3>
  <p><strong>T\u00edtulo I:</strong> Subsidios federales para escuelas con altos porcentajes de estudiantes de bajos ingresos. Siete escuelas de RCSD reciben fondos de T\u00edtulo I.</p>
  <p><strong>Distrito (ATSI/Categoricos):</strong> Financiamiento adicional del distrito dirigido a escuelas identificadas para Apoyo Adicional Dirigido y Mejora (ATSI). McKinley recibe la mayor asignaci\u00f3n ($610K).</p>
  <p><strong>PTO/PTA:</strong> La recaudaci\u00f3n de fondos de padres var\u00eda dr\u00e1sticamente: el PTA de North Star recauda $326K (58% de su SPSA), mientras que Garfield, Taft, Hoover y Roosevelt reportan $0.</p>
  <p><strong>Medida U:</strong> Fondos del impuesto parcelario distribuidos a las escuelas para enriquecimiento, m\u00fasica, arte y tecnolog\u00eda.</p>
  <p><strong>Prop 28 (Artes):</strong> Fondos estatales de la Proposici\u00f3n 28 (2022) dedicados a la educaci\u00f3n art\u00edstica y musical.</p>

  <div class="callout">
    <p><strong>La situaci\u00f3n de equidad es complicada.</strong> Las escuelas de alta necesidad reciben m\u00e1s financiamiento p\u00fablico categ\u00f3rico (T\u00edtulo I, ATSI) pero a\u00fan no pueden cerrar las brechas de rendimiento. Las escuelas de menor necesidad como North Star reciben el menor financiamiento p\u00fablico por alumno y dependen fuertemente de la recaudaci\u00f3n de padres.</p>
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
    <li><a href="https://www.rcsdk8.net/our-programs-and-services/business-services/district-budget">Presupuesto Adoptado e Informe Interino 2025-26</a></li>
    <li><a href="https://www.rcsdk8.net/our-programs-and-services/business-services/district-funding">Resumen de Financiamiento del Distrito</a></li>
  </ul>

  <h3>Bonos e Impuesto Parcelario</h3>
  <ul style="margin-bottom:1.5rem">
    <li><a href="https://www.rcsdk8.net/our-programs-and-services/school-modernization-and-construction/phase-ii-measure-s">Medida S (Bono 2022) &mdash; Proyectos y Actualizaciones</a></li>
    <li><a href="https://www.rcsdk8.net/our-programs-and-services/school-modernization-and-construction/phase-i-measure-t/measure-t-oversight-committee">Comit\u00e9 de Supervisi\u00f3n Ciudadana de Bonos</a></li>
    <li><a href="https://www.rcsdk8.net/our-programs-and-services/business-services/measure-u-parcel-tax">Impuesto Parcelario Medida U</a></li>
    <li><a href="https://www.rcsdk8.net/our-programs-and-services/business-services/measure-u-parcel-tax/measure-u-exemptions">Exenciones de la Medida U</a></li>
  </ul>

  <h3>LCAP y Rendici\u00f3n de Cuentas</h3>
  <ul style="margin-bottom:1.5rem">
    <li><a href="https://www.rcsdk8.net">LCAP Adoptado 2025-26</a></li>
    <li><a href="https://www.caschooldashboard.org/reports/41689660000000/2024">Panel de Control Escolar de California &mdash; RCSD</a></li>
  </ul>

  <h3>Reuniones de la Mesa Directiva</h3>
  <ul style="margin-bottom:1.5rem">
    <li><a href="https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030397">Portal GAMUT</a> &mdash; Agendas, actas y documentos oficiales</li>
    <li><a href="https://www.youtube.com/@RedwoodCitySchoolDistrict">Canal de YouTube de RCSD</a> &mdash; Grabaciones de reuniones</li>
    <li><a href="/reuniones/">\u00cdndice de Reuniones RCSD.info</a></li>
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
      <div class="glossary-def">El n\u00famero promedio de estudiantes que asisten a la escuela cada d\u00eda, utilizado como base para los c\u00e1lculos de financiamiento estatal. La tasa ADA de RCSD es cerca del 94.70%.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">ATSI</div>
      <div class="glossary-def">Apoyo Adicional Dirigido y Mejora. Una designaci\u00f3n estatal para escuelas con subgrupos de estudiantes en los niveles m\u00e1s bajos de rendimiento.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Basic Aid / Financiado por la Comunidad</div>
      <div class="glossary-def">Un distrito cuyos ingresos por impuestos locales a la propiedad superan el derecho estatal LCFF. RCSD retiene todos los ingresos por impuestos a la propiedad.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">CalPERS</div>
      <div class="glossary-def">Sistema de Jubilaci\u00f3n de Empleados P\u00fablicos de California. Proporciona pensiones para personal clasificado. Tasa del empleador: 26.81%.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">CalSTRS</div>
      <div class="glossary-def">Sistema de Jubilaci\u00f3n de Maestros del Estado de California. Proporciona pensiones para personal certificado. Tasa del empleador: 19.10%.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Gasto Deficitario</div>
      <div class="glossary-def">Cuando los gastos superan los ingresos en un a\u00f1o dado. La diferencia se cubre con el balance del fondo. RCSD tiene un gasto deficitario de $1.7M en 2025-26.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Balance del Fondo</div>
      <div class="glossary-def">Los ahorros acumulados del distrito. Incluye fondos restringidos (designados para prop\u00f3sitos espec\u00edficos) y fondos no restringidos disponibles para uso general.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Fondo General</div>
      <div class="glossary-def">El fondo operativo principal del distrito (Fondo 01). Cubre salarios, beneficios, materiales de instrucci\u00f3n y operaciones diarias.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Bono de Obligaci\u00f3n General (GO)</div>
      <div class="glossary-def">Un bono aprobado por votantes respaldado por impuestos a la propiedad usado exclusivamente para mejoras de capital. Requiere aprobaci\u00f3n del 55% de los votantes.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">LCAP</div>
      <div class="glossary-def">Plan de Control Local y Rendici\u00f3n de Cuentas. Un plan trienal requerido que describe c\u00f3mo el distrito usar\u00e1 los fondos para mejorar los resultados.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">LCFF</div>
      <div class="glossary-def">F\u00f3rmula de Financiamiento de Control Local. El sistema principal de financiamiento escolar de California.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Impuesto Parcelario</div>
      <div class="glossary-def">Un impuesto fijo o basado en f\u00f3rmula por cada parcela de tierra, usado para operaciones del Fondo General. Requiere aprobaci\u00f3n de dos tercios de los votantes.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">RDA (Agencia de Redesarrollo)</div>
      <div class="glossary-def">Antigua agencia municipal cuya disoluci\u00f3n result\u00f3 en pagos de impuestos a la propiedad al distrito. RCSD recibe $11M en 2025-26, pero se espera que esto baje a cero.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Requisito de Reserva (3%)</div>
      <div class="glossary-def">La ley de California requiere que los distritos mantengan una Reserva para Incertidumbre Econ\u00f3mica de al menos 3% de los gastos. En el Segundo Informe Interino 2025-26, la reserva total de RCSD es del 3.51%, por encima del m\u00ednimo legal del 3% y con proyecci\u00f3n de subir al 5.81% para 2027-28.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Restringido vs. No Restringido</div>
      <div class="glossary-def">Los fondos restringidos tienen restricciones legales sobre su uso. Los fondos no restringidos pueden usarse para cualquier prop\u00f3sito educativo legal.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">Subsidios S&amp;C</div>
      <div class="glossary-def">Subsidios Suplementarios y de Concentraci\u00f3n bajo LCFF. Financiamiento estatal adicional para distritos con altos porcentajes de alumnos no duplicados. RCSD recibe $10.2M.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">SPSA</div>
      <div class="glossary-def">Plan Escolar para el Logro Estudiantil. El plan y presupuesto a nivel de sitio de cada escuela para programas suplementarios.</div>
    </div>
    <div class="glossary-item">
      <div class="glossary-term">T\u00edtulo I</div>
      <div class="glossary-def">Programa federal que proporciona financiamiento suplementario a escuelas con altos porcentajes de estudiantes de bajos ingresos. Siete escuelas de RCSD reciben fondos de T\u00edtulo I.</div>
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
    title: 'RCSD Budget Deep Dive 2025-26 \u2014 Redwood City School District',
    description: 'Comprehensive budget guide for the Redwood City School District: revenue sources, school bonds (Measures S & T), parcel tax (Measure U), spending breakdown, and multi-year fiscal outlook.',
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
    title: 'Presupuesto del Distrito RCSD 2025-26 \u2014 Distrito Escolar de Redwood City',
    description: 'Gu\u00eda completa del presupuesto del Distrito Escolar de Redwood City: fuentes de ingresos, bonos escolares, impuesto parcelario, desglose de gastos y perspectiva fiscal multianual.',
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
