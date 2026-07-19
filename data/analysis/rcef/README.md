# Redwood City Education Foundation (RCEF) — IRS Filing Data

Background research on RCEF (EIN **94-2903141**), the nonprofit foundation that
raises money for RCSD schools. Fetched 2026-06-10 from ProPublica's Nonprofit
Explorer API; unpublished working data, not yet used on rcsd.info.

- **`rcef.json`** — full organization record from
  `https://projects.propublica.org/nonprofits/api/v2/organizations/942903141.json`
  (registration data, latest filing metadata, list of available filings).
- **`rcef_990s.json`** — extracted series of the 13 machine-readable Form 990
  filings, tax years 2011 → 2023: total revenue, functional expenses, end-of-year
  assets and liabilities, officer-compensation percentages, and PDF links back to
  ProPublica for each filing.

Re-fetch from the same API endpoint to update; ProPublica lags IRS releases by
months, so the newest tax year is not an RCEF reporting gap.
