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
