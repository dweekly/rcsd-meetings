# Meeting summaries from transcripts

## Why

The summary on a meeting card is the only description most visitors ever read of
a board meeting. Today it is written from agenda item titles, which means it can
only ever say what the board *planned* to take up — never what it decided.

Two separate problems come from that:

1. **Agenda titles rank badly.** A sixteen-line consent block outweighs a single
   staff report by line count alone. `feat/agenda-time-weighting` (PR #123) fixes
   the ranking by reading the time the agenda allocates to each section, which is
   the district's own statement of what a meeting is about.
2. **Agenda titles cannot carry outcomes.** No amount of ranking gets a vote
   count or a dollar figure out of "Approval of the 2025-26 Unaudited Actuals
   Financial Report". The 18 best summaries on the site today are hand-written
   and say things like "Board voted 4-0 to initiate IDEA due process" and
   "solar change orders returning $2.29M to the district". Nothing regenerates
   those, so they exist only where somebody wrote them by hand.

29 of the 34 meetings from July 2025 to date have a transcript sitting in
`artifacts/transcripts-slim/`. The transcript records what actually happened.
Summarizing from it produces a summary that is both correctly ranked and
carries outcomes — strictly better than the agenda-derived and the hand-written
summaries it replaces.

This serves the site's purpose directly: parents, journalists and board members
reading `/meetings/` should be able to tell what a meeting *did*, not only what
it listed.

### Intent, for a reader deciding whether some other design would serve as well

The goal is an accurate, scannable account of each meeting's substantive
business, in both languages, that a reader can trust and trace. Any approach
that produces that is acceptable. What is **not** acceptable is losing the
outcome detail that the hand-written summaries already carry, or publishing
claims the transcript does not support.

## What must be true

Acceptance criteria, each a command that passes or fails end to end.

```bash
# 1. The generator is idempotent: a second run with no --force changes nothing.
node scripts/generate-transcript-summaries.mjs --range 2025-07-01:2026-09-21
git diff --quiet data/meeting-summaries.json data/meeting-summaries-es.json

# 2. Every meeting in range that has a transcript has a transcript-derived
#    summary, and every one of those records its provenance.
node scripts/check-summary-provenance.mjs --range 2025-07-01:2026-09-21

# 3. The unit suite passes, including the range/selection and provenance rules.
npm run test:transcript-summaries

# 4. The agenda-based generator never overwrites a transcript-derived summary,
#    including under --refresh.
npm run test:transcript-summaries   # covers this as a named case

# 5. The whole suite still passes.
npm test                            # test:triage excepted; it fails on main
```

Beyond the commands, two qualities are checked by reading a sample of ten
regenerated summaries side by side with the transcript:

- every dollar figure, vote count and name in the summary appears in the
  transcript (no invented specifics);
- the Spanish reads as sixth-grade Californian Spanish, not a literal
  translation of English syntax.

## Where the work happens

- Worktree: `~/dev/rcsd/rcsd.info-transcript-summaries`
- Branch: `feat/transcript-summaries`, stacked on `feat/agenda-time-weighting`
  (it consumes `scripts/lib/agenda-weight.mjs` from that branch)
- PR: opened against `feat/agenda-time-weighting`, merged after PR #123

## Design

### Input

`artifacts/transcripts-slim/<date>.json` — `utterances[]` with `text` and
speaker. The largest board transcript in range is 208,054 characters
(2025-11-12), about 52,000 tokens, so **the whole transcript is sent without
truncation**. This matters: `generate-committee-summaries.mjs` caps at 120,000
characters, which on a board meeting cuts the end — exactly where the action
items are voted. Nine of the 29 transcripts in range exceed that cap.

The agenda is sent alongside the transcript, ordered by
`rankItems()` from `scripts/lib/agenda-weight.mjs`, so the model knows which
topics the district itself treated as the substance of the meeting and can
attach what it hears in the transcript to the right item.

### Output

Existing files, unchanged shape — `data/meeting-summaries.json` and
`data/meeting-summaries-es.json`, keyed by date (or slug where a date has two
meetings). Consumers (`build-homepage.mjs`, `build-meetings-html.mjs`,
`build-ics.mjs`, `lib/discovery-datasets.mjs`) keep reading a flat
key → string map and need no change.

### Provenance

A new sidecar, `data/meeting-summaries-provenance.json`, keyed the same way:

```json
{
  "2026-02-04": {
    "source": "transcript",
    "transcriptKey": "2026-02-04",
    "model": "claude-sonnet-4-6",
    "generatedAt": "2026-09-21"
  }
}
```

A sidecar rather than a schema change, so nothing that reads the summaries today
has to change. This is what makes the two generators safe to coexist:

- `generate-meeting-summaries.mjs` (agenda-based) already skips any key that
  exists, and gains one rule: **never delete or overwrite an entry whose
  provenance says `transcript`**, including under `--refresh` /
  `--refresh-no-minutes`. Without that rule the nightly pipeline would
  eventually flatten this work back to agenda prose.
- `generate-transcript-summaries.mjs` (new) writes both summary files and the
  provenance record together.

Entries with no provenance record are the pre-existing hand-written ones. They
are treated as `unknown` and are **replaced** by a transcript-derived summary
when one is generated — that is the point of the effort — but never by the
agenda-based generator.

### Model

`claude-sonnet-4-6`. The task is reading a 3-hour meeting and separating
decisions from discussion; Haiku is used for the agenda-title path, where there
is no reasoning to do. Cost for the 29 meetings in range is roughly 660,000
input tokens, about $2.

Per the project rule, the model id carries no date suffix.

### Tense and accuracy

These meetings have happened, so summaries are written in decisive past tense.
Two guardrails go in the prompt and are checked by reading the sample:

- **Attribute only what the transcript supports.** A vote count must have been
  said aloud. If the transcript does not record an outcome, the summary says the
  board discussed the item, not that it approved it.
- **Absence of evidence is not evidence of absence.** A missing outcome means
  the recording did not capture it, not that nothing happened.

### Labeling

Already handled: `/meetings/` labels summaries AI-generated, and README records
the pipeline. README's data-source table gains the transcript path, and the
provenance sidecar makes the source of any given summary checkable.

## Scope

**In:** 34 meetings dated 2025-07-01 through 2026-09-21. The 29 with transcripts
get transcript-derived summaries; the 5 without
(2026-07-22, 2026-07-16, 2025-12-13, 2025-11-21, 2025-08-12) keep the
agenda-ranked path from PR #123.

**Out:**

- Meetings before 2025-07-01. The generator takes a `--range`, so extending the
  rewrite to the full archive is a decision to make later, not new code.
- Changing what the meeting *pages* show. Only the card summary changes.
- Spanish transcripts. `artifacts/transcripts-slim/<date>-es.json` exists, but
  both languages come from one request over the English transcript, as elsewhere
  in this repo. Summarizing the Spanish transcript separately is a possible
  future improvement, not this change.
- Re-transcription. Whatever is in `transcripts-slim` is the input.
- Committee summaries. `generate-committee-summaries.mjs` keeps its own path,
  though its 120,000-character truncation is worth revisiting and is filed in
  ROADMAP rather than fixed here.

## Producers for every consumed state

Checked by grep, not assumed:

| Consumed | Produced by |
|---|---|
| `meeting.hasTranscript` | `scripts/build-meetings.mjs` from `artifacts/transcripts-*` presence |
| `artifacts/transcripts-slim/<date>.json` | `scripts/restore-cache.mjs` (R2 sync); written upstream by the transcription pipeline |
| `meeting.items[].plannedMinutes` | `scripts/parse-formal-agenda.mjs`, via `scripts/lib/agenda-duration.mjs` |
| item ranking | `scripts/lib/agenda-weight.mjs` (`rankItems`) |
| summary key (date vs slug) | `getSummaryKey()` in `scripts/generate-meeting-summaries.mjs` — must be shared, not reimplemented |
| summaries read for display | `build-homepage.mjs`, `build-meetings-html.mjs`, `build-ics.mjs`, `lib/discovery-datasets.mjs` |

The key derivation is the one genuine trap: two meetings on one date are keyed
by slug, and a second implementation of that rule would silently write summaries
under keys nothing reads. It gets exported from its current home and imported.

## Open: the premise above does not survive checking

Plan review, confirmed by measurement, found that the specifics in the existing
hand-written summaries are mostly **not spoken aloud**. Across the 17 rich
summaries in range that have a transcript, 6 of 37 dollar figures appear in the
transcript text (matching number words as well as digits — the transcript says
"14.3 million", not "$14.3M"). Those figures live in the board packet PDFs,
which staff write and the board reads, not in what anyone says at the meeting.

So a transcript-only rewrite is **not** strictly better than what it replaces:
it would gain discussion and outcomes and lose most published dollar figures.
Vote outcomes do survive — 6 of the 7 meetings citing a vote count carry roll-call
language ("all in favor", "aye", "unanimous") — but as outcomes, not as tallies.

The design this points to is transcript **plus** the packet attachments of the
top-ranked agenda items. The time-ranking makes that tractable: on 2026-02-04 the
top six items carry 10 attachments out of the meeting's 69.

This section stands until the approach is settled; the plan above is not yet
buildable as written.
