# Warrant Register Vendor-Spend Index

**Goal:** Scrape every monthly warrant register the district has published, index every
check/warrant line item into a queryable database, and build reports answering questions like
*"How much does the district pay Van Pelt per year?"*

Fresh as of 2026-06-24.

A **warrant register** is the monthly list of every check (warrant) the district issued, ratified
by the Board of Trustees as a consent item. It is a public record. Each line names a payee, an
amount, a date, and (depending on era) a fund/object code and a redemption status.

## Source landscape (verified empirically 2026-06-24)

77 warrant-register agenda items are indexed in `data/meetings-data.json`, spanning **March 2020 →
May 2026**. They split into two hosting eras and two report formats:

| Era | Months | Host | Download | Report format |
|---|---|---|---|---|
| BoardDocs | Mar 2020 → May 2025 (~64) | `go.boarddocs.com` direct `$file` URLs already in `meetings-data.json` | plain HTTPS GET — **requires a full browser User-Agent** (bare `Mozilla/5.0` → HTTP 403) + polite rate-limiting | QSS **"Accounts Payable Warrant Status Report"** (later relabeled "Warrant Maintenance – …"). One row per warrant: `status · warrant# · payee · dist · date-issued · amount · redeemed-date · status`. Carries warrant status (Redeemed / Outstanding / Cancelled). |
| Simbli | Jun 2025 → May 2026 (~13) | eBoardSolutions/Simbli (Incapsula-protected) | **already downloaded** to `artifacts/board-packets/{date}/` | Escape **"ReqPay12a Board Report"**. Per-check fund-object lines + Fund Recap + Net (Check Amount) total. |

**Extraction quality:** most PDFs parse cleanly with `pdftotext -layout`. A *sporadic* minority of
BoardDocs-era PDFs (confirmed: 2021-06-16) embed a custom font with no ToUnicode map, so the numeric
columns extract as blank — fatal for a register. These are detected (payee row with no amount /
non-ASCII header) and recovered via **tesseract OCR** (`pdftoppm -r 200 → tesseract`), which reads
them perfectly. Both formats carry a printed grand total used as a parse **checksum**.

## Data model

- **PDFs** → `artifacts/board-packets/{meeting-date}/{filename}.pdf` (gitignored, synced to R2 at
  `https://data.rcsd.info/board-packets/{date}/{filename}.pdf`). Existing convention; preserves the
  public records, which currently live only on a vendor portal.
- **Download manifest** → `data/warrant-pdf-manifest.json` (committed): one entry per register with
  source href, meeting date, covered month, local path, sha256, byte size, download status.
- **Per-register extraction** → `data/warrants/{YYYY-MM}.json` (committed, diffable, idempotent —
  mirrors the `data/board-memos/{date}.json` convention). Each has a `_metadata` provenance block,
  the line items, per-payee `payeeType` (`vendor` | `individual`), warrant status, and a
  `checksum` reconciliation result.
- **Database** → local SQLite built on demand by `build-warrants-db.mjs` (gitignored, **not** synced
  to R2 — keeps named-individual reimbursement data out of the public bucket while internal-first).
- **Vendor aliases** → `data/warrant-vendor-aliases.json` (committed): curated map collapsing name
  variants ("Amazon Services LLC" / "Amazon Capital Services" → canonical).

## Decisions (locked 2026-06-24)

- **Audience:** internal tool first; public bilingual page deferred to PR4 once accuracy + the
  privacy posture are vetted.
- **Reimbursements:** keep every payee, but tag `vendor` vs `individual` (surname-comma heuristic).
  These are public records; the individual-name privacy question is revisited before any public page.
- **Coverage:** all available (~2020 → 2026).
- **"Per year":** default to California fiscal year (Jul 1 – Jun 30); reports note the basis.

## Plan (one entry per shippable PR; strike through as merged)

- [x] **PR1 — Backfill downloader.** `scripts/scrape-warrant-pdfs.mjs` pulls all 64 BoardDocs PDFs
  (full UA, rate-limited, idempotent, `%PDF-` + size validated) into `artifacts/board-packets/{date}/`,
  writes `data/warrant-pdf-manifest.json`, syncs to R2. **Done 2026-06-24: 64/64 downloaded, 0
  failures, coverage 2020-03 → 2025-04 (BoardDocs) + 2025-06 → 2026-05 (Simbli, already local) =
  continuous. Garbled-font scan: only 1 of 64 (2021-05) needs OCR; the other 63 extract cleanly with
  `pdftotext -layout`.** *Independently valuable: archives public records off the vendor portal.*
- [x] **PR2 — Extractor + validation.** `scripts/extract-warrants.mjs` + `scripts/lib/warrant-parsers.mjs`:
  two parser families (QSS classic/maint + Escape) with tesseract OCR fallback → one
  `data/warrants/{YYYY-MM}.json` per register + `data/warrants-index.json`, each checksum-reconciled
  against the printed grand total. **Done 2026-06-24: 76 registers, 29,791 line items. 70/76 reconcile
  to $0.00; 2 minor-mismatch (≤$0.42 on $7–13M); 3 incomplete-detail (2021-05/06/07 — Summary-format
  PDFs omit detail rows at the source); 1 coverage-gap (2026-02 — district misfiled an SPSA under the
  warrant filename). Proof: Van Pelt Construction = $4.99M across FY2023–24…FY2025–26.** Each
  format reconciles per its own rule (Escape "Net" excludes cancelled checks; QSS "TOTAL DISTRICT"
  includes them) — line items carry `status` + `disbursedTotal` so spend reporting can net out
  cancelled/voided. Period-overlap pairs flagged for the reporting layer to dedupe.
- [x] **PR3 — Canonicalization + DB + reports.** `data/warrant-vendor-aliases.json` (curated rollup,
  e.g. CalPERS' several legal names), `scripts/build-warrants-db.mjs` → `warrants.db` (SQLite,
  gitignored, **not** R2-synced — carries individual names), `scripts/report-vendor-spend.mjs`.
  **Done 2026-06-24: 30,253 payments indexed; 612 excluded (cancelled/voided + 2 superseded subset
  registers). `npm run report:warrants -- "van pelt"` → $5.19M across FY2023-24…FY2025-26;
  `--top N` lists biggest vendors; `--detail` adds every check + source PDF links.** Spend queries
  filter `excluded = 0`, so cancelled checks and overlapping-register double-counts are handled
  automatically; non-reconciled months are footnoted, never silently dropped. Warrant numbers recycle
  across years, so overlap dedup is scoped to the two flagged register pairs (period-containment), not
  global.
- [ ] **PR4 (deferred) — Public bilingual page.** EN + ES vendor-spend pages, OG cards, search
  integration — gated on accuracy review and the individual-name privacy decision.

## Caveats

- **Warrant status matters for "money spent":** QSS-era registers list Outstanding / Cancelled
  warrants alongside Redeemed. Cancelled warrants should be netted out; the extractor records status
  per line so reports can choose issued vs. redeemed semantics.
- **Format drift across ~6 years is the main risk.** The printed grand-total checksum is the guard —
  any register that fails to reconcile is flagged `parseStatus: "mismatch"` rather than silently trusted.
- **Vendor-name normalization is iterative.** Automated normalization (uppercase, strip Inc/LLC/Corp,
  collapse whitespace) plus a hand-curated alias overlay; expect to refine as queries surface variants.
- **Known data issues (from PR2, see `data/warrants-index.json` `parseStatus`):**
  - `total-exceeds-detail` — **2021-05, 2021-06, 2021-07**: the printed "TOTAL DISTRICT 18" on these
    QSS "Summary" sheets is ~1.9–2.3× the sum of the warrants listed (e.g. June 2021 prints
    $21,765,035.47 but its 616 warrants sum to $11.46M). **The line items are complete and correct,
    not the total** — proven for June 2021: its 616 warrants are a superset of the separately-published
    6/1–6/25 register (396 warrants, which reconciles exactly to $8,513,998.95), and the shared
    warrants (incl. Beals Martin $1.6M) carry identical amounts. The printed total appears to sum
    fund-distribution lines (multi-fund warrants counted once per fund while shown as one row) —
    hypothesis, unconfirmed (Summary format hides the fund splits). **Use `disbursedTotal` (summed
    line items), not the printed total, for these months.** May/July 2021 fit the same era/format/ratio
    but lack an overlapping register to prove against directly.
  - ~~`coverage-gap` — **2026-02**~~ **RESOLVED 2026-06-24.** The cached attachment was an SPSA, not
    the register — a download-side bug in `scrape-board-packets.mjs` (our metadata had the correct
    Simbli AID 1433020; the saved bytes were wrong). Re-fetched AID 1433020 and replaced local + R2;
    Feb 2026 now reconciles exactly (462 checks, $7,186,162.93). A filename-vs-content scan of all 77
    warrant/SPSA-named cached PDFs found no other mismatches, so this was isolated — but the
    underlying scraper bug is not yet root-caused (could not reproduce from current code). `extract-warrants.mjs`
    auto-detects misfiled warrant attachments, which is the regression net.
  - `minor-mismatch` — **2026-03, 2025-09**: reconcile to within $0.42 on $7–13M (one stray fraction
    each); usable, flagged for completeness.
- **Period overlaps:** 2020-06 and 2021-06 each have two registers with overlapping date ranges
  (e.g. 6/1–6/15 and 6/1–6/30). The reporting layer (PR3) must dedupe by period to avoid
  double-counting; `data/warrants-index.json._metadata.periodOverlaps` lists the pairs.
