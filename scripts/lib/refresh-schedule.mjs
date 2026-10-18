/**
 * The annual refresh tickler: when each year-scoped fact's newer edition is known
 * to exist, and what to do about it.
 *
 * Why this exists. On 2026-10-18 the site was publishing a budget "adoption
 * scheduled June 24" four months after adoption, a 2025-26 LCAP after the
 * 2026-27 one was adopted, and 2024 Dashboard links ten months after the 2025
 * Dashboard came out. Nothing flagged any of it, because a release calendar
 * written in a runbook prompts nobody. Here the calendar is code:
 * check-freshness.mjs evaluates it on every scheduled run, so a fact left past
 * its due date turns the run red, and the failure notification is the reminder.
 *
 * Contract (see docs/ANNUAL-REFRESH.md, "Refresh schedule"):
 * - Each rule has one or more release occurrences per calendar year, each with a
 *   due date and the minimum value the fact must hold from then on.
 * - Occurrences from this year AND last year are checked, so an overdue fact
 *   stays overdue across New Year instead of resetting until the next release.
 * - Grace belongs to the occurrence: from its due date (inclusive) to due +
 *   GRACE_DAYS (exclusive) a stale fact is an advisory; from then on it fails.
 * - A newer value satisfies an older requirement (values only compare upward).
 * - A deferral names one occurrence (rule id + due date), an `until` date and a
 *   reason. While active it downgrades that occurrence to an advisory; once it
 *   expires the occurrence is in whatever state the calendar gives it, with no
 *   fresh grace.
 * - Dates are America/Los_Angeles calendar days, as YYYY-MM-DD strings.
 *
 * Values are compared as numbers so one rule shape covers every fact:
 *   school year "2025-26" -> 2025; Dashboard "2025" -> 2025;
 *   budget { fiscalYear: "2026-27", report: "adopted" } -> 20261;
 *   officer rotation "2025-12-17" -> 20251217.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

export const GRACE_DAYS = 30;

const BUDGET_REPORTS = ['adopted', 'first-interim', 'second-interim'];
const BUDGET_LABELS = { 1: 'Adopted Budget', 2: 'First Interim', 3: 'Second Interim' };

const startYear = (schoolYear) => Number(String(schoolYear).slice(0, 4));
const schoolYear = (start) => `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
const budgetRank = (src) => startYear(src.fiscalYear) * 10 + (BUDGET_REPORTS.indexOf(src.report) + 1);
const ymd = (n) => `${String(n).slice(0, 4)}-${String(n).slice(4, 6)}-${String(n).slice(6, 8)}`;

/**
 * Known release dates. `due` is set a little after the usual release so a slow
 * year doesn't cry wolf; GRACE_DAYS then sits on top before anything fails.
 */
export const RULES = [
  {
    id: 'ca-dashboard',
    label: 'CA School Dashboard year (CA_DASHBOARD_YEAR)',
    occurrences: [{ due: '01-05', need: (y) => y - 1 }],
    show: String,
    fix: 'Confirm https://www.caschooldashboard.org/reports/41690050000000/<year> renders a '
      + '"Performance Overview" (the site answers 200 for any year, so status proves nothing), '
      + 'then bump CA_DASHBOARD_YEAR in scripts/lib/school-year.mjs. Every link goes through caDashboardUrl().',
  },
  {
    id: 'lcap',
    label: 'LCAP year (LCAP_YEAR)',
    occurrences: [{ due: '07-15', need: (y) => y }],
    show: schoolYear,
    fix: 'The Board adopts the next LCAP in late June. Refresh every LCAP-derived fact on school pages '
      + 'from the adopted plan (keep each comparison on one measurement window), then bump LCAP_YEAR. '
      + 'The budget page\'s LCAP table moves with the budget refresh.',
  },
  {
    id: 'budget',
    label: 'Budget page source report (BUDGET_SOURCE)',
    occurrences: [
      { due: '01-15', need: (y) => (y - 1) * 10 + 2 },
      { due: '04-15', need: (y) => (y - 1) * 10 + 3 },
      { due: '07-15', need: (y) => y * 10 + 1 },
    ],
    show: (n) => `${schoolYear(Math.floor(n / 10))} ${BUDGET_LABELS[n % 10]}`,
    fix: 'Refresh /budget/ and /presupuesto/ (scripts/build-budget.mjs) section by section from the newer '
      + 'report, labeling any figure kept from an older one, then update BUDGET_SOURCE in scripts/lib/school-year.mjs.',
  },
  {
    id: 'actuals',
    label: 'Budget page unaudited actuals (ACTUALS_SOURCE)',
    occurrences: [{ due: '10-15', need: (y) => y - 1 }],
    show: (n) => `${schoolYear(n)} Unaudited Actuals`,
    fix: 'The Board approves the prior year\'s Unaudited Actuals in September. Update the actuals figures in '
      + 'scripts/build-budget.mjs, then ACTUALS_SOURCE in scripts/lib/school-year.mjs.',
  },
  {
    id: 'sarc',
    label: 'SARC year (SARC_YEAR)',
    occurrences: [{ due: '03-01', need: (y) => y - 2 }],
    show: schoolYear,
    fix: 'SARCs post each February. Stage the PDFs, run scripts/extract-sarc.mjs, then bump SARC_YEAR.',
  },
  {
    id: 'iready',
    label: 'i-Ready presentation year (IREADY_YEAR)',
    occurrences: [{ due: '07-01', need: (y) => y - 1 }],
    show: schoolYear,
    fix: 'Re-extract the spring Board data presentations (scripts/extract-ireadyu-growth.mjs). The extractor '
      + 'and renderer use year-named fields (e.g. y2_25_26_midyear), so moving IREADY_YEAR alone changes only labels.',
  },
  {
    id: 'spsa',
    label: 'SPSA year (SPSA_YEAR)',
    occurrences: [{ due: '06-01', need: (y) => y - 1 }],
    show: schoolYear,
    fix: 'School plans are approved school by school through the spring. Once every school\'s plan is posted, '
      + 'bump SPSA_YEAR (it drives extract-spsa-budgets.mjs and every school\'s SPSA link).',
  },
  {
    id: 'ltel',
    label: 'CDE long-term English learner data (CDE_DATA_YEARS.ltel)',
    occurrences: [{ due: '05-15', need: (y) => y - 1 }],
    show: schoolYear,
    hands: true,
    fix: 'DataQuest blocks scripts with a CAPTCHA: download the new year from '
      + 'https://www.cde.ca.gov/ds/ad/filesltel.asp in a browser, save it as artifacts/cde/ltel-<year>.txt, '
      + 'then follow "LTEL usually needs a hand download" in docs/ANNUAL-REFRESH.md.',
  },
  {
    id: 'officers',
    label: 'Board officer rotation (both OFFICER_ROTATIONS arrays)',
    occurrences: [{ due: '01-15', need: (y) => (y - 1) * 10000 + 1201 }],
    show: (n) => `rotation dated ${ymd(n)}`,
    hands: true,
    fix: 'Add the December reorganization to OFFICER_ROTATIONS in BOTH scripts/extract-chapter-markers.mjs and '
      + 'scripts/build-meetings-html.mjs (source: that meeting\'s approved minutes), and update officer roles in '
      + 'data/trustees.json.',
  },
];

/**
 * Snoozes for a source that is genuinely late. Each one names a single
 * occurrence and expires; see the contract above.
 * Shape: { id: 'ca-dashboard', due: '2027-01-05', until: '2027-02-15', reason: '...' }
 */
export const DEFERRALS = [];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(s, days) {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Today's date in America/Los_Angeles, as YYYY-MM-DD. */
export function todayInLA(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
}

/** Latest afterDate in an OFFICER_ROTATIONS array, read from source text (never imported). */
function latestRotation(text) {
  const block = text.match(/const OFFICER_ROTATIONS = \[([\s\S]*?)\n\];/);
  if (!block) return null;
  const dates = [...block[1].matchAll(/afterDate:\s*'(\d{4}-\d{2}-\d{2})'/g)].map((m) => m[1]).sort();
  return dates.length ? Number(dates.at(-1).replaceAll('-', '')) : null;
}

/**
 * The values each rule checks, read from the code that actually renders them.
 * A value that cannot be read is null, which the evaluator reports as a failure.
 */
export async function currentValues(rootDir) {
  const sy = await import(resolve(rootDir, 'scripts/lib/school-year.mjs'));
  const read = (fn) => { try { return fn(); } catch { return null; } };
  const rotations = ['scripts/extract-chapter-markers.mjs', 'scripts/build-meetings-html.mjs']
    .map((p) => read(() => latestRotation(readFileSync(resolve(rootDir, p), 'utf-8'))));
  return {
    'ca-dashboard': read(() => Number(sy.CA_DASHBOARD_YEAR)),
    lcap: read(() => startYear(sy.LCAP_YEAR)),
    budget: read(() => budgetRank(sy.BUDGET_SOURCE)),
    actuals: read(() => startYear(sy.ACTUALS_SOURCE.fiscalYear)),
    sarc: read(() => startYear(sy.SARC_YEAR)),
    iready: read(() => startYear(sy.IREADY_YEAR)),
    spsa: read(() => startYear(sy.SPSA_YEAR)),
    ltel: read(() => startYear(sy.CDE_DATA_YEARS.ltel)),
    // Both arrays must be current; the older of the two is the one that counts.
    officers: rotations.includes(null) ? null : Math.min(...rotations),
  };
}

/**
 * Evaluate every rule for `today`. Pure: no clock, no files.
 * Returns { problems, advisories }, each a list of messages.
 */
export function evaluateSchedule({ today, values, rules = RULES, deferrals = DEFERRALS, graceDays = GRACE_DAYS }) {
  const problems = [];
  const advisories = [];
  if (!validDate(today)) {
    return { problems: [`Refresh schedule: "${today}" is not a valid YYYY-MM-DD date.`], advisories };
  }

  const ruleIds = new Set(rules.map((r) => r.id));
  for (const d of deferrals) {
    if (!ruleIds.has(d.id) || !validDate(d.due) || !validDate(d.until) || !String(d.reason ?? '').trim()) {
      problems.push(`Refresh schedule: malformed deferral ${JSON.stringify(d)} (needs a known id, valid due and until dates, and a reason).`);
    }
  }

  const year = Number(today.slice(0, 4));
  for (const rule of rules) {
    const value = values[rule.id];
    if (typeof value !== 'number' || Number.isNaN(value)) {
      problems.push(`Refresh schedule: could not read ${rule.label}. ${rule.fix}`);
      continue;
    }
    // Every occurrence already due, last year's included; report only the most
    // severe unmet one per rule so a long-overdue fact gives one clear message.
    let worst = null;
    for (const y of [year - 1, year]) {
      for (const occ of rule.occurrences) {
        const due = `${y}-${occ.due}`;
        if (due > today) continue;
        const need = occ.need(y);
        if (value >= need) continue;
        const fatalFrom = addDays(due, graceDays);
        const deferral = deferrals.find((d) => d.id === rule.id && d.due === due && validDate(d.until) && today < d.until && String(d.reason ?? '').trim());
        const state = deferral ? 'deferred' : (today >= fatalFrom ? 'fatal' : 'grace');
        const rank = { deferred: 0, grace: 1, fatal: 2 }[state];
        if (!worst || rank > worst.rank || (rank === worst.rank && need > worst.need)) {
          worst = { state, rank, need, due, fatalFrom, deferral };
        }
      }
    }
    if (!worst) continue;
    const head = `${rule.label} is ${rule.show(value)}; ${rule.show(worst.need)} was due ${worst.due}.`;
    if (worst.state === 'fatal') {
      problems.push(`${head} ${rule.fix}${rule.hands ? ' (Needs a person: there is a Todoist task for this.)' : ''}`);
    } else if (worst.state === 'grace') {
      advisories.push(`${head} Fails the build from ${worst.fatalFrom}. ${rule.fix}`);
    } else {
      advisories.push(`${head} Deferred until ${worst.deferral.until}: ${worst.deferral.reason}`);
    }
  }
  return { problems, advisories };
}
