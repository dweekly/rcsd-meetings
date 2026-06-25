#!/usr/bin/env node
/**
 * build-warrants-page.mjs — public bilingual vendor-spending page (PR4).
 *
 * Aggregates the committed per-register line items (data/warrants/*.json) into per-vendor
 * fiscal-year spend and renders /vendors/ (EN) + /proveedores/ (ES). Reads from JSON (not
 * warrants.db) so the site build is reproducible without the local database.
 *
 * Exclusion rules mirror build-warrants-db.mjs: cancelled/voided checks and the subset register
 * in each overlapping pair are dropped, so totals are "money actually disbursed".
 *
 * Output:
 *   docs/vendors/vendor-spend.json   full per-vendor aggregate (fetched by the page for search)
 *   docs/vendors/index.html          EN
 *   docs/proveedores/index.html      ES
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { headMeta, siteNav, siteFooter } from './html-parts.mjs';
import { prettyVendorName, isCommaName, personMatchKey, isPlainPersonCandidate, titleCasePerson } from './lib/warrant-parsers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const WARR_DIR = resolve(ROOT, 'data/warrants');

function fiscalYear(mdy) {
  const m = (mdy || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  let y = +m[3]; if (y < 100) y += 2000;
  const start = +m[1] >= 7 ? y : y - 1;
  return `FY${start}-${String(start + 1).slice(2)}`;
}
function ymd(mdy) {
  const m = (mdy || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  let y = +m[3]; if (y < 100) y += 2000;
  return `${y}-${String(+m[1]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`;
}

function loadCategories() {
  const p = resolve(ROOT, 'data/warrant-categories.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).categories : [];
}
// Assign ONE category id by first-match-wins keyword (individuals → reimbursements).
function categorize(name, type, categories) {
  if (type === 'individual') return 'reimbursements';
  const up = (name || '').toUpperCase();
  for (const c of categories) if (c.patterns.some((pat) => up.includes(pat))) return c.id;
  return 'other';
}

// Manual payee overrides (e.g. contractors paid by personal name → real counterparty + category),
// keyed by person-match-key. See data/warrant-payee-overrides.json.
function loadOverrides() {
  const p = resolve(ROOT, 'data/warrant-payee-overrides.json');
  if (!existsSync(p)) return {};
  const { overrides } = JSON.parse(readFileSync(p, 'utf8'));
  return Object.fromEntries(Object.entries(overrides || {}).map(([k, v]) => [k.toUpperCase(), v]));
}

function loadAliasMap() {
  const p = resolve(ROOT, 'data/warrant-vendor-aliases.json');
  const map = new Map();
  if (existsSync(p)) {
    const { aliases } = JSON.parse(readFileSync(p, 'utf8'));
    for (const [canon, keys] of Object.entries(aliases || {})) for (const k of keys) map.set(k.toUpperCase(), canon);
  }
  return map;
}

// Subset register in each overlapping pair → superseded (excluded), matching the DB builder.
function supersededSet(index) {
  const byMonth = new Map(index.registers.map((r) => [r.month, r]));
  const out = new Set();
  for (const [a, b] of (index._metadata.periodOverlaps || [])) {
    const ra = byMonth.get(a), rb = byMonth.get(b);
    if (!ra?.period || !rb?.period) continue;
    const fa = ymd(ra.period.from), ta = ymd(ra.period.to), fb = ymd(rb.period.from), tb = ymd(rb.period.to);
    if (!fa || !ta || !fb || !tb) continue;
    if (fa <= fb && ta >= tb) out.add(b);
    else if (fb <= fa && tb >= ta) out.add(a);
  }
  return out;
}

function aggregate() {
  const index = JSON.parse(readFileSync(resolve(ROOT, 'data/warrants-index.json'), 'utf8'));
  const alias = loadAliasMap();
  const superseded = supersededSet(index);
  // Per-vendor detail is only trustworthy where the line items reconcile to the printed total.
  // Registers that don't (mostly 2011–2013 scanned/OCR-partial, where OCR misses rows) are
  // excluded so we never undercount a vendor with partial detail.
  const usable = new Set(index.registers
    .filter((r) => r.parseStatus === 'reconciled' || r.parseStatus === 'minor-mismatch')
    .map((r) => r.month));
  const FY_FLOOR = '2014-07-01'; // first full clean fiscal year (FY2014-15); CA FY begins July 1

  // Pass 1: most-common spelling per key (readable canonical), AND a roster of known individuals
  // (comma-format "Surname, Given" names) so we can recover the same people in the older "GIVEN
  // SURNAME" registers (cross-era employee-reimbursement matching).
  const spell = new Map();
  const personRoster = new Set();
  const files = readdirSync(WARR_DIR).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const j = JSON.parse(readFileSync(resolve(WARR_DIR, f), 'utf8'));
    if (!usable.has(j._metadata.month)) continue;
    for (const r of (j.lineItems || [])) {
      if (!r.payeeKey || (ymd(r.dateIssued) || '') < FY_FLOOR) continue;
      if (!spell.has(r.payeeKey)) spell.set(r.payeeKey, new Map());
      spell.get(r.payeeKey).set(r.payee, (spell.get(r.payeeKey).get(r.payee) || 0) + 1);
      if (isCommaName(r.payee)) { const k = personMatchKey(r.payee); if (k) personRoster.add(k); }
    }
  }
  const display = new Map();
  for (const [k, sc] of spell) display.set(k, prettyVendorName(sc));
  const canonicalFor = (key) => alias.get(key) || display.get(key) || key;
  // True for comma-format names and for plain "GIVEN SURNAME" names matching a rostered person.
  const individualOf = (payee) => {
    if (isCommaName(payee)) return personMatchKey(payee);
    if (isPlainPersonCandidate(payee)) { const k = personMatchKey(payee); if (k && personRoster.has(k)) return k; }
    return null;
  };

  const overrides = loadOverrides();
  const vendors = new Map();
  const allFy = new Set();
  let grand = 0, payCount = 0;
  let minDate = '9999', maxDate = '0000';
  for (const f of files) {
    const j = JSON.parse(readFileSync(resolve(WARR_DIR, f), 'utf8'));
    if (superseded.has(j._metadata.month) || !usable.has(j._metadata.month)) continue;
    for (const r of (j.lineItems || [])) {
      if (/^(Cancelled|Voided)/i.test(r.status || '')) continue;
      if ((ymd(r.dateIssued) || '') < FY_FLOOR) continue;
      const fy = fiscalYear(r.dateIssued); if (!fy) continue;
      allFy.add(fy);
      // Manual overrides win (contractors paid by personal name); then individuals (incl. cross-era
      // matches) group under one "Given Surname" person; everything else is a business.
      const personKey = individualOf(r.payee);
      const ov = personKey ? overrides[personKey] : null;
      const canon = ov ? ov.canonical : (personKey ? titleCasePerson(personKey) : canonicalFor(r.payeeKey));
      let v = vendors.get(canon);
      if (!v) { v = { name: canon, type: (ov || !personKey) ? 'vendor' : 'individual', forcedCat: ov?.category || null, total: 0, checks: 0, byFy: {} }; vendors.set(canon, v); }
      v.total += r.amount; v.checks++; v.byFy[fy] = (v.byFy[fy] || 0) + r.amount;
      if (!ov && !personKey && r.payeeType === 'vendor') v.type = 'vendor';
      grand += r.amount; payCount++;
      const d = ymd(r.dateIssued); if (d) { if (d < minDate) minDate = d; if (d > maxDate) maxDate = d; }
    }
  }
  const categories = loadCategories();
  const list = [...vendors.values()]
    .map((v) => ({
      name: v.name, type: v.type, checks: v.checks,
      cat: v.forcedCat || categorize(v.name, v.type, categories),
      total: Math.round(v.total * 100) / 100,
      byFy: Object.fromEntries(Object.entries(v.byFy).map(([k, x]) => [k, Math.round(x * 100) / 100])),
    }))
    .sort((a, b) => b.total - a.total);
  const fyList = [...allFy].sort();
  const registers = index.registers.filter((r) => !superseded.has(r.month));

  // Spend totals per category (for the summary chips).
  const catTotals = new Map();
  for (const v of list) catTotals.set(v.cat, (catTotals.get(v.cat) || 0) + v.total);
  const catList = [
    ...categories.map((c) => ({ id: c.id, label: c.label })),
    { id: 'reimbursements', label: { en: 'Employee reimbursements', es: 'Reembolsos a empleados' } },
    { id: 'other', label: { en: 'Other / uncategorized', es: 'Otros / sin categoría' } },
  ].map((c) => ({ ...c, total: Math.round((catTotals.get(c.id) || 0) * 100) / 100 }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);

  // District-wide AP spend per fiscal year (for the hero chart). First/last FY are partial.
  const totalByFy = {};
  for (const v of list) for (const [fy, amt] of Object.entries(v.byFy)) totalByFy[fy] = (totalByFy[fy] || 0) + amt;
  for (const k of Object.keys(totalByFy)) totalByFy[k] = Math.round(totalByFy[k] * 100) / 100;
  // Construction & facilities is overwhelmingly bond-funded capital and is lumpy year to year;
  // splitting it out keeps the operating baseline from looking like it tripled.
  const constructionByFy = {};
  for (const v of list) if (v.cat === 'construction') for (const [fy, amt] of Object.entries(v.byFy)) constructionByFy[fy] = (constructionByFy[fy] || 0) + amt;
  for (const k of Object.keys(constructionByFy)) constructionByFy[k] = Math.round(constructionByFy[k] * 100) / 100;
  // Full category × fiscal-year matrix, for the rich per-year hover breakdown.
  const categoryByFy = {};
  for (const v of list) for (const [fy, amt] of Object.entries(v.byFy)) {
    (categoryByFy[fy] ||= {})[v.cat] = (categoryByFy[fy][v.cat] || 0) + amt;
  }
  for (const fy of Object.keys(categoryByFy)) for (const c of Object.keys(categoryByFy[fy])) {
    categoryByFy[fy][c] = Math.round(categoryByFy[fy][c] * 100) / 100;
  }

  // The dataset is floored at the start of the first fiscal year, so only the final (current,
  // in-progress) fiscal year is partial — unless the first year's data starts well after its July 1.
  const partialFy = [fyList[fyList.length - 1]];
  if (minDate > `${fyList[0].slice(2, 6)}-07-08`) partialFy.push(fyList[0]);

  return {
    vendors: list, fyList, categories: catList, totalByFy, constructionByFy, categoryByFy,
    partialFy,
    stats: {
      grand: Math.round(grand * 100) / 100, payCount, vendorCount: list.length,
      registerCount: registers.length, minDate, maxDate,
    },
  };
}

// Tiny inline bar sparkline of spend across fiscal years (each vendor scaled to its own max).
// Each bar carries a native <title> so hovering a year shows that year's figure.
function sparkSvg(byFy, fyList, fmtLoc, color = '#2f6b3f') {
  const vals = fyList.map((fy) => byFy[fy] || 0);
  const max = Math.max(1, ...vals);
  const bw = 7, gap = 2, h = 22, pad = 2;
  const bars = vals.map((v, i) => {
    const tip = `${fyList[i].replace('FY', 'FY ')}: ${fmtUsd(fmtLoc, v)}`;
    const x = i * (bw + gap);
    if (v > 0) {
      const bh = Math.max(1.5, Math.round((h - pad) * (v / max)));
      return `<rect x="${x}" y="${h - bh}" width="${bw}" height="${bh}" rx="1" fill="${color}"><title>${tip}</title></rect>`;
    }
    return `<rect x="${x}" y="0" width="${bw}" height="${h}" fill="transparent"><title>${tip}</title></rect>` +
      `<rect x="${x}" y="${h - 1.5}" width="${bw}" height="1.5" rx="1" fill="#cdddd2"/>`;
  }).join('');
  const w = fyList.length * (bw + gap);
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-hidden="true">${bars}</svg>`;
}

const T = {
  en: {
    lang: 'en', loc: 'en_US', nav: 'vendors', alt: '/proveedores/', other: '/proveedores/',
    title: 'Vendor Spending — RCSD Open Data',
    desc: 'Every check the Redwood City School District has written since 2020, searchable by vendor and fiscal year. Compiled from board-ratified warrant registers.',
    kicker: 'District spending', h1: 'Vendor Spending', crumbHref: '/budget/', crumb: 'Budget',
    intro: 'Each month the Board of Trustees ratifies a <strong>warrant register</strong> — the list of every check the district issued. This page indexes them into one searchable database so you can see how much the district pays any vendor, and how that changes year over year.',
    statSpend: 'Total disbursed', statVendors: 'Distinct payees', statRegisters: 'Warrant registers', statPeriod: 'Period',
    coverageNote: 'These are <strong>accounts-payable warrants</strong> — payments to vendors, contractors, and benefits. They do <strong>not</strong> include employee salaries (payroll), the district\'s single largest cost, which is paid on separate payroll warrants.',
    trendHeading: 'Warrant spend by fiscal year', opLabel: 'Operating', conLabel: 'Construction & facilities',
    partialNote: '∗ the current fiscal year is still in progress. Construction &amp; facilities is largely bond-funded capital (Measures T and S) and is lumpy year to year; the operating segment is the steadier baseline.',
    searchLabel: 'Search for a vendor', searchPh: 'e.g. Van Pelt, Sodexo, PG&E…',
    thRank: '#', thVendor: 'Payee', thTotal: 'Total paid', thChecks: 'Checks', thTrend: 'Trend by year',
    catHeading: 'Spend by category', allCat: 'All', catNote: 'Categories are a rough name-based grouping, not an accounting classification.',
    topHeading: 'Largest payees', showingAll: 'Showing', matches: 'payees', noMatch: 'No payees match',
    perFy: 'By fiscal year', indiv: 'individual', vendorTag: 'vendor',
    methH: 'How this was built', method: 'Line items were extracted from each register PDF and reconciled against the register\'s own printed grand total. Cancelled and voided checks (no money disbursed) are excluded. Spending is grouped by California fiscal year (July–June). Vendor-name spellings are rolled up via a curated alias list, so one payee isn\'t split across variants.',
    caveatH: 'Data notes',
    caveatNames: 'Registers list individual employee expense/mileage reimbursements by name alongside business vendors — these are public records. Each payee is tagged <em>vendor</em> or <em>individual</em>.',
    caveat2021: 'Three months (May–July 2021) print a monthly total that over-counts the checks listed; this page uses the actual checks, which are complete.',
    caveatReimb: 'The two payment systems print employee names differently, so reimbursements before mid-2025 are matched to staff by name across both. Employees who left before then may not be separated from small vendors, so older reimbursement totals are a floor.',
    sourceH: 'Sources & raw data', source: 'Built from the warrant registers attached to board meeting agendas. The machine-readable data is public: ',
    dataLink: 'vendor aggregate (JSON)', registersLink: 'per-register line items',
    fmtLoc: 'en-US',
  },
  es: {
    lang: 'es', loc: 'es_US', nav: 'vendors', alt: '/vendors/', other: '/vendors/',
    title: 'Gastos a Proveedores — Datos Abiertos de RCSD',
    desc: 'Cada cheque que el Distrito Escolar de Redwood City ha emitido desde 2020, con búsqueda por proveedor y año fiscal. Compilado de los registros de cheques aprobados por la junta.',
    kicker: 'Gastos del distrito', h1: 'Gastos a Proveedores', crumbHref: '/presupuesto/', crumb: 'Presupuesto',
    intro: 'Cada mes la Junta de Síndicos aprueba un <strong>registro de cheques</strong> (warrant register) — la lista de cada cheque que emitió el distrito. Esta página los reúne en una base de datos con búsqueda para que veas cuánto le paga el distrito a cualquier proveedor, y cómo cambia año con año.',
    statSpend: 'Total pagado', statVendors: 'Beneficiarios distintos', statRegisters: 'Registros de cheques', statPeriod: 'Período',
    coverageNote: 'Estos son <strong>cheques de cuentas por pagar</strong> — pagos a proveedores, contratistas y beneficios. <strong>No</strong> incluyen los salarios del personal (nómina), el mayor gasto del distrito, que se paga en cheques de nómina aparte.',
    trendHeading: 'Gasto en cheques por año fiscal', opLabel: 'Operación', conLabel: 'Construcción e instalaciones',
    partialNote: '∗ el año fiscal actual aún está en curso. La construcción e instalaciones es en gran parte capital financiado por bonos (Medidas T y S) y varía mucho de un año a otro; la parte de operación es la base más estable.',
    searchLabel: 'Busca un proveedor', searchPh: 'p. ej. Van Pelt, Sodexo, PG&E…',
    thRank: '#', thVendor: 'Beneficiario', thTotal: 'Total pagado', thChecks: 'Cheques', thTrend: 'Tendencia por año',
    catHeading: 'Gasto por categoría', allCat: 'Todas', catNote: 'Las categorías son una agrupación aproximada por nombre, no una clasificación contable.',
    topHeading: 'Mayores beneficiarios', showingAll: 'Mostrando', matches: 'beneficiarios', noMatch: 'Ningún beneficiario coincide',
    perFy: 'Por año fiscal', indiv: 'individuo', vendorTag: 'proveedor',
    methH: 'Cómo se hizo', method: 'Cada línea se extrajo del PDF de cada registro y se cuadró contra el total impreso del propio registro. Los cheques cancelados o anulados (sin dinero pagado) se excluyen. El gasto se agrupa por año fiscal de California (julio–junio). Las variantes de nombre se unifican con una lista de alias para que un beneficiario no se divida en versiones distintas.',
    caveatH: 'Notas sobre los datos',
    caveatNames: 'Los registros incluyen reembolsos de gastos/millaje de empleados por nombre junto con proveedores comerciales — son documentos públicos. Cada beneficiario se marca como <em>proveedor</em> o <em>individuo</em>.',
    caveat2021: 'Tres meses (mayo–julio de 2021) imprimen un total mensual que sobrecuenta los cheques listados; esta página usa los cheques reales, que están completos.',
    caveatReimb: 'Los dos sistemas de pago escriben los nombres de empleados de forma distinta, así que los reembolsos antes de mediados de 2025 se identifican por nombre entre ambos. Las personas que se fueron antes podrían no separarse de proveedores pequeños, por lo que los totales antiguos son un mínimo.',
    sourceH: 'Fuentes y datos sin procesar', source: 'Compilado de los registros de cheques adjuntos a las agendas de la junta. Los datos legibles por máquina son públicos: ',
    dataLink: 'agregado por proveedor (JSON)', registersLink: 'líneas por registro',
    fmtLoc: 'es-MX',
  },
};

// Category → emoji, shown as a scannable icon column (label on hover / for screen readers).
const ICONS = {
  charter: '🎓', benefits: '🪙', utilities: '💡', food: '🍎', 'sped-health': '🩺',
  staffing: '👥', construction: '🏗️', instruction: '📚', technology: '💻',
  professional: '⚖️', government: '🏛️', afterschool: '⚽', transportation: '🚌',
  reimbursements: '🧾', other: '▫️',
};
const catIcon = (id) => ICONS[id] || '▫️';

function fmtUsd(loc, n) {
  return new Intl.NumberFormat(loc, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
function fyRange(byFy) {
  const ks = Object.keys(byFy).sort();
  if (!ks.length) return '';
  const a = ks[0].replace('FY', '').slice(0, 4);
  const b = ks[ks.length - 1].split('-')[1];
  return `${a}–${b.length === 2 ? '20' + b : b}`;
}

function abbrevUsd(n) {
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'k';
  return '$' + Math.round(n);
}
// Hero bar chart: AP spend per fiscal year, stacked into operating (baseline) vs construction &
// facilities (lumpy, bond-funded capital) so steady operating growth reads apart from the
// bond-program spikes. Partial (in-progress) years are marked + de-emphasized.
function yearChart(totalByFy, constructionByFy, fyList, partialFy, fmtLoc, labels) {
  const H = 96;
  const max = Math.max(1, ...fyList.map((fy) => totalByFy[fy] || 0));
  const bars = fyList.map((fy) => {
    const total = totalByFy[fy] || 0;
    const con = constructionByFy[fy] || 0;
    const op = Math.max(0, total - con);
    const conH = Math.round(H * (con / max));
    const opH = Math.round(H * (op / max));
    const partial = partialFy.includes(fy);
    const lbl = fy.replace('FY', '').replace(/^20/, '') + (partial ? '∗' : '');
    const tip = `${fy.replace('FY', 'FY ')} — ${labels.op}: ${fmtUsd(fmtLoc, op)}; ${labels.con}: ${fmtUsd(fmtLoc, con)}`;
    return `<div class="ybar${partial ? ' partial' : ''}" title="${tip}">
      <span class="ybar-val">${abbrevUsd(total)}</span>
      <div class="ybar-stack">
        <div class="ybar-con" style="height:${conH}px"></div>
        <div class="ybar-op" style="height:${opH}px"></div>
      </div>
      <span class="ybar-lbl">${lbl}</span>
    </div>`;
  }).join('');
  return `<div class="year-legend"><span class="lg lg-op">${labels.op}</span><span class="lg lg-con">${labels.con}</span></div>
  <div class="year-chart">${bars}</div>`;
}

function renderPage(t, data) {
  const { vendors, stats, fyList, categories, totalByFy, constructionByFy, categoryByFy, partialFy } = data;
  const topN = vendors.slice(0, 100);
  const periodTxt = `${stats.minDate.slice(0, 4)}–${stats.maxDate.slice(0, 4)}`;
  const catLabel = (id) => { const c = categories.find((x) => x.id === id); return c ? c.label[t.lang] : id; };

  const rowsHtml = topN.map((v, i) => `
    <tr>
      <td class="r-rank">${i + 1}</td>
      <td class="r-icon"><span class="cat-ico" title="${escapeHtml(catLabel(v.cat))}" role="img" aria-label="${escapeHtml(catLabel(v.cat))}">${catIcon(v.cat)}</span></td>
      <td class="r-name">${escapeHtml(v.name)}</td>
      <td class="r-total">${fmtUsd(t.fmtLoc, v.total)}</td>
      <td class="r-checks">${v.checks}</td>
      <td class="r-trend">${sparkSvg(v.byFy, fyList, t.fmtLoc)}</td>
    </tr>`).join('');

  const chipsHtml = `<button class="chip active" data-cat="">${t.allCat} · ${fmtUsd(t.fmtLoc, stats.grand)}</button>` +
    categories.map((c) => `<button class="chip" data-cat="${c.id}"><span class="chip-ico">${catIcon(c.id)}</span> ${escapeHtml(c.label[t.lang])} · ${fmtUsd(t.fmtLoc, c.total)}</button>`).join('');

  const jsonLd = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Dataset',
    name: t.h1, description: t.desc,
    url: `https://rcsd.info${t.lang === 'es' ? '/proveedores/' : '/vendors/'}`,
    creator: { '@type': 'Organization', name: 'RCSD Open Data' },
    temporalCoverage: `${stats.minDate}/${stats.maxDate}`,
    distribution: { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: 'https://rcsd.info/vendors/vendor-spend.json' },
  })}</script>`;

  const head = headMeta({
    title: t.title, description: t.desc,
    canonical: `https://rcsd.info${t.lang === 'es' ? '/proveedores/' : '/vendors/'}`,
    ogLocale: t.loc, ogImageKey: `page-vendors${t.lang === 'es' ? '-es' : ''}`,
    hreflang: [
      { lang: 'en', href: 'https://rcsd.info/vendors/' },
      { lang: 'es', href: 'https://rcsd.info/proveedores/' },
    ],
    jsonLd, pageCSS: PAGE_CSS,
  });

  return `<!DOCTYPE html>
<html lang="${t.lang}">
<head>
${head}
</head>
<body>
${siteNav({ activePage: 'budget', lang: t.lang, altLangHref: t.alt })}
<main class="vendors-main">
  <header class="vendors-hero">
    <nav class="crumb" aria-label="Breadcrumb"><a href="${t.crumbHref}">${t.crumb}</a> <span aria-hidden="true">›</span> ${t.h1}</nav>
    <p class="kicker">${t.kicker}</p>
    <h1>${t.h1}</h1>
    <p class="intro">${t.intro}</p>
    <p class="coverage-note">${t.coverageNote}</p>
    <div class="stat-grid">
      <div class="stat"><div class="stat-num">${fmtUsd(t.fmtLoc, stats.grand)}</div><div class="stat-lbl">${t.statSpend}</div></div>
      <div class="stat"><div class="stat-num">${stats.vendorCount.toLocaleString(t.fmtLoc)}</div><div class="stat-lbl">${t.statVendors}</div></div>
      <div class="stat"><div class="stat-num">${stats.registerCount}</div><div class="stat-lbl">${t.statRegisters}</div></div>
      <div class="stat"><div class="stat-num">${periodTxt}</div><div class="stat-lbl">${t.statPeriod}</div></div>
    </div>
    <div class="trend-block">
      <h2 class="trend-h">${t.trendHeading}</h2>
      ${yearChart(totalByFy, constructionByFy, fyList, partialFy, t.fmtLoc, { op: t.opLabel, con: t.conLabel })}
      <p class="partial-note">${t.partialNote}</p>
    </div>
  </header>

  <section class="cat-sec">
    <h2>${t.catHeading}</h2>
    <div class="cat-chips" id="catchips" role="group">${chipsHtml}</div>
    <p class="cat-note">${t.catNote}</p>
  </section>

  <section class="search-sec">
    <label class="search-label" for="vsearch">${t.searchLabel}</label>
    <input id="vsearch" type="search" placeholder="${t.searchPh}" autocomplete="off" aria-describedby="vcount">
    <p id="vcount" class="vcount" aria-live="polite"></p>
  </section>

  <section class="table-sec">
    <h2>${t.topHeading}</h2>
    <table class="vtable" id="vtable">
      <thead><tr>
        <th class="r-rank">${t.thRank}</th><th class="r-icon" aria-label="${t.catHeading}"></th><th class="r-name">${t.thVendor}</th>
        <th class="r-total">${t.thTotal}</th><th class="r-checks">${t.thChecks}</th><th class="r-trend">${t.thTrend}</th>
      </tr></thead>
      <tbody id="vbody">${rowsHtml}</tbody>
    </table>
    <p class="nomatch" id="nomatch" hidden>${t.noMatch}</p>
  </section>

  <section class="notes">
    <h2>${t.methH}</h2><p>${t.method}</p>
    <h2>${t.caveatH}</h2><ul><li>${t.caveatNames}</li><li>${t.caveatReimb}</li><li>${t.caveat2021}</li></ul>
    <h2>${t.sourceH}</h2><p>${t.source}<a href="/vendors/vendor-spend.json">${t.dataLink}</a> · <a href="https://data.rcsd.info/json/warrants-index.json">${t.registersLink}</a>.</p>
  </section>
</main>
${siteFooter({ lang: t.lang })}
<script>
const FMT_LOC = ${JSON.stringify(t.fmtLoc)};
const STR = ${JSON.stringify({ showingAll: t.showingAll, matches: t.matches })};
const CATS = ${JSON.stringify(Object.fromEntries(categories.map((c) => [c.id, c.label[t.lang]])))};
const ICONS = ${JSON.stringify(ICONS)};
const FYS = ${JSON.stringify(fyList)};
const CAT_BY_FY = ${JSON.stringify(categoryByFy)};
const usd = (n) => new Intl.NumberFormat(FMT_LOC, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
let ALL = null, activeCat = '', query = '';
const body = document.getElementById('vbody');
const input = document.getElementById('vsearch');
const countEl = document.getElementById('vcount');
const noMatch = document.getElementById('nomatch');
const chips = document.getElementById('catchips');

function esc(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function spark(byFy){
  const vals = FYS.map(fy => byFy[fy] || 0);
  const max = Math.max(1, ...vals);
  const bw=7, gap=2, h=22;
  let bars='';
  vals.forEach((v,i) => {
    const x = i*(bw+gap);
    const tip = esc(FYS[i].replace('FY','FY ')+': '+usd(v));
    if(v>0){ const bh=Math.max(1.5, Math.round((h-2)*(v/max))); bars+='<rect x="'+x+'" y="'+(h-bh)+'" width="'+bw+'" height="'+bh+'" rx="1" fill="#2f6b3f"><title>'+tip+'</title></rect>'; }
    else { bars+='<rect x="'+x+'" y="0" width="'+bw+'" height="'+h+'" fill="transparent"><title>'+tip+'</title></rect><rect x="'+x+'" y="'+(h-1.5)+'" width="'+bw+'" height="1.5" rx="1" fill="#cdddd2"/>'; }
  });
  const w = FYS.length*(bw+gap);
  return '<svg class="spark" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'" aria-hidden="true">'+bars+'</svg>';
}
function fyRange(byFy){ const ks=Object.keys(byFy).sort(); return ks.length ? ks[0].replace('FY','').slice(0,4)+'–'+ks[ks.length-1].split('-')[1] : ''; }
function render(list){
  body.innerHTML = list.slice(0,200).map((v,i) => {
    const lbl = esc(CATS[v.cat]||v.cat);
    return '<tr><td class="r-rank">'+(i+1)+'</td>'+
    '<td class="r-icon"><span class="cat-ico" title="'+lbl+'" role="img" aria-label="'+lbl+'">'+(ICONS[v.cat]||'▫️')+'</span></td>'+
    '<td class="r-name">'+esc(v.name)+'</td>'+
    '<td class="r-total">'+usd(v.total)+'</td><td class="r-checks">'+v.checks+
    '</td><td class="r-trend" title="'+fyRange(v.byFy)+'">'+spark(v.byFy)+'</td></tr>';
  }).join('');
  noMatch.hidden = list.length>0;
  countEl.textContent = STR.showingAll+' '+Math.min(list.length,200).toLocaleString(FMT_LOC)+
    (list.length>200 ? ' / '+list.length.toLocaleString(FMT_LOC) : '')+' '+STR.matches;
}
async function ensure(){ if(ALL) return; const r=await fetch('/vendors/vendor-spend.json'); ALL=(await r.json()).vendors; }
async function apply(){
  await ensure();
  const q = query.toLowerCase();
  render(ALL.filter(v => (!activeCat || v.cat===activeCat) && (!q || v.name.toLowerCase().includes(q))));
}
let timer;
input.addEventListener('input', () => { clearTimeout(timer); timer=setTimeout(()=>{ query=input.value.trim(); apply(); }, 120); });
chips.addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if(!b) return;
  activeCat = b.dataset.cat;
  chips.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c===b));
  apply();
});

// Rich per-year hover: show the full category breakdown for the hovered fiscal-year bar.
(function(){
  const chart = document.querySelector('.year-chart');
  if(!chart) return;
  const tip = document.createElement('div');
  tip.className = 'yc-tip'; tip.hidden = true;
  document.body.appendChild(tip);
  const fyOf = lbl => 'FY' + (lbl.replace('∗','').length===5 ? '20'+lbl.replace('∗','') : lbl.replace('∗',''));
  function build(fy){
    const cats = CAT_BY_FY[fy] || {};
    const rows = Object.entries(cats).sort((a,b)=>b[1]-a[1]);
    const total = rows.reduce((s,r)=>s+r[1],0);
    let html = '<div class="yc-tip-h">'+fy.replace('FY','FY ')+' · '+usd(total)+'</div>';
    for(const [c,a] of rows){
      const pct = total? Math.round(100*a/total):0;
      html += '<div class="yc-tip-row"><span>'+(ICONS[c]||'▫️')+' '+esc(CATS[c]||c)+'</span><span class="yc-tip-amt">'+usd(a)+' <em>'+pct+'%</em></span></div>';
    }
    return html;
  }
  chart.addEventListener('mouseover', e => {
    const bar = e.target.closest('.ybar'); if(!bar) return;
    const lbl = bar.querySelector('.ybar-lbl').textContent;
    tip.innerHTML = build(fyOf(lbl)); tip.hidden = false; bar.removeAttribute('title');
    bar.querySelectorAll('[title]').forEach(x=>x.removeAttribute('title'));
  });
  chart.addEventListener('mousemove', e => {
    if(tip.hidden) return;
    const pad=14, w=tip.offsetWidth, h=tip.offsetHeight;
    let x=e.clientX+pad, y=e.clientY+pad;
    if(x+w>innerWidth-8) x=e.clientX-w-pad;
    if(y+h>innerHeight-8) y=e.clientY-h-pad;
    tip.style.left=x+'px'; tip.style.top=y+'px';
  });
  chart.addEventListener('mouseleave', ()=>{ tip.hidden = true; });
})();
</script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const PAGE_CSS = `
/* baseCSS exposes --green-wash/pale/light/mid/deep and --text*; this page was written against a
   numbered scale + --ink*, so alias them here to the real palette (otherwise greens/bars/active
   chips render with no color). */
:root{
  --green-50:#f0f6ed; --green-100:#dcebd5; --green-200:#bedfb0; --green-300:#93c585;
  --green-400:#5ea177; --green-500:#4a8c6a; --green-600:#2d5a3f; --green-700:#244a34; --green-800:#1a3a2a;
  --ink:#2a2a28; --ink-soft:#5a5a56;
}
.vendors-main{max-width:1000px;margin:0 auto;padding:0 1.25rem 4rem}
.vendors-hero{padding:1.5rem 0 1.5rem}
.crumb{font-family:var(--font-mono);font-size:.78rem;color:var(--ink-soft);margin:0 0 .9rem}
.crumb a{color:var(--green-700);text-decoration:none}
.crumb a:hover{text-decoration:underline}
.vendors-hero .kicker{font-family:var(--font-mono);text-transform:uppercase;letter-spacing:.12em;font-size:.78rem;color:var(--green-700);margin:0 0 .4rem}
.vendors-hero h1{font-family:var(--font-display);font-size:clamp(2rem,5vw,3rem);margin:0 0 .6rem;color:var(--ink)}
.vendors-hero .intro{font-size:1.08rem;max-width:62ch;color:var(--ink-soft)}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem;margin-top:1.8rem}
.stat{background:var(--green-50);border:1px solid var(--green-100);border-radius:12px;padding:1rem 1.1rem}
.stat-num{font-family:var(--font-mono);font-size:1.45rem;font-weight:600;color:var(--green-800)}
.stat-lbl{font-size:.82rem;color:var(--ink-soft);margin-top:.2rem}
.coverage-note{font-size:.92rem;color:var(--ink-soft);max-width:64ch;margin:1rem 0 0;padding:.7rem .9rem;background:var(--green-50);border-left:3px solid var(--green-400);border-radius:0 8px 8px 0}
.trend-block{margin-top:1.8rem}
.trend-h{font-family:var(--font-display);font-size:1.15rem;margin:0 0 .8rem}
.year-chart{display:flex;align-items:flex-end;gap:.6rem;height:140px}
.ybar{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;flex:1;max-width:90px;height:100%}
.ybar-val{font-family:var(--font-mono);font-size:.72rem;color:var(--green-800);margin-bottom:.25rem;white-space:nowrap}
.ybar-stack{width:100%;display:flex;flex-direction:column;justify-content:flex-end;border-radius:3px 3px 0 0;overflow:hidden}
.ybar-con{width:100%;background:var(--amber)}
.ybar-op{width:100%;background:var(--green-600)}
.ybar:hover .ybar-op{background:var(--green-800)}
.ybar.partial .ybar-op{background:var(--green-300)}
.ybar.partial .ybar-con{background:var(--amber-light)}
.ybar.partial .ybar-val{color:var(--ink-soft)}
.year-legend{display:flex;gap:1.1rem;margin:.2rem 0 .7rem;font-size:.78rem;color:var(--ink-soft)}
.lg{display:inline-flex;align-items:center}
.lg::before{content:"";width:11px;height:11px;border-radius:2px;margin-right:.35rem}
.lg-op::before{background:var(--green-600)}
.lg-con::before{background:var(--amber)}
.year-chart .ybar{cursor:default}
.yc-tip{position:fixed;z-index:50;pointer-events:none;background:#fff;border:1px solid var(--green-200);border-radius:8px;box-shadow:0 6px 22px rgba(0,0,0,.16);padding:.55rem .7rem;font-size:.8rem;min-width:210px;max-width:300px}
.yc-tip-h{font-family:var(--font-mono);font-weight:600;color:var(--green-800);border-bottom:1px solid var(--green-100);padding-bottom:.3rem;margin-bottom:.3rem}
.yc-tip-row{display:flex;justify-content:space-between;gap:1rem;padding:.13rem 0;line-height:1.25}
.yc-tip-amt{font-family:var(--font-mono);white-space:nowrap}
.yc-tip-amt em{color:var(--ink-soft);font-style:normal}
.ybar-lbl{font-family:var(--font-mono);font-size:.72rem;color:var(--ink-soft);margin-top:.35rem}
.partial-note{font-size:.76rem;color:var(--ink-soft);font-style:italic;margin:.6rem 0 0}
.search-sec{margin:2rem 0 1rem}
.search-label{display:block;font-weight:600;margin-bottom:.4rem}
#vsearch{width:100%;font-size:1.05rem;padding:.7rem .9rem;border:2px solid var(--green-200);border-radius:10px;font-family:var(--font-body)}
#vsearch:focus{outline:none;border-color:var(--green-600)}
.vcount{font-family:var(--font-mono);font-size:.82rem;color:var(--ink-soft);min-height:1.1em;margin:.5rem 0 0}
.table-sec h2,.notes h2{font-family:var(--font-display);font-size:1.4rem;margin:1.6rem 0 .8rem}
.vtable{width:100%;border-collapse:collapse;font-size:.95rem}
.vtable th{text-align:left;font-family:var(--font-mono);font-size:.74rem;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-soft);border-bottom:2px solid var(--green-200);padding:.5rem .6rem}
.vtable td{padding:.5rem .6rem;border-bottom:1px solid var(--green-50)}
.vtable tbody tr:hover{background:var(--green-50)}
.r-rank{width:2.5rem;font-family:var(--font-mono);color:var(--ink-soft)}
.r-total,.r-checks{font-family:var(--font-mono);text-align:right;white-space:nowrap}
.r-total{font-weight:600;color:var(--green-800)}
.r-trend{width:90px}.r-trend .spark{display:block}
th.r-total,th.r-checks,th.r-trend{text-align:right}
.r-icon{width:1.8rem;text-align:center;padding-left:0;padding-right:0}
.cat-ico{font-size:1.05rem;line-height:1;cursor:default}
.chip-ico{font-size:.95rem}
.cat-sec{margin:2rem 0 1rem}
.cat-sec h2{font-size:1.15rem;margin-bottom:.4rem}
.cat-chips{display:flex;flex-wrap:wrap;gap:.35rem;margin:.5rem 0}
.chip{font-family:var(--font-mono);font-size:.72rem;padding:.22rem .55rem;border:1px solid var(--green-200);background:var(--green-50);border-radius:999px;cursor:pointer;color:var(--ink);transition:all .12s}
.chip:hover{border-color:var(--green-500)}
.chip.active{background:var(--green-700);color:#fff;border-color:var(--green-700)}
.cat-note{font-size:.82rem;color:var(--ink-soft);font-style:italic;margin:.3rem 0 0}
.nomatch{font-style:italic;color:var(--ink-soft);padding:1rem .6rem}
.notes{margin-top:2.5rem;font-size:.95rem;color:var(--ink-soft)}
.notes ul{padding-left:1.1rem}.notes li{margin:.3rem 0}
.notes a{color:var(--green-700)}
/* Phones: the 6-column table overflows, so drop rank + check-count, let names wrap,
   and shrink the chart/chips/stats to fit a ~375px viewport without horizontal panning. */
@media (max-width: 560px){
  .vendors-main{padding:0 .9rem 3rem}
  .vendors-hero{padding:1rem 0 1rem}
  .stat-grid{grid-template-columns:1fr 1fr;gap:.7rem}
  .stat-num{font-size:1.2rem}
  .year-chart{gap:.3rem;height:120px}
  .ybar-val,.ybar-lbl{font-size:.58rem}
  .chip{font-size:.68rem;padding:.2rem .5rem}
  .vtable{font-size:.88rem}
  .vtable th,.vtable td{padding:.45rem .3rem}
  .r-rank,th.r-rank,.r-checks,th.r-checks{display:none}
  .r-name{word-break:break-word}
  .r-total{font-size:.84rem}
  .r-trend{width:62px}.r-trend .spark{width:62px;height:20px}
}
`;

function main() {
  const data = aggregate();
  for (const dir of ['docs/vendors', 'docs/proveedores']) mkdirSync(resolve(ROOT, dir), { recursive: true });

  // Client search payload (trim byFy precision already rounded). Public, served at /vendors/.
  const payload = {
    _metadata: {
      description: 'Per-vendor disbursed spend by California fiscal year, from RCSD warrant registers. Cancelled/voided and superseded-duplicate records excluded.',
      generated: new Date().toISOString().slice(0, 10),
      ...data.stats,
    },
    fiscalYears: data.fyList,
    totalByFiscalYear: data.totalByFy,
    constructionByFiscalYear: data.constructionByFy,
    categoryByFiscalYear: data.categoryByFy,
    categories: data.categories,
    vendors: data.vendors,
  };
  writeFileSync(resolve(ROOT, 'docs/vendors/vendor-spend.json'), JSON.stringify(payload));

  writeFileSync(resolve(ROOT, 'docs/vendors/index.html'), renderPage(T.en, data));
  writeFileSync(resolve(ROOT, 'docs/proveedores/index.html'), renderPage(T.es, data));

  console.log(`Built /vendors/ + /proveedores/ — ${data.vendors.length} payees, $${data.stats.grand.toLocaleString()} disbursed, ${data.stats.registerCount} registers.`);
}

main();
