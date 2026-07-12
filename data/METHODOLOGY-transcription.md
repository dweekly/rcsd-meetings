# Board Meeting Transcription Methodology

## Overview

All RCSD board meeting recordings posted to the district's YouTube channel are transcribed using AssemblyAI's Universal-3.5 Pro speech recognition model with speaker diarization (meetings transcribed before July 2026 used Universal 3 Pro). This replaces the YouTube auto-generated captions, which suffer from poor accuracy on proper nouns, missing punctuation, and no speaker attribution.

## Audio Source

- **Source:** YouTube videos from the RCSD Board of Trustees channel
- **Download tool:** `yt-dlp` (version 2026.03.03+)
- **Audio format:** Opus codec in WebM container (format ID `251`)
- **Sample rate:** 48 kHz
- **Bitrate:** ~103 kbps (variable)
- **Why Opus/251:** YouTube offers three audio-only streams per video:
  - `139`: AAC-HE, 49 kbps, 22 kHz — too low quality
  - `140`: AAC-LC, 129 kbps, 44 kHz — good quality, widely compatible
  - `251`: Opus, 103 kbps, 48 kHz — highest sample rate, native speech codec

  We chose format 251 (Opus) because it provides the highest sample rate (48 kHz vs 44 kHz), Opus is specifically designed for speech fidelity, and AssemblyAI natively decodes Opus without transcoding. The raw WebM container is uploaded directly to AssemblyAI with no intermediate processing (no ffmpeg, no format conversion) to avoid any generation loss.
- **Download command:** `yt-dlp -f bestaudio --no-warnings -o <output> <youtube-url>`
- **Cache:** `artifacts/audio/{videoId}.webm` — permanent local cache, never re-downloaded
- **Published:** `https://data.rcsd.info/audio/{videoId}.webm`

## Transcription Service

- **Provider:** AssemblyAI
- **Model:** Universal-3.5 Pro (`speech_models: ['universal-3-5-pro', 'universal-2']` in API; Universal-2 is the automatic fallback for languages Universal-3.5 Pro doesn't cover). Transcripts produced before 2026-07-12 used Universal 3 Pro.
- **Speaker diarization:** Enabled (`speaker_labels: true`)
- **Word-level timestamps:** Included by default (millisecond precision)
- **Word boost:** Custom vocabulary list to improve recognition of district-specific terms:
  - Board members: Trustee Weekly, Trustee Sena, Trustee Hanna, Trustee Varma, Trustee Patel
  - District leadership: Superintendent Ramsey, Dr. Ramsey
  - School names: Adelante Selby, Clifford, Garfield, Henry Ford, Hoover, Kennedy, McKinley, North Star, Orion, Roosevelt, Roy Cloud, Taft
  - Acronyms/programs: RCSD, LCAP, SPSA, CAASPP, ELPAC, CSSP, Measure U, Measure S
  - Procedural terms: Brown Act, consent agenda, ParentSquare, Simbli, BoardDocs

## Output Schema

Each transcript is cached as a JSON file at `artifacts/transcripts-aai/{videoId}.json` and published to `https://data.rcsd.info/transcripts-aai/{videoId}.json`.

### Top-level fields (subset of AssemblyAI response)

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | AssemblyAI transcript ID |
| `status` | string | `"completed"` or `"error"` |
| `audio_duration` | number | Total audio duration in seconds |
| `confidence` | number | Overall confidence score (0.0–1.0) |
| `text` | string | Full transcript as plain text (no speaker labels) |
| `words` | array | Word-level detail (see below) |
| `utterances` | array | Speaker-diarized segments (see below) |

### `words[]` element

| Field | Type | Description |
|-------|------|-------------|
| `text` | string | The word as recognized |
| `start` | number | Start time in milliseconds from audio start |
| `end` | number | End time in milliseconds |
| `confidence` | number | Per-word confidence (0.0–1.0) |
| `speaker` | string | Speaker label (e.g., `"A"`, `"B"`) |

### `utterances[]` element

| Field | Type | Description |
|-------|------|-------------|
| `text` | string | Full text of the utterance |
| `start` | number | Start time in milliseconds |
| `end` | number | End time in milliseconds |
| `confidence` | number | Utterance-level confidence |
| `speaker` | string | Speaker label (e.g., `"A"`, `"B"`) |
| `words` | array | Word-level detail for this utterance (same schema as top-level `words[]`) |

### Speaker labels

Speakers are assigned alphabetical labels (`A`, `B`, `C`, ...) by AssemblyAI based on voice characteristics. Labels are consistent within a single meeting but are **not** consistent across meetings — Speaker A in one meeting is not necessarily the same person as Speaker A in another. Speaker identification (mapping labels to actual board members) is a separate downstream step not yet implemented.

## Quality Observations

Based on initial batch (verified on 5 completed transcripts):

- **Overall confidence:** 96.7%–97.5% across meetings
- **Word-level timestamps:** Millisecond-precise, no overlaps detected, monotonically ordered
- **Utterance ordering:** Strictly monotonic in all transcripts checked
- **Duration accuracy:** AAI audio duration matches YouTube duration within 2–11 seconds (container padding)
- **Last utterance alignment:** Within 6–13 seconds of audio end (normal closing silence)
- **Diarization accuracy:** Generally strong for regular board meetings (7–8 speakers detected). Study sessions with fewer distinct speakers may under-segment (e.g., 2 speakers detected where 4+ were present)
- **Known limitations:**
  - Proper nouns (board member names) occasionally have lower per-word confidence (0.68–0.80) despite word boost
  - Bilingual content (Spanish public comment instructions) is transcribed phonetically rather than as Spanish text
  - Crosstalk during heated discussions may be attributed to wrong speaker

## Costs

- **Rate:** $0.28/hour of audio since July 2026 (AssemblyAI Universal-3.5 Pro: $0.21 base + $0.02 speaker diarization + $0.05 contextual prompting); earlier transcripts were $0.37/hour on Universal 3 Pro
- **Total corpus:** ~90 hours across 49 meetings
- **Estimated total cost:** ~$33

## Scripts

- **Transcription:** `scripts/transcribe-assemblyai.mjs`
  - Supports `--date`, `--limit`, `--force`, `--oldest-first` flags
  - Reads `ASSEMBLYAI_API_KEY` from `.env`
  - Caches audio and transcripts to never repeat work
- **Progress dashboard:** `scripts/transcribe-dashboard.mjs`
  - Local web dashboard at `http://localhost:3456`
  - Reads filesystem state, no database required

## Data Provenance

All source audio is publicly available via the RCSD YouTube channel. Transcriptions are derivative works of public government meetings conducted under the California Brown Act. No copyright restrictions apply to the factual content of public meeting proceedings.
