# Annual refresh — facts that expire on a school-year boundary

rcsd.info publishes a lot of things that are true only until some date nobody is
watching. This document is the inventory of those things, what checks them now,
and what still has to be checked by hand.

**Why it exists.** On 2026-08-19 a sweep found four of twelve principals wrong and the
superintendent wrong. Kennedy had listed a principal who had rotated out; `/district`
had spent seven weeks telling readers the district was "in a superintendent transition"
that finished on June 30. None of it was a data-entry mistake — the data was correct
when written and nothing ever re-read it. That is the failure this document and the
freshness guard exist to prevent.

The lesson shaped the design: **a checklist would not have caught it**, because nothing
prompts anyone to open a checklist. Anything that can be machine-checked should fail the
build instead.

## What is checked automatically

Two scripts, wired into `.github/workflows/pipeline.yml`:

| Script | Role | Where in the pipeline |
|---|---|---|
| `scripts/verify-live-facts.mjs` | Probes rcsdk8.net, records observations into `data/freshness.json` | Before the commit step, `continue-on-error` |
| `scripts/check-freshness.mjs` | Compares observations to the published data, exits 1 on drift | Final step, beside `check-pipeline-health.mjs` |

They are separate so the observation record still gets written and committed on a run
where the guard goes red, and so an alert never discards the run's paid API work.

**Sources probed.** All are server-rendered Finalsite pages that list people as
`<h2>Name | Title</h2>`:

- Principals — `https://{school website}/our-school/meet-our-school-leadership`, one per
  school, hosts taken from `data/schools.json`.
- Superintendent and cabinet —
  `https://www.rcsdk8.net/our-programs-and-services/our-superintendent`.

**What is fatal vs. advisory.** A drifted principal or superintendent fails the build.
Cabinet/director roster drift prints an advisory and does not. The roster page churns and
is not a complete roster of record; a guard that cries wolf is a guard the operator learns
to ignore, which would cost us the checks that matter.

**Fixing a red run.** Correct the data file the guard names — never the guard — then
`node scripts/verify-live-facts.mjs` and re-check. The published values live in
`data/schools.json` and `data/trustees.json`; `data/freshness.json` holds only what the
sources said, so a name still has exactly one definition.

**A probe that cannot read its source is a failure, not a pass.** A 404, or markup that no
longer matches, exits non-zero and names the URL. An earlier draft of the superintendent
probe scanned flattened page text and confidently returned "Trustees Meeting Calendar" out
of the nav; extraction is structural now, and absence of the structure is loud.

## Do not commit a locally-rebuilt `docs/`

`artifacts/` is gitignored. Several builders read it and **degrade silently** when it is
absent, so a local rebuild produces a page that looks fine and is missing data:

- `scripts/document-inventory.mjs` — without `artifacts/documents/sarc/`, the district page
  loses all 36 language-specific SARC links, every Spanish direct link included. This
  happened while preparing PR 1 and was caught in review. It now prints a warning.
- `scripts/build-meetings.mjs` — without the R2 transcript cache, transcript flags and
  durations are stripped from `meetings-data.json`.
- `scripts/build-schools.mjs` — the five `data/cde/*.json` reads are wrapped in
  `try/catch → {}` (see PR 2).

Revert **only the generated HTML** when you undo a local build — `git checkout -- docs/`
also reverts the hand-written `docs/*.md` runbooks, which are real content that lives in
the same directory.

The pipeline rebuilds and deploys `docs/` on every run with the full artifact set, and
never commits it. So when a change only touches `data/` or a builder, **let CI rebuild** —
committing your local `docs/` output buys nothing and can ship data loss. If you do need to
commit built HTML, sync `artifacts/` from R2 first and check the warnings.

## Bumping a year is not yet a one-line change

`scripts/lib/school-year.mjs` holds each year, and the URLs, file paths, and CDE source
notes follow it. **About 50 school years are still written out by hand in
`scripts/build-schools.mjs`** — section headings, stat-card bubbles, intro sentences — and
those do not.

No automated check can close this gap, and it is worth understanding why: a literal does
not move when a constant moves, and grepping cannot tell "2025-26 the SPSA year" from
"2025-26 the LCAP year", since several constants hold the same value today. An earlier
attempt at a guard here passed cleanly with `SPSA_YEAR` already bumped. What exists instead
is a test that bounds the count, so the debt cannot quietly grow.

So, until the audit in `ROADMAP.md` lands: **after bumping any year, grep
`scripts/build-schools.mjs` for the OLD value and check each hit**, in both languages.
Some will be genuinely different facts that should keep their old year — a SARC reports on
the prior year, and SSC rosters are point-in-time records.

## Facts with two copies

These must move together. Changing one and not the other is how the chapter-marker roster
went on naming a retired superintendent for seven weeks.

| Fact | Copy 1 (rendered) | Copy 2 |
|---|---|---|
| Superintendent | `data/trustees.json` → `/district` | `scripts/extract-chapter-markers.mjs` `DISTRICT_STAFF` (LLM speaker attribution) |
| Board officer rotation | `scripts/extract-chapter-markers.mjs` `OFFICER_ROTATIONS` | `scripts/build-meetings-html.mjs` (~line 714, carries a TODO) |

The board-officer rotation needs a new entry after **each December board reorganization**,
in both places. It is not yet probed. The authoritative source for who held which office
at a given meeting is the attendance section of that meeting's approved minutes, which lists
each trustee as President, Vice President, Clerk or Member; use it to verify a rotation entry
or to catch a mid-year change, rather than inferring roles from agenda items or news.

## Refresh schedule (the tickler)

Each fact below has a known release date. `scripts/lib/refresh-schedule.mjs` holds the
calendar, and `check-freshness.mjs` checks it on every scheduled run, so a fact left past
its date turns the run red and the GitHub failure email is the reminder. The steps a
script can't do also have recurring Todoist tasks in the RCSD project.

| Fact | Due (then 30 days' grace) | Must be at least | Todoist |
|---|---|---|---|
| `CA_DASHBOARD_YEAR` | Jan 5 | last calendar year | — |
| `BUDGET_SOURCE` | Jan 15 / Apr 15 / Jul 15 | First Interim / Second Interim / next year's Adopted | — |
| `ACTUALS_SOURCE` | Oct 15 | last fiscal year's Unaudited Actuals | — |
| Officer rotation (both arrays) | Jan 15 | a December rotation | every Dec 20 |
| `SARC_YEAR` | Mar 1 | the school year two back | — |
| `CDE_DATA_YEARS.ltel` | May 15 | the school year just ending | every Apr 20 (CAPTCHA: browser download) |
| `SPSA_YEAR` | Jun 1 | the school year just ending | — |
| `IREADY_YEAR` | Jul 1 | the school year just ended | — |
| `LCAP_YEAR` | Jul 15 | the school year starting | — |
| Trustee roster | not machine-checked | — | every two years, Dec 20 (2026, 2028, …) |

How it behaves:
- From the due date a stale fact is an **advisory**; 30 days later it **fails the build**.
  The grace belongs to the release, so it doesn't restart on New Year: an overdue fact
  stays red until it's fixed.
- A newer value always satisfies an older requirement.
- A source that is genuinely late gets a **deferral** in `DEFERRALS`: the rule id, the
  occurrence's due date, an `until` date and a reason. When the deferral expires there is
  no new grace period.
- To see what the guard will say on any date: `node scripts/check-freshness.mjs --today 2027-02-20`.
- The CDE staff and absenteeism datasets aren't on this calendar; the availability probe
  still reaches them and flags new years directly.

## Still manual

### Each December, after the board reorganization
- Officer rotation, both copies above.
- Trustee roster after a November election — `data/trustees.json`, from
  `https://www.rcsdk8.net/our-district/our-board-of-trustees/meet-the-trustees`. Not probed
  (trustee areas, terms, and assignments are structured differently from the leadership
  pages). Then `scripts/fetch-leadership-photos.mjs` and `scripts/build-district.mjs`.
- CA Dashboard release: bump `CA_DASHBOARD_YEAR` in `scripts/lib/school-year.mjs`. Every
  Dashboard link goes through `caDashboardUrl()` there, so that one bump moves them all.

### Each spring
- SPSA year — school plans are approved school by school through about April, so bump
  `SPSA_YEAR` in `scripts/lib/school-year.mjs` once every school's plan is posted (the
  refresh schedule expects it by June 1). It drives both `extract-spsa-budgets.mjs` and the
  SPSA links on school pages. (`build-homepage.mjs` still has its own copy — see ROADMAP.)

### Each fall
- SSC membership — append the new year to `SSC_YEARS` in `scripts/lib/school-year.mjs`.
  Note SSC rosters are point-in-time records of an adopted SPSA and legitimately name
  people who have since moved on; they render with their adoption date.
- School clubs — `scripts/extract-school-clubs.mjs`.

### Each February
- SARC — bump `SARC_YEAR` in `scripts/lib/school-year.mjs`. `scripts/extract-sarc.mjs` now
  looks for `artifacts/documents/sarc/{year}/english/`, falls back to the legacy
  out-of-repo staging path for existing setups, accepts `--pdf-dir`, and fails naming every
  path it tried rather than reading a directory that is not there.

### November–January
- CDE bulk data. **The probe now tells you when to do this** — it checks whether CDE has
  published a year newer than the one in `CDE_DATA_YEARS`. One cycle behind prints an
  advisory; two cycles behind fails the build, because that means a whole annual refresh
  was skipped. A blocked probe reports nothing (CDE sits behind Radware bot protection that
  answers 303 under load, so "I could not tell" must not read as either answer).

  Two gotchas the probe already accounts for, both verified the hard way:
  DataQuest serves LTEL from `?year=…` and returns **HTTP 200 for any year you ask**
  (2030-31 included), with a header-only body when there is no data — so availability is
  decided by whether rows came back, not by the status code. And CDE's bot protection
  answers 303 for stretches, or 302s to a Radware CAPTCHA page (seen from 2026-10-15),
  which reports as unknown rather than as either answer.

  **LTEL usually needs a hand download.** While Radware is serving the CAPTCHA, scripts
  cannot fetch LTEL at all, and the probe cannot tell a new year is out. Check
  https://www.cde.ca.gov/ds/ad/filesltel.asp each spring (2025-26 posted 16 Apr 2026),
  download the new year in a browser, save it as `artifacts/cde/ltel-<year>.txt`, and run
  the pull below: it parses the cached file without fetching. Add a `retrieval` note to
  the output's `_metadata` saying it was a browser download. Also update the year in
  `workers/mcp-server/src/index.ts` and deploy the worker after the next pipeline run has
  uploaded the new JSON to R2.

  To ingest: `node scripts/pull-cde-data.mjs --dataset <name> --year <new-year>`
  (`--year` is required to fetch a year newer than the one recorded), confirm the output, bump
  that dataset's entry in `CDE_DATA_YEARS`, rebuild, and check the numbers actually moved
  on a school page. CDE releases the five datasets **separately** — verified 2026-08-19,
  when the three staff files had published 2025-26 and chronic absenteeism had not.

### Budget page: four reports a year
`/budget/` and `/presupuesto/` (`scripts/build-budget.mjs`) describe the current fiscal
year's budget report (`BUDGET_SOURCE` in `school-year.mjs`: adopted in late June, First
Interim in December, Second Interim in March) and the latest Unaudited Actuals
(`ACTUALS_SOURCE`, each September). The figures live in one block at the top of
`build-budget.mjs`, next to the report and page each came from. To refresh: copy the new
report's figures into that block, update `FIGURES_FROM` and the dates, then bump the
constant. **The build fails if the constant and `FIGURES_FROM` disagree**, so bumping
the constant alone cannot relabel old numbers as new ones; it also fails if a table's
rows stop adding up to its total (a rounding gap in the source itself is declared and
explained on the page). Any sentence kept from an older report names that report and its
date. The district's books are mostly scanned images: render the pages and read them, or
OCR them, rather than trusting `pdftotext`.

### Not covered, deliberately
Bell schedules, district calendars, and lunch URLs rotate each August and have no clean
machine source. They are not probed and not on this checklist as a hard requirement —
verify opportunistically. See `ROADMAP.md`.

## Staged plan

- [x] **PR 1 — leadership drift detector + first correction.** `verify-live-facts.mjs`,
  `check-freshness.mjs`, `data/freshness.json`, `tests/freshness.test.mjs`, pipeline
  wiring; four principals and the superintendent corrected; transition note made
  conditional; chapter-marker roster fixed.
- [x] **PR 2 — year-scoped constants centralized.** `scripts/lib/school-year.mjs` holds
  every year with its source and its bump trigger; `scripts/lib/cde-datasets.mjs` derives
  CDE URLs from a year instead of five hardcoded strings; the `try/catch → {}` CDE loads in
  `build-schools.mjs` now fail loudly; SARC/SPSA/SSC years and the SARC path parameterized;
  the probe reports CDE year staleness, escalating from advisory to build-failing at two
  cycles.

  Deliberately **not** included: ingesting the 2025-26 staff files that CDE has already
  published. That is a data change (tens of MB, then re-verifying every school page's
  numbers) and belongs in its own reviewable PR, not bundled with a refactor. The probe
  now nags for it.
- [ ] **PR 3 — agenda-invalidation check.** After `scrape:simbli`, ask of each newly
  posted agenda item and attachment: does this invalidate a truth the site currently
  publishes? Reports rather than hard-fails; bounded by the existing `MAX_RUN_COST`
  guard. Automates the "Agenda Pull → Theme Triage" habit in `CLAUDE.md`.
- [ ] **PR 4 — runbook finalized + roadmap.** This file kept current; deferred items
  logged.

Related but deliberately separate: the "staff roster with role dates" item in
`ROADMAP.md`. This effort does not grow into it.
