# Data catalog & agent guide

Public JSON datasets for researching Redwood City School District. This is an independent community project, not an official district website. No account or API key is required.

Choose the smallest relevant dataset. Cite its official source and reporting year. Source-check dates below come from the files; missing dates mean unknown freshness. Machine summaries, translations and transcripts may contain errors. Suppressed cells are not zero.

- [Machine-readable catalog](https://rcsd.info/catalog.json)
- [Research skill (English)](https://rcsd.info/.well-known/agent-skills/rcsd-data-web/SKILL.md)
- [Field schema (English)](https://rcsd.info/agents/data-schema.md)
- [Connect an MCP client](https://rcsd.info/mcp/)

## Example: find a school

Fetch schools.json, identify the school slug or CDS code, then join the matching school and year in a SARC or CDE dataset. For board documents, start with attachment-index.json; document-index.json contains only classified documents.

```sh
curl -fsS https://data.rcsd.info/json/schools.json
```

## School directory

- [schools.json](https://data.rcsd.info/json/schools.json)

## District-authorized charter schools

- [charters.json](https://data.rcsd.info/json/charters.json)

## District property and leases

- [properties.json](https://data.rcsd.info/json/properties.json)

## Trustees and district leadership

- [trustees.json](https://data.rcsd.info/json/trustees.json)
- [freshness.json](https://data.rcsd.info/json/freshness.json)

## School calendars

- [district-calendar-2025-26.json](https://data.rcsd.info/json/district-calendar-2025-26.json)
- [district-calendar-2026-27.json](https://data.rcsd.info/json/district-calendar-2026-27.json)

## Planned board agenda topics

- [governance-calendar.json](https://data.rcsd.info/json/governance-calendar.json)

## Board meetings, agendas and attachments

- [meetings-data.json](https://data.rcsd.info/json/meetings-data.json)
- [attachment-index.json](https://data.rcsd.info/json/attachment-index.json)
- [document-index.json](https://data.rcsd.info/json/document-index.json)

## AI-generated meeting summaries and translations

- [meeting-summaries.json](https://data.rcsd.info/json/meeting-summaries.json)
- [meeting-summaries-es.json](https://data.rcsd.info/json/meeting-summaries-es.json)
- [school-board-summaries.json](https://data.rcsd.info/json/school-board-summaries.json)

## Meeting recordings and agenda timestamps

- [youtube-index.json](https://data.rcsd.info/json/youtube-index.json)
- [timestamp-map.json](https://data.rcsd.info/json/timestamp-map.json)

## Board policy index and AI summaries; fetch individual policies on demand

- [policies-index.json](https://data.rcsd.info/json/policies-index.json)
- [policy-summaries.json](https://data.rcsd.info/json/policy-summaries.json)
- [policy-titles-es.json](https://data.rcsd.info/json/policy-titles-es.json)

## Special education enrollment and disability categories

- [sped-enrollment.json](https://data.rcsd.info/json/sped-enrollment.json)
- [sped-categories.json](https://data.rcsd.info/json/sped-categories.json)

## School accountability reports: academics, demographics and spending

- [sarc/adelante-selby.json](https://data.rcsd.info/json/sarc/adelante-selby.json)
- [sarc/clifford.json](https://data.rcsd.info/json/sarc/clifford.json)
- [sarc/garfield.json](https://data.rcsd.info/json/sarc/garfield.json)
- [sarc/henry-ford.json](https://data.rcsd.info/json/sarc/henry-ford.json)
- [sarc/hoover.json](https://data.rcsd.info/json/sarc/hoover.json)
- [sarc/kennedy.json](https://data.rcsd.info/json/sarc/kennedy.json)
- [sarc/mckinley-mit.json](https://data.rcsd.info/json/sarc/mckinley-mit.json)
- [sarc/north-star.json](https://data.rcsd.info/json/sarc/north-star.json)
- [sarc/orion.json](https://data.rcsd.info/json/sarc/orion.json)
- [sarc/roosevelt.json](https://data.rcsd.info/json/sarc/roosevelt.json)
- [sarc/roy-cloud.json](https://data.rcsd.info/json/sarc/roy-cloud.json)
- [sarc/sarc-summary.json](https://data.rcsd.info/json/sarc/sarc-summary.json)
- [sarc/taft.json](https://data.rcsd.info/json/sarc/taft.json)

## State education data: absenteeism, English learners and staffing

- [cde/absenteeism-2024-25.json](https://data.rcsd.info/json/cde/absenteeism-2024-25.json)
- [cde/ltel-2024-25.json](https://data.rcsd.info/json/cde/ltel-2024-25.json)
- [cde/staff-ethnicity-2024-25.json](https://data.rcsd.info/json/cde/staff-ethnicity-2024-25.json)
- [cde/staff-experience-2024-25.json](https://data.rcsd.info/json/cde/staff-experience-2024-25.json)
- [cde/staff-ratios-2024-25.json](https://data.rcsd.info/json/cde/staff-ratios-2024-25.json)

## School plan budgets and site councils

- [spsa-budgets.json](https://data.rcsd.info/json/spsa-budgets.json)
- [ssc-membership.json](https://data.rcsd.info/json/ssc-membership.json)
- [ssc-meetings.json](https://data.rcsd.info/json/ssc-meetings.json)

## School presentations and AI-extracted club mentions

- [site-presentations.json](https://data.rcsd.info/json/site-presentations.json)
- [school-clubs.json](https://data.rcsd.info/json/school-clubs.json)

## Committee membership and meetings

- [committees/cboc.json](https://data.rcsd.info/json/committees/cboc.json)
- [committees/delac.json](https://data.rcsd.info/json/committees/delac.json)

## Vendor payment coverage and aliases; fetch monthly registers on demand

- [warrants-index.json](https://data.rcsd.info/json/warrants-index.json)
- [warrant-vendor-aliases.json](https://data.rcsd.info/json/warrant-vendor-aliases.json)
- [warrant-pdf-manifest.json](https://data.rcsd.info/json/warrant-pdf-manifest.json)
