# RCSD Fully-Loaded Teacher Cost — 25-Year Series

**Goal:** answer "what does one RCSD teacher actually cost, and how has that changed?"
by building a 1999-00 → 2024-25 series of average certificated salary, health &
welfare, and statutory benefits per teacher FTE, in nominal and CPI-adjusted
dollars, plus a SACS expenditure breakdown for recent years.

Research status as of 2026-07-12: **unpublished working analysis** — none of these
numbers appear on rcsd.info yet. Extracted 2026-05-27 in an interactive session
(RCEF data added 2026-06-10). The extraction was done ad hoc with `mdbtools` /
manual queries; **no extraction scripts were preserved**, so this README is the
provenance record. Re-verify against the raw sources before publishing anything
derived from these files.

## Raw sources (local-only, gitignored)

Raw downloads live in `drafts/teacher-cost/` and `sacs/` (~3.2GB, gitignored —
see `.gitignore`). All are re-downloadable public data. RCSD is CDS district
**41-69013** (San Mateo County 41) in every CDE dataset.

| Source | Local files | Coverage | Notes |
|---|---|---|---|
| CDE Form J-90 (certificated salary & benefits), https://www.cde.ca.gov/ds/fd/cs/ | `j90*.exe` self-extracting archives → `extracted/{yy}{yy}/` | 1999-00 → 2024-25 | Early years extract to fixed-width text tables (`SALXSTEP.TXT` salary-by-step, `BENEINFO.TXT` H&W, `FIXDINFO.TXT`, `COLMHDGS.TXT`); recent years to Access DBs (e.g. `tsal2425.accdb`). RCSD filed no J-90 for 2024-25. |
| CDE SACS unaudited actuals, https://www.cde.ca.gov/ds/fd/fd/ | `sacs{yy}{yy}.exe` → `sacs/{yy}{yy}/sacs{yy}{yy}.mdb` + readme .docx | 2018-19 → 2023-24 | Full statewide Access databases; queried for district 41-69013, Fund 01. |
| CDE Current Expense of Education, https://www.cde.ca.gov/ds/fd/ec/ | `currentexpense{yy}{yy}.xlsx` | 2018-19 → 2024-25 | Per-ADA current expense workbooks. |
| CDE staffing files | `StaffFTE12.txt`–`StaffFTE18.txt` (staff assignment FTE by school/job class), `strat1920.txt`–`strat2425.txt` (student-per-staff ratios) | 2012 → 2024-25 | Tab-delimited statewide files from CDE's downloadable staffing data. The exact index pages weren't captured — the saved `page_fd_*.html` / `staffassign.html` snapshots are Radware captcha interstitials (CDE blocked non-browser fetches; the data files themselves downloaded fine). |
| BLS CPI-U via public API (`api.bls.gov`) | `bls_sf*.json` (series `CUURS49BSA0`, San Francisco–Oakland–Hayward), `bls.json` (series `CUUR0000SA0`, U.S. city average) | 1999 → 2025 | Used for the `real_*` inflation-adjusted columns. |
| Transparent California | `tc_index.html`, `tc_2024.html`, `tc_rcsd_2024.html`, `tc_search.html` | 2024 | Saved search/detail pages for RCSD 2024 pay; cross-check only. |

## Derived files (committed here)

- **`rcsd_j90_full_series.json`** — 1999-00 → 2024-25 raw J-90 aggregates for RCSD:
  ADA, teacher FTE, average and total certificated salary, total and per-FTE
  health & welfare. Final row is `{"year": "2024-25", "note": "no filing"}`.
- **`rcsd_j90_series.json`** — same aggregates, 2010-11 → 2024-25 subset.
- **`rcsd_teacher_cost_25yr.json`** — the headline series. Adds per year:
  `strs_rate` (statutory STRS employer contribution rate), `full_load`,
  `real_full_load` and `real_per_student` (CPI-adjusted, SF CPI-U),
  `stu_per_teacher` (ADA ÷ FTE), and `hw_interpolated` (true where a missing
  H&W year was interpolated between neighbors).
- **`rcsd_teacher_cost_series.json`** — 2010-11 → 2024-25 variant carrying the
  raw `cpi` value and `full_load_nominal` alongside the real series.
- **`rcsd_sacs_breakdown.json`** — 2018-19 → 2023-24 General Fund expenditures
  from the SACS databases, grouped by standard SACS object-code families:
  certificated salaries split 1100 teachers / 1200 pupil services / 1300 admin /
  1900 other; classified split 2100 paraprofessionals / 2200 support / 2300 admin /
  2400 clerical / 2900 other; then 3000s benefits (cert/class), 4000s books &
  supplies, 5000s services, 6000s capital, 7000s other outgo, and `total_exp`.

### Reconstructed `full_load` formula

Verified against the data (constant residual across sampled years):

```
full_load = avg_salary × (1 + strs_rate + 0.0445) + hw_per_fte
```

where the flat **4.45%** = 1.45% Medicare + a 3.0% allowance for unemployment
insurance and workers' compensation. This understates true cost in years where
RCSD's actual SUI/WC rates exceeded 3%, and excludes non-J-90 costs (substitutes,
stipends, professional development). `real_*` values deflate by BLS SF CPI-U to
the latest year in the series.

## Caveats

- J-90 is a voluntary survey; RCSD's 2024-25 gap is real (no filing), not a bug.
- `avg_salary` is schedule-driven average pay per FTE, not W-2 gross.
- The SACS breakdown is Fund 01 only and uses unaudited actuals.
- These JSONs are research artifacts in `data/analysis/`, deliberately **outside**
  the top-level `data/*.json` glob that publishes to `https://data.rcsd.info/json/`.
