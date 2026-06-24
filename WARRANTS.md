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
- [ ] **PR2 — Extractor + validation.** `scripts/extract-warrants.mjs`: two parser families + OCR
  fallback → `data/warrants/{YYYY-MM}.json`, each checksum-reconciled against the printed grand total;
  failures flagged, not trusted.
- [ ] **PR3 — Canonicalization + DB + reports.** `data/warrant-vendor-aliases.json`,
  `scripts/build-warrants-db.mjs` (SQLite), `scripts/report-vendor-spend.mjs "van pelt"` → spend by
  fiscal year with check-level drill-down and source PDF links.
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
