# RCSD Board Meetings Data Guide

Navigating the 190-meeting board corpus: data structure, timestamps, transcripts, and efficient search strategies.

## Corpus Overview

- **190 meetings** from August 2020 to present
- **7,868 agenda items** with action types, speakers, and attachments
- **4,605 attachments** (PDFs: budgets, policies, resolutions, SARCs, contracts)
- **155 meetings with video** (YouTube recordings)
- **155 meetings with transcripts** (AssemblyAI diarized, word-level timestamps)
- **694 video timestamp offsets** (agenda item to video position mapping)
- **Two source systems**: BoardDocs (164 older meetings) and Simbli (26 recent meetings)

## File Map

| File | Best For |
|------|----------|
| `meetings-data.json` | Comprehensive queries: all meetings, items, topics, threads |
| `meeting-summaries.json` | Quick overview: 1-3 sentence AI summary per meeting |
| `meeting-summaries-es.json` | Spanish translations of summaries |
| `school-board-summaries.json` | "What has the board discussed about [school]?" |
| `board-memos/{date}.json` | Deep dive into a specific meeting's agenda |
| `youtube-index.json` | Video links for meeting recordings |
| `timestamp-map.json` | Jump to specific agenda items in video |
| `document-index.json` | Find specific document types (budgets, policies, contracts) |

## meetings-data.json Structure

Top-level:
```json
{
  "generated": "YYYY-MM-DD",
  "stats": { "total": 190, "withVideo": 155, ... },
  "meetings": [ ...meeting objects, newest first... ]
}
```

### Meeting Object

| Field | Type | Description |
|-------|------|-------------|
| `date` | string | ISO date (YYYY-MM-DD) |
| `type` | string | "Regular", "Special", "Study Session", "Organizational" |
| `source` | string | "simbli" or "boarddocs" |
| `mid` | string | Meeting ID in source system |
| `slug` | string | URL-friendly identifier (e.g., "2026-04-01-regular") |
| `youtube` | string\|null | YouTube video URL |
| `simbli` | string\|null | Simbli agenda URL (recent meetings) |
| `boarddocs` | string\|null | BoardDocs agenda URL (older meetings) |
| `zoom` | string\|null | Zoom link (if available) |
| `topics` | string[] | LLM-generated topic keywords for the meeting |
| `threads` | string[] | Thematic threads (e.g., "policy", "budget", "facilities") |
| `items` | object[] | Agenda items array |

### Agenda Item Object

| Field | Type | Description |
|-------|------|-------------|
| `itemLabel` | string | Item number (e.g., "1", "9.2", "12.1") |
| `title` | string | Agenda item title |
| `isSection` | boolean | True if this is a section header (e.g., "Public Comment") |
| `plannedMinutes` | number\|null | Allocated time for this section |
| `actionType` | string\|null | "Procedural", "Action", "Information", "Discussion", "Consent" |
| `speaker` | string\|null | Prepared/approved by line |
| `attachments` | object[] | Array of attachment objects |

### Attachment Object

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Document title |
| `id` | string | Attachment ID in source system |
| `url` | string | Direct download URL |
| `filename` | string | Original filename |
| `size` | number\|null | File size in bytes |

### Common Meeting Structure

Typical RCSD board meeting agenda:
1. **Call to Order / Roll Call** (Procedural)
2. **Closed Session** — labor negotiations, litigation, personnel
3. **Reconvene to Open Session** (~7:00 PM)
4. **Welcome / Pledge** (Procedural)
5. **Public Comment** (Information) — general and labor comments
6. **Superintendent's Report** (Information)
7. **Board Member Reports** (Information)
8. **Information/Discussion Items** — presentations, reports, first readings
9. **Action Items** — votes on policies, budgets, contracts
10. **Consent Calendar** — routine approvals bundled together
11. **Board Calendar / Adjournment**

## timestamp-map.json Structure

Maps agenda items to video timestamps by meeting date:
```json
{
  "YYYY-MM-DD": {
    "videoId": "youtube_video_id",
    "items": [
      { "timestamp": "HH:MM:SS", "timestampSeconds": 195 },
      null,  // no timestamp for this item
      ...
    ]
  }
}
```

The `items` array is positionally aligned with the meeting's `items` array in `meetings-data.json`. A `null` entry means no timestamp was identified for that item.

To construct a timestamped YouTube link:
```
https://www.youtube.com/watch?v={videoId}&t={timestampSeconds}
```

## document-index.json Structure

Categorized index of all board attachments:
```json
{
  "generated": "YYYY-MM-DD",
  "stats": { "total": 1032, "byType": { "budget/presentation": 27, ... } },
  "documents": [
    {
      "type": "budget",
      "subtype": "presentation",
      "title": "document title",
      "meetingDate": "YYYY-MM-DD",
      "itemLabel": "12.1",
      "itemTitle": "Agenda item title",
      "attachmentId": "...",
      "url": "..."
    }
  ]
}
```

### Document Categories

| Type/Subtype | Count | Description |
|-------------|-------|-------------|
| `resolution/resolution` | 205 | Board resolutions |
| `tax/parcel` | 109 | Parcel tax (Measure U) documents |
| `sped/contract` | 83 | Special education NPA/NPS contracts |
| `spsa/plan` | 81 | School Plans for Student Achievement |
| `policy/policy` | 52 | Board policies and administrative regulations |
| `budget/first-interim` | 48 | First interim budget reports |
| `lcap/annual` | 46 | Local Control Accountability Plans |
| `school-report/presentation` | 46 | School presentations to the board |
| `sarc/report` | 42 | School Accountability Report Cards |
| `compliance/williams-ucp` | 40 | Williams Act / Uniform Complaint compliance |
| `budget/adopted-budget` | 36 | Adopted annual budgets |
| `labor/csea` | 30 | CSEA (classified staff) labor agreements |
| `labor/rcta` | 29 | RCTA (teachers) labor agreements |
| `tax/bond` | 18 | Measure T Bond Program documents |

## Efficient Search Strategies

### For topical searches across all meetings:
1. Use Grep on `meetings-data.json` to find dates containing keywords in topic/title fields
2. Then read `meeting-summaries.json` for those dates
3. Only load full `board-memos/{date}.json` if deeper detail is needed

### For school-specific queries:
Read `school-board-summaries.json` directly — it's pre-indexed by school slug.

### For document type queries ("find me all LCAP documents"):
Read `document-index.json` and filter by `type`/`subtype`.

### For video timestamp queries:
1. Find the meeting date from `meetings-data.json`
2. Read `timestamp-map.json` for that date
3. Match the item index to get the timestamp
4. Combine with YouTube URL from the meeting object or `youtube-index.json`

## Transcript Access

Full diarized transcripts live in `artifacts/transcripts-aai/` (local, gitignored) and are published to `data.rcsd.info/transcripts-aai/`. These are large JSON files with word-level timestamps and speaker diarization from AssemblyAI Universal Pro models (Universal-3.5 Pro for meetings transcribed from July 2026).

For transcript-level queries, use the slim transcripts at `artifacts/transcripts-slim/` (compressed, ~34MB total) or fetch from the remote URL.

## school-board-summaries.json Format

Keys: `"YYYY-MM-DD|Agenda Item Title"`
Values: object keyed by school slug, each with `en` and `es` summary strings.

```json
{
  "2026-03-11|Roosevelt School Presentation...": {
    "roosevelt": {
      "en": "Annual school presentation to the Board; SPSA review",
      "es": "Presentacion escolar anual ante la Mesa Directiva; SPSA"
    }
  }
}
```

Filter by school slug to get all board items relevant to a specific school.
