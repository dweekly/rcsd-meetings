# Fall 2026 refresh + annual refresh tickler

Stage: product (production site, real readers). Owner: David. Written 2026-10-18.

## Why

On 2026-10-18 a survey of every year-scoped fact found three things the site was
publishing past their shelf life, none of which any check had flagged:

- `/budget/` still says the 2026-27 budget is "Proposed — adoption scheduled June 24".
  It was adopted that day, and the 2025-26 Unaudited Actuals were approved 9/23.
- School pages cite the "2025-26 LCAP". The 2026-27 LCAP was adopted 6/24.
- Every CA School Dashboard link points at the 2024 Dashboard. The 2025 Dashboard has been
  out since December 2025.

Earlier the same day, LTEL had sat a full cycle behind: CDE's bot protection now blocks
the probe that was supposed to notice. `docs/ANNUAL-REFRESH.md` already names the root
cause: "a checklist would not have caught it, because nothing prompts anyone to open a
checklist." The freshness guard fixed that for principals and the superintendent. This
effort extends the same idea to *dates*. Each refreshable fact gets a date after which its
newer edition is known to exist, so a stale constant turns the scheduled run red, and
GitHub's failure email becomes the tickler. Todoist tasks cover only the steps a script
cannot do (the LTEL browser download, which sits behind a CAPTCHA, and the trustee roster
after an election).

A different design would also serve if it gets a human prompt to the right person at the
right time without depending on anyone remembering to look.

Three meetings (9/23, 9/30, 10/14) also lack theme-triage records, which fails `npm test`.
Their attachments are where the budget and LCAP updates come from, so they belong here.

## Work items (one PR each, in this order)

Merge order: **T, D, then B and L (either order), then E.**

| # | PR | Who | Depends on |
|---|---|---|---|
| T | Triage records for 2026-09-23, 09-30, 10-14 | subagent | — |
| D | CA Dashboard links → 2025 through one `caDashboardUrl()` helper; also fixes the budget page's link, which used a wrong district CDS code (`41689660000000`; RCSD is `41690050000000`) and rendered an empty page | main session | T merged |
| B | **Owns `scripts/build-budget.mjs` outright.** Whole-page, section-by-section refresh of `/budget/` + `/presupuesto/` to the 2026-27 Adopted Budget, with the 2025-26 Unaudited Actuals as the prior year's actuals. Includes Measure C's certified result (verify from the county's certified results; the page still says the count is ongoing) and the LCAP spending table, which must reconcile arithmetically (rows currently sum to $68.0M against a $65.9M total). Adds two constants to `scripts/lib/school-year.mjs`: `BUDGET_SOURCE = { fiscalYear, report }` for the current-year budget (precedence within a fiscal year: Adopted → First Interim → Second Interim) and `ACTUALS_SOURCE = { fiscalYear }` for the latest unaudited actuals. Every figure kept from an older report is labeled with its report and date; a constant never relabels old numbers. | subagent | D merged |
| L | LCAP → 2026-27 on school pages, not `build-budget.mjs`. Inventory every LCAP-derived fact rendered (fact, source, **measurement period**, keep or change), refresh only facts where the adopted 2026-27 LCAP has a newer measurement, keep comparison pairs on the same measurement window (e.g. the district i-Ready winter diagnostic against school mid-year diagnostics), never overwrite SARC- or CDE-derived figures because the LCAP repeats them, then bump `LCAP_YEAR` | subagent | — |
| E | Tickler: date-based due checks in the freshness guard, plus Todoist tasks for the hands-on steps | main session | D, B, L merged (otherwise it lands red) |

Sources (all already on R2 under `data.rcsd.info/board-packets/`):
`2026-06-17/2026-27-Budget-Book.pdf`, `2026-06-17/2026-27-MYP-Budget-Adoption.pdf`,
`2026-06-24/Final-2026_Local_Control_and_Accountability_Plan_Redwood_City_Elementary_School_.pdf`
(the adopted LCAP; the 6/17 `LCAP-Final-REPORT-June-2026.pdf` was the hearing copy, so it's supporting evidence only),
`2026-06-24/2026-27-Proposed-Adopted-Budget-Book.pdf`,
`2026-09-23/25.26-Unaudited-Actuals-Book.pdf`.

### E in detail

- `scripts/lib/refresh-schedule.mjs`: one entry per refreshable fact, each with its
  current value (read from the constant, not copied), a function giving the expected
  minimum value for a given date, `dueAfter`, a grace period, the fix steps, and whether
  it needs hands. Initial entries and release dates:

  | Fact | Due after | Expected minimum on/after that date in year Y |
  |---|---|---|
  | `CA_DASHBOARD_YEAR` | Jan 5 | `Y-1` (Dashboard released early Dec) |
  | `LCAP_YEAR` | Jul 15 | `Y-(Y+1)` (adopted late June) |
  | `BUDGET_SOURCE` | Jul 15 → Adopted for `Y-(Y+1)`; Jan 15 → First Interim for `(Y-1)-Y`; Apr 15 → Second Interim for `(Y-1)-Y` | report precedence Adopted < First < Second within a fiscal year; a later fiscal year satisfies any earlier requirement |
  | `ACTUALS_SOURCE` | Oct 15 | Unaudited Actuals for `(Y-1)-Y` |
  | `SARC_YEAR` | Mar 1 | `(Y-2)-(Y-1)` |
  | `IREADY_YEAR` | Jul 1 | `(Y-1)-Y` |
  | `SPSA_YEAR` | Jun 1 | `(Y-1)-Y` (school plans arrive school by school through late April or May) |
  | `CDE_DATA_YEARS.ltel` | May 15 | `(Y-1)-Y`, hands-on (CAPTCHA) |
  | Latest officer-rotation date, in **both** `OFFICER_ROTATIONS` arrays (`extract-chapter-markers.mjs` and `build-meetings-html.mjs`), read as text rather than by importing the executable extractor | Jan 15 | ≥ Dec 1 of `Y-1` |

  CDE staff and absenteeism are left to the existing availability probe, which can still
  see them.
- **Deadline contract.** Requirements come from dated release occurrences, this year's
  *and the previous year's*, so an overdue requirement stays overdue across New Year.
  Grace (default 30 days) belongs to the occurrence, not to the run: from the due date
  (inclusive) to due + grace (exclusive) a stale fact is an advisory, and from then on it
  fails the build. A newer valid edition satisfies an older requirement. A deferral names
  one requirement and carries `until` plus a required `reason`; when it expires, the
  requirement is immediately in whatever state the calendar gives it, with no fresh grace.
  All dates are America/Los_Angeles calendar days.
- The schedule check runs **independently of `data/freshness.json`**: today the guard exits
  0 when that file is absent, and that early exit must not disable date checks. The
  workflow step's placement and `!cancelled()` condition stay as they are.
- `--today YYYY-MM-DD` on `check-freshness.mjs` overrides only the schedule's clock, not the
  observation-age check.
- Todoist (project RCSD), recurring, with the procedure in the description: LTEL download
  (every Apr 20); board officer rotation + trustee roles in both languages (every Dec 20);
  trustee roster after an election (every two years on Dec 20, anchored to 2026, after the
  new board is seated rather than before). Gate 5 checks recurrence, next date and
  description, not just that names match.
- `docs/ANNUAL-REFRESH.md` gains a section on the schedule; the "Still manual" lists point
  at it.

## Gates (each must pass before its item is called done)

1. `npm test` exits 0. This covers the triage check and the new refresh-schedule tests.
2. `node scripts/check-freshness.mjs` exits 0 on `main` today. In tests, a fixture with every
   fact satisfied passes at `--today 2027-02-20`, and the same fixture with only the
   Dashboard year set back to 2025 fails naming `CA_DASHBOARD_YEAR`. That proves the guard
   both passes and fails. Boundary tests: the day before due, the due day, the last grace
   day, the first fatal day, Dec 31 → Jan 1 rollover, a newer value satisfying an older
   requirement, invalid dates, active and expired deferrals, and a missing `freshness.json`.
   They run under both `npm test` and CI's `test:freshness`.
3. After each merge, a Quick pipeline run is dispatched immediately and is green.
4. Production checks after each PR's Quick run (`curl -fsS`, so an HTTP error fails), each
   requiring the old content gone **and** the new content present:
   - D: on `/` (one bilingual homepage; there is no `/es/`), `/budget/`, `/presupuesto/` and every school route in both
     languages, no `caschooldashboard.org/reports/…/2024` and no `41689660000000`; at least
     one `/2025` link on each.
   - B: `/budget/` has no `Adoption scheduled`, and `/presupuesto/` has no
     `Adopción programada`; both name the 2026-27 Adopted Budget and the 2025-26 Unaudited
     Actuals; Measure C shows its certified result.
   - L: Kennedy in both languages cites the 2026-27 LCAP.
   - E: a deliberately failed run's notification email reaches David (checked in Gmail).
5. `td task list --project RCSD --json` lists the three recurring tasks.
6. Each PR: Codex review SHIP, rendered EN+ES screenshots at desktop and phone widths for
   any page that changed.

## Out of scope

- Ingesting CA Dashboard *data* (colors, indicators). The site only links to it today.
  That stays a ROADMAP item.
- SPSA 2026-27 and SSC 2026-27 rosters: not yet adopted (the spring 2026 SPSA items are
  2025-26 plans).
- Chronic absenteeism 2025-26: not yet published.
- Getting past CDE's CAPTCHA by script.
- Charter adopted budgets / LCAPs attached on 9/23: the T triage records route them, and
  any charter-page refresh is filed, not done here.

## Plan review (Codex `gpt-6.1-sol`, high, 2026-10-18)

Folded in: merge order (T first), separate current-budget and actuals sources with report
precedence, a whole-page budget audit including Measure C and the LCAP table's arithmetic,
the adopted (6/24) LCAP as the source, measurement-period discipline for L, the deadline
contract, SPSA due on Jun 1, schedule checks that don't depend on `freshness.json`, both
officer-rotation arrays, the trustee-roster task after seating, a controlled positive and
negative test for `--today`, boundary tests, stronger production checks, and confirming
the failure email reaches David.

Moved to ROADMAP: proving year constants match the ingested data (e.g.
`y2_25_26_midyear` fields that `IREADY_YEAR` does not move), the remaining year-literal
migration, event-driven invalidation (elections, policies, calendars), a heartbeat that
monitors the monitor, and structural validation of every triage record.

Declined: nothing. The Measure C figure and the final LCAP filename came from the
reviewer and are verified against their sources before use.

## Decisions

- Tickler mechanism: due dates in the guard **and** Todoist for hands-on steps (David,
  2026-10-18).
- Refresh all four stale items now (David, 2026-10-18).
