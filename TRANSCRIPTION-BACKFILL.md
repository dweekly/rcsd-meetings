# Full-Corpus Transcription Backfill (July 2026)

**Goal:** re-transcribe all ~169 meeting recordings with AssemblyAI
Universal-3.5 Pro, replacing a corpus that is 83% Universal-2 (the March 2026
backfill's `speech_model: 'best'` alias resolved to Universal-2 for
pre-2026-02-04 accounts) and 100% affected by the `speakers_expected: 10`
diarization anchor.

## Why (validated 2026-07-12 → 07-16, seven test re-transcriptions)

- **Spanish testimony is missing from the archive.** Universal-2 dropped whole
  Spanish public comments (2026-01-13 study session: ~14 min / ~1,800 words of
  parent testimony reduced to fragments; one comment survived as the literal
  string "Or in spanish."). 3.5 Pro with `language_detection: true` transcribes
  them as fluent Spanish — no extra config.
- **Diarization was anchored.** `speakers_expected: 10` forced every meeting to
  exactly 10 voices, merging distinct public commenters. The
  `speaker_options {min: 5, max: 30}` range found 21 real voices on the same
  audio with no over-splitting (commit `cad68600`).
- **District vocabulary.** CAASPP ("cast data"), ELPAC ("LPAC"), i-Ready
  ("the irony assessment"), Taft ("at task") all recovered; per-era trustee
  names improve (Díaz-Slocum 1→6 in one meeting).

## Request config (frozen)

The exact options in `scripts/transcribe-assemblyai.mjs` as of `cad68600`:
`speech_models: ['universal-3-5-pro', 'universal-2']`, `speaker_labels: true`,
`speaker_options: {min_speakers_expected: 5, max_speakers_expected: 30}`,
`language_detection: true`, `disfluencies: false`, `remove_audio_tags: 'all'`,
`temperature: 0.1`, and the era-aware contextual `prompt`. Effective rate
$0.28/hr ≈ **$95–100 for the corpus**. Deliberately excluded: keyterms_prompt,
entity/sentiment/highlights add-ons, auto_chapters (silent 500s on 3.5 Pro),
custom_spelling (reserved for the separate normalization pass).

## How it runs

`scripts/backfill-transcripts.mjs`, on trogdor in a **standalone clone at
`~dew/rcsd-backfill/` (home filesystem, 1.2TB free; /mnt/data is root-owned)** — never the Actions runner workspace, so scheduled
pipeline runs can't collide with it. Audio is pre-staged from the R2 mirror
(`data.rcsd.info/audio/{videoId}.webm`), not YouTube. Resumable: transcripts
already showing `speech_model_used: 'universal-3-5-pro'` are skipped on
restart. Sequential; expected wall time ~8–12 h.

## Publish gate (deliberate)

The backfill writes only to the standalone clone's `artifacts/transcripts-aai/`.
**Nothing reaches production until the transcripts are QA-reviewed** (speaker
count distribution, confusables grep, Spanish recovery, spot-reads) and the
downstream cost is acknowledged: copying them into the runner workspace cache
triggers the next scheduled pipeline to regenerate slim transcripts and
re-translate every Spanish transcript via the Claude API (est. multiple hours
of pipeline time; cost measured on the first tranche before committing the
rest if it looks large).

Publish step, once approved:
```bash
ssh trogdor 'cp ~/rcsd-backfill/rcsd.info/artifacts/transcripts-aai/*.json \
  /mnt/data/actions-runner/_work/rcsd-meetings/rcsd-meetings/artifacts/transcripts-aai/'
```
then let the scheduled pipeline run (or dispatch it) to rebuild and sync R2.

## Known follow-ups

- **Normalization pass (separate task):** confusables seen so far — 3.5 Pro
  writes "LCP" for spoken LCAP in Zoom-era audio, and "Trustee Lee" for
  Trustee Li. Grep the finished corpus for more before deciding between
  `custom_spelling` at transcription time vs. a post-pass.
- **Screenplay view (separate task):** AAI speaker identification works
  post-hoc on stored transcript IDs (no audio re-upload) but low/medium effort
  gave conflicting mappings and hallucinated an absent trustee; needs a
  verification layer (roll-call parsing + LLM cross-check) before publishing
  named attribution. Per-utterance en/es tagging is local and trivial.
- The old Universal-2/3-Pro transcripts remain in R2 until the publish step
  overwrites them; each transcript self-documents its model in
  `speech_model_used`.
