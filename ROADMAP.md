# RCSD.info Roadmap

## Provenance and Multi-District Platform — Stack Ranked

Highest priority appears first. This list is intentionally not numbered: reorder the
bullets when priorities change. Keep only forward work here; completed work belongs
in commit messages, `CHANGELOG.md`, and the project blog.

- [ ] **Make generated-site changes small and reviewable before the next bulk
  regeneration.** Extract the remaining shared policy CSS and stable page chrome into
  release-managed assets or partials, keep authored sources distinct from generated
  outputs, evaluate building bulky `docs/` derivatives only in CI, and add a diff-budget
  check that flags repeated inline blocks or unexpectedly large generated churn. Preserve
  static no-JavaScript semantics, bilingual parity, and release-manifest coverage.
- [ ] **Prove the first Pages-only platform slice with San Mateo–Foster City.**
  Extract the shared Simbli acquisition boundary and canonical meeting contract, match
  an RCSD shadow fixture, then publish an explicitly allowlisted SMFCSD `v0` sample to
  the no-index holding Pages project. Reconcile 12 meetings across Agenda Online,
  Simbli, and YouTube; retain independent occurrence, agenda, minutes, and recording
  states; show discrepancies and record-level provenance; and measure language coverage
  per artifact. Use official menu PDFs and test a vendor feed only after the district
  links it. Require English/Spanish structural parity and no zero score in the
  `actionSafety` dimension defined by the SMFCSD expert-review rubric; require at least
  90% of the sample to pass first review without major correction; and turn every
  accepted correction into
  a source-linked generic fixture, rule, or terminology entry. Run for two board cycles
  or 30 unattended days and stay below 15 minutes of maintenance per district per month
  before onboarding Ravenswood. Keep at most three active districts until combined
  maintenance stays below 45 minutes per month.
- [ ] **Continuously refresh the official policy index.** Schedule periodic rescans of
  the GAMUT/Simbli policy portal, compare catalog and source hashes, and queue delayed
  rechecks after policies clear a second reading in a board consent agenda (for example,
  one and two weeks later). Ingest only official portal changes, retain the adopting
  meeting/item as lineage, and regenerate Spanish and summary derivatives with their
  exact LLM provenance.
- [ ] **Extend exact LLM invocation envelopes to every mutating pipeline.** Apply the
  policy contract to meeting summaries, memo/transcript translation, chapters,
  timestamp mapping, and future extraction/classification jobs; retain explicit
  historical exceptions rather than inventing missing parameters.
- [ ] **Prove configuration-only reuse with Ravenswood, then adapter contrast with
  Fresno.** Model dated source regimes and extract representative meeting, finance,
  calendar, menu, video, and language samples without publishing reconnaissance
  artifacts. Keep district quirks in source-linked configuration and fixtures rather
  than district-name branches in shared adapters.
- [ ] **Migrate the strongest deterministic datasets next.** Bring warrants, CDE, and
  SARC behind schema, source-snapshot, hash, reporting-period, and reconciliation gates.
- [ ] **Move composite facts and editorial claims out of page builders.** Give schools,
  charters, trustees, properties, calendars, and budgets record/field-group sources;
  represent calculated or plain-language assertions as reviewable derived claims.
- [ ] **Connect the full meeting lineage.** Trace portal records, agendas, packet
  attachments, video, audio, raw/slim transcripts, chapters, timestamp mappings,
  summaries, and translations with explicit lifecycle and official/derived status.
- [ ] **Generate provenance for every audience from one source.** Add bilingual source
  and methodology panels, public provenance/release JSON, and MCP provenance lookup
  without changing existing routes or requiring client migration.
- [ ] **Choose a neutral public identity only after the pilot earns permanence.** Keep
  links derived from `PUBLIC_BASE_URL` and the holding deployment excluded from search
  indexing; attach a custom domain and remove `noindex` only through an explicit
  publication decision.
- [ ] **Expand the California cohort only after the pilot contracts stabilize.** Use
  Menlo Park City and Pajaro Valley to test Diligent generations, OpenGov, CatapultCMS,
  and fragmented multilingual publishing; use Oakland/Legistar as the later high-volume
  multi-body stress test, with Dixon available for Granicus coverage.

## Annual Refresh — deferred items

Found while building the freshness guard (2026-08-19). See `docs/ANNUAL-REFRESH.md`.

- [ ] **Committed `docs/` drifts from `data/`, and regenerating surfaces it in unrelated PRs.**
  The pipeline rebuilds and deploys `docs/` but never commits it, so tracked HTML falls
  behind whatever `data/` currently holds. Rebuilding on a pristine `origin/main` with no
  source changes at all already produces diffs — verified 2026-08-19. Two concrete ones:
  - Kennedy's 2025-06-25 section renders "HVAC Upgrade Projects Phase II" twice, the same
    item with the same watch URL. Board-meeting items need de-duplication before render.
  - Roosevelt's 2020-04-01 portable-rental item gets `t=258`, which lands on approval of
    the agenda rather than the bond consent item (the regenerated cache puts the first
    bond consent item at 313s). A confidently wrong video jump.

  Both predate and are independent of the freshness work. Either commit rebuilt `docs/`
  from CI so drift cannot accumulate, or stop tracking built HTML — the current halfway
  state means any PR that rebuilds inherits unrelated churn.
- [ ] **Principal headshots are not refreshed when a principal changes.** `docs/img/principals/{slug}.jpg`
  is a hand-maintained asset, so the four principals corrected on 2026-08-19 briefly had
  their predecessor's face under their name. Photos were replaced by hand from the school
  leadership pages. The probe already reads those pages and could record the portrait URL,
  making this checkable the same way the name is.
- [ ] **Bind the ~50 hand-written school years in `build-schools.mjs` to their constants.**
  `scripts/lib/school-year.mjs` now owns the years that drive URLs, file paths, and CDE
  source notes, but headings, stat bubbles, and intro copy still write years out. Each one
  needs identifying with the fact it belongs to (SPSA, LCAP, i-Ready presentation, SSC
  roster, CSSP, SARC, or the year a SARC reports on) — several are NOT the same fact even
  though they read the same today, and substituting one constant across them produced false
  provenance once already. This is a careful reading pass, not a find-and-replace, which is
  why it is its own task. A test bounds the current count so the debt cannot grow.
- [ ] **Bell schedules, district calendars, and lunch URLs** rotate each August with no clean
  machine source. Deliberately out of scope for the annual-refresh effort; verify
  opportunistically until a source exists.
- [ ] **The budget page is the densest concentration of stale facts in the repo.**
  `scripts/build-budget.mjs` hardcodes the 2025-26 Second Interim narrative across ~40
  sites, plus a 2026-27 proposed-budget banner that explicitly promises a post-adoption
  refresh. Needs its own effort.
- [ ] **CA Dashboard year `2024`** is hardcoded in `build-schools.mjs`, `build-homepage.mjs`,
  and `build-budget.mjs`. Rolls each December.
- [ ] **Surface "data as of" dates to readers.** `schools.json.lastUpdated`,
  `trustees.json._metadata.retrieved`, `cde/*._metadata.downloadDate` and others all exist
  and are never displayed. Near-zero cost, and it makes the refresh self-auditing.

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
- [ ] **Snapshot external (non-Simbli) attachment links** — some agenda attachments are bare hrefs to third-party hosts rather than Simbli-hosted PDFs (e.g. 2026-08-10's county Investment/Compliance Reports on smcgov.org, and a bit.ly link to the NPS/NPA approved rate sheets), so `download-board-packets.mjs` correctly skips them and the packet archive isn't self-contained. Teach the downloader (or a sibling step) to capture these URLs too, clearly labeled as third-party captures with fetch date + source URL, so the archive survives link rot — bit.ly redirects especially can break or be repointed silently

## Board Meetings — Lifecycle States

A meeting progresses through distinct states, each with different data confidence:

1. **Scheduled** (weeks/months out): On governance calendar. We know the date and can provisionally describe planned topics at a high level. Calendar widget shows: date, "Board Meeting", high-level preview if available.
2. **Agendized** (Friday before Wed meeting): Public agenda posts. Now concrete what will formally be discussed. Show: agenda link, one-sentence summary of key items, any attachments.
3. **Live** (during the ~2hr meeting): Prominently display Zoom join link. This should be the most visible state — a parent checking the site during a meeting should immediately see how to join.
4. **Awaiting Recording** (0-3 days after): Meeting happened but no video yet. We know what was agendized but not what actually transpired. Show: agenda-based summary with language like "Scheduled to discuss..." rather than "Discussed...". Any attendee notes or live observations could supplement.
5. **Recorded** (2-3 days after): YouTube video posts. From detailed ASR analysis we can understand what transpired, but this is unofficial. Show: video link, AI-generated summary with caveat.
6. **Minutes Approved** (~1 month later): Formal minutes approved at a subsequent meeting. High confidence about what officially transpired. Show: approved minutes link, authoritative summary.

The calendar widget and meeting pages should reflect which state each meeting is in, and be clear about the confidence level of any summary shown.

- [ ] **Slot governance-calendar topics into future dates before formal agendas post** (realizes state 1's "high-level preview if available"). The "Schedule of Board Agenda Items" (a.k.a. governance calendar) lists high-level planned topics per future meeting; it is attached to the **"Other Business / Future Topics"** agenda item and is already located by `findGovernanceCalendar()`. Extract its per-date topics into `data/governance-calendar.json` `provisionalTopics` so the **Approved Meeting Calendar** grid (topic dot + hover title), the **"Next meeting"** glance card, the homepage, and the ICS feed all show a high-level preview *before* the concrete agenda posts (~72h before each meeting). **Blocked:** the 2026‑27 Schedule of Board Agenda Items has not posted yet — expected on/after the **Aug 10, 2026** agenda; this becomes a live TODO once it posts. (25‑26 reference PDF, most recent: `https://simbli.eboardsolutions.com/meetings/TempFolder/Meetings/25-26%20Schedule%20of%20Board%20Agenda%20Items_1585773rqjlb03ajnwipfdmziqkg0gu.pdf`)

## Board Meetings — School Relevance
- [ ] Better summarize school-relevant meetings: "What was discussed/approved in this board meeting (per the minutes) that could impact $SCHOOL?"
- [ ] For meetings without minutes: "What was on the agenda that could impact $SCHOOL?"
- [ ] Surface these per-school summaries on school pages

## Board Meetings — Transcription & Chapters
- [ ] Unified meeting page with tab selector: Transcript / Agenda / Minutes — all synced to video playback (click agenda item 9.3 → scrub video to that timestamp; agenda highlights current item during playback)
- [ ] Spanish translation of transcripts
- [x] **Alignment-shift repeat failures** (resolved 2026-08-18): all six 4.6-era failers (2020-04-22, 2020-06-17, 2020-07-22, 2020-09-09, 2020-09-30, 2021-02-10) passed the digit-alignment guard on claude-sonnet-5 in the full-corpus drain (run 32193943887: 146/147 translated, $113.69 accounted). One new straggler, 2021-08-11, failed once in the drain — expected to clear on a scheduled retry; if it repeats across several runs, retry with smaller batches (shift risk grows with batch length) and add a persistent skip-list/backoff.
- [x] API spend guardrail in pipeline (2026-08-18): translate-transcripts now has a $10/run cost ceiling (MAX_RUN_COST) plus a stuck-drain detector (staleDeferred not shrinking for 4 saturated runs), recorded in committed data/translation-health.json and asserted by check-pipeline-health.mjs as the LAST workflow step — red run alerts via GitHub email without discarding paid work. Still open (operator): org-wide Console spend alert (per-key limits don't exist), and verify workflow-failure emails actually arrive for scheduled runs. Consider extending the cost ceiling to extract-chapter-markers. (Loop ledger: flatlined Jul 22–Aug 18, ~4 weeks, ~$1.1–1.2k waste.)
- [ ] Audit `dweekly-key-1` API key usage ($81.72 month-to-date, last used Aug 14) — identify what's calling it, rotate/kill if orphaned.

## Board Meetings — Detailed summaries from transcripts
Build a pipeline for rich per-meeting summaries (inputs already in place: AAI transcripts + formal agenda + minutes + chapter markers):
- [ ] Per-agenda-item discussion summary (what was said, by whom, key points raised)
- [ ] Ordered by actual discussion sequence (not agenda order); note agenda changes proposed/approved at the top
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
- [ ] **"Dial the District" voice agent** — two phone numbers (English and Spanish) that parents can call, text, or WhatsApp to ask questions about the district. **In progress 2026-07-19.** Plan: numbers owned in Twilio (vendor-portable); Synthflow voice agents (EN/ES) + Synthflow chat agents for SMS/WhatsApp via the Twilio integration; thin REST facade worker wrapping MCP-server data tools for Synthflow custom actions. Greeting must disclose AI + independent-of-district status (CA B&P §17941).
  - [x] English number registered: **(650) 482-8912**, Twilio SID `PN362f56b4c53d16a1c7d3f7f56004e907` (2026-07-19)
  - [x] Spanish number registered: **(650) 399-7203**, Twilio SID `PN321fe9e3d033d9f36ba9db4b33a2c5fb` (2026-07-19)
  - [x] A2P 10DLC registered (2026-07-19): Primary Customer Profile `BUcc2e4c96fc84e34313a8f1ee46d8910b` (Primatech Paper Co LLC, approved), Low Volume Standard brand `BN9d512160e771a7442b26653d43790118` (TCR ID BJXM0AA, registered), Low Volume Mixed campaign `CM990654babdfe036bff7008f9bbdf6e39` (both numbers pre-associated to Messaging Service `MGdd84695f9632558345909532a0987c99`, auto-register on approval). **Rejected 2026-07-19** (errors 30909 CTA-verification + 30910 non-English sample + invalid description — numbers weren't published on the site and brand wasn't attributed); fixed and resubmitted 2026-07-20; **rejected again** (sample content + CTA verification). Second fix per onboarding-guide close-read, resubmitted 2026-07-20 PM: verbatim "Message and data rates may apply" everywhere (was "Msg & data"), terms adds "any" to carrier-liability sentence, privacy adds CTIA opt-in-data non-share sentence, samples all-English with [bracketed] variables, message_flow cites homepage CTA + hosted proof screenshot (/img/sms-cta.png). **APPROVED 2026-07-20** on the third submission — SMS is carrier-registered and live on both numbers. SMS chat agents LIVE 2026-07-21: "RCSD Text (English)" (2376fd23…) on +16504828912, "RCSD Texto (Español)" (c4241dca…) on +16503997203, both with the rcsd_info_data MCP connector. WhatsApp LIVE 2026-07-21: senders "RCSD Info" (+16504828912) and "RCSD Info Español" (+16503997203) Online on WABA 28129299956710854 under the Primatech portfolio; both chat agents' WhatsApp deploys enabled and bound. Remaining: Meta business verification on the Primatech portfolio (EIN letter, Security Center) to lift limited-mode caps and finalize display names. Required legal pages shipped: /privacy/ /terms/ /privacidad/ /terminos/ (`build-legal.mjs`)
  - [x] WhatsApp senders registered 2026-07-21 (after Twilio ticket 28384081 unlinked dormant Sinister Dexter WABA 791481343920343): both numbers registered from PARENT account under Meta "Primatech" portfolio 1043496398639489, WABA 28129299956710854. Do NOT move numbers to the RCSD Twilio subaccount — would detach A2P campaign + break Synthflow SIP trunks.
  - [x] Inbound message webhooks wired 2026-07-21 (Synthflow does NOT auto-configure these — texts got Twilio's default auto-reply until fixed): SMS via Messaging Service `MGdd84695…` Integration webhook; WhatsApp via per-sender Messaging Endpoint Configuration. Sender form requires "Profile about" tagline to save — set EN/ES taglines. Full playbook: `plugin/skills/a2p-campaign/SKILL.md`.
  - [x] **Text channels moved in-house 2026-07-21** — Synthflow chat backend failed server-side (its own test widget errored on every LLM reply), so SMS/WhatsApp now run on our own Cloudflare Worker `workers/text-agent` (text.rcsd.info): one Messages API call per answer with the MCP connector executing mcp.rcsd.info tools server-side (claude-sonnet-4-6), KV conversation context (1h TTL) + rate caps, deterministic AI-disclosure prefix, EN/ES prompts by line. Webhooks re-pointed via Twilio REST API; rollback = restore chat.synthflow.ai URLs (Synthflow chat agents parked, not deleted; voice stays on Synthflow). 104-question eval harness in `workers/text-agent/eval/` (run-eval + tool-verified judge). PR #86.
  - ~~REST facade worker~~ superseded: voice calls mcp.rcsd.info directly via Synthflow MCP connector; text path now self-hosted (workers/text-agent) after Synthflow chat failure
  - [x] Voice LIVE 2026-07-20: Synthflow agents "RCSD Info (English)" (11fabe9e…, +16504828912) and "RCSD Info (Español)" (c13373f0…, +16503997203), both wired to mcp.rcsd.info via workspace MCP connector rcsd_info_data (14 tools); Twilio integration → David Weekly Test Account. Synthflow MCP server added to Claude Code for ops. Remaining: chat agents for SMS/WhatsApp (post-A2P-approval)
  - [ ] **Call transfer to school sites / district office** (requested by Dr. R via David 2026-07-21): voice agents should offer to connect callers to the right front office — Synthflow supports transfer-call actions; school office numbers are in `query-school`, district office in `get-trustees` (650-482-2200, verified from rcsdk8.net footer). Needs per-school dynamic transfer target or a small set of transfer actions.
  - Later/v2: **Gemini 3.1 Flash Live** native voice-to-voice behind the same Twilio numbers (SIP trunk or LiveKit) — prototype exists in `~/dev/rcsd/rcsd-chat-test` on `gemini-2.5-flash-native-audio-latest` (3.1 errored via API-key auth; may need v1alpha ephemeral tokens). Flash Live: 90.8% ComplexFuncBench Audio; SynthID-watermarked. Ref: https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-1-flash-live/
- [x] ~~**WhatsApp bot**~~ shipped 2026-07-21 as part of Dial the District: both numbers answer WhatsApp via `workers/text-agent`.
- [ ] **General data-interrogation tools for agents** — beyond the 14 curated MCP tools, add `list-datasets` / `read-dataset` (bounded, filtered) so voice/text agents can answer long-tail questions — especially narrative district history ("when did the Orion co-op move to the old John Gill campus and why?"), which the curated tools can't reach today (eval category `history`). Possibly a `query-data` LLM sub-query tool later.

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
- [x] ~~**Verify + record Fair Oaks campus ownership in `properties.json`.**~~ Done 2026-07-21: ownership confirmed by Board President; entry added with the Connect facilities-use amendment + Prop 39 extension (2021-10-06) linked. Board-approved lease/JUA PDFs are now linked from the /schools/ properties table for Harper (Wagner Schoolhouse LLC), Hawes (Building Kidz + Touchstone), Fair Oaks (Connect), and the warehouse.
- [ ] **Mirror BoardDocs-era lease/JUA PDFs to R2** (`board-packets/`). The property `documents[]` links for 2020-2025 BoardDocs items point at go.boarddocs.com, which blocks non-browser clients and could disappear; the Touchstone 2025 renewal already uses the R2 mirror.

## Vendors / Warrant Registers
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
- [ ] **Install PyMuPDF (`fitz`) on the pipeline runner.** `scripts/extract-agenda-links.py`
  (`import fitz  # pymupdf`, which harvests hyperlink rectangles from agenda PDFs) fails
  every scheduled run with `ModuleNotFoundError: No module named 'fitz'` — the self-hosted
  runner (trogdor) has no `.venv` with PyMuPDF installed. The step is currently
  soft-failing, so agenda-link extraction silently degrades. Add a `.venv` + `pip install
  pymupdf` (latest) to the runner or a pipeline setup step, per the venv-always rule.
- [ ] **Screencap demo** — narrated screen recording showing: homepage, clicking into a meeting, transcript click-to-seek, Spanish toggle, chapter markers, MCP query. For embedding on the site and social sharing.

## Data Attribution (in progress)
- [ ] **Rebuild school growth numbers from scratch.** Current `growth: { ela, math }` fields on each school (scripts/build-schools.mjs) are unverified and mislabeled — the tooltip claims "CAASPP 105%+ of expected growth" but CAASPP doesn't produce that metric, and the values don't match the district's actual LCAP-tracked metric (i-Ready Expected Growth). Plan:
  - [ ] Scrape each school's 2025-26 Board of Trustees data presentation PDF (listed in `SCHOOL_BOARD_PRESENTATION` in build-schools.mjs) and extract the LCAP Goal #3 table: "% of students meeting i-Ready Expected Growth" for ELA and Math, with Base 23-24 / Year 1 24-25 Actual / Year 2 25-26 Mid-Year rows.
  - [ ] Persist extracted numbers as structured JSON under `data/ireadyu-growth/<slug>.json` with per-cell source (PDF URL + page #) so every number links back to its slide.
  - [ ] Rewrite the growth stat cards to show the metric honestly: "% meeting i-Ready annual growth target, <year>" with a source link that opens the actual PDF slide (not the CDE growth-model page, which is unrelated).
  - [ ] Rewrite the tooltip/fine-print text in both EN and ES (scripts/build-schools.mjs:1273-1274 and :1418-1419) to describe i-Ready, not CAASPP.
- [ ] **Provenance tagging across all hardcoded data.** Every value in the `SCHOOL_DATA` object (CAASPP, demographics, funding, staffing) should carry a `source` attribute pointing to the specific document and page/row it came from, so readers (and future us) can audit each claim. Design a lightweight schema (e.g. `{ value: 11.4, source: "2025-26 SPSA, p.12" }`) and migrate existing fields.
- [ ] Pull CDE growth model spreadsheet (growthmodeldownload2025.xlsx) to check for useful RCSD data not yet represented

## Targeted Repairs
- [ ] **OCR the captured "E PDF" policy exhibits.** The embedded source PDFs are now
  snapshotted and provenance-indexed; extract trustworthy text where possible, then
  generate Spanish and summary derivatives while retaining explicit no-text
  exceptions for scans that cannot be recovered reliably.
- [ ] **Render AI summaries for multi-meeting dates.** 25 suffixed detail pages (8 multi-meeting dates, e.g. 2020-04-01) have summaries in `data/meeting-summaries.json` under suffixed slugs that the detail builder never looks up — they render unlabeled/summary-less while the data exists.
- [ ] **Migrate `/mcp/` pages into the build.** `docs/mcp/index.html` + `es/` are hand-maintained static files; they drift from the shared chrome every time html-parts changes (hand-patched 2026-06-10: token, describedby, Committees tab — still no search box or skip link).
- [ ] **Generate dedicated OG cards for /policies/ + /politicas/** (currently reuse the homepage cards; ES uses page-home-es as a stopgap).
- [ ] **`DATA_BASE` env var for the MCP worker** so `wrangler dev` can point at local `data/` instead of production R2 — today, data-dependent fixes can't be verified end-to-end before upload.
- [ ] **Drop `build-transcript-viewer.mjs`** — legacy, not in run-pipeline, and overwrites bilingual pages with EN-only if run manually (header now warns).
