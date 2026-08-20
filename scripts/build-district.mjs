#!/usr/bin/env node
/**
 * Generate docs/district/index.html and docs/distrito/index.html
 * from templates/district-{en,es}.html + shared html-parts.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { headMeta, siteNav, siteFooter } from './html-parts.mjs';
import { scanDocuments, prettyDocName, prettySchool, R2_BASE } from './document-inventory.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Scan document inventory once for both EN and ES pages
const documentInventory = scanDocuments(ROOT);

// ---- Page-specific CSS (shared by both EN and ES) ----
const districtCSS = `
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
    /* --green-light is only 3.77:1 on --cream; --green-mid hits 7.48:1 (WCAG AA) */
    color: var(--green-mid);
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

  .source::before {
    content: '';
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

  tbody td.school-name {
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

  /* ---- TREND INDICATORS ---- */
  .trend-up { color: var(--green-mid); }
  .trend-down { color: var(--coral); }
  .trend-flat { color: var(--text-muted); }

  .trend-arrow {
    font-size: 0.75em;
    vertical-align: middle;
    margin-left: 0.2rem;
  }

  /* ---- GOAL CARDS ---- */
  .goal-grid {
    display: grid;
    gap: 1.5rem;
    margin: 1.5rem 0;
  }

  .goal-card {
    border: 1px solid var(--rule);
    padding: 1.5rem;
    background: #fff;
  }

  .goal-card h4 {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--green-light);
    margin-bottom: 0.3rem;
  }

  .goal-card h3 {
    margin-top: 0;
    margin-bottom: 1rem;
    font-size: 1.05rem;
  }

  .goal-card p {
    font-size: 0.9rem;
    max-width: none;
  }

  .goal-metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 0.8rem;
    margin-bottom: 1rem;
  }

  .goal-metric {
    background: var(--cream);
    padding: 0.8rem;
  }

  .goal-metric-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: 0.3rem;
  }

  .goal-metric-row {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .goal-metric-value {
    font-family: 'Fraunces', serif;
    font-size: 1.3rem;
    font-weight: 600;
    line-height: 1;
  }

  .goal-metric-delta {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem;
  }

  .goal-metric-target {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.6rem;
    color: var(--text-muted);
    margin-top: 0.2rem;
  }

  /* ---- TRENDS SECTION ---- */
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

  .trend-item p {
    font-size: 0.92rem;
    max-width: none;
  }

  /* ---- GLOSSARY ---- */
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

  /* ---- MARGIN LINKS ---- */
  .has-margin-link {
    position: relative;
  }

  .margin-link {
    position: absolute;
    left: 660px;
    top: 0;
    width: 160px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.58rem;
    letter-spacing: 0.02em;
    line-height: 1.9;
  }

  .margin-link a {
    display: block;
    color: var(--green-mid);
    text-decoration: none;
    opacity: 0.85;
    transition: opacity 0.2s;
  }

  .margin-link a:hover {
    opacity: 1;
    color: var(--green-deep);
  }

  .margin-link a::before {
    display: inline-block;
    width: 1.2em;
    font-size: 0.9em;
  }

  .margin-link a.watch::before { content: '\\25b6'; }
  .margin-link a.read::before { content: '\\2197'; }

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

  .committee-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 0.75rem;
  }
  .committee-card {
    display: block;
    padding: 0.9rem 1rem;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 10px;
    text-decoration: none;
    color: inherit;
  }
  .committee-card:hover { border-color: var(--green-mid); }
  .committee-name {
    display: block;
    font-family: 'Fraunces', Georgia, serif;
    font-size: 1.05rem;
    color: var(--green-deep);
    margin-bottom: 0.25rem;
  }
  .committee-desc { display: block; font-size: 0.85rem; color: var(--text-muted); line-height: 1.45; }
  .committee-rec {
    display: inline-block;
    margin-top: 0.4rem;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.68rem;
    color: var(--green-mid);
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

  /* ---- RESPONSIVE ---- */
  @media (max-width: 900px) {
    .margin-link { display: none; }
  }

  @media (max-width: 640px) {
    html { font-size: 15px; }
    .header-inner { padding: 3rem 1.2rem 2.5rem; }
    .content { padding: 0 1.2rem 4rem; }
    .header-meta { gap: 1.5rem; }
    .glossary { columns: 1; }
    .toc a { padding: 0.8rem 0.6rem; font-size: 0.6rem; }
    /* Fade the right edge to signal the section nav scrolls horizontally. */
    .toc-inner {
      padding: 0 1.2rem;
      -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 1.4rem), transparent);
      mask-image: linear-gradient(to right, #000 calc(100% - 1.4rem), transparent);
    }
    .goal-metrics { grid-template-columns: 1fr; }
    .doc-school-grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
    .doc-tab { padding: 0.6rem 0.8rem; font-size: 0.6rem; }
  }

  /* page-specific footer overrides */
  .site-footer { font-size: 0.8rem; text-align: left; }
  .footer-nav { margin-top: 1rem; }
  .footer-nav a { font-size: 0.68rem; margin: 0 1.5rem 0 0; }`;

// ---- Board of Trustees / leadership section CSS (appended to districtCSS) ----
const leadershipCSS = `
  .trustee-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(185px, 1fr));
    gap: 1rem;
    margin-top: 1.2rem;
  }
  .trustee-card {
    border: 1px solid var(--rule);
    border-radius: 12px;
    overflow: hidden;
    background: #fff;
    display: flex;
    flex-direction: column;
  }
  .trustee-card:hover { border-color: var(--green-mid); }
  .trustee-photo {
    width: 100%;
    aspect-ratio: 4 / 5;
    object-fit: cover;
    object-position: center top;
    background: var(--green-wash);
    display: block;
  }
  .trustee-photo.placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Fraunces', Georgia, serif;
    font-size: 2.6rem;
    font-weight: 300;
    color: var(--green-mid);
  }
  .trustee-body { padding: 0.85rem 0.95rem 1rem; display: flex; flex-direction: column; gap: 0.28rem; }
  .trustee-area {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.62rem;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--green-mid);
  }
  .trustee-name { font-family: 'Fraunces', Georgia, serif; font-size: 1.08rem; line-height: 1.12; color: var(--green-deep); }
  .trustee-role { font-size: 0.8rem; font-style: italic; color: var(--text-secondary); line-height: 1.3; }
  .trustee-term { font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; color: var(--text-muted); }
  .trustee-assign { font-size: 0.74rem; color: var(--text-muted); line-height: 1.4; margin-top: 0.1rem; }
  .trustee-email { font-size: 0.74rem; margin-top: 0.15rem; }
  .trustee-email a { word-break: break-word; }

  .leadership-subhead {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 1.35rem;
    font-weight: 400;
    color: var(--green-deep);
    margin: 2.4rem 0 0.2rem;
  }
  .leadership-note { font-size: 0.85rem; color: var(--text-muted); margin: 0 0 0.4rem; }
  .supt-grid {
    display: grid;
    /* auto-fill keeps the empty second track when only one superintendent is
       listed (the normal case outside a transition), so the lone card sits at
       the column minimum. 320px keeps a long name like "Dr. Christian J.
       Rubalcaba" off three lines while still fitting two cards side by side
       during a transition. */
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1rem;
    margin-top: 0.9rem;
  }
  .supt-card {
    display: flex;
    gap: 0.9rem;
    align-items: flex-start;
    border: 1px solid var(--rule);
    border-radius: 12px;
    padding: 0.95rem;
    background: #fff;
  }
  .supt-card.incoming { border-color: var(--green-mid); background: var(--green-wash); }
  .supt-photo {
    width: 78px;
    height: 96px;
    flex: 0 0 auto;
    object-fit: cover;
    object-position: center top;
    border-radius: 8px;
    background: var(--green-pale);
  }
  .supt-photo.placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Fraunces', Georgia, serif;
    font-size: 1.5rem;
    color: var(--green-mid);
  }
  .supt-badge {
    display: inline-block;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.56rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 0.12rem 0.45rem;
    border-radius: 999px;
    margin-bottom: 0.3rem;
  }
  .supt-badge.incoming { background: var(--green-mid); color: #fff; }
  .supt-badge.outgoing { background: var(--amber-light); color: var(--green-deep); }
  .supt-name { font-family: 'Fraunces', Georgia, serif; font-size: 1.05rem; line-height: 1.15; color: var(--green-deep); }
  .supt-title { font-size: 0.8rem; font-style: italic; color: var(--text-secondary); }
  .supt-status { font-family: 'IBM Plex Mono', monospace; font-size: 0.68rem; color: var(--text-muted); margin-top: 0.25rem; line-height: 1.35; }
  .supt-links { font-size: 0.74rem; margin-top: 0.3rem; }

  .cabinet-list {
    list-style: none;
    padding: 0;
    margin: 0.7rem 0 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
    gap: 0.45rem 2rem;
  }
  .cabinet-item { font-size: 0.9rem; color: var(--text-secondary); line-height: 1.4; }
  .cabinet-item strong { font-family: 'Fraunces', Georgia, serif; font-weight: 400; color: var(--green-deep); }`;

// ---- i18n labels for documents section ----
const DOC_LABELS = {
  en: {
    docsTitle: 'Documents & Reports',
    docsSubtitle: 'School plans, budgets, and accountability reports archived from official sources.',
    docsBudget: 'Budget',
    docsLcap: 'LCAP',
    docsSpsa: 'School Plans (SPSA)',
    docsSarc: 'School Report Cards',
    docsEnglish: 'English',
    docsSpanish: 'Espa\u00f1ol',
  },
  es: {
    docsTitle: 'Documentos e Informes',
    docsSubtitle: 'Planes escolares, presupuestos e informes de rendici\u00f3n de cuentas archivados de fuentes oficiales.',
    docsBudget: 'Presupuesto',
    docsLcap: 'LCAP',
    docsSpsa: 'Planes Escolares (SPSA)',
    docsSarc: 'Boletas Escolares',
    docsEnglish: 'Ingl\u00e9s',
    docsSpanish: 'Espa\u00f1ol',
  },
};

/**
 * Render the Documents & Reports section HTML for a given language.
 */
function renderDocuments(lang) {
  const L = DOC_LABELS[lang];
  const inv = documentInventory;
  const hasDocs = Object.keys(inv.budget).length || Object.keys(inv.lcap).length ||
    Object.keys(inv.spsa).length || Object.keys(inv.sarc).length;
  if (!hasDocs) return '';

  let html = `<section class="section" id="documents">
  <div class="section-rule"></div>
  <div class="section-num">09</div>
  <h2>${L.docsTitle}</h2>
  <p class="section-subtitle">${L.docsSubtitle}</p>
  <div class="doc-tabs">
    <button class="doc-tab active" data-doc-tab="budget">${L.docsBudget}</button>
    <button class="doc-tab" data-doc-tab="lcap">${L.docsLcap}</button>
    <button class="doc-tab" data-doc-tab="spsa">${L.docsSpsa}</button>
    <button class="doc-tab" data-doc-tab="sarc">${L.docsSarc}</button>
  </div>`;

  // Helper: render doc list, appending meeting date when titles collide
  function renderDocList(docs) {
    // Count how many times each title appears
    const titleCounts = {};
    for (const d of docs) titleCounts[d.title] = (titleCounts[d.title] || 0) + 1;
    let out = '';
    for (const d of docs) {
      const label = titleCounts[d.title] > 1 && d.meetingDate
        ? `${d.title} (${d.meetingDate})` : d.title;
      out += `\n      <a class="doc-link" href="${d.url}" target="_blank" rel="noopener">${label}</a>`;
    }
    return out;
  }

  // Budget panel — grouped by year, sorted by subtype priority
  html += `\n  <div class="doc-panel active" data-doc-panel="budget">`;
  for (const year of Object.keys(inv.budget).sort().reverse()) {
    html += `\n    <h3 class="doc-year-heading">${year}</h3>`;
    html += `\n    <div class="doc-list">`;
    html += renderDocList(inv.budget[year]);
    html += `\n    </div>`;
  }
  html += `\n  </div>`;

  // LCAP panel
  html += `\n  <div class="doc-panel" data-doc-panel="lcap">`;
  for (const year of Object.keys(inv.lcap).sort().reverse()) {
    html += `\n    <h3 class="doc-year-heading">${year}</h3>`;
    html += `\n    <div class="doc-list">`;
    html += renderDocList(inv.lcap[year]);
    html += `\n    </div>`;
  }
  html += `\n  </div>`;

  // SPSA panel — school grid per year
  html += `\n  <div class="doc-panel" data-doc-panel="spsa">`;
  for (const year of Object.keys(inv.spsa).sort().reverse()) {
    html += `\n    <h3 class="doc-year-heading">${year}</h3>`;
    html += `\n    <div class="doc-school-grid">`;
    for (const s of inv.spsa[year]) {
      html += `\n      <a class="doc-school-link" href="${s.url}" target="_blank" rel="noopener">${prettySchool(s.school)}</a>`;
    }
    html += `\n    </div>`;
  }
  html += `\n  </div>`;

  // SARC panel — board-presented SARCs + language-specific versions from artifacts
  html += `\n  <div class="doc-panel" data-doc-panel="sarc">`;
  for (const year of Object.keys(inv.sarc).sort().reverse()) {
    const yearData = inv.sarc[year];
    html += `\n    <h3 class="doc-year-heading">${year}</h3>`;

    // Board-presented SARCs (from document-index.json)
    if (yearData.schools?.length) {
      html += `\n    <div class="doc-school-grid">`;
      for (const s of yearData.schools) {
        html += `\n      <a class="doc-school-link" href="${s.url}" target="_blank" rel="noopener">${prettySchool(s.school)}</a>`;
      }
      html += `\n    </div>`;
    }

    // Language-specific SARCs from artifacts/documents/sarc/
    const englishSarcs = Object.values(yearData).filter(v => v?.lang === 'english');
    const spanishSarcs = Object.values(yearData).filter(v => v?.lang === 'spanish');
    if (englishSarcs.length) {
      html += `\n    <div class="doc-lang-label">${L.docsEnglish}</div>`;
      html += `\n    <div class="doc-school-grid">`;
      for (const s of englishSarcs.sort((a, b) => a.school.localeCompare(b.school))) {
        html += `\n      <a class="doc-school-link" href="${s.url}" target="_blank" rel="noopener">${prettySchool(s.school)}</a>`;
      }
      html += `\n    </div>`;
    }
    if (spanishSarcs.length) {
      html += `\n    <div class="doc-lang-label">${L.docsSpanish}</div>`;
      html += `\n    <div class="doc-school-grid">`;
      for (const s of spanishSarcs.sort((a, b) => a.school.localeCompare(b.school))) {
        html += `\n      <a class="doc-school-link" href="${s.url}" target="_blank" rel="noopener">${prettySchool(s.school)}</a>`;
      }
      html += `\n    </div>`;
    }
  }
  html += `\n  </div>`;

  html += `\n</section>`;
  return html;
}

// ---- Page configs ----
const PAGES = [
  {
    lang: 'en',
    template: 'templates/district-en.html',
    outFile: 'docs/district/index.html',
    title: 'RCSD District Overview 2025-26 \u2014 Redwood City School District',
    description: 'Budget, performance, enrollment, and governance overview for the Redwood City School District 2025-26 school year.',
    ogTitle: 'RCSD District Overview 2025-26',
    ogDesc: 'Budget, performance, enrollment, and governance overview for the Redwood City School District.',
    canonical: 'https://rcsd.info/district/',
    ogLocale: 'en_US',
    hreflang: [
      { lang: 'en', href: 'https://rcsd.info/district/' },
      { lang: 'es', href: 'https://rcsd.info/distrito/' },
    ],
    altLangHref: '/distrito/',
  },
  {
    lang: 'es',
    template: 'templates/district-es.html',
    outFile: 'docs/distrito/index.html',
    title: 'Resumen del Distrito RCSD 2025-26 \u2014 Distrito Escolar de Redwood City',
    description: 'Presupuesto, rendimiento, inscripci\u00f3n y gobernanza del Distrito Escolar de Redwood City para el a\u00f1o escolar 2025-26.',
    ogTitle: 'Resumen del Distrito RCSD 2025-26',
    ogDesc: 'Presupuesto, rendimiento, inscripci\u00f3n y gobernanza del Distrito Escolar de Redwood City.',
    canonical: 'https://rcsd.info/distrito/',
    ogLocale: 'es_US',
    hreflang: [
      { lang: 'es', href: 'https://rcsd.info/distrito/' },
      { lang: 'en', href: 'https://rcsd.info/district/' },
    ],
    altLangHref: '/district/',
  },
];

// ---- JSON-LD: school district entity ----
// GovernmentOrganization is the Google-recognized organization type;
// additionalType points at the more specific schema.org/SchoolDistrict.
// Address comes from data/properties.json (slug: district-office).
const districtOfficeAddress = (() => {
  try {
    const props = JSON.parse(readFileSync(resolve(ROOT, 'data/properties.json'), 'utf-8'));
    return (props.properties || []).find(p => p.slug === 'district-office')?.address || null;
  } catch { return null; }
})();

function districtJsonLd(lang) {
  // "750 Bradford Street, Redwood City, CA 94063" → structured PostalAddress
  let address = { '@type': 'PostalAddress', addressLocality: 'Redwood City', addressRegion: 'CA', addressCountry: 'US' };
  const m = districtOfficeAddress?.match(/^(.+?),\s*(.+?),\s*([A-Z]{2})\s+(\d{5})$/);
  if (m) {
    address = { '@type': 'PostalAddress', streetAddress: m[1], addressLocality: m[2], addressRegion: m[3], postalCode: m[4], addressCountry: 'US' };
  }
  const entity = {
    '@context': 'https://schema.org',
    '@type': 'GovernmentOrganization',
    additionalType: 'https://schema.org/SchoolDistrict',
    name: 'Redwood City School District',
    alternateName: lang === 'es' ? ['RCSD', 'Distrito Escolar de Redwood City'] : 'RCSD',
    url: 'https://www.rcsdk8.net',
    logo: 'https://data.rcsd.info/logos/district.jpg',
    address,
    sameAs: [
      'https://www.rcsdk8.net',
      'https://www.youtube.com/@RedwoodCitySchoolDistrict',
    ],
  };
  return `<script type="application/ld+json">\n${JSON.stringify(entity, null, 2)}\n</script>`;
}

// ---- Board of Trustees / district leadership section ----
const LEADERSHIP_LABELS = {
  en: {
    title: 'Board of Trustees',
    subtitle: 'RCSD is governed by five trustees, each elected from a geographic trustee area to a four-year term.',
    area: 'Trustee Area',
    term: 'Term',
    oversees: 'Oversees',
    superTitle: 'Superintendent',
    superNote: 'The district is in a superintendent transition.',
    superNoteSettled: '',
    cabinetTitle: 'District Cabinet',
    leadershipTitle: 'District Leadership',
    badgeCurrent: 'Current',
    badgeIncoming: 'Incoming',
    contract: 'Employment agreement →',
    bio: 'Biography →',
    roster: 'Full board roster & bios on rcsdk8.net →',
  },
  es: {
    title: 'Mesa Directiva',
    subtitle: 'El RCSD es gobernado por cinco síndicos, cada uno elegido por un área electoral geográfica para un período de cuatro años.',
    area: 'Área Electoral',
    term: 'Período',
    oversees: 'Supervisa',
    superTitle: 'Superintendente',
    superNote: 'El distrito está en una transición de superintendente.',
    superNoteSettled: '',
    cabinetTitle: 'Gabinete del Distrito',
    leadershipTitle: 'Liderazgo del Distrito',
    badgeCurrent: 'Actual',
    badgeIncoming: 'Entrante',
    contract: 'Contrato de empleo →',
    bio: 'Biografía →',
    roster: 'Directorio completo de la Mesa Directiva en rcsdk8.net →',
  },
};

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const initials = (name) => name.replace(/Dr\.|Ed\.D\.|,/g, '').trim().split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();

/** Render the Board of Trustees + superintendent transition + cabinet section. */
function renderLeadership(lang) {
  const file = resolve(ROOT, 'data/trustees.json');
  if (!existsSync(file)) return '';
  const data = JSON.parse(readFileSync(file, 'utf-8'));
  const L = LEADERSHIP_LABELS[lang];
  const es = lang === 'es';

  // --- Trustee cards (sorted by area) ---
  const trustees = [...(data.trustees || [])].sort((a, b) => a.area - b.area);
  const cards = trustees.map(t => {
    const role = es ? t.roleEs : t.roleEn;
    const assigns = (es ? t.assignmentsEs : t.assignmentsEn) || [];
    const photo = t.photo
      ? `<img class="trustee-photo" src="${R2_BASE}/trustees/${t.photo}" alt="${esc(t.name)}" loading="lazy" decoding="async">`
      : `<div class="trustee-photo placeholder">${esc(initials(t.name))}</div>`;
    return `
      <div class="trustee-card">
        ${photo}
        <div class="trustee-body">
          <span class="trustee-area">${L.area} ${t.area}</span>
          <span class="trustee-name">${esc(t.name)}</span>
          <span class="trustee-role">${esc(role)}</span>
          <span class="trustee-term">${L.term} ${t.termStartYear}–${t.termEndYear}</span>
          ${assigns.length ? `<span class="trustee-assign">${L.oversees}: ${assigns.map(esc).join(', ')}</span>` : ''}
          ${t.email ? `<span class="trustee-email"><a href="mailto:${esc(t.email)}">${esc(t.email)}</a></span>` : ''}
        </div>
      </div>`;
  }).join('');

  // --- Superintendent transition cards ---
  const suptCard = (s, kind) => {
    if (!s) return '';
    const badge = kind === 'incoming' ? L.badgeIncoming : L.badgeCurrent;
    const title = es ? s.titleEs : s.titleEn;
    const status = es ? s.statusEs : s.statusEn;
    const photo = s.photo
      ? `<img class="supt-photo" src="${R2_BASE}/trustees/${s.photo}" alt="${esc(s.name)}" loading="lazy" decoding="async">`
      : `<div class="supt-photo placeholder">${esc(initials(s.name))}</div>`;
    return `
      <div class="supt-card${kind === 'incoming' ? ' incoming' : ''}">
        ${photo}
        <div class="supt-meta">
          <span class="supt-badge ${kind === 'incoming' ? 'incoming' : 'outgoing'}">${badge}</span>
          <span class="supt-name">${esc(s.name)}</span>
          <span class="supt-title">${esc(title)}</span>
          <div class="supt-status">${esc(status)}</div>
          ${s.email ? `<span class="trustee-email"><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></span>` : ''}
          ${(s.bioUrl || s.contractUrl) ? `<div class="supt-links">${s.bioUrl ? `<a href="${esc(s.bioUrl)}" target="_blank" rel="noopener">${L.bio}</a>` : ''}${s.bioUrl && s.contractUrl ? ' · ' : ''}${s.contractUrl ? `<a href="${esc(s.contractUrl)}" target="_blank" rel="noopener">${L.contract}</a>` : ''}</div>` : ''}
        </div>
      </div>`;
  };
  const sup = data.superintendent || {};
  // The transition note is conditional on an `incoming` record actually being
  // present. It used to render unconditionally, so /district told readers the
  // district was "in a superintendent transition" for seven weeks after the
  // transition finished. A date-conditional sentence that nothing ever moves
  // is a stale fact waiting to happen — tie it to the data instead.
  const note = sup.incoming ? L.superNote : L.superNoteSettled;
  const suptSection = (sup.current || sup.incoming) ? `
  <h3 class="leadership-subhead">${L.superTitle}</h3>${note ? `
  <p class="leadership-note">${note}</p>` : ''}
  <div class="supt-grid">${suptCard(sup.current, 'current')}${suptCard(sup.incoming, 'incoming')}
  </div>` : '';

  // --- Cabinet + broader leadership lists ---
  const renderRoster = (people, title) => people.length ? `
  <h3 class="leadership-subhead">${title}</h3>
  <ul class="cabinet-list">${people.map(c => `
    <li class="cabinet-item"><strong>${esc(c.name)}</strong> — ${esc(es ? c.titleEs : c.titleEn)}</li>`).join('')}
  </ul>` : '';
  const cabinetSection = renderRoster(data.cabinet || [], L.cabinetTitle);
  const directorsSection = renderRoster(data.directors || [], L.leadershipTitle);

  const rosterUrl = data._metadata?.source;

  return `<section class="section" id="trustees">
  <div class="section-rule"></div>
  <div class="section-num">02</div>
  <h2>${L.title}</h2>
  <p class="section-subtitle">${L.subtitle}</p>
  <div class="trustee-grid">${cards}
  </div>
${suptSection}
${cabinetSection}
${directorsSection}
${rosterUrl ? `\n  <p style="margin-top:1.6rem"><a class="doc-link" href="${esc(rosterUrl)}" target="_blank" rel="noopener">${L.roster}</a></p>` : ''}
</section>`;
}

const COMMITTEE_LABELS = {
  en: { title: 'Committees & Oversight', subtitle: 'Standing district and school committees, with meeting recordings and transcripts where available.', viewAll: 'View all committees →', prefix: 'committees', recordings: 'recordings' },
  es: { title: 'Comités y Supervisión', subtitle: 'Comités permanentes del distrito y de las escuelas, con grabaciones y transcripciones de reuniones cuando están disponibles.', viewAll: 'Ver todos los comités →', prefix: 'comites', recordings: 'grabaciones' },
};

/** Render the Committees & Oversight section from data/committees/*.json. */
function renderCommittees(lang) {
  const dir = resolve(ROOT, 'data/committees');
  if (!existsSync(dir)) return '';
  const committees = readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(resolve(dir, f), 'utf-8')))
    .sort((a, b) => (a.nameEn || '').localeCompare(b.nameEn || ''));
  if (!committees.length) return '';
  const L = COMMITTEE_LABELS[lang];
  const cards = committees.map(c => {
    const name = lang === 'es' ? c.nameEs : c.nameEn;
    const desc = (lang === 'es' ? c.descriptionEs : c.descriptionEn) || '';
    const rec = (c.meetings || []).filter(m => m.youtube).length;
    return `\n    <a class="committee-card" href="/${L.prefix}/${c.id}/">
      <span class="committee-name">${name}</span>
      ${desc ? `<span class="committee-desc">${desc.slice(0, 160)}</span>` : ''}
      ${rec ? `<span class="committee-rec">${rec} ${L.recordings}</span>` : ''}
    </a>`;
  }).join('');
  return `<section class="section" id="committees">
  <div class="section-rule"></div>
  <div class="section-num">10</div>
  <h2>${L.title}</h2>
  <p class="section-subtitle">${L.subtitle}</p>
  <div class="committee-grid">${cards}
  </div>
  <p style="margin-top:1rem"><a class="doc-link" href="/${L.prefix}/">${L.viewAll}</a></p>
</section>`;
}

for (const page of PAGES) {
  const bodyContent = readFileSync(resolve(ROOT, page.template), 'utf-8');
  const documentsSection = renderDocuments(page.lang);
  const committeesSection = renderCommittees(page.lang);
  const leadershipSection = renderLeadership(page.lang);

  const html = `<!DOCTYPE html>
<html lang="${page.lang}">
<head>
${headMeta({
  title: page.title,
  description: page.description,
  canonical: page.canonical,
  ogLocale: page.ogLocale,
  ogImageKey: `page-district${page.lang === 'es' ? '-es' : ''}`,
  hreflang: page.hreflang,
  jsonLd: districtJsonLd(page.lang),
  pageCSS: districtCSS + leadershipCSS,
})}
</head>
<body>

${siteNav({ activePage: 'district', lang: page.lang, altLangHref: page.altLangHref })}

${bodyContent.replace('<!-- LEADERSHIP_SECTION -->', leadershipSection)}

${documentsSection}

${committeesSection}

</main>

${siteFooter({ lang: page.lang })}

<script>
(function() {
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

  mkdirSync(resolve(ROOT, dirname(page.outFile)), { recursive: true });
  writeFileSync(resolve(ROOT, page.outFile), html);
  console.log(`Wrote ${page.outFile}`);
}
