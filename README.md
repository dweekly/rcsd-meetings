# rcsd.info — Open Data for Redwood City School District

Independently compiled public records for the [Redwood City School District](https://www.rcsdk8.net) — board meetings, school profiles, budgets, and calendars — presented as a bilingual (English/Spanish) static site.

**Live site:** [rcsd.info](https://rcsd.info)
**Data API:** [data.rcsd.info](https://data.rcsd.info)
**Source:** [github.com/dweekly/rcsd-meetings](https://github.com/dweekly/rcsd-meetings)

## What's here

- **192 board meetings** (April 2020 – present) from BoardDocs and Simbli/GAMUT
- **8,073 agenda items** with **4,845 attachments** and source links
- **619 school board policies, bylaws, and regulations** across 9 governance sections
- **157 meeting recordings** with diarized transcripts (AssemblyAI Universal 3 Pro)
- **4,198 agenda items mapped to video timestamps** via LLM analysis of transcripts (148 meetings)
- **12 school profile pages** with demographics, test scores, bell schedules, safety plans, and board presentations
- **3 charter school profiles** plus a **district property index** (district-owned sites that aren't operating schools)
- **District budget visualization** with per-pupil funding breakdowns
- **Full-site search** (English and Spanish, each searching only its own-language corpus) — see [`SEARCH.md`](SEARCH.md)
- **Site history** — what was added and when, month by month, in [`CHANGELOG.md`](CHANGELOG.md) (fresh as of 2026-06-10)

*Counts reflect the data snapshot of May 2026; the pipeline runs continuously, so live figures will be higher.*

## Provenance Contracts and Verified Releases

The first v1 provenance-gated release covers the board-policy family while
preserving every existing data URL and payload shape. The full contract,
quality states, LLM invocation envelope, and migration boundaries are described
in [`PROVENANCE.md`](PROVENANCE.md).

- Versioned contracts live in [`schemas/provenance/v1/`](schemas/provenance/v1/)
  and are published under `https://rcsd.info/schemas/provenance/v1/` (for
  example, the
  [dataset provenance schema](https://rcsd.info/schemas/provenance/v1/dataset-provenance.schema.json)).
- Dataset sidecars live in [`data/provenance/`](data/provenance/) and are
  published under `https://data.rcsd.info/json/provenance/` (for example, the
  [English policy sidecar](https://data.rcsd.info/json/provenance/rcsd.board-policies.json)).
- The public release pointer is
  [`https://data.rcsd.info/json/releases/current.json`](https://data.rcsd.info/json/releases/current.json).
- Non-publishing pilot source manifests for RCSD, Ravenswood, Fresno, and
  San Mateo–Foster City live in [`districts/`](districts/). They are
  reconnaissance configuration, not district-endorsed facts.

```bash
npm run provenance:policies       # regenerate policy sidecars
npm run validate:provenance       # JSON Schema + lineage/artifact checks
npm run test:provenance           # provenance unit tests
npm run build:provenance-schemas  # copy public contracts into docs/

npm run release:manifest -- --require-clean-source
npm run release:stage             # immutable + stable R2 bytes; candidate receipt
npm run release:deploy-pages      # deploy Pages + write a release-bound receipt
npm run release:promote           # immutable manifest + current.json, published last
npm run release:smoke             # verify public EN, ES, provenance + release pointer
```

Staging refreshes and verifies shape-compatible stable URLs but never changes
the current pointer. If the Pages deploy fails, promotion does not run and the
prior release remains current. Promotion can recover its durable R2 candidate
after an interruption and refuses to overwrite a current release that changed
since staging.
The release intentionally accepts a short, shape-compatible Pages/R2 overlap;
see the copy-paste [`RELEASE-RUNBOOK.md`](RELEASE-RUNBOOK.md) for recovery.

## Data Provenance

Every dataset on this site is traceable to its public source. We document the origin, extraction method, and any transformations for each pipeline. Methodology documents live alongside the data they describe:

| Pipeline | Methodology | Key Details |
|----------|-------------|-------------|
| Meeting transcription | [`data/METHODOLOGY-transcription.md`](data/METHODOLOGY-transcription.md) | AssemblyAI Universal 3 Pro, Opus audio from YouTube, speaker diarization |
| Meeting aggregation | [Data sources](#data-sources) below | Simbli + BoardDocs APIs |
| Board policies | `data/policies-index.json`, `data/board-policies/`, `data/policy-titles-es.json` | Full policy text, cross-references, footnotes, and metadata scraped from Simbli's REST APIs; titles machine-translated to Spanish via `scripts/translate-policy-titles.mjs` (Claude, cached, labeled) |
| Policy bodies in Spanish | `data/board-policies-es/` | Policy body text machine-translated via `scripts/translate-policy-bodies.mjs` (Claude Sonnet, ~$16 one-time for the full manual). Idempotent: each output file stores a sha256 of its English source in `_metadata`, so re-runs only translate new or revised policies. Every file carries model, timestamp, and method in `_metadata`; each Spanish policy page is labeled that the English Simbli version is the only official text |
| Policy summaries | `data/policy-summaries.json` | One-sentence summary per policy for the /policies/ and /politicas/ index pages, generated by `scripts/generate-policy-summaries.mjs` — one Claude request per policy returns English + Spanish together, cached by source-text sha256. Labeled as AI-generated on both index pages; scanned PDF exhibits with no extractable text are skipped, never invented |
| School profiles | `data/schools.json` | CDE enrollment, CAASPP, SARC, IRS 990 PTO filings |
| Charter profiles | `data/charters.json` | CDE School Directory + Profile for metadata; financial docs filtered from `document-index.json` by title patterns |
| District properties | `data/properties.json` | District-owned/leased sites that aren't operating schools (admin, former campuses, storage); seed list confirmed by the Board President |
| Budget data | `data/budget/` | RCSD adopted budget documents, CDE LCFF data |
| CDE datasets | `data/cde/*.json` | Absenteeism, LTEL, staff ethnicity/experience/ratios via `pull-cde-data.mjs` |
| SPSA extraction | `data/ssc-membership.json`, `data/spsa-budgets.json` | SSC membership and budgets extracted from SPSA PDFs via Claude Haiku |
| SSC meetings | `data/ssc-meetings.json` | Per-meeting SSC agenda/minutes PDFs, published per-school to `documents/ssc/{school}/{year}/` on R2 |
| Committees | `data/committees/*.json`, [`docs/COMMITTEES.md`](docs/COMMITTEES.md) | District/school committees (CBOC, DELAC, …); recordings discovered from the YouTube index, transcribed + translated like board meetings (transcripts at `transcripts/<id>-<date>.json`) |
| Linked documents | `data/linked-documents.json` | Hand-curated documents linked from agenda memos but hosted off the board portal (e.g. the adopted Facilities Master Plan); each entry cites its source meeting/item. Indexed into search by title — see [`SEARCH.md`](SEARCH.md) |
| Board of Trustees | `data/trustees.json` | The five elected trustees (name, photo, trustee area, term, officer role, school assignments, email), plus the superintendent transition, district cabinet, and directors. Hand-maintained from the official RCSD "Meet the Trustees" + "Our Superintendent" pages and district news releases; headshots mirrored to R2 by `scripts/fetch-leadership-photos.mjs`. Rendered on `/district/` + `/distrito/` by `build-district.mjs`. `termStartYear` is derived (`termEndYear − 4`, per Cal. Ed. Code §35107) |
| GSC SEO & Crawl | [`data/METHODOLOGY-gsc.md`](data/METHODOLOGY-gsc.md) | Google Search Console API monitoring for indexing status, sitemaps, and search analytics |
| Warrant registers | `data/warrant-pdf-manifest.json`, `data/warrant-pdf-manifest-historical.json`, `data/warrants/{YYYY-MM}.json`, `data/warrants-index.json`, `data/warrant-vendor-aliases.json`, `data/warrant-categories.json`, `data/warrant-payee-overrides.json`, [`WARRANTS.md`](WARRANTS.md) | Monthly board-ratified warrant (check) registers; clean vendor coverage **FY2014-15 – present** (BoardDocs back to 2011 is downloaded + archived on R2 but 2011–2013 are scanned/OCR-partial and floored out). Backfilled from BoardDocs `$file` URLs + Simbli, parsed (QSS + Escape formats, OCR fallback) into per-check line items, each reconciled against the register's printed total. Powers the public `/vendors/` + `/proveedores/` pages (under Budget); `scripts/build-warrants-db.mjs` builds a local SQLite (`warrants.db`, gitignored — carries individual names); `scripts/report-vendor-spend.mjs "<vendor>"` reports spend by fiscal year. Provenance + data caveats in [`WARRANTS.md`](WARRANTS.md) |

AI-generated content (meeting summaries, timestamp mappings) is always labeled as such and links back to the source transcript or agenda.

## Data Sources

| Source | What | Method | Scripts |
|--------|------|--------|---------|
| [Simbli/GAMUT](https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030397) | Agendas, minutes, attachments (Jun 2025+) | Playwright browser scraping | `scrape-simbli-agendas.mjs`, `scrape-board-packets.mjs` |
| [Simbli Policies](https://simbli.eboardsolutions.com/Policy/PolicyListing.aspx?S=36030397) | Board Policy manual, bylaws, regulations | Playwright session interception + REST API calls | `scrape-board-policies.mjs` |
| [BoardDocs](https://go.boarddocs.com/ca/redwood/Board.nsf) | Agendas, item bodies, attachments (Apr 2020 – Jun 2025) | REST API scraping (browser UA) | `scrape-boarddocs.mjs` |
| [YouTube](https://www.youtube.com/@redwoodcityschooldistrict) | Meeting videos | `yt-dlp` channel index | `scrape-youtube-index.mjs` |
| YouTube audio | Raw Opus 48kHz audio streams | `yt-dlp -f bestaudio` | `transcribe-assemblyai.mjs` |
| [AssemblyAI](https://www.assemblyai.com/) | Diarized transcripts with word-level timestamps | Universal 3 Pro API | `transcribe-assemblyai.mjs` |
| Claude Haiku | Agenda item → video timestamp mapping | LLM transcript analysis | `map-timestamps-llm.mjs` |
| [CDE DataQuest](https://data1.cde.ca.gov/dataquest/) | Enrollment, demographics, test scores, SpEd | Public data files | `data/sped-enrollment.json`, `data/sped-categories.json` |
| [CDE Chronic Absenteeism](https://www.cde.ca.gov/ds/ad/fsabd.asp) | Chronic absenteeism by subgroup | CDE bulk download | `data/cde/absenteeism-2024-25.json` |
| [CDE LTEL/ELAS](https://dq.cde.ca.gov/dataquest/longtermel/) | Long-term English Learner status | CDE bulk download | `data/cde/ltel-2024-25.json` |
| [CDE Staff Demographics](https://www.cde.ca.gov/ds/ad/fsspre.asp) | Teacher race/ethnicity | CDE bulk download | `data/cde/staff-ethnicity-2024-25.json` |
| [CDE Staff Experience](https://www.cde.ca.gov/ds/ad/fsspex.asp) | Teacher experience levels | CDE bulk download | `data/cde/staff-experience-2024-25.json` |
| [CDE Staff Ratios](https://www.cde.ca.gov/ds/ad/fssprat.asp) | Student-staff ratios | CDE bulk download | `data/cde/staff-ratios-2024-25.json` |
| SPSA PDFs | SSC membership, school budgets | Claude Haiku extraction from board packets | `data/ssc-membership.json`, `data/spsa-budgets.json` |
| SSC-published docs | Per-meeting SSC agendas and minutes | .docx → PDF via pandoc + headless Chromium (`scripts/convert-ssc-docs.mjs`) | `data/ssc-meetings.json` |
| [IRS 990 filings](https://projects.propublica.org/nonprofits/) | PTO/PTA per-pupil funding | ProPublica Nonprofit Explorer | `data/schools.json` |
| [CDE School Directory](https://www.cde.ca.gov/SchoolDirectory/) | Charter entity metadata (CDS, address, charter number, date opened) | Manual transcription | `data/charters.json` |
| RCSD records / Board President | District-owned non-school properties (admin, former campuses, storage) | Manual transcription, confirmed by Board President | `data/properties.json` |
| [RCSD "Meet the Trustees"](https://www.rcsdk8.net/our-district/our-board-of-trustees/meet-the-trustees) + district news releases | Board roster (area, term, role, assignments, email), superintendent transition, cabinet; headshots | Manual transcription; headshots mirrored from RCSD Finalsite CDN to R2 | `data/trustees.json`, `scripts/fetch-leadership-photos.mjs` |
| [Google Search Console](https://search.google.com/search-console) | Indexing status, sitemaps, organic traffic performance | Service Account API queries | `gsc_monitor.py` |

## Pipeline

Scripts run in order. Most can be run independently. All cache aggressively — safe to re-run at any time.

```
 Scraping & Collection
 ─────────────────────
 1. scrape:youtube        → data/youtube-index.json
 2. scrape:boarddocs      → data/boarddocs-scraped.json
 3. scrape:simbli         → data/board-memos/*.json (agenda + attachment metadata)
 3b. scrape:policies      → data/policies-index.json + data/board-policies/*.json (raw text + refs)
 4. scrape:packets        → adds local PDFs under artifacts/board-packets/ + memo fields

 Transcription (AssemblyAI)
 ──────────────────────────
 5. transcribe            → artifacts/audio/*.webm + artifacts/transcripts-aai/*.json
    See: data/METHODOLOGY-transcription.md

 CDE Data (California Dept of Education)
 ───────────────────────────────────────
 5b. pull-cde-data.mjs    → data/cde/*.json (absenteeism, LTEL, staff ethnicity/experience/ratios)
 5c. extract:sarc         → data/sarc/*.json (School Accountability Report Cards)

 Processing
 ──────────
 6. extract:links         → data/agenda-attachments.json (requires pymupdf; reads
    artifacts/agendas/*.pdf — regenerate a missing/broken agenda PDF with
    scripts/generate-agenda-pdf.mjs, which drives Simbli's own PrintAgenda.aspx)
 7. map:timestamps:llm    → data/timestamp-map.json (requires ANTHROPIC_API_KEY)
 7b. monitor:gsc          → GSC SEO and Crawl Error Report (data/gsc-monitoring-report.md)
 7c. translate-policy-bodies.mjs    → data/board-policies-es/*.json (Claude; cached
     by sourceHash — only new/revised policies hit the API; requires ANTHROPIC_API_KEY)
 7d. generate-policy-summaries.mjs  → data/policy-summaries.json (EN+ES one-sentence
     summaries per policy; same sourceHash caching; requires ANTHROPIC_API_KEY)

 Build
 ─────
 8.  build:data           → data/meetings-data.json
 8b. build-committees.mjs → data/committees/*.json (recordings + transcript status)
 9.  build:home           → docs/index.html, sitemap.xml, robots.txt
 10. build:html           → docs/meetings/index.html
 10b. build-committee-pages.mjs → docs/committees/**, docs/comites/** (EN + ES)
 11. build:schools        → docs/schools/**/index.html
 12. build:charters       → docs/charters/**, docs/escuelas-charter/**
 13. build:district       → docs/district/index.html (incl. Committees section)
 14. build:budget         → docs/district/budget/
 15. build:blog           → docs/blog/**
 15b. build:policies      → docs/policies/** (EN), docs/politicas/** (ES) — index
      plus one page per policy, slugs from scripts/lib/policy-slug.mjs
 16. build:search         → docs/search/ (EN), docs/buscar/ (ES)

 Search index (must run last, after all HTML exists)
 ───────────────────────────────────────────────────
 17. search:index         → docs/pagefind/ (Pagefind Node API: HTML pages +
                            per-document records from document-index.json +
                            linked-documents.json, per-language)

 Deploy
 ──────
 npx wrangler pages deploy docs --project-name=rcsd-meetings
 npm run upload           → R2 (data.rcsd.info)
```

`run-pipeline.mjs` performs steps 16–17 automatically as its final build stages,
so CI's `wrangler pages deploy` ships the search index alongside the pages.

Quick rebuild (build steps only):
```bash
npm run build
```

## Search

Full-site search is powered by [Pagefind](https://pagefind.app), which indexes
the rendered `docs/` HTML at build time — so it covers everything already on the
pages (meetings, schools, policies, budget, blog) with no separate index to
maintain. It is exposed through a search box in the global nav and dedicated
results pages with live autocomplete at `/search` (English) and `/buscar`
(Spanish), built with Pagefind's accessible Component UI.

Because Pagefind splits its index by each page's `<html lang>` attribute, an
English page searches **only** the English corpus and a Spanish page **only** the
Spanish corpus. Beyond the HTML pages, the index also carries a record per board
**document** (title → direct file URL): board-packet attachments from
`document-index.json`; documents linked inside agenda memos but hosted
off-portal, which both scrapers extract and classify into each item's
`memoLinks` (see [`scripts/lib/memo-links.mjs`](scripts/lib/memo-links.mjs)) —
`scrape-simbli-agendas.mjs` for the Simbli era and `scrape-boarddocs.mjs --bodies`
(which fetches each item's body) for the older BoardDocs era; and curated entries
in `data/linked-documents.json` (e.g. the adopted Facilities Master Plan). So a search like "facilities master plan" links straight to the
PDF — not just to the meetings that discuss it. (Recurring public-comment Google
Forms found in memos are classified separately and kept out of search results.)
Result ranking was tuned by evaluating real parent/community
queries in a browser, and a query-relaxation layer broadens over-specified
natural-language queries (e.g. "roy cloud principal email") that Pagefind's
all-terms matching would otherwise collapse. The approach, rationale, relevance
findings, file map, and extension points are documented in [`SEARCH.md`](SEARCH.md).

### Simbli agenda scraping

Simbli's agenda is rendered by an Angular SPA. Attachment links never appear in the static HTML — the SPA fetches them per item from `GetItemsTreeDTO` + `GetSupportingDocuments`. `scrape:simbli` runs Playwright headless, lets the Imperva/Incapsula JS challenge resolve, intercepts the SPA's session params from those XHRs, and reuses them to enumerate all items + attachment AIDs in one shot. It also walks the meeting listing to discover newly-posted MIDs.

```bash
npx playwright install chromium      # one-time setup
npm run scrape:simbli                # discover + scrape any new agendas
npm run scrape:simbli -- --date 2026-05-13   # single meeting
npm run scrape:simbli -- --refresh   # re-pull all (preserves memo + filename enrichments)
npm run scrape:simbli -- --list-only # discovery report; no scrape
```

`scrape:simbli` runs as Phase 0 of `run-pipeline.mjs`, so a fresh `node scripts/run-pipeline.mjs --quick` automatically picks up newly-posted agendas before the build.

### Simbli board policies manual scraping

The entire district board policy manual (619 active policies, bylaws, and regulations across 9 sections) is dynamically fetched from Simbli's REST APIs. `scrape:policies` starts Chromium via Playwright to clear Imperva/Incapsula, intercepts the session-specific security tokens (`sct`, `ensid`, `ptid`) from the first catalog payload, and then uses direct, polite batch-concurrency REST calls inside the page context to download, sanitize, and cache every single policy text and reference in `data/board-policies/` as JSON.

```bash
npm run scrape:policies                # discover and fetch all policies (idempotent/cached)
npm run scrape:policies -- --force     # ignore cache, re-fetch all 619 policies
npm run scrape:policies -- --limit 5   # cap download at 5 policies (excellent for testing)
```

### Board packet PDF download

`scrape:packets` is a follow-on slow path that downloads the actual PDF attachments and adds memo fields (Quick Summary / Recommendation / Rationale / Financial Impact / Speaker) by walking each item's detail view. It enriches the memo files `scrape:simbli` produces.

```bash
npm run scrape:packets           # scrape all meetings (downloads PDFs)
npm run scrape:packets -- --date 2026-02-26  # single meeting
npm run scrape:packets -- --skip-existing    # skip cached meetings
```

### Transcription

Board meeting audio is transcribed with AssemblyAI Universal 3 Pro with speaker diarization. See [`data/METHODOLOGY-transcription.md`](data/METHODOLOGY-transcription.md) for full details on audio source selection, model settings, output schema, and quality observations.

```bash
npm run transcribe                          # all unprocessed meetings
npm run transcribe -- --date 2026-01-14     # single meeting
npm run transcribe -- --limit 5             # batch of 5
node scripts/transcribe-dashboard.mjs       # live progress dashboard at localhost:3456
```

**Output:**
- `artifacts/audio/{videoId}.webm` — raw Opus audio (permanent cache)
- `artifacts/transcripts-aai/{videoId}.json` — full diarized transcript with word-level timestamps
- Published to `data.rcsd.info/audio/` and `data.rcsd.info/transcripts-aai/`

### Google Search Console SEO & Crawl Monitoring

The pipeline audits search indexing and crawler health using the Google Search Console API. It lists registered sitemap download errors, queries organic search footprint metrics for the last 30 days, and checks individual pages for crawling permissions and usability errors.

```bash
npm run monitor:gsc                          # run search console monitoring
npm run monitor:gsc -- --mock                # preview with realistic simulation data
npm run monitor:gsc -- --limit 50            # inspect a larger sample of sitemap URLs
```

**Output** (both gitignored — real Search Console data is operator-specific and stays out of the public repo; run `npm run monitor:gsc` to regenerate locally):
- `data/gsc-data.json` — raw API results
- `data/gsc-monitoring-report.md` — human-readable Markdown SEO & crawl error dashboard

## Document Ontology

All meeting attachments are classified into a document index (`data/document-index.json`) using the following taxonomy. Each document is tagged with type, subtype, school(s), school year, and meeting provenance.

| Type | Subtypes | Description |
|------|----------|-------------|
| **budget** | adopted-budget, first-interim, second-interim, unaudited-actuals, gann-limit, presentation, budget-reduction, multi-year-projection, developer-fee | District financial documents and reports |
| **lcap** | annual, mid-year, federal-addendum, amendment | Local Control and Accountability Plan |
| **spsa** | plan | School Plan for Student Achievement (per-school, per-year) |
| **sarc** | report | School Accountability Report Card (per-school, per-year) |
| **school-report** | presentation | Annual school board presentations with data and SPSA updates |
| **resolution** | resolution | Numbered board resolutions |
| **policy** | policy | Board policies, administrative regulations, bylaws |
| **tax** | parcel, bond | Parcel tax measures (E/U — revenue) and facilities bonds (S/T — construction) |
| **sped** | contract, report | Special education NPS/NPA contracts and study reports |
| **english-learners** | elac, delac, data | English Learner Advisory Committees and reclassification data |
| **early-ed** | preschool, tk | California State Preschool Program (CSPP), Head Start, Transitional Kindergarten |
| **labor** | rcta, csea, other | Union agreements — RCTA (certificated teachers), CSEA (classified staff), RCAA (administrators) |
| **compliance** | williams-ucp | Quarterly Williams/Uniform Complaint Procedure reports |
| **safety** | safety-plan | Comprehensive School Safety Plans (CSSPs) |

### Bargaining Units

The district has three employee bargaining units:
- **RCTA** — Redwood City Teachers Association (certificated/teaching staff)
- **CSEA** — California School Employees Association (classified/support staff)
- **RCAA** — Redwood City Administrators Association (management/admin)

### Meeting Item Schema

Each meeting's `items` array uses a formal agenda structure:

| Field | Type | Description |
|-------|------|-------------|
| `itemLabel` | string | Hierarchical agenda number ("1", "7.1", "11.3") |
| `title` | string | Clean title (no numeric prefix, no duration suffix) |
| `isSection` | boolean | True for section headers |
| `plannedMinutes` | number/null | Planned duration from agenda (sections only) |
| `actionType` | string/null | "Procedural", "Action", "Action (Consent)", "Discussion", "Information" |
| `speaker` | string/null | From board memo Speaker field |
| `attachments` | array | `{ title, aid, href, filename, size }` |
| `publicComments` | array/null | Individual speakers: `{ name, startSeconds, endSeconds, summary }` |
| `phases` | object/null | Chapter marker timestamps: `{ opened, presentation, publicComment, discussion, vote }` |

## Artifacts & Storage

| Location | Contents | Storage |
|----------|----------|---------|
| `data/` | JSON data files, methodology docs | Git (committed) |
| `docs/` | Generated HTML site | Git → Cloudflare Pages |
| `artifacts/` | Audio, transcripts, PDFs | Local + R2 (gitignored) |
| `data.rcsd.info` | Published artifacts | Cloudflare R2 bucket |

## Setup

```bash
npm install
cp .env.example .env  # add ANTHROPIC_API_KEY and ASSEMBLYAI_API_KEY

# For PDF link extraction:
python3 -m venv .venv
.venv/bin/pip install pymupdf

# For board packet scraping:
npx playwright install chromium
```

## Adapting for Your District

This pipeline can be adapted for other California school districts that use BoardDocs or Simbli:

1. **BoardDocs:** Change `COMMITTEE_ID` in `scrape-boarddocs.mjs`
2. **Simbli:** Change the `S=` school ID in URL patterns
3. **YouTube:** Change `CHANNEL_URL` in `scrape-youtube-index.mjs`
4. **Schools:** Replace `data/schools.json` with your district's school data
5. **Transcription:** Provide your own `ASSEMBLYAI_API_KEY` in `.env`

## Disclaimer

This is not an official Redwood City School District product. Data is independently assembled from publicly available sources and may contain errors. AI-generated content (meeting summaries, timestamp mappings) is labeled as such. For authoritative information, visit [rcsdk8.net](https://www.rcsdk8.net).

## License

MIT
