# RCSD Data Schema Reference

Complete field documentation for all JSON data files in the rcsd.info `data/` directory. Each section includes a real data sample to demonstrate the actual structure.

## data/schools.json

Top-level: `{ schools[], districtLinks, rcef, lastUpdated }`

### Sample School Record

```json
{
  "slug": "adelante-selby",
  "name": "Adelante Selby Spanish Immersion School",
  "nameShort": "Adelante Selby",
  "nameEs": "Escuela de Inmersión en Español Adelante Selby",
  "grades": "TK-5",
  "type": "choice",
  "program": "Spanish · Español",
  "programEs": "Español · Spanish",
  "enrollment": 630,
  "highNeedPct": 65,
  "address": "170 Selby Lane, Atherton, CA 94027",
  "phone": "(650) 482-2415",
  "website": "https://adelanteselby.rcsdk8.net",
  "principal": "Patricia Alcocer",
  "bellSchedule": {
    "earlyReleaseDay": "Thursday",
    "supervision": null,
    "regular": [
      { "grades": "TK", "start": "8:28 AM", "end": "1:40 PM" },
      { "grades": "K", "start": "8:18 AM", "end": "2:00 PM" },
      { "grades": "1", "start": "8:13 AM", "end": "2:20 PM" },
      { "grades": "2-3", "start": "8:08 AM", "end": "2:25 PM" },
      { "grades": "4-5", "start": "8:03 AM", "end": "2:25 PM" }
    ],
    "earlyRelease": [
      { "grades": "TK", "end": "12:45 PM" },
      { "grades": "K", "end": "1:15 PM" },
      { "grades": "1", "end": "1:20 PM" },
      { "grades": "2-5", "end": "1:25 PM" }
    ]
  },
  "lunchUrl": "https://menus.healthepro.com/organizations/1184/sites/9274/menus/103750",
  "communitySchool": true,
  "cdsCode": "41690056044580",
  "parentLinks": {
    "platform": "ParentSquare",
    "konstella": null
  },
  "pto": {
    "name": "Unidos Y Adelante",
    "url": "https://unidospto.org/",
    "ein": "48-1266142",
    "ctNumber": "119817",
    "rctStatus": "current",
    "revenue": 251126,
    "revenueFY": "2024-25",
    "sourceUrl": "https://projects.propublica.org/nonprofits/organizations/481266142"
  }
}
```

### Key Field Notes

- `type`: `"neighborhood"` (address-assigned) or `"choice"` (application-based)
- `highNeedPct`: % classified as high-need (SED + EL + Foster Youth, unduplicated)
- `bellSchedule.regular[]`: Per-grade-band start/end times (not a single time for whole school)
- `bellSchedule.earlyReleaseDay`: Varies by school (Wednesday or Thursday)
- `pto`: `null` if school has no active PTO/PTA — these schools rely on RCEF
- `rctStatus`: CA Registry of Charitable Trusts filing status
- `parentLinks.platform`: All schools use ParentSquare; some also have Konstella or Membership Toolkit
- `lunchUrl`: Encodes both site ID and menu ID for HealthePro API

### districtLinks Sample

```json
{
  "parentSquare": "https://www.parentsquare.com/signin",
  "parentSquareNote": "District-wide official parent communication platform used by all schools",
  "absenceReporting": {
    "app": "SchoolMessenger",
    "ios": "https://apps.apple.com/us/app/schoolmessenger/id978894818",
    "android": "http://play.google.com/store/apps/details?id=com.schoolmessenger.recipient"
  },
  "lunchMenuProvider": "HealthePro",
  "lunchMenuBase": "https://menus.healthepro.com/organizations/1184"
}
```

### rcef Sample

```json
{
  "name": "Redwood City Education Foundation",
  "nameEs": "Fundación Educativa de Redwood City",
  "url": "https://www.rcef.org/",
  "ein": "94-2903141",
  "description": "RCEF provides supplementary funding for all RCSD schools, with a focus on equity for schools without active PTOs."
}
```

---

## data/charters.json

Top-level: `{ _metadata, charters[] }` — 3 RCSD-authorized charter schools, tracked separately from district-operated schools (`schools.json`).

### Key Fields Per Charter

| Field | Description |
|-------|-------------|
| `slug` | URL slug |
| `name`, `nameShort`, `nameEs` | School names (EN / ES) |
| `cdsCode`, `charterNumber`, `charterFundingType` | State identifiers and funding model |
| `dateOpened`, `authorizer` | Charter history |
| `address`, `addressNote`, `addressNoteEs`, `phone` | Location; all three charters sit on district-owned former-school campuses — Connect + KIPP share Fair Oaks, Rocketship is on Hawes (see `properties.json`) |
| `grades`, `gradesNote`, `enrollment`, `enrollmentYear`, `enrollmentSource` | Size |
| `schoolLeaders`, `network`, `networkNote` | Leadership / charter-management org |
| `titlePatterns` | Title regexes used by `build-charters.mjs` to filter `document-index.json` for per-charter board items |
| `website`, `email`, `socialMedia`, `greatSchools`, `cdeSchoolProfileUrl`, `cdeDirectoryUrl`, `filing990` | External links |

---

## data/properties.json

Top-level: `{ _metadata, properties[] }` — district-owned or district-leased real estate that is **not** an operating RCSD school, including the charter-hosting former school campuses (Hawes, Fair Oaks). Use this to resolve a district address that isn't a school — e.g. a board-packet item that references a site only by street address. Operating schools are in `schools.json`; charters in `charters.json`.

### Sample Record

```json
{
  "slug": "former-adelante-campus",
  "name": "Harper School (private)",
  "nameEs": "Harper School (privada)",
  "address": "3150 Granger Way, Redwood City, CA 94063",
  "use": "leased-out",
  "useLabel": "Leased to a private school tenant",
  "useLabelEs": "Alquilado a una escuela privada como inquilino",
  "tenant": { "name": "Harper School", "url": "https://www.harperschool.org", "type": "private" },
  "formerUse": "Former Adelante Selby Spanish Immersion campus",
  "formerUseEs": "Antiguo campus de Adelante Selby Spanish Immersion",
  "notes": null
}
```

### Schema

| Field | Description |
|-------|-------------|
| `slug` | Stable identifier |
| `name`, `nameEs` | Property name (EN / ES) |
| `address` | Street address — primary lookup key when an agenda item names a site by address only |
| `addressNote` | Clarifies alternate addresses on the same campus (e.g. Building Kidz's 907 Roosevelt entrance on the 909 Roosevelt Hawes campus) |
| `use` | One of `admin`, `leased-out`, `district-program`, `leased-in`, `charter-and-leased-out`, `charter-campus` |
| `useLabel`, `useLabelEs` | Human-readable use (EN / ES) |
| `tenant` | If `leased-out`: `{ name, url, type, programs, networkNote }`; otherwise `null` |
| `tenants` | For multi-tenant sites (Hawes, Fair Oaks): array of `{ name, type, url, note }` covering the charter and private lessees, with use-agreement history in `note` |
| `documents` | Board-approved leases / joint-use agreements: `{ label, labelEs, date, url }`. Rendered as link chips in the /schools/ properties table. BoardDocs-hosted URLs 403 to curl but serve fine to browsers |
| `landlord` | If `leased-in`: `{ name, propertyManager, note }` |
| `formerUse`, `formerUseEs` | Prior RCSD use, if any |
| `squareFeet` | Floor area, where known |
| `notes`, `source` | Provenance notes and board-meeting source links |

### Key Field Notes

- **Current coverage (6 properties):** District Office (750 Bradford St), former Adelante Selby campus leased to Harper School via Wagner Schoolhouse LLC (3150 Granger Way), former Orion campus hosting LEARN Academy — a non-public special-education school, formerly the Creative Learning Center, acquired by LEARN 2022, NOT district-operated (815 Allerton St), former Hawes Community School campus (909 Roosevelt Ave — Rocketship charter plus Building Kidz preschool at the 907 Roosevelt entrance and Touchstone Learning, both under board-approved Joint Use Agreements), former Fair Oaks Elementary campus (2950 Fair Oaks Ave — KIPP Excelencia + Connect Community Charter; ownership confirmed by Board President 2026-07-21), and the district storage warehouse (1757 E Bayshore Rd).
- Per `_metadata.status`, the authoritative full district inventory is still pending — this is seed data confirmed by the Board President, not an exhaustive list.

---

## data/trustees.json

The elected Board of Trustees plus district leadership. Three top-level keys: `trustees` (array), `superintendent` (object with `current`, plus `former[]` for predecessors and `incoming` only while a transition is pending), and `cabinet` (array). Plus a `_metadata` provenance block.

### Sample Trustee Record

```json
{
  "slug": "david-weekly",
  "name": "David Weekly",
  "area": 2,
  "roleEn": "President",
  "roleEs": "Presidente",
  "termStartYear": 2022,
  "termEndYear": 2026,
  "email": "dweekly@rcsdk8.net",
  "assignmentsEn": ["Kennedy Middle School", "Facilities", "Roy Cloud School", "Taft Community School"],
  "assignmentsEs": ["Kennedy Middle School", "Instalaciones", "Roy Cloud School", "Taft Community School"],
  "photo": "david-weekly.jpg",
  "photoSource": "https://resources.finalsite.net/.../TrusteeDavidWeekly.jpg"
}
```

### Schema

| Field | Type | Notes |
|-------|------|-------|
| `slug` | string | Stable kebab-case id |
| `area` | int | Trustee area 1–5; the by-area seat the member represents |
| `roleEn` / `roleEs` | string | Officer role (President, Vice President, Clerk) or special liaison role; ES is gender-correct |
| `termStartYear` | int | **Derived** as `termEndYear − 4` (Cal. Ed. Code §35107: 4-year terms), not stated on source |
| `termEndYear` | int | Authoritative — the year the current term expires (from the source page) |
| `email` | string | District email |
| `assignmentsEn` / `assignmentsEs` | string[] | School/area oversight; school proper names kept in English in both languages |
| `photo` | string | Filename under `https://data.rcsd.info/trustees/`; null if none |
| `photoSource` | string | Upstream CDN URL the headshot was mirrored from |

`superintendent.current` / `superintendent.incoming` use `name`, `titleEn`/`titleEs`, `statusEn`/`statusEs`, `email`, `photo`, `photoSource`, `bioUrl`, and `contractUrl` (nullable). `superintendent.former[]` holds predecessors with the same shape plus `servedThrough` (ISO date); it is retained for history and is NOT rendered. `incoming` is present only during a pending transition — `build-district.mjs` shows the "district is in a superintendent transition" note if and only if `incoming` exists, and `check-freshness.mjs` fails the build if someone recorded as `incoming` is already the sitting superintendent on the district page. An optional `photoCrop` (e.g. `"4:5"`) tells `fetch-leadership-photos.mjs` to center-crop a non-portrait source via `sips`; `photoNote` documents why. `cabinet[]` (Assistant Superintendent of Human Resources, Assistant Superintendent of Educational Services, CBO) and `directors[]` (13 directors/coordinators) each use `slug`, `name`, `titleEn`, `titleEs`. ES titles for directors use the gender-neutral "Dirección de …" form to avoid misgendering by name.

### Key Field Notes

- **Areas 2 and 5** (David Weekly, Cecilia I. Márquez) expire 2026 and are on the November 2026 ballot; **Areas 1, 3, 4** expire 2028.
- **Superintendent:** Dr. Christian J. Rubalcaba (appointed 2026-01-21) has been superintendent since 2026-07-01. Dr. John R. Baker retired 2026-06-30 and is under `superintendent.former[]`. Note `scripts/extract-chapter-markers.mjs` carries a SECOND, date-ranged copy of the superintendency for LLM speaker attribution — the two must be changed together; see `docs/ANNUAL-REFRESH.md`.
- Hand-maintained; re-check after each November election and the December board reorganization. See `_metadata.refreshProcedure`.

---

## data/freshness.json

Observations of RCSD-authoritative web pages, used to detect that a published fact
has drifted from its source. Written by `scripts/verify-live-facts.mjs` on every
pipeline run; asserted by `scripts/check-freshness.mjs` as a final workflow step.

**This file is not a source of published values.** It records what rcsdk8.net *said*.
The values the site publishes stay in `schools.json` (`principal`) and `trustees.json`
(`superintendent`, `cabinet`, `directors`), so each fact keeps exactly one definition.

### Schema

- `_metadata` — provenance: `source` (the district superintendent page),
  `additionalSources[]` (the 12 per-school leadership pages), `scrapedAt` (ISO),
  `method`, `writer`, `asserter`.
- `maxObservationAgeDays` — how stale observations may get before the guard reports
  that probing itself has stopped. Default 7; the pipeline runs twice daily.
- `lastRun` — `probedAt` (ISO), `probed`, `failed`, `failures[]` (human-readable
  strings naming the URL that could not be read).
- `observations[]` — each has `id`, `kind`, `source`, and `observed`:
  - `kind: "principal"` — plus `slug`; `observed` is the principal's name. Compared
    against `schools.json` → the matching school's `principal`. **Fatal on drift.**
  - `kind: "superintendent"` — `observed` is the name. Compared against
    `trustees.json` → `superintendent.current.name`. **Fatal on drift**, and also
    fatal if the observed person is still sitting in `superintendent.incoming`.
  - `kind: "cabinet"` — `observed` is an array of `{name, title}` for everyone else
    on the superintendent page. Compared against the union of `trustees.json`
    `cabinet[]` + `directors[]`. **Advisory only** — that page churns and is not a
    complete roster of record, and a guard that cries wolf gets ignored.
  - `kind: "cde-year"` — plus `dataset`, `ingestedYear`, and `availability`, a map of
    candidate school year → `true` / `false` / `"unknown"` for whether CDE has published
    that year. **Escalating:** one cycle behind is an advisory, two or more fails the
    build (a whole annual refresh was skipped). `"unknown"` reports nothing — CDE's bot
    protection answers 303 under load, so a blocked probe is not evidence either way.

### Key Field Notes

- Names are compared on a normalized key (`scripts/lib/person-name.mjs`): courtesy
  titles (Mr./Mrs./Ms.) and post-nominals are dropped, accents folded, case flattened.
  Earned doctorates are kept, since they are part of the published name. So
  "Ms. Melissa Bowdoin" does not read as a change, but "Dr. Luis Arreola" →
  "Nick Fanourgiakis" does.
- An unrecognized `kind` fails the guard rather than being ignored, so adding a probe
  without teaching the guard about it cannot read as "clean".

## data/district-calendar-{year}.json

### Sample

```json
{
  "schoolYear": "2025-26",
  "calendarUrl": "https://resources.finalsite.net/.../2025-26TK-8InstructionalCalendarBoardapproved12112024.pdf",
  "events": [
    { "date": "2025-08-13", "type": "milestone", "en": "First Day of School", "es": "Primer Día de Clases" },
    { "date": "2025-09-01", "type": "no-school", "en": "Labor Day", "es": "Día del Trabajo" },
    { "date": "2025-09-15", "dateEnd": "2025-09-19", "type": "early-release", "en": "Parent Teacher Conference Week", "es": "Semana de Conferencias con Padres" }
  ]
}
```

### Key Field Notes

- `type`: `"no-school"`, `"early-release"`, `"milestone"`, `"board-meeting"`
- `dateEnd`: Present only for multi-day events (e.g., Spring Break). Check `date <= queryDate <= dateEnd`.
- To determine if school is in session: check for `no-school` events, then verify date falls between "First Day" and "Last Day" milestones, then check it's not a weekend.

---

## data/sped-enrollment.json

CDE Census Day Enrollment data — IEP students by school and grade.

### Sample

```json
{
  "_source": {
    "dataset": "CDE Census Day Enrollment",
    "year": "2024-25",
    "url": "https://www.cde.ca.gov/ds/ad/filesenrcensus.asp",
    "note": "Students with IEPs under IDEA. Does not include 504 plan students. Values of null indicate cell suppression (≤10 students).",
    "retrievedDate": "2026-03-12"
  },
  "district": { "total": 1121 },
  "schools": {
    "clifford": {
      "total": 138,
      "grades": { "1": 14, "2": null, "3": 15, "4": 13, "5": 12, "6": 22, "7": 12, "8": 24, "TK": null, "K": 15 },
      "totalEnrollment": 698,
      "pct": 19.8
    }
  }
}
```

### Key Field Notes

- `null` in grades = cell suppression (<=10 students, CDE privacy rule) — always explain this
- `pct` = `total / totalEnrollment * 100`
- Does NOT include 504 plan students (504 data only available from OCR CRDC, lags ~5 years)

---

## data/sped-categories.json

CDE Special Education by Program Setting — disability categories and LRE placement.

### Sample

```json
{
  "district": {
    "disabilityCategories": {
      "Specific Learning Disability": 391,
      "Speech/Language Impairment": 385,
      "Other Health Impairment": 250,
      "Autism": 185,
      "Intellectual Disability": 48,
      "Emotional Disturbance": 31,
      "Deaf-Blindness": null,
      "Hard of Hearing": null,
      "Visual Impairment": null
    },
    "placement": {
      "total": 1310,
      "regularGt80": 825,
      "regular40to79": 126,
      "regularLt40": 236,
      "separateSchool": 30,
      "preschool": 93
    }
  },
  "schools": {
    "clifford": {
      "placement": {
        "total": 138,
        "regularGt80": 65,
        "regular40to79": 22,
        "regularLt40": 46,
        "separateSchool": 2,
        "preschool": 3
      }
    }
  }
}
```

### Key Field Notes

- LRE = Least Restrictive Environment. `regularGt80` = most inclusive (in regular class >80% of day)
- `null` in disability categories = cell suppression
- Per-school data has placement only (not disability category breakdown — CDE suppresses at school level)

---

## data/sarc/sarc-summary.json

SARC summary data for all schools. **Covers prior year**: 2024-25 SARCs report 2023-24 data.

Top-level: `{ generated, "slug": { demographics, expenditures, caaspp } }`

### Key Fields Per School

| Path | Type | Description |
|------|------|-------------|
| `demographics.hispanicLatino` | number | % Hispanic/Latino |
| `demographics.white` | number | % White |
| `demographics.asian` | number | % Asian |
| `demographics.africanAmerican` | number | % African American |
| `demographics.englishLearners` | number | % English Learners |
| `demographics.socioeconomicallyDisadvantaged` | number | % SED (proxy for free/reduced lunch) |
| `expenditures.schoolSite.totalPerPupil` | number | Total per-pupil spending at school site |
| `caaspp.elaAllStudents.metExceededPct` | number | % meeting/exceeding ELA standards |
| `caaspp.mathAllStudents.metExceededPct` | number | % meeting/exceeding Math standards |

Read `data/sarc/{slug}.json` for detailed per-school data: teachers, textbooks, facilities, test results by student group, and more.

---

## data/meetings-data.json

The primary board meeting file. See `references/meetings-guide.md` for full navigation guide.

### Sample Meeting (metadata, no items)

```json
{
  "date": "2026-03-25",
  "type": "Regular",
  "source": "simbli",
  "mid": "50617",
  "slug": "2026-03-25-regular",
  "youtube": "u4Is6bk2Gh8",
  "simbli": "https://simbli.eboardsolutions.com/SB_Meetings/ViewMeeting.aspx?S=36030397&MID=50617",
  "boarddocs": null,
  "zoom": "https://rcsdk8-net.zoom.us/s/83593509461",
  "topics": [
    "Taft/Garfield SPSA presentations, 2024-25 financial audit (Eide Bailly), Second Interim Budget ($158.1M rev), AI-assisted literacy info item, drone policy BP 3515.21 second reading, Connect charter audit review, Ed Code 41372 salary waiver (55.54% vs 60%), 650 Chromebooks ($323.9K), 16 CSBA policy updates, Measure U addenda (North Star/Henry Ford)"
  ],
  "threads": ["budget", "policy", "charter"],
  "hasTranscript": true,
  "duration": "2h 27m",
  "durationSeconds": 8852
}
```

### Sample Agenda Items (3 types)

```json
[
  {
    "itemLabel": "1",
    "title": "Call to Order",
    "isSection": true,
    "plannedMinutes": 1,
    "actionType": "Procedural",
    "speaker": null,
    "attachments": []
  },
  {
    "itemLabel": "1.2",
    "title": "Public Comment on Closed Session Items Only",
    "isSection": false,
    "plannedMinutes": null,
    "actionType": "Information",
    "speaker": "Prepared by: Evelyn Campos, Administrative Assistant to the Superintendent Approved by: John R. Baker, Ed.D., Superintendent",
    "attachments": []
  },
  {
    "itemLabel": "13.1",
    "title": "Taft School Presentation and School Plan for Student Achievement (SPSA) Approval",
    "isSection": false,
    "actionType": "Action",
    "speaker": "Prepared by: Anna Herrera, Assistant Superintendent, Ed. Services Approved by: John R. Baker, Ed. D., Superintendent",
    "attachments": [
      { "title": "Taft 25-26 Board Presentation", "aid": "1453621", "filename": "Taft-25-26-Board-Presentation.pdf" },
      { "title": "Taft SPSA 2025-26_(Spring)Elementary_School_20260315", "aid": "1451853", "filename": "Taft-SPSA-2025-26_-Spring-Elementary_School_20260315.pdf" }
    ],
    "timestamp": "00:32:35",
    "timestampSeconds": 1955,
    "phases": {
      "opened": 1955,
      "presentation": 1979,
      "discussion": 2757,
      "vote": { "seconds": 3754, "type": "voice", "result": "unanimous" }
    },
    "publicComments": [],
    "consent": false
  }
]
```

### Chapter Markers (recent meetings with transcripts)

Recent meetings include rich `chapterMarkers` with speaker identification, per-item phase timestamps, and public comment summaries:

```json
{
  "speakers": {
    "A": { "name": "Evelyn Sanchez", "role": "Executive Assistant to Superintendent / Board Secretary" },
    "B": { "name": "David Weekly", "role": "Board President" },
    "I": { "name": "John Baker", "role": "Superintendent" }
  },
  "items": [
    {
      "itemLabel": "9",
      "title": "Public Comment / Labor Association Comments",
      "phases": { "opened": 454, "publicComment": 454 },
      "publicComments": [
        {
          "name": "Christy Herrera",
          "startSeconds": 468,
          "endSeconds": 650,
          "summary": "Described kindergarten classrooms at Hoover as overwhelmed, noting class sizes of 27-28 students, and urged the board to prioritize smaller class sizes."
        }
      ]
    },
    {
      "itemLabel": "8",
      "title": "Approval of the Agenda",
      "phases": {
        "opened": 435,
        "vote": { "seconds": 439, "type": "voice", "result": "unanimous" }
      }
    }
  ]
}
```

### Key Field Notes

- `actionType`: `"Procedural"`, `"Action"`, `"Information"`, `"Discussion"`, `"Consent"`, or `null`
- `isSection`: True for major agenda section headers (numbered without decimals)
- `topics[]`: LLM-generated keyword summaries — good for searching
- `threads[]`: Thematic tags (e.g., "budget", "policy", "charter", "facilities")
- `phases`: All values are seconds from video start. `vote.result` is typically `"unanimous"`.
- `publicComments[]`: Timestamped and summarized public comments with speaker names
- Older BoardDocs-sourced meetings have simpler item structure (no phases/chapterMarkers)

---

## data/meeting-summaries.json

Keyed by slug (e.g., `"2026-03-11"` or `"2020-04-01-board-meeting"`). Each value is a prose summary paragraph (1-3 sentences). **AI-generated** — always label as such.

---

## data/school-board-summaries.json

Board items tagged to schools. Keys: `"YYYY-MM-DD|Agenda Item Title"`. Values: `{ "slug": { "en": "...", "es": "..." } }`.

---

## data/timestamp-map.json

Maps agenda items to video timestamps by meeting date. Each entry has `videoId` and `items[]` positionally aligned with `meetings-data.json` items. Each element is `{ timestamp, timestampSeconds }` or `null`.

Construct timestamped YouTube links: `https://www.youtube.com/watch?v={videoId}&t={timestampSeconds}`

---

## data/document-index.json

Categorized index of board attachments. Each document: `{ type, subtype, title, meetingDate, itemLabel, itemTitle, attachmentId, url }`.

Document types and counts:
- `resolution/resolution` (205), `tax/parcel` (109), `sped/contract` (83), `spsa/plan` (81)
- `policy/policy` (52), `budget/first-interim` (48), `lcap/annual` (46), `school-report/presentation` (46)
- `sarc/report` (42), `compliance/williams-ucp` (40), `budget/adopted-budget` (36)
- `labor/csea` (30), `labor/rcta` (29), `tax/bond` (18)

**Caveat:** this is a *curated taxonomy* and does not contain every attachment — unclassified item types are absent (e.g. the superintendent employment contract). When a title search here is empty, fall back to `agenda-attachments.json` (below) before concluding a document doesn't exist.

---

## data/agenda-attachments.json

The **complete raw list** of every PDF attached to every agenda item — the authoritative source for finding a specific named document (resolutions, employment contracts, agreements, MOUs, change orders, warrant registers).

Shape: an object keyed by meeting date; each value is an array of attachment records.

```json
{
  "2026-01-21": [
    {
      "aid": "1376174",
      "title": "Superintendent's Employment Contract_Redwood City SD & Dr. Christian Rubalcaba 20206-2028",
      "url": "https://simbli.eboardsolutions.com//Meetings/Attachment.aspx?S=36030397&AID=1376174",
      "page": 20
    }
  ]
}
```

| Field | Notes |
|-------|-------|
| `aid` | Simbli attachment id; also keys the R2 mirror `board-packets/{aid}.pdf` |
| `title` | Attachment title — grep this to find a document by name |
| `url` | Original Simbli `Attachment.aspx` link |
| `page` | Page within the combined board packet |

**Public PDF URL:** `https://data.rcsd.info/board-packets/{meetingDate}/{filename}`, where `filename` is the sanitized title (from `document-index.json`'s `filename` field, when classified). See the SKILL's "Finding a specific named board document" recipe.

---

## data/cde/absenteeism-2024-25.json

CDE Chronic Absenteeism data — disaggregated by reporting category (student subgroup) per school.

### Sample

```json
{
  "_metadata": {
    "description": "Chronic absenteeism rates by school and student group",
    "source": "https://www3.cde.ca.gov/demo-downloads/attendance/chronicabsenteeism25-v2.txt",
    "dataYear": "2024-25",
    "downloadDate": "2026-04-12",
    "fileStructure": "https://www.cde.ca.gov/ds/ad/fsabd.asp",
    "pipeline": "scripts/pull-cde-data.mjs --dataset absenteeism"
  },
  "district": {
    "TA": { "enrolled": 7737, "count": 1417, "rate": 18.3 },
    "RH": { "enrolled": 5306, "count": 1197, "rate": 22.6 },
    "SE": { "enrolled": 2999, "count": 727, "rate": 24.2 }
  },
  "clifford": {
    "TA": { "enrolled": 721, "count": 138, "rate": 19.1 },
    "RH": { "enrolled": 328, "count": 88, "rate": 26.8 }
  }
}
```

### Schema

| Field | Type | Description |
|-------|------|-------------|
| `_metadata` | object | Source provenance (URL, date, pipeline command) |
| `district` | object | District-wide data keyed by reporting category code |
| `{school-slug}` | object | Per-school data keyed by reporting category code |
| `{code}.enrolled` | number/null | Cumulative enrollment for that subgroup |
| `{code}.count` | number/null | Number of chronically absent students (absent >=10% of enrolled days) |
| `{code}.rate` | number/null | Chronic absenteeism rate as a percentage |

### Reporting Category Codes

| Code | Description |
|------|-------------|
| `TA` | All Students (Total) |
| `GF` | Female |
| `GM` | Male |
| `GRTKKN` | TK/Kindergarten |
| `GR13` | Grades 1-3 |
| `GR46` | Grades 4-6 |
| `GR78` | Grades 7-8 |
| `GRTK8` | Grades TK-8 (all grades) |
| `RA` | Asian |
| `RB` | African American / Black |
| `RD` | Not Reported |
| `RF` | Filipino |
| `RH` | Hispanic or Latino |
| `RI` | American Indian or Alaska Native |
| `RP` | Pacific Islander |
| `RT` | Two or More Races |
| `RW` | White |
| `SD` | Students with Disabilities |
| `SE` | English Learners |
| `SF` | Foster Youth |
| `SH` | Homeless |
| `SM` | Migrant |
| `SS` | Socioeconomically Disadvantaged |

### Key Field Notes

- `null` values = CDE privacy suppression (cell size too small to report)
- `rate` = `count / enrolled * 100`
- "Chronically absent" = absent 10% or more of enrolled school days
- Not all reporting categories are present for every school — depends on student population

---

## data/cde/ltel-2024-25.json

CDE Long-Term English Learner (LTEL) and English Learner Academic Status (ELAS) data per school.

### Sample

```json
{
  "_metadata": {
    "description": "Long-term English learner counts by school",
    "source": "https://dq.cde.ca.gov/dataquest/longtermel/lteldnld.aspx?year=2024-25",
    "dataYear": "2024-25",
    "downloadDate": "2026-04-12",
    "fileStructure": "https://dq.cde.ca.gov/dataquest/longtermel/",
    "pipeline": "scripts/pull-cde-data.mjs --dataset ltel"
  },
  "district": {
    "totalEnrollment": 7523,
    "el": 2855,
    "rfep": 867,
    "atRisk": 450,
    "ltel": 326,
    "el4plus": 407,
    "el03y": 1672,
    "el45y": 594,
    "el6plusY": 589
  },
  "clifford": {
    "totalEnrollment": 698,
    "el": 143,
    "rfep": 64,
    "atRisk": 12,
    "ltel": 19,
    "el4plus": 22,
    "el03y": 90,
    "el45y": 20,
    "el6plusY": 33
  }
}
```

### Schema

| Field | Type | Description |
|-------|------|-------------|
| `_metadata` | object | Source provenance (URL, date, pipeline command) |
| `district` | object | District-wide totals |
| `{school-slug}` | object | Per-school totals |
| `totalEnrollment` | number | Total school enrollment (all students) |
| `el` | number | Current English Learners |
| `rfep` | number | Reclassified Fluent English Proficient (exited EL status) |
| `atRisk` | number | At-Risk of becoming LTEL (EL for 4-5 years, not meeting criteria) |
| `ltel` | number | Long-Term English Learners (EL for 6+ years without reclassification) |
| `el4plus` | number | EL students enrolled 4+ years |
| `el03y` | number | EL students enrolled 0-3 years |
| `el45y` | number | EL students enrolled 4-5 years |
| `el6plusY` | number | EL students enrolled 6+ years |

### Key Field Notes

- `ltel` counts only students in grades 6-12 (CDE's LTEL definition), so TK-5-only schools show 0 — their long-enrolled ELs appear in `el6plusY` instead
- `totalEnrollment` here is from the LTEL dataset and may differ slightly from Census Day enrollment
- Values before 2026-06-10 were exactly 2x reality: the raw file has Gender = F, M, and ALL rows (ALL = F + M) and the old pipeline summed all three; `pull-cde-data.mjs` now sums only Gender=ALL rows
- RFEP students are no longer classified as EL but are tracked for monitoring
- `atRisk` students are a subset of EL students who may become LTEL without intervention

---

## data/cde/staff-ethnicity-2024-25.json

CDE Staff Demographics — teacher race/ethnicity counts per school.

### Sample

```json
{
  "_metadata": {
    "description": "Staff ethnicity/race counts by school (teachers)",
    "source": "https://www3.cde.ca.gov/demo-downloads/staff/stre2425.txt",
    "dataYear": "2024-25",
    "downloadDate": "2026-04-12",
    "fileStructure": "https://www.cde.ca.gov/ds/ad/fsspre.asp",
    "pipeline": "scripts/pull-cde-data.mjs --dataset staff-ethnicity"
  },
  "district": {
    "total": 364,
    "africanAmerican": 15,
    "americanIndian": 1,
    "asian": 46,
    "filipino": 21,
    "hispanicLatino": 84,
    "pacificIslander": 1,
    "white": 184,
    "twoOrMore": 2,
    "notReported": 10
  },
  "adelante-selby": {
    "total": 23,
    "africanAmerican": 0,
    "americanIndian": 0,
    "asian": 0,
    "filipino": 0,
    "hispanicLatino": 18,
    "pacificIslander": 0,
    "white": 4,
    "twoOrMore": 0,
    "notReported": 1
  }
}
```

### Schema

| Field | Type | Description |
|-------|------|-------------|
| `_metadata` | object | Source provenance (URL, date, pipeline command) |
| `district` | object | District-wide teacher counts by ethnicity |
| `{school-slug}` | object | Per-school teacher counts by ethnicity |
| `total` | number | Total number of teachers |
| `africanAmerican` | number | African American / Black teachers |
| `americanIndian` | number | American Indian or Alaska Native teachers |
| `asian` | number | Asian teachers |
| `filipino` | number | Filipino teachers |
| `hispanicLatino` | number | Hispanic or Latino teachers |
| `pacificIslander` | number | Pacific Islander teachers |
| `white` | number | White teachers |
| `twoOrMore` | number | Two or More Races teachers |
| `notReported` | number | Race/ethnicity not reported |

### Key Field Notes

- Counts are for **teachers only** (certificated classroom teachers), not all staff
- District total may not equal sum of school totals (district office staff, itinerant teachers)
- Source file uses CDE's standard staff race/ethnicity categories per Ed Code reporting

---

## data/cde/staff-experience-2024-25.json

CDE Staff Experience — teacher experience levels per school.

### Sample

```json
{
  "_metadata": {
    "description": "Staff experience levels by school (teachers)",
    "source": "https://www3.cde.ca.gov/demo-downloads/staff/stex2425.txt",
    "dataYear": "2024-25",
    "downloadDate": "2026-04-12",
    "fileStructure": "https://www.cde.ca.gov/ds/ad/fsspex.asp",
    "pipeline": "scripts/pull-cde-data.mjs --dataset staff-experience"
  },
  "district": {
    "total": 364,
    "avgYearsTotal": 11,
    "avgYearsDistrict": 9.2,
    "experienced": 267,
    "inexperienced": 97,
    "firstYear": 27,
    "secondYear": 70
  },
  "garfield": {
    "total": 14,
    "avgYearsTotal": 4.5,
    "avgYearsDistrict": 2.7,
    "experienced": 6,
    "inexperienced": 8,
    "firstYear": 2,
    "secondYear": 6
  }
}
```

### Schema

| Field | Type | Description |
|-------|------|-------------|
| `_metadata` | object | Source provenance (URL, date, pipeline command) |
| `district` | object | District-wide teacher experience |
| `{school-slug}` | object | Per-school teacher experience |
| `total` | number | Total number of teachers |
| `avgYearsTotal` | number | Average years of total teaching experience |
| `avgYearsDistrict` | number | Average years teaching in this district |
| `experienced` | number | Teachers with 3+ years experience |
| `inexperienced` | number | Teachers with fewer than 3 years experience |
| `firstYear` | number | First-year teachers |
| `secondYear` | number | Second-year teachers |

### Key Field Notes

- "Inexperienced" = first- or second-year teachers (CDE definition, not pejorative)
- `firstYear` + `secondYear` should roughly equal `inexperienced` (minor rounding differences possible)
- `experienced` + `inexperienced` = `total`
- High inexperienced counts at a school can indicate retention challenges
- Garfield is a notable outlier with very low average experience and majority inexperienced staff

---

## data/cde/staff-ratios-2024-25.json

CDE Student-Staff Ratios — student-to-teacher, student-to-admin, and student-to-pupil-services ratios per school.

### Sample

```json
{
  "_metadata": {
    "description": "Student-to-staff ratios by school",
    "source": "https://www3.cde.ca.gov/demo-downloads/staff/strat2425.txt",
    "dataYear": "2024-25",
    "downloadDate": "2026-04-12",
    "fileStructure": "https://www.cde.ca.gov/ds/ad/fssprat.asp",
    "pipeline": "scripts/pull-cde-data.mjs --dataset staff-ratios"
  },
  "district": {
    "enrollment": 7507,
    "teacherFTE": 357.8,
    "adminFTE": 36.7,
    "pupilServicesFTE": 30.2,
    "studentTeacherRatio": 21,
    "studentAdminRatio": 204.6,
    "studentPupilServicesRatio": 248.2
  },
  "mckinley-mit": {
    "enrollment": 476,
    "teacherFTE": 21.1,
    "adminFTE": 0.9,
    "pupilServicesFTE": 0,
    "studentTeacherRatio": 22.6,
    "studentAdminRatio": null,
    "studentPupilServicesRatio": null
  }
}
```

### Schema

| Field | Type | Description |
|-------|------|-------------|
| `_metadata` | object | Source provenance (URL, date, pipeline command) |
| `district` | object | District-wide ratios |
| `{school-slug}` | object | Per-school ratios |
| `enrollment` | number | Total student enrollment |
| `teacherFTE` | number | Full-time equivalent teachers |
| `adminFTE` | number | Full-time equivalent administrators |
| `pupilServicesFTE` | number | Full-time equivalent pupil services staff (counselors, psychologists, etc.) |
| `studentTeacherRatio` | number | Students per teacher |
| `studentAdminRatio` | number/null | Students per administrator |
| `studentPupilServicesRatio` | number/null | Students per pupil services staff member |

### Key Field Notes

- `null` ratios appear when FTE is below 1.0 (CDE suppresses ratio calculation for very small FTE)
- FTE values are decimal (e.g., 0.9 = part-time administrator)
- `pupilServicesFTE` includes school counselors, psychologists, social workers, and nurses
- `enrollment` here is from the staffing dataset and may differ slightly from Census Day enrollment
- Adelante Selby (25.3) and North Star (25.7) have notably high student-teacher ratios vs. district average (21.0)

---

## data/ssc-membership.json

School Site Council (SSC) membership extracted from SPSA (School Plan for Student Achievement) PDF documents.

### Sample

```json
{
  "_metadata": {
    "description": "School Site Council membership extracted from SPSA PDFs",
    "source": "SPSA documents at artifacts/documents/spsa/",
    "extractionMethod": "Claude Haiku via document content block API",
    "lastUpdated": "2026-04-09"
  },
  "adelante-selby": {
    "2023-24": {
      "school": "Adelante Selby Spanish Immersion School",
      "schoolYear": "2023-24",
      "composition": {
        "principal": 1,
        "classroomTeachers": 3,
        "otherStaff": 1,
        "parentCommunity": 5
      },
      "members": [
        { "name": "Warren Sedar", "role": "principal" },
        { "name": "Silvia Antonelli", "role": "classroomTeacher" },
        { "name": "Yessica Gallagher", "role": "parentCommunity" }
      ],
      "chairperson": "Yessica Gallagher",
      "adoptionDate": "2023-10-18"
    }
  }
}
```

### Schema

| Field | Type | Description |
|-------|------|-------------|
| `_metadata` | object | Source provenance and extraction method |
| `{school-slug}` | object | Per-school membership, keyed by school year |
| `{year}.school` | string | Full school name |
| `{year}.schoolYear` | string | Academic year (e.g., "2023-24") |
| `{year}.composition` | object | Seat counts by role category |
| `{year}.composition.principal` | number | Number of principal seats (always 1) |
| `{year}.composition.classroomTeachers` | number | Number of classroom teacher seats |
| `{year}.composition.otherStaff` | number | Number of other school staff seats |
| `{year}.composition.parentCommunity` | number | Number of parent/community member seats |
| `{year}.members[]` | array | Individual members with name and role |
| `{year}.chairperson` | string | SSC chairperson name |
| `{year}.adoptionDate` | string | Date the SPSA was adopted by the SSC |

### Key Field Notes

- SSC membership is required by Ed Code for Title I schools — equal representation of staff and parents
- Extracted via AI (Claude Haiku) from SPSA PDFs; verify against source documents for critical uses
- Multiple school years may be present per school as SPSAs are updated annually
- `composition` totals should satisfy: `principal + classroomTeachers + otherStaff = parentCommunity` (parity requirement)

## data/committees/&lt;id&gt;.json

One file per committee instance (`cboc`, `delac`, and — as they are added — `ssc-<school>`, `elac-<school>`). Builders glob `data/committees/*.json`. Curated metadata is hand-authored; the `meetings[]` recordings + transcript status are enriched by `scripts/build-committees.mjs` from the committee-tagged YouTube index and the AAI cache. Sparse by default: only `id`, `type`, `scope`, `nameEn`, `nameEs` are required.

Committee transcripts are namespaced to avoid colliding with board transcripts: `transcriptKey = "<id>-<date>"` → `https://data.rcsd.info/transcripts/<id>-<date>.json` (EN) and `<id>-<date>-es.json` (ES).

### Schema

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Committee instance id (e.g. `cboc`, `ssc-orion`). |
| `type` | string | Committee type (`cboc`, `delac`, `elac`, `ssc`). |
| `scope` | string | `district` or `school`. |
| `school` | string\|null | School slug when `scope === 'school'`. |
| `nameEn` / `nameEs` | string | Bilingual committee name. |
| `shortName` | string | Acronym (e.g. `CBOC`). |
| `descriptionEn` / `descriptionEs` | string\|null | Bilingual blurb. |
| `homepage` / `email` / `chair` | string\|null | Optional contact/links. |
| `members` | array | `[{ name, role, since }]` — optional, sparse. |
| `videoTitleMatch` | string[] | Case-insensitive substrings used by `scrape-youtube-index.mjs` to tag this committee's recordings. |
| `meetings[]` | array | Per-meeting: `date`, `status` (`past`/`scheduled`), `time`, `location`, `youtube`, `transcriptKey`, `hasTranscript`, `duration`, `durationSeconds`, `agendaPdf`, `minutesPdf`, `descriptionEn`/`descriptionEs`, and AI-generated `summaryEn`/`summaryEs` (from the transcript, via generate-committee-summaries.mjs). Most fields optional. |

(Replaces the former `data/committee-meetings.json`, which held only DELAC/CBOC scheduled dates for the ICS feeds.)

## data/ssc-meetings.json

Per-school, per-year index of SSC meeting agendas and minutes. Meeting documents are published to R2 under `documents/ssc/{school}/{year}/` and served from `data.rcsd.info`.

### Sample

```json
{
  "_metadata": {
    "description": "Per-school School Site Council meeting agendas and minutes.",
    "source": "Materials shared publicly by each school's SSC.",
    "extractionMethod": "Source .docx files converted to PDF via pandoc → HTML → Chromium (scripts/convert-ssc-docs.mjs).",
    "lastUpdated": "2026-04-21"
  },
  "orion": {
    "2025-26": [
      {
        "date": "2025-09-24",
        "agendaPdf": "documents/ssc/orion/2025-26/2025-09-24-agenda.pdf",
        "minutesPdf": "documents/ssc/orion/2025-26/2025-09-24-minutes.pdf"
      }
    ]
  }
}
```

### Schema

| Field | Type | Description |
|-------|------|-------------|
| `_metadata` | object | Source provenance and conversion method |
| `{school-slug}` | object | Per-school meetings, keyed by school year |
| `{school-slug}.{year}[]` | array | Meetings sorted chronologically |
| `{meeting}.date` | string | Meeting date (`YYYY-MM-DD`) |
| `{meeting}.agendaPdf` | string, optional | R2 path to agenda PDF |
| `{meeting}.minutesPdf` | string, optional | R2 path to minutes PDF |

### Key Field Notes

- Either `agendaPdf` or `minutesPdf` (or both) should be present; absent field means that artifact wasn't yet shared by the SSC.
- Paths are relative; prefix with `https://data.rcsd.info/` to get the public URL.
- Coverage today: `orion` 2025-26. Pattern supports adding more schools/years as SSCs share materials.


---

## data/spsa-budgets.json

SPSA budget summaries extracted from 2025-26 SPSA (School Plan for Student Achievement) PDF documents.

### Sample

```json
{
  "_metadata": {
    "description": "SPSA budget summaries extracted from 2025-26 SPSA PDFs",
    "source": "Budget Summary pages in artifacts/documents/spsa/2025-26/",
    "extractionMethod": "Claude Haiku via document content block API",
    "lastUpdated": "2026-04-12"
  },
  "adelante-selby": {
    "raw": {
      "school": "Adelante Selby Spanish Immersion School",
      "schoolYear": "2025-26",
      "consolidatedAppFunds": 87430,
      "csiFunds": 0,
      "totalBudgeted": 854047,
      "federalPrograms": [
        { "name": "Title I", "amount": 72871 }
      ],
      "stateLocalPrograms": [
        { "name": "District Funded", "amount": 289028 },
        { "name": "Measure U", "amount": 147333 },
        { "name": "Prop. 28", "amount": 85852 }
      ]
    },
    "categorized": {
      "spsaTotal": 854047,
      "titleI": 72871,
      "district": 383245,
      "ptoPta": 164746,
      "measureU": 147333,
      "prop28": 85852
    }
  }
}
```

### Schema

| Field | Type | Description |
|-------|------|-------------|
| `_metadata` | object | Source provenance and extraction method |
| `{school-slug}.raw` | object | Raw budget data as extracted from the SPSA PDF |
| `{school-slug}.raw.school` | string | Full school name |
| `{school-slug}.raw.schoolYear` | string | Budget year (e.g., "2025-26") |
| `{school-slug}.raw.consolidatedAppFunds` | number | Consolidated Application funds (Title I + other federal) |
| `{school-slug}.raw.csiFunds` | number | Comprehensive Support and Improvement funds |
| `{school-slug}.raw.totalBudgeted` | number | Total budgeted across all funding sources |
| `{school-slug}.raw.federalPrograms[]` | array | Federal funding line items (`{ name, amount }`) |
| `{school-slug}.raw.stateLocalPrograms[]` | array | State and local funding line items (`{ name, amount }`) |
| `{school-slug}.categorized` | object | Simplified/categorized budget breakdown |
| `{school-slug}.categorized.spsaTotal` | number | Total SPSA budget |
| `{school-slug}.categorized.titleI` | number | Title I federal funding |
| `{school-slug}.categorized.district` | number | District-funded amounts (D100 + District Funded + Site Improvement) |
| `{school-slug}.categorized.ptoPta` | number | PTO/PTA/PFC contributions |
| `{school-slug}.categorized.measureU` | number | Measure U parcel tax funds |
| `{school-slug}.categorized.prop28` | number | Proposition 28 (arts/music) funding |

### Key Field Notes

- Extracted via AI (Claude Haiku) from SPSA PDFs; verify against source documents for critical uses
- `categorized` rolls up multiple `raw` line items into standardized categories for cross-school comparison
- `ptoPta` may be 0 at schools without active parent organizations (those schools rely on RCEF)
- `csiFunds` is non-zero only for schools identified for Comprehensive Support and Improvement
- Budget amounts are for the school site plan only; does not include all district spending at the school

---

## HealthePro Lunch Menu API

Public REST API (no authentication). Base URL: `https://menus.healthepro.com/api/organizations/1184`

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /sites/list` | All school sites with IDs |
| `GET /sites/{siteId}/menus/` | Available menus for a site |
| `GET /menus/{menuId}/year/{YYYY}/month/{M}/date_overwrites` | **Daily menu items** |
| `GET /menus/{menuId}/start_date/{start}/end_date/{end}/recipes/` | Recipe catalog with allergens/nutrition |

### School Menu IDs (from lunchUrl in schools.json)

| School | Site ID | Menu ID |
|--------|---------|---------|
| Adelante Selby | 9274 | 103750 |
| Clifford | 9275 | 103731 |
| Garfield | 9277 | 103763 |
| Henry Ford | 9278 | 103766 |
| Hoover | 9279 | 103767 |
| Kennedy | 9280 | 103754 |
| McKinley | 9281 | 103771 |
| North Star | 9366 | 103771 |
| Orion | 9282 | 103774 |
| Roosevelt | 9284 | 103755 |
| Roy Cloud | 9283 | 103751 |
| Taft | 9285 | 103756 |

### Response Structure (date_overwrites)

```json
{
  "data": [
    {
      "id": 1446912083,
      "day": "2026-03-02",
      "meal_id": 14050158,
      "setting": "{\"current_display\": [...], ...}"
    }
  ]
}
```

Parse the `setting` JSON string → `current_display` array:
```json
[
  { "item": "Lunch Entree", "weight": 0, "name": "Lunch Entree", "type": "category" },
  { "item": 1175334, "weight": 1, "name": "Locally Made Cheese Pizza", "type": "recipe" },
  { "item": "Vegetables", "weight": 4, "name": "Vegetables", "type": "category" },
  { "item": 1175253, "weight": 5, "name": "Caesar Salad FS", "type": "recipe" }
]
```

- `type: "category"` = section header; `type: "recipe"` = menu item
- `weight` = display order

---

## data/policies-index.json

Top-level: `{ _metadata, sections[], policies[] }` — The global index of Redwood City School District board policies, bylaws, and administrative regulations.

### Sample Index Record

```json
{
  "_metadata": {
    "source": "https://simbli.eboardsolutions.com/Policy/PolicyListing.aspx?S=36030397",
    "scrapedAt": "2026-05-24T15:20:00.000Z",
    "method": "Playwright + Simbli ViewPolicy API scraper"
  },
  "sections": [
    {
      "code": "0000",
      "name": "Philosophy, Goals, Objectives and Comprehensive Plans",
      "encrId": "6XAK9hcueplusL8NJI1ShcBkQ=="
    }
  ],
  "policies": [
    {
      "id": "6XAK9hcueplusL8NJI1ShcBkQ==",
      "code": "0100",
      "title": "Philosophy",
      "type": "BP",
      "section": "0000",
      "lastRevised": "11/04/2009",
      "lastReviewed": "11/04/2009",
      "hasAttachment": false,
      "revid": "6XAK9hcueplusL8NJI1ShcBkQ=="
    }
  ]
}
```

### Schema Description

#### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `_metadata` | object | Provenance metadata including source URL, scraped timestamp, and method. |
| `sections` | array of objects | Section directories mapping the 1000s series (e.g. `0000`, `1000`, etc.) to descriptive titles. |
| `policies` | array of objects | Catalog of all policies and regulations. |

#### Section fields (`sections[]`)

| Field | Type | Description |
|-------|------|-------------|
| `code` | string | Numeric identifier for the section (e.g. `"0000"`, `"1000"`, `"5000"`). |
| `name` | string | English name of the section. |
| `encrId` | string | Internal encrypted ID from Simbli for the section. |

#### Policy Catalog fields (`policies[]`)

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Internal unique ID of the policy revision. |
| `code` | string | The policy code number (e.g. `"0100"`, `"5141.22"`). |
| `title` | string | Description/title of the policy. |
| `type` | string | `"BP"` (Board Policy), `"AR"` (Administrative Regulation), `"BB"` (Board Bylaw), `"E"` (Exhibit), etc. |
| `section` | string | Matches the `sections[]` code prefix representing the functional division. |
| `lastRevised` | string | MM/DD/YYYY representation of when the policy was last revised/reviewed. |
| `lastReviewed` | string | MM/DD/YYYY representation of when the policy was last reviewed. |
| `hasAttachment` | boolean | Indicates whether this policy has attached files. |
| `revid` | string | Revision ID matching the `id` field, used to request full detail. |

---

## data/board-policies/{code}-{type}.json

Individual, structured detailed records of each board policy, regulation, and bylaw.

### Sample Policy Detail

```json
{
  "code": "0100",
  "title": "Philosophy",
  "type": "BP",
  "section": "0000",
  "lastRevised": "11/04/2009",
  "lastReviewed": "11/04/2009",
  "hasAttachment": false,
  "revid": "6XAK9hcueplusL8NJI1ShcBkQ==",
  "contentHtml": "<p>As part of its responsibility...</p>",
  "contentText": "As part of its responsibility...",
  "footnotes": [
    {
      "type": "State",
      "references": [
        {
          "code": "Ed. Code 51002",
          "description": "Local development of...",
          "url": ""
        }
      ]
    }
  ],
  "crossRefs": [
    {
      "code": "0200",
      "title": "Goals For The School District",
      "type": "BP"
    }
  ],
  "attachments": []
}
```

### Schema Description

| Field | Type | Description |
|-------|------|-------------|
| `code` | string | The policy code number (e.g. `"0100"`, `"5141.22"`). |
| `title` | string | Description/title of the policy. |
| `type` | string | `"BP"` (Board Policy), `"AR"` (Administrative Regulation), `"BB"` (Board Bylaw), etc. |
| `section` | string | Numeric identifier for the parent section division. |
| `lastRevised` | string | MM/DD/YYYY date of last revision. |
| `lastReviewed` | string | MM/DD/YYYY date of last review. |
| `hasAttachment` | boolean | Flag showing if attachments are present. |
| `revid` | string | Revision ID string used in Simbli URLs. |
| `contentHtml` | string | Full HTML content of the policy as rendered by Simbli. |
| `contentText` | string | Cleaned and sanitized plain-text format of the policy body (ideal for LLM context). |
| `footnotes` | array | Grouped legal or management references associated with this policy (e.g. State, Federal, Management). |
| `crossRefs` | array | Cross-references to other related board policies. |
| `attachments` | array | Listing of downloadable attachments (e.g. PDFs or forms) linked with this policy. |

#### Footnotes Structure (`footnotes[]`)

- `type`: string (e.g., `"State"`, `"Federal"`, `"Management"`)
- `references`: array of objects, each containing:
  - `code`: string (e.g. `"Ed. Code 35160"`)
  - `description`: string describing the legal basis
  - `url`: string (URL to reference text, if available)

#### Cross References Structure (`crossRefs[]`)

- `code`: string (code of the referenced policy)
- `title`: string (description of the referenced policy)
- `type`: string (e.g. `"BP"`, `"AR"`, `"BB"`)

#### Attachments Structure (`attachments[]`)

- `id`: string (unique attachment identifier in Simbli)
- `name`: string (display name of the attached file)
- `filename`: string (file name on server)

---

## data/board-policies-es/{code}-{type}.json

Spanish machine-translations of policy **bodies**, one file per policy with the same `{code}-{type}.json` filename as `data/board-policies/`. Every policy but one has a file; the one gap (`6174-E PDF(1)-AR`) is a scanned PDF exhibit with no extractable English text, so there is nothing to translate — its page falls back to English. These are unofficial AI translations: the English version on Simbli is the only text with legal force.

### Sample Record

```json
{
  "code": "0100",
  "type": "BP",
  "titleEs": "Filosofía",
  "contentTextEs": "Como parte de su responsabilidad de establecer una visión orientadora para el distrito...",
  "_metadata": {
    "model": "claude-sonnet-4-6",
    "generatedAt": "2026-06-10T16:52:48.783Z",
    "method": "AI translation of contentText via the Claude API (scripts/translate-policy-bodies.mjs); one policy per request, bodies over 30KB split at paragraph boundaries into chunks and reassembled; validated for length, paragraph structure, and meta-commentary",
    "sourceFile": "data/board-policies/0100-BP.json",
    "sourceHash": "fd6d807b12ca5d1b9329929bfa3fb60994deac09f2c119604f83250b76ef3b1d",
    "note": "Machine translation. The English Simbli version is authoritative."
  }
}
```

### Schema Description

| Field | Type | Description |
|-------|------|-------------|
| `code` | string | The policy code number, matching the English file (e.g. `"0100"`, `"5141.22"`). |
| `type` | string | `"BP"`, `"AR"`, `"BB"`, or `"E"` — matches the English file. |
| `titleEs` | string | Spanish title, copied from `data/policy-titles-es.json` for consistency. |
| `contentTextEs` | string | The translated plain-text policy body. Footnotes/legal citations and crossRefs are NOT translated — statute names and code strings stay in English; read them from the English file. |
| `_metadata.model` | string | Claude model id used for the translation. |
| `_metadata.generatedAt` | string | ISO 8601 timestamp of the translation run. |
| `_metadata.method` | string | How the translation was produced (script, chunking, validation). |
| `_metadata.sourceFile` | string | Path of the English source file. |
| `_metadata.sourceHash` | string | sha256 of the English `contentText` at translation time. The translator skips any policy whose stored hash still matches, so re-runs only touch new/revised policies. |
| `_metadata.cacheFingerprint` | string | Canonical sha256 over the exact model/API/SDK, sent parameters, prompt/output-schema hashes, inputs, localization, safety, and chunking configuration. Legacy cached files may omit it until deliberately regenerated. |
| `_metadata.llmInvocationIds` | string[] | Invocation IDs that produced the published body. Long policies have one ID per translated chunk. |
| `_metadata.llmInvocations` | object[] | Full validated invocation records, including retry/repair attempts, effective response, usage/cost, output hash, and cache fingerprint. Secrets and raw sensitive prompts are never included. |
| `_metadata.note` | string | Disclaimer that the English Simbli version is authoritative. |

---

## data/policy-titles-es.json

Spanish machine-translations of policy and section titles. Existing `sections`
and `titles` maps retain their public shape. Newly generated files add invocation
provenance under `_metadata`:

| Field | Type | Description |
|-------|------|-------------|
| `_metadata.cacheFingerprints.sections` / `.titles` | object | Per-output cache fingerprint maps. |
| `_metadata.llmInvocationIds.sections` / `.titles` | object | Maps each translated key to the batch invocation that produced it. |
| `_metadata.llmInvocations` | object[] | Deduplicated, validated batch invocation records. |

Older cached title files remain valid but are marked partial in the provenance
sidecar until a deliberate translation run upgrades them.

---

## data/policy-summaries.json

AI-generated one-sentence summaries of every board policy, English AND Spanish, for the `/policies/` and `/politicas/` index pages. One entry per policy, less the same single intentional gap as `board-policies-es/` (`6174-E PDF(1)-AR` has no source text, so no summary is invented for it).

### Sample

```json
{
  "_metadata": {
    "source": "data/board-policies/*.json (scraped from https://simbli.eboardsolutions.com/Policy/PolicyListing.aspx?S=36030397 by scrape-board-policies.mjs)",
    "method": "AI-generated one-sentence summaries via the Claude API (scripts/generate-policy-summaries.mjs); one request per policy returning English and Spanish together as structured JSON; policy text truncated to the first 8000 chars as a cost/quality tradeoff; sourceHash is the sha256 of the full (untruncated) contentText for cache invalidation",
    "model": "claude-sonnet-4-6",
    "generatedAt": "2026-06-10T18:27:09.543Z",
    "note": "Machine-generated summaries for the policy index pages. They simplify and may omit nuance; the full policy text on Simbli is authoritative. Spanish summaries are AI-generated, not official district translations."
  },
  "summaries": {
    "0100-BP": {
      "title": "Philosophy",
      "en": "Commits the Board to a set of core beliefs — including safety, high expectations, family partnership, and equity — that must guide all district programs and activities.",
      "es": "Establece las creencias fundamentales de la Mesa Directiva — como seguridad, altas expectativas, trabajo con familias y equidad — que deben guiar todos los programas del distrito.",
      "sourceHash": "fd6d807b12ca5d1b9329929bfa3fb60994deac09f2c119604f83250b76ef3b1d"
    }
  }
}
```

### Schema Description

| Field | Type | Description |
|-------|------|-------------|
| `_metadata` | object | Provenance: source files, generation method, model id, timestamp, and the authoritative-text disclaimer. |
| `summaries` | object | Map keyed by `"{code}-{type}"` (e.g. `"0100-BP"`, `"5144.1-AR"`) — same key format as the per-policy filenames. |
| `summaries[key].title` | string | The English policy title at generation time (for sanity-checking against the catalog). |
| `summaries[key].en` | string | One-sentence English summary. |
| `summaries[key].es` | string | One-sentence Spanish summary, generated in the same request as the English one so both describe the same substance. |
| `summaries[key].sourceHash` | string | sha256 of the policy's full English `contentText`; entries whose hash still matches are reused on re-runs, so only new/revised policies hit the API. |
| `_metadata.cacheFingerprints` | object | Per-policy canonical invocation fingerprints; a mismatch forces regeneration. |
| `_metadata.llmInvocationIds` | object | Maps each summary key to the invocation that produced its English/Spanish pair. |
| `_metadata.llmInvocations` | object[] | Full validated invocation records, including rejected drafts and successful repair attempts. |

---

## data/provenance/*.json

Compatibility-preserving provenance sidecars. They document existing public
payloads without inserting keys into top-level maps that consumers may iterate.
The v1 contract is defined by
`schemas/provenance/v1/dataset-provenance.schema.json`.

Current policy sidecars:

| File | Dataset |
|------|---------|
| `rcsd.board-policies.json` | Simbli catalog, 619 English policy mirrors, and exhibit snapshots |
| `rcsd.board-policies-es.json` | Spanish title/body translations and their English input hashes |
| `rcsd.board-policy-summaries.json` | English/Spanish one-sentence summaries and source lineage |

Key fields:

| Field | Description |
|-------|-------------|
| `$schema`, `schemaVersion`, `datasetId`, `districtId` | Contract and stable identity |
| `kind` | `source-mirror`, `normalized`, `derived`, or `translation` |
| `artifacts[]` | Repository-relative path, media type, bytes, and `sha256:` hash |
| `authority` | Whether the artifact is official, derived, unofficial, or mixed; official language where applicable |
| `sources[]` | Official URL, publisher, acquisition/effective date, and optional snapshot hash |
| `lineage` | Generator, source commit, generated date, and hashed dataset inputs |
| `recordLineage[]` | Output artifact + JSON Pointer mapped to source/dataset inputs and optional LLM invocation |
| `quality` | Machine/human review state and explicit exceptions; `partial` always lists why |
| `llmInvocations[]` | Exact, safe execution metadata for newly generated AI derivatives |

The known `6174-E PDF(1)-AR` scanned source gap and legacy pre-instrumentation
LLM metadata are explicit `partial` exceptions, never inferred from file counts.
Public copies live at `https://data.rcsd.info/json/provenance/`.


---

## data/warrants-index.json

Index of every monthly warrant register (board-ratified check list); clean vendor coverage FY2014-15 onward (older registers archived but scanned/OCR-partial). Read this first for coverage and per-month reconciliation status. Built by `scripts/extract-warrants.mjs`.

### Schema Description

| Field | Type | Notes |
|-------|------|-------|
| `_metadata.counts` | object | `{registers, reconciled, mismatch, viaOcr, failed, coverageGaps, skipped}`. |
| `_metadata.periodOverlaps` | array | Pairs of `month` keys whose date ranges overlap (e.g. a 6/1–6/25 and a 6/1–6/30 sheet). When aggregating, keep one and drop the other to avoid double-counting. |
| `registers[]` | array | One entry per register. |
| `registers[].month` | string | `YYYY-MM`; a `-b`/`-c` suffix disambiguates two registers covering the same month. |
| `registers[].meetingDate` | string | Meeting that ratified it (`YYYY-MM-DD`). |
| `registers[].format` | string | `qss` (Mar 2020 – May 2025) or `escape` (Jun 2025+). |
| `registers[].total` | number | Sum of parsed line items used for checksum (format-specific rule). |
| `registers[].disbursedTotal` | number | Money actually paid (cancelled/voided excluded). **Use this for spend.** |
| `registers[].printedTotal` | number | The register's printed grand total. Do **not** use for the 3 `total-exceeds-detail` months. |
| `registers[].parseStatus` | string | `reconciled` (line items = printed total), `minor-mismatch` (≤0.5%), `total-exceeds-detail` (complete line items, inflated printed total — 2021-05/06/07), or `coverage-gap`. |
| `registers[].period` | object | `{from, to, monthKey}` MM/DD/YYYY range covered. |
| `registers[].sourceUrl` | string | Public PDF (BoardDocs `$file` or `data.rcsd.info/board-packets/...`). |
| `registers[].file` | string | Path to the per-register line-item file. |

## data/warrants/{YYYY-MM}.json

Per-register line items (one file per register; key matches `warrants-index.json` `month`).

### Schema Description

| Field | Type | Notes |
|-------|------|-------|
| `_metadata` | object | Provenance: `month`, `meetingDate`, `source`, `sourceUrl`, `reportFormat`, `extraction` (pdftotext vs OCR), `pdfSha256`, `period`, `checksum` (`printedTotal`, `parsedTotal`, `disbursedTotal`, `reconciled`, `parseStatus`), and `fundRecap`/`printedCheckCount` for Escape registers. |
| `lineItems[]` | array | One row per check/warrant. |
| `lineItems[].warrant` / `.check` | string | Warrant (QSS) or check (Escape) number. **Recycles across years — not a global unique key.** |
| `lineItems[].dateIssued` | string | MM/DD/YYYY. |
| `lineItems[].payee` | string | Payee as printed. |
| `lineItems[].payeeKey` | string | Normalized key (uppercase, stripped Inc/LLC/punctuation) for aggregation; map via `warrant-vendor-aliases.json`. |
| `lineItems[].payeeType` | string | `vendor` or `individual` (heuristic; individuals are employee reimbursements). |
| `lineItems[].amount` | number | Check amount. Negative = credit/unpaid-tax adjustment. |
| `lineItems[].status` | string | `Redeemed`, `Outstanding`, `Cancelled`, `Voided`, etc. Exclude Cancelled/Voided from spend. |
| `lineItems[].fundObjects` | array | SACS fund-object codes (Escape-era registers only). |

## data/warrant-vendor-aliases.json

Curated rollup of normalized payee keys → canonical display name, for names normalization can't merge (CalPERS' multiple legal names, CDW-G, Siemens, etc.). `aliases` maps `"Canonical Name"` → array of normalized keys. Consumed by `scripts/build-warrants-db.mjs`.

## warrants.db (built locally, not committed)

`scripts/build-warrants-db.mjs` assembles the above into a SQLite DB: tables `registers` and `payments` (one row per line item, with `canonical`, `fiscal_year`, and an `excluded` flag = cancelled/voided OR superseded register). Query via `scripts/report-vendor-spend.mjs`.
