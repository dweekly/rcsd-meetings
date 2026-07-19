# Speaker Maps: Named/Role Attribution for Meeting Transcripts

**Goal:** map each diarized speaker letter in a transcript to a person and/or
role with evidence-backed confidence, producing a "screenplay" view (who said
what, with utterance timing, disfluencies removed, per-utterance en/es language
tags) and `data/speaker-maps/{date}.json` for meeting pages.

Status 2026-07-18: prototyped on the 2026-02-11 meeting (validated against
trustee ground truth); not yet built as a pipeline stage.

## Trust hierarchy (validated empirically)

1. **Minutes (primary).** The district's approved minutes are the authoritative
   speaker record: attendance with roles and canonical name spellings
   ("Present … Others Present"), absences, who chaired, per-item presenters,
   and mover/seconder on every motion ("Márquez, Li; 5-0"). They also capture
   per-meeting truth a static roster can't: title changes, substitutes, and
   one-meeting attendees. Archive gap: `artifacts/minutes/` holds 52 PDFs
   (through 2026-01-21); ~158 meetings have minutes mapped in packet data — a
   minutes-archive backfill is a prerequisite for corpus-wide coverage.
2. **Transcript-internal deterministic evidence.**
   - Roll call: "Trustee X? / Here" adjacency — but rapid roll calls merge
     answers into neighboring speakers, so any letter answering for two names
     is disqualified, and called names must be normalized against the
     confusables list ("Vice President Marcus" = Márquez, "Trustee Lee" = Li).
   - Chair-announced speakers: "Our next speaker is <name>" → the next new
     voice. Public commenters are otherwise absent from minutes.
   - Self-introductions, bilingual: "My name is … / Mi nombre es …".
   - Cross-reference elimination: "I'll echo what Mike said" proves that
     speaker is not Wells.
3. **AssemblyAI Speaker Identification (candidates only).** Post-hoc on a
   stored `transcript_id` (no audio re-upload) via the `speech_understanding`
   API; `speaker_type` name|role, effort low|medium (no high), **max 10 input
   speakers**. Verified failure modes: low and medium disagree with each other;
   both agreed on a wrong clerk mapping (correlated errors — consensus is not
   verification); hallucinated an absent trustee even when the transcript says
   "President Weekly is absent"; invents names beyond the provided roster from
   in-transcript mentions (sometimes right — announced commenters — sometimes
   ghosts like a former superintendent mentioned in passing). Pricing not yet
   confirmed — check the AssemblyAI billing page.

The reconciler applies evidence in that order, records the evidence type per
assignment, flags conflicts for review, and leaves unresolved letters as
letters. Correct-but-partial beats complete-but-wrong: the prototype named
4/20 speakers (32% of words) with zero errors.

## Roles are time-scoped — sometimes within one meeting

Roles must be modeled as (person, role, interval), not per-meeting constants.
The December annual organizational meeting is the forcing case: it **opens**
with the outgoing officers presiding (roll call uses the old titles), then an
agenda item elects new officers who take over **mid-meeting** — so "President"
refers to different people before and after that item, in the same recording.
The minutes record each election and its vote; the timestamp map bounds the
agenda item in the video, giving the interval boundary. All role-derived
evidence (chair heuristics, "Vice President X?" roll-call titles) must carry
the timestamp it was observed at and resolve against the interval-valued role
table. Era tables (`BOARD_ERAS`) have day granularity and are fine for
transcription prompts, but not for role attribution on reorganization days.

## Editorial policy (decided 2026-07-18)

Full-name attribution is in scope: everything here is synthesized from the
public record (speakers identify themselves on the record in a noticed public
meeting), so name-level speaker maps are publishable. Attribution accuracy is
the bar — a name only ships when the evidence chain supports it; uncertain
letters stay unnamed rather than guessed.

## Pipeline sketch

1. Backfill `artifacts/minutes/` from archived board packets (existing
   extraction machinery; minutes live as pages inside the following meeting's
   packet, see `data/minutes-aids.json` / `data/agenda-attachments.json`).
2. `extract-minutes-roster.mjs`: pdftotext → attendance/roles/absences/motions
   per meeting (light LLM assist for irregular formats), emitting the
   interval-valued role table (splitting on reorganization items).
3. `build-speaker-map.mjs`: deterministic transcript evidence + AAI candidates
   (roster from step 2, ≤10 names) → reconciled `data/speaker-maps/{date}.json`
   with per-assignment evidence provenance.
4. Screenplay renderer + per-utterance language tagging (local detection; the
   API does not tag language per utterance).
