# Agenda Item Content: Capture → Render → Translate → Backfill

Goal: every board agenda item's full content (Quick Summary/Abstract,
Recommendation, Rationale, Financial Impact, Background, Contacts, …) is
captured, shown on the meeting pages in both languages, full-text searchable,
and backfilled across the historical corpus.

Motivation: the scraper recorded only item titles + attachments (`memo: {}`),
so the substance the board actually reads was missing. This surfaced when the
June 24 "sale of district equipment to the retiring superintendent" item looked
undocumented in our data when the memo in fact states a $1,025 fair-market
valuation. We were missing context on every item.

## Phase 0 — Retrieve (DONE, PR #56)
- `scrape-simbli-agendas.mjs` fetches `GetMeetingItemDetailsModel` per item and
  flattens `ItemContents` into `memo` keyed by field title (`htmlToText`).
- Per-item provenance (created/modified by + time) recorded.
- `mergeWithExisting` prefers fresh memo so revised agendas overwrite stale text.
- Verified: 48/61 items on MID 51017 carry content. Committed to board-memos.

## Phase A — Carry content through + render on EN meeting pages
The captured content lives only in `board-memos/*.json`. It is NOT in
`meetings-data.json`, NOT rendered, NOT searchable. parse-formal-agenda.mjs
carries only `Speaker` through.

- `parse-formal-agenda.mjs`: add `content` to the item schema — an ordered
  array `[{label, text}]` from `item.memo` (excluding `Speaker`, already used).
- Do NOT put full prose in `meetings-data.json` (8k+ items would bloat the
  browser-loaded blob to multiple MB). Instead `build-meeting-pages.mjs` reads
  `board-memos/{date}.json` directly (it already loads memoDir) and renders the
  content server-side under each agenda item in `buildAgendaHtml`.
- Render as a collapsible block per item (labeled sections), escaped via
  `escapeHtml`. Server-side → Pagefind indexes it automatically.
- Acceptance: June 24 page shows 16.16's $1,025 valuation; Pagefind search for
  "fair market value" returns the meeting.

## Phase B — Translate memos to Spanish
- New `translate-memos.mjs` (model after `translate-transcripts.mjs`): translate
  each item's content fields to ES via Anthropic, cache by content hash to avoid
  re-paying. Output `data/board-memos-es/{date}.json` (or inline `contentEs`).
- `build-meeting-pages.mjs` ES locale renders translated content; EN content
  shown with an "original English" note only where a translation is missing.
- Wire into run-pipeline after scrape, before page build (full mode only).

## Phase C — Backfill historical corpus (chunked, trogdor)
- One-time `scrape-simbli-agendas.mjs --refresh` over the corpus in date-range
  chunks (e.g. per school-year, or month buckets) to populate content for the
  ~196 historical meetings. Paced to avoid Incapsula rate limits.
- Then translate + rebuild + deploy. Filenames preserved by merge (no packet
  re-downloads).
- Decision: full archive back to 2020 vs recent-season only — chosen: full
  corpus.

## Sequencing
A (render EN) → B (ES translate) → C (backfill, so backfilled content also gets
translated/rendered). Each phase is its own tested PR.
