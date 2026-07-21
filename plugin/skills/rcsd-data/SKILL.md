---
name: RCSD Data Analyst
description: This skill should be used when the user asks about "Redwood City schools", "RCSD", "school hours", "school enrollment", "school calendar", "is there school today", "next board meeting", "what's for lunch", "lunch menu", "report an absence", "IEP data", "special education", "EL percentage", "LTEL", "long-term English learner", "chronic absenteeism", "teacher diversity", "staff demographics", "teacher experience", "pupil-teacher ratio", "school site council", "SSC", "SPSA", "free and reduced lunch", "PTO", "Konstella", "ParentSquare", "which school", "board meeting", "SARC", "test scores", "CAASPP", "school budget", "RCEF", "Measure U", "expenditures", "district property", "former school site", "who leases the old campus", "watch board meeting", "compare schools", "school demographics", "meeting transcript", "board discussion", "who is my trustee", "who represents my area", "board member", "trustee area", "board president", "who is the superintendent", "new superintendent", "district cabinet", "CBO", "chief business official", "find the resolution", "board resolution", "employment contract", "find the agreement", "MOU", "board packet", "agenda item document", "warrant register", "change order", "vendor spend", "how much does the district pay", "how much do we pay", "vendor payments", "check register", "top vendors", "who do we pay", "annual spend to", or any question about Redwood City School District schools, demographics, calendars, meetings, lunch menus, funding, staffing, trustees, board documents, vendor payments, or parent resources. Also activates when the user mentions a child's name in the context of school.
version: 0.7.0
---

# RCSD Data Analyst

Answer any question about Redwood City School District (RCSD) — a TK-8 public school district in Redwood City, California serving ~6,500 students across 12 schools — by reading and reasoning over local data files directly.

## Core Approach

All structured data lives in `data/` within the rcsd.info project (typically `/Users/dew/dev/rcsd/rcsd.info/data/`). Most fact datasets are small JSON files; provenance sidecars can be larger because they enumerate artifact hashes and record-level lineage. Read the relevant fact files directly and consult the matching sidecar when source or generation history matters. This enables arbitrary queries, comparisons, and cross-file analysis that no pre-built tool can match.

For questions requiring live external data (lunch menus), use the bundled scripts.

## Family Configuration

Check for `~/.claude/rcsd-info.local.md` in the user's home directory. This stores family context for resolving child-specific questions ("What's Max having for lunch?").

Expected format:
```yaml
---
children:
  - name: Max
    grade: 5
    school: orion
    program: Mandarin Immersion
  - name: Cyrus
    grade: 3
    school: orion
    program: Mandarin Immersion
---
```

When a user mentions a child by name, resolve their school and grade from this config. If the config doesn't exist and the user asks a child-specific question, ask which school and offer to save the config.

## Data File Inventory

Read these files from `data/` to answer questions. For field-by-field documentation, consult `references/data-schema.md`.

### Schools & District

| File | Size | Use For |
|------|------|---------|
| `schools.json` | 609 lines | School profiles, bell schedules, addresses, principals, PTO/PTA info, parent links, CDS codes |
| `charters.json` | 3 charters | RCSD-authorized charter schools: addresses, authorizer, enrollment, leaders, CDS codes (separate from district schools) |
| `properties.json` | 6 properties | District-owned/leased real estate that is **not** an operating school — admin buildings, leased-out former campuses (Hawes at 909 Roosevelt: Rocketship charter + Building Kidz + Touchstone; Fair Oaks at 2950 Fair Oaks Ave: KIPP + Connect), storage. Each entry links its board-approved leases/use agreements (`documents[]`). Keyed by address; use to resolve a district site named only by street address. |
| `district-calendar-2025-26.json` | ~17 events | "Is there school?" queries for 2025-26 year |
| `district-calendar-2026-27.json` | ~17 events | "Is there school?" queries for 2026-27 year |
| `governance-calendar.json` | ~12 events | Board meeting schedule |
| `trustees.json` | 5 trustees + leadership | **Who is my board member / trustee?** Board roster keyed by trustee area (name, area, officer role, term years, school assignments, email), the superintendent transition (Dr. Baker through 2026-06-30 → Dr. Rubalcaba from 2026-07-01), and district cabinet (Deputy Supt. Wendy Kelly, Asst. Supt. Anna Herrera, CBO Rick Edson) + 14 directors/coordinators (`directors[]`). Use for "who represents area N", "who is the board president", "who is the superintendent", "when does X's term end", "who is the director of special education / HR / technology". |

### Demographics & Academics

| File | Use For |
|------|---------|
| `sped-enrollment.json` | IEP student counts by school and grade (CDE 2024-25) |
| `sped-categories.json` | Disability categories and LRE placement by school |
| `sarc/sarc-summary.json` | Demographics, CAASPP scores, per-pupil spending across all schools |
| `sarc/{slug}.json` | Detailed SARC per school: teachers, textbooks, facilities, test results by student group |
| `cde/absenteeism-2024-25.json` | Chronic absenteeism by subgroup per school (race, EL, SED, SWD, homeless) — CDE 2024-25 |
| `cde/ltel-2024-25.json` | English Learner status: EL, LTEL, At-Risk, Reclassified counts per school — CDE 2024-25 |
| `cde/staff-ethnicity-2024-25.json` | Teacher race/ethnicity counts per school — CDE Census Day 2024-25 |
| `cde/staff-experience-2024-25.json` | Teacher experience: avg years, inexperienced count per school — CDE 2024-25 |
| `cde/staff-ratios-2024-25.json` | Student-teacher ratio, pupil services ratio per school — CDE 2024-25 |
| `ssc-membership.json` | School Site Council members, roles, chairperson per school (3 years from SPSA PDFs) |
| `ssc-meetings.json` | Per-school SSC meeting agendas and minutes (PDFs on R2). Currently covers Orion 2025-26. |
| `spsa-budgets.json` | SPSA budget summaries: funding by source per school (from 2025-26 SPSA PDFs) |
| `committees/<id>.json` | One file per committee (CBOC, DELAC, …): name, scope, members, chair, email, homepage, and meetings (past/scheduled). CBOC includes 13 video recordings with transcripts (`transcripts/cboc-<date>.json`). Built by `build-committees.mjs`. |

### Board Meetings (190 meetings, Aug 2020 - present)

| File | Size | Use For |
|------|------|---------|
| `meetings-data.json` | Largest file | Comprehensive: all meetings, agenda items, timestamps, topics, threads |
| `meeting-summaries.json` | 194 entries | AI-generated 1-3 sentence summaries per meeting |
| `meeting-summaries-es.json` | 194 entries | Spanish translations of summaries |
| `school-board-summaries.json` | ~750 entries | Agenda items tagged to specific schools |
| `board-memos/{date}.json` | Per-meeting | Per-meeting agenda details and staff memo text (the narrative); does **not** carry attachment file URLs — use `agenda-attachments.json` for those |
| `agenda-attachments.json` | Per-meeting, keyed by date | **The complete raw list of every PDF attached to every agenda item** — `{aid, title, url, page}` per attachment. This is where named documents live: **resolutions, employment contracts, agreements, MOUs, change orders, warrant registers.** grep it by title. Most comprehensive document source. |
| `youtube-index.json` | ~893 entries | YouTube video links for meeting recordings. Each entry has a `kind` field (`board` or a committee id like `cboc`); board consumers filter to `kind === 'board'`. |
| `timestamp-map.json` | 694 offsets | Agenda item to video timestamp mapping |
| `document-index.json` | Taxonomy | Attachments **classified** by type/subtype/school/year (`documents[]` with `meetingDate`, `itemLabel`, `aid`, `filename`). Good for "all SARCs" / "budget docs for school X". **Caveat: it is a curated taxonomy and omits unclassified item types — e.g. the superintendent employment contract is NOT in it. If a title search here is empty, fall back to `agenda-attachments.json` before concluding a document doesn't exist.** |

### Vendors & Warrant Registers (vendor payments, FY2014-15 – present)

Every monthly **warrant register** (the board-ratified list of checks the district issued) is parsed into per-payment line items. Use this to answer **"how much does the district pay <vendor> per year?"** and **"who are our biggest vendors?"**

| File | Use For |
|------|---------|
| `warrants-index.json` | One row per monthly register: `month`, `meetingDate`, `format`, `total`, `disbursedTotal`, `printedTotal`, `parseStatus`, `period`, `sourceUrl`. **Read this first** for coverage + which months are fully reconciled. `_metadata.periodOverlaps` lists register pairs to dedupe. |
| `warrants/{YYYY-MM}.json` | Per-register **line items**: `{warrant/check, dateIssued, payee, payeeKey, payeeType (vendor\|individual), amount, status, fundObjects}`. 30k+ rows across 76 files. This is the raw data for vendor-spend questions. |
| `warrant-vendor-aliases.json` | Curated rollup of name variants → canonical vendor (e.g. CalPERS' several legal names, CDW-G, Siemens). Apply when aggregating so one vendor isn't split across spellings. |
| `warrant-pdf-manifest.json` | Provenance for the BoardDocs-era register PDFs (source URL, sha256). |

**Fastest path for a vendor-spend question** (if working in the repo): build the SQLite DB once and query via the CLI —
```bash
npm run build:warrants-db                          # builds ./warrants.db (gitignored)
node scripts/report-vendor-spend.mjs "van pelt"     # spend by fiscal year
node scripts/report-vendor-spend.mjs "van pelt" --detail   # every check + source PDF links
node scripts/report-vendor-spend.mjs --top 25       # biggest vendors all-time
```
The CLI already excludes cancelled checks + superseded registers and footnotes non-reconciled months. To reason without the DB, read `warrants-index.json` then the relevant `warrants/{YYYY-MM}.json` files and sum `amount` by normalized payee (skip `status` starting "Cancelled"/"Voided").

### Board Policies (619 policies, bylaws, and regulations)

| File/Directory | Size | Use For |
|------|------|---------|
| `policies-index.json` | 619 entries | School board policies global catalog, including codes, titles, revision IDs, and revision dates |
| `board-policies/` | 619 JSONs | Directory of individual files per policy (e.g. `0100-BP.json`) with full HTML content, sanitized text, footnotes (legal references), and cross-references |
| `policy-titles-es.json` | 619 entries | Spanish translations of every policy title (Claude-translated, cached, provenance in `_metadata`); powers /politicas/ |
| `board-policies-es/` | 618 JSONs | Spanish machine-translations of policy **bodies** — `{ code, type, titleEs, contentTextEs, _metadata }`, same filenames as `board-policies/`. One policy (`6174-E PDF(1)-AR`, a scanned PDF exhibit with no extractable text) intentionally has no file; its page falls back to English. The English Simbli version is the only official text |
| `policy-summaries.json` | 618 entries | AI-generated one-sentence summaries, English AND Spanish, under `.summaries["{code}-{type}"]` = `{ title, en, es, sourceHash }`; powers the /policies/ + /politicas/ index pages. Same one intentional gap (no source text → no summary, never invented) |

### Provenance Sidecars

These v1 sidecars describe provenance-migrated datasets without changing their
existing public JSON shapes. Read the matching sidecar for questions such as
“where did this come from?”, “is this official?”, “what generated this?”, or
“which source version was translated?”

| File | Use For |
|------|---------|
| `provenance/rcsd.board-policies.json` | English policy catalog and bodies: official Simbli sources, artifact hashes, record-level lineage, generator version, quality state, and the declared scanned-source exception |
| `provenance/rcsd.board-policies-es.json` | Spanish policy titles and bodies: source-English hashes, translation lineage, LLM invocation references when available, and official-language caveats |
| `provenance/rcsd.board-policy-summaries.json` | Bilingual policy summaries: source-text hashes, derived-record lineage, LLM invocation references when available, and quality exceptions |

Only provenance-migrated families have v1 sidecars today; absence of a sidecar
for a legacy dataset is not evidence that the fact has no source. Fall back to
that dataset's `_metadata`, source fields, and methodology document.

### School Slugs

| Slug | School | Grades | Type |
|------|--------|--------|------|
| `adelante-selby` | Adelante Selby Spanish Immersion | TK-5 | Choice |
| `clifford` | Clifford School | TK-8 | Neighborhood |
| `garfield` | Garfield Community School | K-5 | Neighborhood |
| `henry-ford` | Henry Ford School | TK-5 | Neighborhood |
| `hoover` | Hoover Community School | TK-8 | Neighborhood |
| `kennedy` | John F. Kennedy Middle School | 6-8 | Neighborhood |
| `mckinley-mit` | McKinley Institute of Technology | 6-8 | Choice |
| `north-star` | North Star Academy | 3-8 | Choice |
| `orion` | Orion Alternative School | TK-5 | Choice |
| `roosevelt` | Roosevelt School | TK-5 | Neighborhood |
| `roy-cloud` | Roy Cloud School | TK-8 | Neighborhood |
| `taft` | Taft School | TK-5 | Neighborhood |

## Query Strategy

### Simple lookups (single file)
Read the relevant file and extract the answer. Examples: school phone number, bell schedule, calendar check, meeting summary.

### Cross-file analysis (join reasoning)
Read multiple files and reason across them. Examples: "Which schools have high EL% but low math scores?" requires joining `sarc/sarc-summary.json` (demographics + CAASPP) with `schools.json` (enrollment context).

### Finding a specific named board document (resolution, contract, agreement, MOU, change order, warrant register)
Don't conclude "it isn't in our data" from one empty grep. Follow this order:

1. **grep `data/agenda-attachments.json`** by title keyword (e.g. `rubalcaba`, `employment contract`, `Resolution No`). It is keyed by meeting date and lists **every** attachment as `{aid, title, url, page}` — the most complete source.
2. Also grep `data/document-index.json` (classified) if you want to filter by type/school/year — but remember it omits unclassified items, so a miss here is **not** authoritative.
3. **Build the public PDF URL** from the attachment's meeting date + `filename` (in `document-index.json`): `https://data.rcsd.info/board-packets/{meetingDate}/{filename}`. (`agenda-attachments.json` carries the original Simbli `Attachment.aspx?AID=…` link; the friendly R2 mirror is `board-packets/{date}/{filename}` or `board-packets/{aid}.pdf`.)
4. If you know the meeting but not the item, read that meeting in `meetings-data.json` / `board-memos/{date}.json` to get the agenda item label, then look up its attachments.

Example: the superintendent's employment contract → `agenda-attachments.json` under `2026-01-21` (agenda item 12.3) → `https://data.rcsd.info/board-packets/2026-01-21/Superintendent-s-Employment-Contract_Redwood-City-SD-Dr.-Christian-Rubalcaba-202.pdf`.

### Temporal/topical analysis (meetings corpus)
For "what has the board discussed about X?", search `meetings-data.json` for topic keywords in the `topics` array and item titles, then read `meeting-summaries.json` for context. For deeper detail, read the specific `board-memos/{date}.json` files. See `references/meetings-guide.md` for navigating the meeting corpus.

### Vendor spend / warrant-register queries ("how much do we pay <vendor>?")
1. **Coverage check**: read `data/warrants-index.json`. Note `parseStatus` per month and `_metadata.periodOverlaps`.
2. **Aggregate**: prefer the CLI (`node scripts/report-vendor-spend.mjs "<vendor>"`). Without it, read each `data/warrants/{YYYY-MM}.json`, match the payee (use `payeeKey` + `warrant-vendor-aliases.json` to merge spellings), sum `amount` grouped by **California fiscal year (Jul–Jun)**.
3. **Exclude correctly**: skip line items whose `status` starts with "Cancelled"/"Voided" (no money disbursed), and drop the superseded register in each `periodOverlaps` pair (the shorter-period one) to avoid double-counting.
4. **Caveat the answer**: if any contributing month has `parseStatus` other than `reconciled`, say so (see caveats below). Cite source PDFs via `sourceUrl` in the index.

### Board Policies queries
For "what is the district's policy on X?", follow this 3-step strategy:
1. **Search Index**: First, read `data/policies-index.json`. Perform a text or regex search on the `title` or `code` fields of the `policies` array to identify candidate policy codes and types (e.g. `5141.22 BP` or `9223 AR`).
2. **Read Detail File**: Once you identify the relevant policy code and type, read its individual detail JSON file directly from `data/board-policies/{code}-{type}.json` (e.g. `data/board-policies/9223-AR.json`). For a Spanish answer, the machine-translated body is in `data/board-policies-es/{code}-{type}.json` (`contentTextEs`); note it is unofficial — the English version is authoritative.
3. **Analyze & Present**: Extract the `contentText` for the core policy rules, the `footnotes` for statutory citations (like the CA Education or Government Code), and the `crossRefs` for related governance rules to synthesize an authoritative answer.

### Provenance and generation-history queries

For “where did this policy text or summary come from?” or “which model made
this?”:

1. Identify the output family: English policy, Spanish title/body, or bilingual summary.
2. Read the corresponding `data/provenance/*.json` sidecar above.
3. Use `authority` and `kind` to distinguish official-source mirrors from translations and derived explanations.
4. Follow `recordLineage` inputs and JSON Pointers to the exact source record and hash; report the sidecar's `quality.state` and relevant exceptions.
5. Inspect `llmInvocations` for instrumented generations. Historical cached translations and summaries predate exact invocation capture, so their sidecars are deliberately `partial`: known model/source hashes are retained, but missing request parameters are never invented. Future instrumented calls record the exact requested model, installed SDK, parameters sent, prompt/schema/input hashes, attempts, and the resolved model version when the provider exposes it.

When working outside the repo, replace `data/provenance/` with
`https://data.rcsd.info/json/provenance/`. The currently published release
pointer is `https://data.rcsd.info/json/releases/current.json`.

### Comparative queries
Read the relevant data for all schools and present side-by-side. The data is small enough to load entirely.

For detailed cross-file query examples, consult `references/query-patterns.md`.

## Live Data (Scripts)

Only lunch menus require live API calls. Everything else is answered from local JSON.

### Lunch Menus

Fetch live from the HealthePro API using the bundled script:
```bash
node ${SKILL_DIR}/scripts/lunch-menu.mjs <slug> [date]
node ${SKILL_DIR}/scripts/lunch-menu.mjs orion tomorrow
node ${SKILL_DIR}/scripts/lunch-menu.mjs orion 2026-04-03
```

Date accepts: `YYYY-MM-DD`, `today`, `tomorrow` (defaults to today).

If the script is unavailable, call the HealthePro API directly. See `references/data-schema.md` for endpoint details and school-to-menuId mapping.

### School Lookup (Convenience)

For quick formatted school profiles, the bundled script is available but reading `schools.json` directly is preferred for flexibility:
```bash
node ${SKILL_DIR}/scripts/query-school.mjs <slug> [--sped] [--meetings]
node ${SKILL_DIR}/scripts/query-school.mjs --calendar YYYY-MM-DD
node ${SKILL_DIR}/scripts/query-school.mjs --list
```

## Data Caveats

- **Cell suppression**: CDE data uses `null` where counts are <=10 students (privacy). State this when presenting data.
- **SARC year lag**: 2024-25 SARCs report 2023-24 data. Note the reporting year.
- **CDE data year**: CDE bulk files in `data/cde/` are 2024-25 (more current than SARCs).
- **LTEL at elementary**: Elementary schools (TK-5) typically show 0 LTELs because students haven't been ELs long enough (6+ years). At-Risk is the relevant metric for elementary.
- **Absenteeism codes**: Use reporting category codes (TA=All, RH=Hispanic, SE=English Learners, SS=SED, SD=Students with Disabilities, SH=Homeless). See `references/data-schema.md` for full code table.
- **Staff ratios**: `null` ratio means denominator FTE < 1.0 (CDE doesn't compute ratio).
- **504 plans**: Not tracked by CDE; only available from OCR CRDC (lags ~5 years).
- **AI-generated content**: Meeting summaries and SSC membership data (extracted from PDFs via Claude) are AI-generated and labeled as such.
- **Historical LLM provenance**: Cached policy translations and summaries created before v1 invocation tracking have partial execution metadata. Do not infer absent parameters or claim byte-for-byte reproducibility; newly generated outputs retain the exact invocation envelope described above.
- **Lunch menus**: Published monthly; future months may not yet be available.
- **Bilingual**: Calendar events have `en` and `es` fields. The site has `/schools/` and `/escuelas/` mirrors.
- **Warrant registers**: every line item is reconciled against the register's printed grand total. Most months reconcile exactly; check `parseStatus` in `warrants-index.json`. Three months — **2021-05, 2021-06, 2021-07** (`total-exceeds-detail`) — have complete line items but a printed monthly total that over-counts (~1.9–2.3×, a "Summary"-format artifact); use the summed line items / `disbursedTotal`, never `printedTotal`, for those. Cancelled/voided warrants are listed but disbursed $0 (exclude from spend). Registers list **individual employee reimbursements by name** (`payeeType: "individual"`) alongside business vendors — these are public records. Fiscal year is California Jul–Jun. Fund/object codes (`fundObjects`) are captured for the Escape-era (Jun 2025+) registers only.

## Remote Fallback

If local data files are not available (e.g., repo not cloned), all JSON is published at `https://data.rcsd.info/json/`. Use WebFetch as a fallback. Board meeting videos are on YouTube (links in `youtube-index.json`).

## Additional Resources

### Reference Files

- **`references/data-schema.md`** — Complete field-by-field documentation of every JSON data file, plus HealthePro API details
- **`references/query-patterns.md`** — Examples of cross-file analysis queries with step-by-step approaches
- **`references/meetings-guide.md`** — Navigating the 190-meeting board corpus: structure, timestamps, transcripts

### Website

- **rcsd.info** — school pages at `/schools/{slug}/`, meetings at `/meetings/`, budget at `/budget/`
- **data.rcsd.info** — public JSON and artifact hosting
