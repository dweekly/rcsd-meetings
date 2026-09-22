# Meeting summaries from transcripts

## Why

The summary on a meeting card is the only description most visitors ever read of
a board meeting. Where it is written from agenda item titles it can only say what
the board *planned* to take up — "The Board was scheduled to consider approval of
multiple service agreements" — never what it decided.

For a meeting that has already happened, the recording is a better source. It
carries the outcome, the debate, the item that got pulled, and the vote. This
adds a second generator that writes a meeting's summary from its transcript,
using the agenda's own time allocations (see
[`scripts/lib/agenda-weight.mjs`](../scripts/lib/agenda-weight.mjs)) to decide
which of the evening's subjects were the substance.

### What a transcript can and cannot tell you

Measured across the 17 meetings between 2025-07-01 and 2026-09-21 whose summaries
cite specific figures:

- **Dollar figures are mostly not spoken.** 6 of 37 appear anywhere in the
  transcript, counting spoken forms ("14.3 million") as well as digits. The rest
  live in the board packet PDFs that staff write and trustees read.
- **Outcomes are spoken.** 6 of the 7 meetings citing a vote carry roll-call
  language — "all in favor", "aye", "opposed", "passes unanimously".
- **The agenda supplies identity, the transcript supplies the event.** On
  2026-09-09 the transcript says staff are "pulling 7.17, 7.18, and 7.19 for a
  minor procedural amendment"; only the agenda knows those are Board Policies
  4113.5, 4213.5 and 4313.5. Both are sent, for exactly this reason.

This bounds what the generator is for. It replaces **agenda-derived** summaries,
which have no outcomes at all. It does **not** replace the hand-written summaries
carried since the initial release: those cite packet figures the recording never
says aloud, and regenerating them would trade published numbers for narrative.

### Intent

An accurate, scannable account of each meeting's substantive business, in both
languages, that a reader can trust and trace. What is not acceptable is losing
detail the site already publishes, or asserting anything the sources do not
support.

## What must be true

```bash
# 1. A bulk run over the whole range is a no-op: the nine are already done and
#    the other 25 are protected from it.
node scripts/generate-transcript-summaries.mjs --range 2025-07-01:2026-09-21
git diff --quiet data/meeting-summaries.json data/meeting-summaries-es.json

# 2. Unit suite: provenance guard, key derivation, and data consistency.
npm run test:transcript-summaries

# 3. The whole suite still passes.
npm test          # test:triage excepted; it fails on main for an unrelated reason
```

Checked by reading, not by command: every figure, vote count and name in a
generated summary must be traceable to the transcript or the agenda. Verified for
this change on 2026-08-26 (`$1,192,530`, Trustee King absent, Measure C),
2026-06-24 (Rubalcaba, 46 years, 45-day revision, Title I) and 2026-09-09 (the
pulled items above).

## Where the work happens

- Worktree: `~/dev/rcsd/rcsd.info-transcript-summaries`
- Branch: `feat/transcript-summaries`, stacked on `feat/agenda-time-weighting`
- Merges after PR #123

## Design

### Input

`artifacts/transcripts-slim/<date>.json` — `utterances[]`, joined. The whole
transcript is sent: the largest board meeting in range is 208,054 characters
(2025-11-12), about 52,000 tokens. Truncation would be worse than it sounds,
because action items are voted at the **end** of a board meeting, which is
exactly what a cap removes. `generate-committee-summaries.mjs` caps at 120,000
characters; nine board transcripts in range exceed that, and revisiting it is
filed in ROADMAP.

The ranked agenda is sent alongside.

### Output

The existing `data/meeting-summaries.json` and `data/meeting-summaries-es.json`,
unchanged in shape — a flat key → string map. No consumer changes
(`build-homepage.mjs`, `build-meetings-html.mjs`, `build-meeting-pages.mjs`,
`build-ics.mjs`, `lib/discovery-datasets.mjs`).

### Provenance

`data/meeting-summaries-provenance.json`, keyed the same way, recording
`{source, transcriptKey, model, generatedAt}` per summary. A sidecar rather than
a schema change, so nothing that reads summaries today has to change.

It is what lets the two generators coexist safely:

- `generate-meeting-summaries.mjs` skips any key that already has a summary, and
  additionally **refuses to regenerate a transcript-derived entry even under
  `--refresh`**. Without that, the nightly pipeline would walk this work back to
  agenda prose.
- `generate-transcript-summaries.mjs` **refuses to overwrite a summary with no
  provenance record** unless the run names that meeting's date outright. Those are
  the hand-written summaries, and `--range` is a bulk instrument that must not be
  able to reach them.
- The record carries `enHash`, a fingerprint of the summary text it describes, so
  a skip is decided on the text that is actually present. The sidecar and the
  summary files can be restored from git independently, and a flag alone cannot
  tell that they have drifted apart.

### Model

`claude-sonnet-4-6` — reading a three-hour meeting and telling a decision from a
discussion of one is the whole task. The agenda-title path stays on Haiku, where
there is nothing to reason about. Model ids in this project carry no date suffix.

### Accuracy guardrails

The agenda states how many consent items were **scheduled**, never how many
passed: boards pull items at the top of the evening (three on 2026-09-09, three
on 2026-08-10), so presenting the scheduled count as an outcome publishes a
number wrong by exactly the withdrawn items. The outline says "SCHEDULED" and
sends the model to the transcript for the disposition.

Spanish house style is enforced rather than requested. The existing 196 Spanish
summaries call the board "la junta" or "la mesa directiva" and never
"los fideicomisarios"; asking in the prompt got it right seven times in nine,
twice over. `houseStyleViolation()` now checks the output and retries with a
correction, failing the meeting rather than publishing off-register Spanish. The
check is case-sensitive and matches only the collective — "Trustee King" is that
person's title and must survive into the Spanish.

Also in the prompt, and checked by reading:

- Name a figure, vote count or resolution number only where the transcript or
  agenda states it.
- Where the transcript does not record an outcome, say the board discussed or
  heard the item — not that it approved it. A missing outcome means the recording
  did not capture it, not that nothing happened.
- Past tense; these meetings happened.

### Labeling

Summaries are already labeled AI-generated wherever shown. The provenance sidecar
makes the source of any individual summary checkable.

## Scope

**In:** the nine meetings between 2025-07-01 and 2026-09-21 whose summaries were
agenda-derived and which have a transcript — 2026-03-11, 2026-04-01, 2026-05-27,
2026-06-10, 2026-06-17, 2026-06-24, 2026-08-10, 2026-08-26, 2026-09-09.

**Out:**

- The hand-written summaries, for the reason above.
- 2026-07-16 and 2026-07-22: agenda-derived but never recorded, so there is no
  better source. They keep the agenda-ranked summary from PR #123.
- Meetings before 2025-07-01. The generator takes `--range`, so widening this is
  a decision, not new code.
- Board packet text. Pairing the transcript with the packets of the top-ranked
  items is the design that would beat the hand-written summaries on their own
  ground; the ranking makes it tractable (on 2026-02-04 the top six items carry
  10 attachments of the meeting's 69). Filed in ROADMAP, not built here.
- Spanish transcripts. `<date>-es.json` exists, but both languages come from one
  request over the English transcript, as elsewhere in this repo.

## Producers for every consumed state

| Consumed | Produced by |
|---|---|
| `artifacts/transcripts-slim/<date>.json` | `scripts/restore-cache.mjs` (R2 sync) |
| `meeting.items[].plannedMinutes` | `scripts/parse-formal-agenda.mjs` via `scripts/lib/agenda-duration.mjs` |
| item ranking | `scripts/lib/agenda-weight.mjs` (`rankItems`) |
| summary key (date vs slug) | `scripts/lib/meeting-summary-key.mjs`, shared by both generators |
| summary provenance | `scripts/lib/summary-provenance.mjs` |

## Known issue, filed not fixed

`scripts/build-meeting-pages.mjs:1008` reads `summaries[m.date]` only, ignoring
the slug key used when two meetings share a date. Those meetings show no summary
on their detail page. Pre-existing; unrelated to this change.
