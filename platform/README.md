# Multi-district platform lab

This directory contains an additive, static lab for testing whether RCSD.info's
source discipline can serve more than one school district. It does not tenantize
the existing RCSD application. RCSD's `docs/` build, public routes, Pages project,
R2 data, Workers, release pipeline, and domain remain independent.

`district-data-lab` is a working label, not a permanent name or promised hostname.
The first authorized deployment can use the Pages-assigned `*.pages.dev` hostname.
Renderers receive `PUBLIC_BASE_URL`; source code and stored records must not depend
on that holding hostname.

## Publication boundary

`districts/active.json` is the only district publication allowlist. The build must
not glob `districts/*`, infer publication from a folder, or treat a reconnaissance
manifest as public data. The allowlist starts empty, and this foundation rejects every
non-empty allowlist. District activation stays disabled until the build validates the
dataset, provenance sidecar, English/Spanish parity, safety review, and lineage receipt
described in `ROADMAP.md`.

The holding site remains excluded from indexing. Its generated `_headers` file must
apply `X-Robots-Tag: noindex` across the deployment, including HTML and JSON. Removing
that header requires an explicit publication decision; acquiring a custom domain does
not remove it implicitly.

## Local build

The lab uses the repository's existing Node installation and has no separate
service to run:

```sh
npm run test:platform
npm run build:platform
```

The build emits `build/platform/` and performs no network access or deployment.
It defaults to `https://district-data-lab.pages.dev` for absolute links; set
`PUBLIC_BASE_URL` to replace that provisional origin.

## Experimental public contract

The lab publishes static HTML and small, versioned JSON on the same origin. `v0` is
experimental: consumers should expect compatible additions but must not treat route
or payload stability as a production promise. The empty foundation emits:

- `/en/`
- `/es/`
- `/api/v0/districts/index.json`
- `/api/v0/schemas/meetings.schema.json`
- `/_meta/release.json`

An approved district dataset will add these route shapes:

- `/districts/{slug}/{locale}/`
- `/districts/{slug}/{locale}/meetings/`
- `/api/v0/districts/{slug}/datasets/meetings.json`
- `/api/v0/districts/{slug}/provenance/meetings.json`

Generated output belongs under ignored `build/platform/`. Authored manifests,
schemas, adapters, normalizers, renderers, locales, fixtures, and tests remain tracked.
The browser must not need client-side JavaScript to read the core pages.

## Data flow and adapter boundary

Each release follows one direction:

```text
allowlisted manifest
  → immutable source evidence
  → shared adapter
  → canonical records and retained discrepancies
  → derived or translated records with provenance
  → schema, parity, safety, and lineage checks
  → static HTML and JSON
  → one Pages deployment
```

Shared adapters accept source configuration and never branch on a district slug.
District-specific source behavior belongs in manifest configuration, immutable
fixtures, or a source-linked correction rule. A discrepancy between official sources
is retained and shown rather than resolved silently.

The first meeting contract keeps these state axes independent:

- occurrence: `scheduled`, `held`, `cancelled`, or `unknown`;
- agenda: `absent`, `published`, `revised`, or `unknown`;
- minutes: `absent`, `published`, `approved`, or `unknown`; and
- recording: `absent`, `expected`, `published`, `not-applicable`, or `unknown`.

## Deferred infrastructure

The lab remains Pages-only while HTML and small JSON are sufficient. Do not add a
database, queue, Durable Object, KV namespace, admin interface, per-district Pages
project, bucket, Worker, generic MCP server, custom theme, custom domain, or permanent
brand to the first slice. Policies, transcripts, full budgets, large binary mirrors,
search, and notifications also wait until the meeting pilot passes.

If large binaries or agent queries later justify more infrastructure, add one lab-only
R2 bucket and one read-only Worker with district and release prefixes. Do not reuse the
RCSD bucket or Worker.
