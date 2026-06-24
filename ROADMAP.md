# RCSD.info Roadmap

## Calendars
- [ ] Full district calendar page (not just homepage widget) with clearer visual treatment of multi-day windows (e.g. Spring Break shown as a block, not just start date)
- [ ] Per-school calendars with school-specific events layered on top of district calendar
- [ ] iCal (.ics) subscription feeds for district and per-school calendars

## School Pages — Community & Parent Links
- [ ] Surface parentLinks on school detail pages and homepage cards
- [ ] WhatsApp parent group links per school
- [ ] After-school program info affiliated by school site
- [ ] Verify Clifford Konstella link (check cliffordschoolpto.org/helpful-links)
- [ ] Get North Star Konstella signup link from PTA

## School Pages — Advisory & Special Programs
- [ ] ELAC (English Learner Advisory Committee) info per school
- [ ] DELAC (District English Learner Advisory Committee) info
- [ ] Special Education / SEPTAR info and links
- [ ] After-school programs by school site

## School Pages — Documents
- [ ] Pull Spanish-language SARCs for 2024-25 and upload to data.rcsd.info/documents/sarc/2024-25/spanish/
- [ ] Link Spanish SARCs from /escuelas/ pages (currently links to English with "(inglés)" note)

## School Pages — Board Presentations
- [ ] Kennedy and Garfield have not presented since 2023-24 — flag or investigate
- [ ] Scrape BoardDocs back to ~March 2023 to capture the missing Garfield and Kennedy presentations

## District & School Committees
- [ ] Citizens' Bond Oversight Committee (CBOC) — membership, meeting dates, agendas, minutes
  - Measure S bond committee; Alan Hansen approved as taxpayer rep Dec 2025
  - Should have its own page or section on district page
- [ ] School Site Councils (SSCs) — scrape and index meeting agendas, minutes, and materials per school
  - Currently "Coming soon" on school pages
  - SSCs approve CSSPs and SPSAs; membership is public record
  - [x] Extract structured SSC membership from SPSA PDFs (member names, roles [parent/staff/community]) into `data/ssc-membership.json` — 12 schools × 3 years extracted, surfaced on school pages and MCP server
  - Subject to Greene Act (Ed Code 35147): 72-hour agenda posting, open meetings, 3-year record retention
  - Known sources: Taft has Google Docs (https://docs.google.com/document/d/1YsMiY6CFhrxRX9ploZViPZqy4UigzYUTZMVYTf53VdI/); Kennedy has Sept/Oct 2023 on website; Orion has a public Google Drive folder at https://drive.google.com/drive/folders/1ZM8gRkBjer18QwlvNG_pEKOYmgFmwRZa (anonymously scrapable, per Board President 2026-04-20); MIT has placeholder pages only
  - Most schools have no publicly visible SSC documentation
- [ ] DELAC (District English Learner Advisory Committee) — scrape and index meeting agendas, minutes, presentations
  - District page: rcsdk8.net DELAC page has 2025-26 schedule (9 meetings), but only Aug 2025 docs posted
  - Aug 2025 meeting has agenda, minutes, and presentation in both EN and ES — good model
  - Need to get historical meeting documents and ongoing minutes
- [ ] ELAC (English Learner Advisory Committee) — per-school meeting agendas, minutes, materials
  - Required at schools with 21+ EL students (5 CCR 11308); all RCSD schools likely qualify
  - Subject to Greene Act like SSCs
  - Taft is only school with any ELAC info on website (meets 5x/year, one date listed)
  - No other school has visible ELAC documentation
- [ ] District Advisory Committee (DAC) — LCAP advisory body
- [ ] Special Education Community Advisory Committee (CAC/SEPTAR)
- [ ] PTO/PTA board members and meeting schedules per school

## CDE Data Pulls

### Tier 1 — High value, per-school, current
- [ ] ELPAC Results — EL proficiency levels (1-4) per school (2023-24)
  - Source: https://caaspp-elpac.cde.ca.gov/caaspp/ (Research File List, ELPAC test type)
- [ ] ELAS/LTEL Data — Long-term English Learner counts + reclassification per school/grade (2024-25)
  - Source: https://www.cde.ca.gov/ds/ad/filesltel.asp
  - Critical for equity: shows students stuck as EL for 6+ years
- [ ] Staff Race/Ethnicity — Official CDE teacher diversity per school (2024-25)
  - Source: https://www.cde.ca.gov/ds/ad/filesstre.asp
  - More authoritative than local HR briefings, enables multi-year trending
- [ ] Staff Experience — New vs veteran teacher distribution per school (2024-25)
  - Source: https://www.cde.ca.gov/ds/ad/filesstex.asp
- [ ] Student/Staff Ratios — Class sizes, counselor ratios per school (2024-25)
  - Source: https://www.cde.ca.gov/ds/ad/filesstrat.asp
- [ ] Chronic Absenteeism (disaggregated) — Demographic breakdown beyond Dashboard headline (2024-25)
  - Source: https://www.cde.ca.gov/ds/ad/filesabd.asp
  - Reveals equity gaps (e.g. 15% overall but 25% among SED students)

### Tier 2 — Valuable supplemental
- [ ] Suspension Data (disaggregated) — Demographic breakdown of discipline (2024-25)
  - Source: https://www.cde.ca.gov/ds/ad/filessd.asp
- [ ] Stability Rate — Student mobility/retention rates per school (2024-25)
  - Source: https://www.cde.ca.gov/ds/ad/filessr.asp
- [ ] FRPM Data — Multi-year poverty trend analysis, 14 years of history (2024-25)
  - Source: https://www.cde.ca.gov/ds/ad/filessp.asp (XLSX format)
- [ ] Census Day Enrollment (full disaggregation) — Grade × race enrollment detail (2024-25)
  - Source: https://www.cde.ca.gov/ds/ad/filesenrcensus.asp
- [ ] Staff Education Level — % of teachers with advanced degrees per school (2024-25)
  - Source: https://www.cde.ca.gov/ds/ad/filessted.asp
- [ ] EL by Grade and Language — EL enrollment by home language per school (2024-25)
  - Source: https://www.cde.ca.gov/ds/ad/fileselsch.asp

### Tier 3 — Lower priority or limited availability
- [ ] Physical Fitness Test (PFT/FITNESSGRAM) — 5th/7th grade fitness results per school
  - Source: https://dq.cde.ca.gov/dataquest/PhysFit/ (query tool only, no bulk download post-2019)
- [ ] CA Healthy Kids Survey (CHKS) — School climate, safety, connectedness
  - Source: https://calschls.org/reports-data/query-chks/
  - Likely district-level only for public access; per-school may require district auth
- [ ] Historical Enrollment (1981-2022) — Long-term enrollment trends
  - Source: https://www.cde.ca.gov/ds/ad/fileshistenr8122.asp
- [ ] Homeless Student Enrollment — Per-school by dwelling type (heavily suppressed)
  - Source: https://www.cde.ca.gov/ds/ad/fileshse.asp
- [ ] OCR Civil Rights Data Collection (CRDC) — Only source for per-school 504 plan counts
  - Source: https://ocrdata.ed.gov/ (most recent: 2020-21, lags ~5 years)
- [ ] Board SpEd Study Report — Detailed per-school SpEd analysis from external consultant
  - April 2024: https://go.boarddocs.com/ca/redwood/Board.nsf/files/D422AX010F7C/$file/Redwood%20City%20SD%20Special%20Education%20Study%20Report.pdf
  - May 2025 update: https://go.boarddocs.com/ca/redwood/Board.nsf/files/DGVSN2736D8B/$file/05_25%20Special%20Education%20Study%20Implementation%20Update%20-%20Board%20Presentation.pdf

## Board Meetings — Public Engagement Tip Boxes
- [ ] **"So you'd like to speak at a board meeting?"** — tip box explaining how to submit a speaker card (online form links for EN/ES, in-person process, time limits, what to expect, Zoom raise-hand for remote)
- [ ] **"So you'd like a topic discussed at a future board meeting?"** — tip box explaining how to request agenda items (contact board members/superintendent, submit written communications, attend public comment to raise the topic, "Other Business/Suggested Items for Future Agenda" section)
- Should appear on the meetings page as collapsible cards near the top
- Bilingual (English + Spanish)

## Board Meetings — Historical Data
- [ ] Scrape BoardDocs back to ~March 2023 (currently starts March 2024)
  - Would capture: Garfield Nov 2023 presentation, Kennedy Nov 2023 presentation, full 2023-24 school year
  - BoardDocs is client-side Angular; need to hit API endpoints or use headful browser
  - Enables multi-year trending of board actions per school
- [ ] Pre-April 2020 BoardDocs backfill (agenda-only, no video) — 2019-2020 school year meetings exist in BoardDocs but YouTube recordings only start April 2020 (first COVID virtual meeting)
- [ ] Add "comprehensive from" statement on meetings page — clearly state April 2020 as start of full coverage (agenda + video + transcript), with agenda-only for earlier meetings if/when backfilled
- [ ] Backfill board packet PDFs for pre-June 2025 meetings — currently only 22 recent meetings have downloaded attachments; 167 older meetings have metadata links but no archived PDFs. BoardDocs links may break; good candidate for trogdor batch job

## Board Meetings — Lifecycle States

A meeting progresses through distinct states, each with different data confidence:

1. **Scheduled** (weeks/months out): On governance calendar. We know the date and can provisionally describe planned topics at a high level. Calendar widget shows: date, "Board Meeting", high-level preview if available.
2. **Agendized** (Friday before Wed meeting): Public agenda posts. Now concrete what will formally be discussed. Show: agenda link, one-sentence summary of key items, any attachments.
3. **Live** (during the ~2hr meeting): Prominently display Zoom join link. This should be the most visible state — a parent checking the site during a meeting should immediately see how to join.
4. **Awaiting Recording** (0-3 days after): Meeting happened but no video yet. We know what was agendized but not what actually transpired. Show: agenda-based summary with language like "Scheduled to discuss..." rather than "Discussed...". Any attendee notes or live observations could supplement.
5. **Recorded** (2-3 days after): YouTube video posts. From detailed ASR analysis we can understand what transpired, but this is unofficial. Show: video link, AI-generated summary with caveat.
6. **Minutes Approved** (~1 month later): Formal minutes approved at a subsequent meeting. High confidence about what officially transpired. Show: approved minutes link, authoritative summary.

The calendar widget and meeting pages should reflect which state each meeting is in, and be clear about the confidence level of any summary shown.

## Board Meetings — School Relevance
- [ ] Better summarize school-relevant meetings: "What was discussed/approved in this board meeting (per the minutes) that could impact $SCHOOL?"
- [ ] For meetings without minutes: "What was on the agenda that could impact $SCHOOL?"
- [ ] Surface these per-school summaries on school pages

## Board Meetings — Transcription & Chapters
- [x] Replace YouTube auto-captions with proper ASR (AssemblyAI Universal 3 Pro) — 144 meetings transcribed
- [x] Generate chapter markers linking formal agenda items to meeting timestamps with phase data (opened, presentation, publicComment, discussion, vote)
- [x] Diarized speaker identification in transcripts (AAI speaker diarization + LLM speaker-to-name mapping)
- [x] Individual public comment speaker extraction with names, timestamps, and summaries
- [x] Formal agenda structure with hierarchical item labels (e.g., 7.1, 11.3) from board memos and BoardDocs
- [x] Web transcript viewer — full-width sticky YouTube player with scrollable diarized transcript, bidirectional sync, search with highlighting
- [x] Downloadable transcript JSON per meeting — slim format on R2 at transcripts/{date}.json
- [ ] Unified meeting page with tab selector: Transcript / Agenda / Minutes — all synced to video playback (click agenda item 9.3 → scrub video to that timestamp; agenda highlights current item during playback)
- [ ] Spanish translation of transcripts

## Board Meetings — Detailed summaries from transcripts
Build a pipeline for rich per-meeting summaries (inputs already in place: AAI transcripts + formal agenda + minutes + chapter markers):
- [ ] Per-agenda-item discussion summary (what was said, by whom, key points raised)
- [ ] Ordered by actual discussion sequence (not agenda order); note agenda changes proposed/approved at the top
- [x] Each public comment: who spoke + summary of remarks (done via chapter markers extraction)
- [ ] Spanish-language public comments: capture interpreter's English translation alongside original
- [ ] EN and ES output, written at sixth-grade reading level (Californian colloquial Spanish for ES)
- [ ] District-specific terms (LCAP, CAASPP, unduplicated pupil, SARC, etc.) get hover-over/clickable inline glossary definitions
- [ ] AI-generated content clearly labeled
- Open questions: glossary via `<abbr title>` vs popover component? Define terms once per page or per first-use per section?

## Agent / API Layer
- [ ] **Enhanced MCP server** — add `get-meeting-details` tool returning transcript, agenda items with PDF download links, timecode mappings, minutes, and source links (BoardDocs/Simbli/YouTube) for a given meeting date
- [ ] **ChatGPT App** via OpenAI Apps SDK (https://developers.openai.com/apps-sdk) — a "RCSD Assistant" that non-technical parents can use directly without knowing what MCP is; backed by the data.rcsd.info JSON API
- [ ] **MCP docs in Spanish** — translate /mcp/ page to match the bilingual pattern of the rest of the site
- [ ] Per-child teacher/homeroom config in family settings — enables teacher-aware queries (field trips, homework, class-specific events)
- [ ] Per-school teacher roster data — enables "Who teaches 3rd grade MI at Orion?" queries
- [ ] Subscribable lunch calendar (iCal .ics) for overlay onto Apple Calendar / Outlook / Google Calendar
- [ ] OpenAPI / JSON API endpoints on data.rcsd.info for school info, calendars, menus, meetings
- [ ] Publish plugin to npm / Claude Code plugin registry for easy installation
- [ ] **Voice agent: deeper knowledge** — current prototype can answer factual questions (schedules, menus, calendar) but can't answer substantive questions about board meetings (e.g. "what were the highlights of the Garfield presentation?"). Two paths:
  - `get_meeting_transcript` tool that fetches slim transcript JSON from R2, searches for keywords, returns relevant excerpt with surrounding context
  - Richer per-agenda-item summaries (2-3 paragraphs each) generated by running Claude over transcripts as a batch pipeline. Store as `data/agenda-item-summaries.json`. Much better search results than one-line meeting summaries.
- [ ] **Voice agent: upgrade to Gemini 3.1 Flash Live** — current prototype uses `gemini-2.5-flash-native-audio-latest` because 3.1 returned internal errors via API key auth (may need ephemeral tokens via v1alpha). 3.1 scores higher on function calling benchmarks.
- [ ] **"Dial the District" voice agent** — two phone numbers (English and Spanish) that parents can call to ask questions about the district and get spoken answers. Use **Gemini 3.1 Flash Live** (native voice-to-voice, no STT→LLM→TTS pipeline, inherently multilingual). Flash Live scores 90.8% on ComplexFuncBench Audio (multi-step function calling in voice) so it can call district data tools natively during conversation. Available via Gemini Live API in Google AI Studio (preview). Architecture: Gemini 3.1 Flash Live + function declarations mirroring MCP tool schemas + Twilio SIP trunk or LiveKit for telephony. Audio is SynthID-watermarked. Separate EN/ES assistant configs with language-appropriate system prompts. Ref: https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-1-flash-live/
- [ ] **WhatsApp bot** — same concept as the phone agent but over text. Parents text questions to a WhatsApp number and get answers from district data. Lower barrier than MCP setup, reaches parents where they already are. Could use the WhatsApp Business API + Claude.

## People Tab & Entity Registry
- [ ] **People page** — a top-level "People" page showing key district personnel and administrators
  - Best-effort: name, photo, title, contact info, LinkedIn where available
  - Roles change over time — show current role prominently, with role history available
  - Board members (current + historical), superintendent, cabinet, principals, key classified staff
  - Officers of unions (RCTA president, CSEA president, RCAA)
- [ ] **Structured person/entity registry** (`data/entities.json`) — canonical list of individuals with:
  - Name, slug, role history (role + date range), e.g. `{name: "David Weekly", roles: [{role: "Trustee", from: "2022-12-14"}, {role: "Board President", from: "2025-12-17"}]}`
  - Enables: "What meetings did X speak at before becoming a Trustee?", "How many times has Anna Herrera presented?", tracking public commenter appearances across meetings
  - Speaker diarization labels (speaker A/B/C) in transcripts can be mapped to entity slugs, enabling role-aware transcript display ("Board President Weekly asked..." instead of "Speaker F said...")
  - Officer rotation annotations should be derived from this registry, not hardcoded
- [ ] **Board member tenure tracking** — historical board composition at any point in time, including departures and swearing-in dates
- [ ] **Staff roster** — district cabinet, principals, key staff with role dates
- [ ] **Public commenter index** — cross-meeting appearances with summaries of what they spoke about
- [ ] Link entities to relevant documents (contract approvals for vendors, tentative agreements for unions)
- [ ] Cross-reference from meeting items and transcript utterances to entity entries

## Charter School Pages
- [ ] **Per-charter pages** for the three RCSD-authorized charters: Connect Community Charter, KIPP Excelencia Community Prep, Rocketship Redwood City Prep
  - Basic info: authorizing relationship, campus address, grades served, enrollment
  - Financial docs: adopted budgets, 1st/2nd interim reports, unaudited actuals, annual audits — with RCSD's review letters alongside each
  - Source: already landing in board packets under Information items (e.g. 2026-02-04 items 17.1–17.5, 2026-03-25 item 17.2). Document index tagging should make extraction straightforward.
  - Historical series so trends are visible (multi-year audits, interim-to-actual variance)
  - Link from district page + surface in board meeting summaries when charter items are discussed
- [ ] Consider same treatment for the KIPP Excelencia Fair Oaks site given the ongoing Prop 2 CSFP funding workstream (Res 11 Sept 2025, Res 23 April 2026)

## Vendors / Warrant Registers
- [x] **Warrant-register database (the foundation)** — built 2026-06-24 (PR #64, branch `feat/warrant-registers`; plan + caveats in [`WARRANTS.md`](WARRANTS.md)). 76 registers (Mar 2020 – May 2026), 30,253 per-check line items, each reconciled against the register's printed total; queryable via `warrants.db` (SQLite) + `npm run report:warrants -- "<vendor>"`. Validated against the target question — Van Pelt Construction = $5.19M across FY2023-24…FY2025-26.
  - [x] Scrape all warrant registers from board attachments (BoardDocs `$file` backfill + Simbli; two ERP formats QSS + Escape; OCR fallback for broken-font PDFs; per-register provenance + printed-total checksum so bad parses are auditable)
  - [x] Payee-name normalization (`normalizePayeeKey` + curated `data/warrant-vendor-aliases.json` rollup, e.g. CalPERS' several legal names)
- [ ] **Root-cause the attachment-download bug** — Feb 2026's register came down as a misfiled SPSA (our metadata had the right Simbli AID 1433020; the saved bytes were wrong). Could not reproduce from current `scrape-board-packets.mjs`. A filename-vs-content scan of all 77 warrant/SPSA-named cached PDFs found no other mismatches, but the bug class is unexplained.
  - [ ] Broader audit: filename-vs-content check across all ~1,600 cached board-packet attachments (content-typing arbitrary docs is fuzzier than warrants, but would confirm nothing else got crossed)
- [ ] **Re-ingest 2021-05/06/07 in Detail format** — these QSS "Summary" sheets have complete line items but a printed total that over-counts (~1.9–2.3×, likely fund-line summing). Spend figures use the summed line items and are correct; re-exporting in Detail format would let them reconcile and remove the footnote.
- [ ] **PR4 — public bilingual vendor-spend page** (deferred) — EN + ES pages, OG cards, search integration. **Gated on the individual-name privacy decision**: registers list employee mileage/expense reimbursements by name (tagged `payeeType: individual`); decide whether to publish, aggregate, or suppress those before any public surface. `warrants.db` is deliberately gitignored + not R2-synced until then.
- [ ] **Vendor spending dashboard** — top-level "Vendors" page on the DB: who the district does business with, annual spend, per-vendor trends, per-fund breakdowns (fund/object codes are captured for the Escape-era registers)
- [ ] **Contract-to-counterparty index** — go through every approved contract attachment (agreements, amendments, service contracts, change orders ratified in consent agendas) and index it against the counterparty/vendor. Joined with the warrant-spend data, this gives a rich per-vendor view: not just how spending on a vendor (e.g. Boys & Girls Club) has trended over time, but a link to each signed contract behind that spending. The document index (`data/document-index.json`) + agenda attachments already have the raw contract PDFs; the work is extracting the counterparty + term + amount per contract and keying it to the vendor canonical used on `/vendors/`.
- [ ] Vendor search: "How much have we paid PowerFlex?" or "What contracts does Eide Bailly have?"
- [ ] Expand `data/warrant-payee-overrides.json` as more contractors-paid-by-name are identified (started with Susan Forker → Green Environment Inc.)
- [ ] **Recover 2011–2013 registers (better OCR).** BoardDocs has RCSD meetings back to Feb 2011; `scripts/scrape-historical-warrants.mjs` already downloads them (PDFs archived on R2). But 2011–2013 registers are scanned images / broken-font PDFs that `pdftoppm`+`tesseract -psm 6` only partially recovers (rows dropped → don't reconcile), so they're floored out (`HIST_FLOOR`/`FY_FLOOR = FY2014-15`). Revisit with layout-aware OCR (tesseract `--psm 4`/`hocr`, or a table-extraction model) to push clean vendor data back to 2011. Clean coverage today: **FY2014-15 → present**.
- [ ] MCP tool for vendor spend (`query-vendor`) so the data is answerable through the existing RCSD data MCP server

## Document Index
- [x] Unified document index from all meeting attachments (data/document-index.json) — 1,000+ docs classified
- [x] Ontology: budget, lcap, spsa, sarc, school-report, resolution, policy, tax (parcel/bond), sped, english-learners (elac/delac/data), early-ed (preschool/tk), labor (rcta/csea), compliance, safety
- [x] Multi-school tagging per document
- [ ] Surface document index on meetings page and school pages
- [ ] Document timeline/history view per type (e.g., all adopted budgets chronologically)

## Data Completeness Indicators
- [ ] **"Awaiting" tags on meeting cards** — highlight when expected data is missing based on typical cadence:
  - YouTube video: expected within 72 hours of meeting. Show "Awaiting video" yellow tag if meeting was >3 days ago and no YouTube link (e.g. March 11 and March 25 currently missing)
  - Transcript: expected within 1 day of video posting
  - Minutes: expected to be approved ~2 meetings later
  - Agenda: expected ~5 days before a scheduled meeting
- [ ] **Broader document expectations** — track whether expected documents are published on time:
  - SPSAs: due annually, one per school
  - SARCs: due annually by February 1
  - LCAPs: due annually by June 30
  - Interim budget reports: 1st interim (Dec), 2nd interim (Mar)
  - Audits: annual, typically presented by January
- [ ] **Visual treatment**: subtle yellow dot or tag, not red/alarming. Informational, not punitive. Tooltip explains what's expected and when. Disappears when the data appears.
- [ ] **District dashboard view**: aggregate completeness across all schools and document types. "8/12 schools have published 2025-26 SARCs" etc.

## Email Subscriptions & Notifications
- [ ] **Subscribe to meeting updates** — email notification when:
  - A new agenda posts for an upcoming meeting
  - Meeting summary is available (after the meeting happens)
  - YouTube recording posts
  - Approved minutes are available
- [ ] Implementation: Cloudflare Workers + D1 for subscriber list, Resend or SES for delivery, unsubscribe link in every email
- [ ] Frequency options: per-meeting (every event) or weekly digest
- [ ] Bilingual emails matching user language preference

## Personalization (Cookies/Preferences)
- [ ] **Remember your schools** — cookie-based preference to highlight schools you care about (e.g. filter meeting items by school, show your school first on homepage)
- [ ] **Address lookup → community school mapping** — enter your address and see which RCSD school(s) you're zoned for, including any community school overlays. Would need to source attendance boundary GIS data from the district or San Mateo County GIS.
- [ ] **Language preference** — remember EN/ES choice across visits

## Getting Involved / Civic Participation
- [ ] **"Get Involved" page** — showcase opportunities for community participation:
  - **School-level committees**: School Site Council (SSC), ELAC, PTO/PTA — what they do, who's on them, how to join, meeting schedules
  - **District-level committees**: DELAC, DAC, LCAP Advisory, Citizens' Bond Oversight Committee (CBOC), Safety Committee — membership, terms, how people are appointed
  - **Board of Trustees**: how to run for trustee (filing requirements, election dates, terms), how to attend/speak at board meetings, how to submit written public comment
  - **Volunteering**: classroom volunteering, chaperoning, PTO, RCEF
- [ ] Bilingual (EN/ES)
- [ ] Include applicable legal requirements: Greene Act for SSCs/ELACs, Brown Act for board meetings, election code for trustee candidacy
- [ ] Link to district pages where they exist; fill gaps with original content where district pages are incomplete

## Structured Minutes
- [ ] **Parse approved minutes PDFs into structured data** (`data/minutes-structured/{date}.json`) with:
  - Attendance: who was present, absent, arrived late, left early
  - Motions: who moved, who seconded, vote tally (including individual votes when recorded)
  - Public comment speakers: names, topics, duration
  - Agenda changes: items pulled from consent, reordered, added, tabled
  - Key actions: resolutions adopted, contracts approved, amounts
- [ ] Use minutes as authoritative source for transcription prompts (who was present, who spoke) — much more reliable than hardcoded board era guesses
- [ ] Feed structured minutes into entity registry (track individuals across meetings)
- [ ] Surface on per-meeting detail pages: structured attendance, vote records, public comment index
- [ ] Enable queries like "How did Trustee X vote on Y?" or "How many times did Z speak at public comment?"

## Data Changelog
- [ ] **`data/changelog.json`** — append-only log of pipeline events with timestamps, structured as `{date, type, meetings[], details}`. Types: `agenda-scraped`, `youtube-ingested`, `transcribed`, `summary-generated`, `packets-downloaded`, etc.
- [ ] Pipeline scripts append to changelog after each run (what was new, what was skipped, errors)
- [ ] **`/changelog` page** — human-readable feed of data ingestion events ("March 31: Added March 11 & 25 YouTube videos and transcripts")
- [ ] Feeds into email subscription system — changelog entries become notification content
- [ ] Bilingual (EN/ES)

## Automation & Infrastructure
- [ ] **Trogdor cron automation** — move scraping pipeline to trogdor (beefy Linux server with CUDA) on a schedule:
  - Simbli agenda scrape (daily or 2x/week)
  - YouTube channel index (daily)
  - Board packet download (daily)
  - AssemblyAI transcription (triggered on new video detection)
  - Timestamp mapping via Claude (after transcription)
  - Site rebuild + `wrangler pages deploy` (after any data change)
- [ ] **Screencap demo** — narrated screen recording showing: homepage, clicking into a meeting, transcript click-to-seek, Spanish toggle, chapter markers, MCP query. For embedding on the site and social sharing.

## Data Attribution (in progress)
- [ ] **Rebuild school growth numbers from scratch.** Current `growth: { ela, math }` fields on each school (scripts/build-schools.mjs) are unverified and mislabeled — the tooltip claims "CAASPP 105%+ of expected growth" but CAASPP doesn't produce that metric, and the values don't match the district's actual LCAP-tracked metric (i-Ready Expected Growth). Plan:
  - [ ] Scrape each school's 2025-26 Board of Trustees data presentation PDF (listed in `SCHOOL_BOARD_PRESENTATION` in build-schools.mjs) and extract the LCAP Goal #3 table: "% of students meeting i-Ready Expected Growth" for ELA and Math, with Base 23-24 / Year 1 24-25 Actual / Year 2 25-26 Mid-Year rows.
  - [ ] Persist extracted numbers as structured JSON under `data/ireadyu-growth/<slug>.json` with per-cell source (PDF URL + page #) so every number links back to its slide.
  - [ ] Rewrite the growth stat cards to show the metric honestly: "% meeting i-Ready annual growth target, <year>" with a source link that opens the actual PDF slide (not the CDE growth-model page, which is unrelated).
  - [ ] Rewrite the tooltip/fine-print text in both EN and ES (scripts/build-schools.mjs:1273-1274 and :1418-1419) to describe i-Ready, not CAASPP.
- [ ] **Provenance tagging across all hardcoded data.** Every value in the `SCHOOL_DATA` object (CAASPP, demographics, funding, staffing) should carry a `source` attribute pointing to the specific document and page/row it came from, so readers (and future us) can audit each claim. Design a lightweight schema (e.g. `{ value: 11.4, source: "2025-26 SPSA, p.12" }`) and migrate existing fields.
- [ ] Pull CDE growth model spreadsheet (growthmodeldownload2025.xlsx) to check for useful RCSD data not yet represented

## Follow-ups from the June 2026 fix-sprint verification (2026-06-10)
- [ ] **Capture the 12 "E PDF" policy exhibits.** Simbli stores exhibit-series policies (e.g. 1312.4-E PDF(1) Williams complaint forms, 6174-E PDF(1) EL education) as embedded PDFs; scrape-board-policies.mjs captures neither the text nor the PDF (contentText and attachments both empty — only footnotes come through the metadata API). Extend the scraper to download the embedded PDF to R2 and text-extract it, then these 12 flow into the Spanish translation + summary pipelines like the other 607.
- [ ] **Render AI summaries for multi-meeting dates.** 25 suffixed detail pages (8 multi-meeting dates, e.g. 2020-04-01) have summaries in `data/meeting-summaries.json` under suffixed slugs that the detail builder never looks up — they render unlabeled/summary-less while the data exists.
- [ ] **Migrate `/mcp/` pages into the build.** `docs/mcp/index.html` + `es/` are hand-maintained static files; they drift from the shared chrome every time html-parts changes (hand-patched 2026-06-10: token, describedby, Committees tab — still no search box or skip link).
- [ ] **Generate dedicated OG cards for /policies/ + /politicas/** (currently reuse the homepage cards; ES uses page-home-es as a stopgap).
- [ ] **`DATA_BASE` env var for the MCP worker** so `wrangler dev` can point at local `data/` instead of production R2 — today, data-dependent fixes can't be verified end-to-end before upload.
- [ ] **Dependabot: 5 moderate vulnerabilities** flagged on the default branch (GitHub banner on every push) — review and bump.
- [ ] **Drop `build-transcript-viewer.mjs`** — legacy, not in run-pipeline, and overwrites bilingual pages with EN-only if run manually (header now warns).
