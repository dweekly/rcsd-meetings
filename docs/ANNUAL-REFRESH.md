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

The pipeline rebuilds and deploys `docs/` on every run with the full artifact set, and
never commits it. So when a change only touches `data/` or a builder, **let CI rebuild** —
committing your local `docs/` output buys nothing and can ship data loss. If you do need to
commit built HTML, sync `artifacts/` from R2 first and check the warnings.

## Facts with two copies

These must move together. Changing one and not the other is how the chapter-marker roster
went on naming a retired superintendent for seven weeks.

| Fact | Copy 1 (rendered) | Copy 2 |
|---|---|---|
| Superintendent | `data/trustees.json` → `/district` | `scripts/extract-chapter-markers.mjs` `DISTRICT_STAFF` (LLM speaker attribution) |
| Board officer rotation | `scripts/extract-chapter-markers.mjs` `OFFICER_ROTATIONS` | `scripts/build-meetings-html.mjs` (~line 714, carries a TODO) |

The board-officer rotation needs a new entry after **each December board reorganization**,
in both places. It is not yet probed.

## Still manual

### Each December, after the board reorganization
- Officer rotation, both copies above.
- Trustee roster after a November election — `data/trustees.json`, from
  `https://www.rcsdk8.net/our-district/our-board-of-trustees/meet-the-trustees`. Not probed
  (trustee areas, terms, and assignments are structured differently from the leadership
  pages). Then `scripts/fetch-leadership-photos.mjs` and `scripts/build-district.mjs`.
- CA Dashboard release: the year `2024` is hardcoded in `build-schools.mjs`,
  `build-homepage.mjs`, and `build-budget.mjs`.

### Each fall
- SPSA year — `scripts/extract-spsa-budgets.mjs`, and the SPSA URLs in `build-schools.mjs`
  and `build-homepage.mjs`.
- SSC membership — append the new year to `YEARS` in `scripts/extract-ssc-membership.mjs`.
  Note SSC rosters are point-in-time records of an adopted SPSA and legitimately name
  people who have since moved on; they render with their adoption date.
- School clubs — `scripts/extract-school-clubs.mjs`.

### Each February
- SARC — `scripts/extract-sarc.mjs`. Currently reads a hardcoded `2024-25` directory under
  an out-of-repo path (`../../nanoclaw/…`); both need fixing, see PR 2 below.

### November–January
- CDE bulk data — the five dataset URLs in `scripts/pull-cde-data.mjs` have the year baked
  into the filename (`stre2425.txt`, `chronicabsenteeism25-v2.txt`, …).
  **Do not bump these before PR 2 lands.** `scripts/build-schools.mjs` loads the five
  outputs each wrapped in `try/catch → {}`, so a renamed file makes school pages silently
  render without absenteeism, LTEL, and staffing data. No error, no test.

### Not covered, deliberately
Bell schedules, district calendars, and lunch URLs rotate each August and have no clean
machine source. They are not probed and not on this checklist as a hard requirement —
verify opportunistically. See `ROADMAP.md`.

## Staged plan

- [x] **PR 1 — leadership drift detector + first correction.** `verify-live-facts.mjs`,
  `check-freshness.mjs`, `data/freshness.json`, `tests/freshness.test.mjs`, pipeline
  wiring; four principals and the superintendent corrected; transition note made
  conditional; chapter-marker roster fixed.
- [ ] **PR 2 — year-scoped constants centralized.** `scripts/lib/school-year.mjs` as the
  one definition; the `try/catch → {}` at `build-schools.mjs` becomes a loud failure
  *before* any year bump; CDE URLs bumped where published; SARC/SPSA/SSC year and path
  parameterized; `freshness.json` extended to assert dataset years so an unpublished
  ingest goes red.
- [ ] **PR 3 — agenda-invalidation check.** After `scrape:simbli`, ask of each newly
  posted agenda item and attachment: does this invalidate a truth the site currently
  publishes? Reports rather than hard-fails; bounded by the existing `MAX_RUN_COST`
  guard. Automates the "Agenda Pull → Theme Triage" habit in `CLAUDE.md`.
- [ ] **PR 4 — runbook finalized + roadmap.** This file kept current; deferred items
  logged.

Related but deliberately separate: the "staff roster with role dates" item in
`ROADMAP.md`. This effort does not grow into it.
