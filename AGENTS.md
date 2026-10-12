# AGENTS.md — rcsd.info

Orientation for AI coding agents working in this repository. Human-facing project docs live in `README.md`; operator-specific hosting config lives in `CLAUDE.md` (gitignored, so not visible to every agent — this file is the committed, tool-agnostic equivalent).

## What this is

`rcsd.info` is a static, bilingual data site for the Redwood City School District (RCSD), a TK-8 public district. Node.js scripts in `scripts/` read JSON from `data/`, pull large/binary artifacts from `artifacts/` (hosted on Cloudflare R2), and generate the static site in `docs/`.

## Before answering data questions — read the skill

All RCSD data — schools, 190+ board meetings, demographics, special education, charters, **district property holdings**, budgets, calendars — is indexed as small JSON files in `data/`.

**Read [`plugin/skills/rcsd-data/SKILL.md`](plugin/skills/rcsd-data/SKILL.md) first.** It is the canonical map of `data/`: which file answers which question, the school-slug table, query strategy, and data caveats. Field-by-field schemas are in [`plugin/skills/rcsd-data/references/data-schema.md`](plugin/skills/rcsd-data/references/data-schema.md).

Do not grep `data/` blind, and do not assume a fact isn't recorded — check the skill's Data File Inventory first. Example: `data/properties.json` indexes every district-owned or district-leased property that is *not* an operating school (admin buildings, leased-out former campuses, storage), keyed by address.

The skill ships as a plugin (`plugin/`) and does not auto-load in a plain Claude Code session, so open it explicitly.

## Conventions

- **Provenance is non-negotiable** — Every bit of data pulled from external sources must have a link back to the official source along with when it was checked/scraped. This applies to **both** the user-facing plain English/Spanish templates (HTML) and the machine-readable information (`_metadata` block in JSON files containing `source`, `scrapedAt`, and `method`). See `README.md`.
- **Bilingual by default** — every user-visible artifact ships English *and* Spanish (`/schools/` + `/escuelas/`, OG cards, PDFs, etc.).
- **Adding data?** Follow the Dataset Expansion Checklist in `CLAUDE.md` — it requires updating the skill's `SKILL.md` and `data-schema.md` so new data stays discoverable. Skipping that step is what makes the skill go stale.
- **Git** — never squash merge; use merge commits to preserve history.
- **Small probe before corpus run** — before dispatching any corpus-scale or hours-long pipeline run, vet the changed path end-to-end with the smallest unit: one meeting via `--date` on the transcribe/translate/marker scripts, or a `quick=true` workflow dispatch (~8 min, exercises the full upload+deploy path). Verify at the destination (R2 bytes, production page), not at "run succeeded" — the July 2026 re-transcription burned five 2-hour cycles and a 6-hour translation run discovering failures a probe would have caught in minutes.
- **Publish public records; don't gate them** — if a record is already public at its source (warrant registers and the employee-reimbursement names in them, agendas, minutes, transcripts), the structured version goes to the data API (`data.rcsd.info/json/`) like everything else. Republishing public records in usable form is the site's purpose, not a privacy risk. How prominently a rendered page surfaces individual names is a separate presentation question. When unsure, check whether the source already publishes it before adding caution.

## Before you commit, open a PR, or deploy

- **A worktree build regresses `meetings-data.json`.** `scripts/build-meetings.mjs` derives `hasTranscript`, `duration`, `durationSeconds` and `stats.withTranscript` from the transcript artifacts (`artifacts/transcripts-*`, synced from R2). A fresh worktree has none, so any local build or pipeline run rewrites the file with transcripts flipped to false and durations dropped, while the meeting count stays the same and the diff looks ordinary. `git restore data/meetings-data.json` rather than committing that, and stage by explicit path, not `git add -A`. For a correct local build, first sync both transcript caches the way `.github/workflows/pipeline.yml` does: `rclone copy r2:rcsd-meetings/transcripts/ artifacts/transcripts-slim/` and `rclone copy r2:rcsd-meetings/transcripts-aai/ artifacts/transcripts-aai/`. The raw `transcripts-aai/` copy is the one `scripts/lib/aai.mjs` reads for transcript availability and durations; the slim copy alone does not prevent the regression.
- **Client JS emitted from a template literal loses its backslashes.** Several builders (`build-meeting-pages.mjs`, `build-search.mjs`, `build-policies.mjs`, among others) write client-side `<script>` code inside JS template literals, so a regex written as `/\s+/` ships as `/s+/`, silently wrong. Double every backslash in emitted client code (`\\s`), and after building, grep the generated HTML in `docs/` for the regex as it should appear rather than trusting the source.
- **Look at the rendered page.** For any change to a builder, template or CSS, serve `docs/` locally (`cd docs && python3 -m http.server`; Playwright blocks `file://`) and screenshot the affected section at desktop and mobile widths, in English and Spanish, before committing or opening a PR. Checking the emitted HTML strings is not enough: a layout can pass every string check and still look broken.
- **Verify unfamiliar APIs in a real browser.** Before writing integration code against a library you have not used here (Pagefind's Component UI is the standing example), load it in Playwright or Chrome DevTools, enumerate the live API object, run the candidate calls, and read the console. Public docs and recalled signatures are often incomplete or wrong. For search or ranking changes, judge quality by running real queries and reading the top results, not by counts.
