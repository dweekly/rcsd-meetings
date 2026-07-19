# Provenance and Releases

RCSD.info publishes official-source mirrors, normalized public data, and
machine-generated explanations. Provenance records what each public artifact is,
where it came from, how it changed, and which checks passed. It does **not** make
RCSD.info or a machine translation an official District publication.

## Contract

Versioned JSON Schemas live in `schemas/provenance/v1/`. Existing public payloads
keep their current shapes; provenance is published as sidecars in
`data/provenance/` and at `https://data.rcsd.info/json/provenance/`.

The core records are:

- **Dataset provenance** — source URLs and snapshots, artifact hashes, reporting
  period, authority status, transformation lineage, exceptions, and review state.
- **Claim provenance** — a source-backed fact or derived assertion identified by
  dataset and JSON Pointer.
- **LLM invocation** — auditable model execution for translations, summaries,
  classifications, and extractions.
- **District source manifest** — dated source regimes, vendors, languages,
  governing bodies, and expected artifact types used during pilot reconnaissance.
- **Release manifest** — the allowlist of public files and their immutable hashes.

Quality states are deliberately categorical: `unreviewed`, `machine-checked`,
`human-reviewed`, `reconciled`, or `partial`. A partial dataset must enumerate its
exceptions; missing information is never converted into a confidence score.

## LLM invocations

Mutating LLM pipelines record the provider, requested and resolved model version
when exposed, API revision, exact installed SDK, generation parameters, prompt and
output-contract hashes, ordered input hashes, locale/glossary, safety settings,
attempt history, effective result, token usage, estimated cost, response hash, and
cache fingerprint.

Hosted models are not guaranteed to replay byte-for-byte even with the same
settings. The promise is auditable inputs and execution context, not deterministic
reproduction. Credentials, authorization headers, private prompt text, sensitive
raw inputs, and provider request IDs are not public provenance.

The cache fingerprint changes when any behaviorally relevant model, prompt,
parameter, input, schema, locale, glossary, safety, SDK, or API field changes.

## Board-policy vertical slice

Board policies are the first provenance-gated family because they combine an
official English source, mirrored JSON, Spanish machine translation, bilingual AI
summaries, legal sensitivity, and a known scanned-PDF exception.

```bash
npm run provenance:policies
npm run test:provenance
npm run build:policies
```

The generator verifies:

- 619 catalog and English records;
- 618 Spanish bodies and 618 bilingual summaries;
- every derivative's current English `contentText` hash; and
- the explicit no-text exception for `6174-E PDF(1)-AR`.

Cached AI outputs created before invocation tracking remain visibly `partial` until
the instrumented generator refreshes them. Their existing model and source hashes
are retained; absent historical request parameters are not invented.

## Releases

`scripts/generate-release-manifest.mjs` creates a candidate policy release under
`tmp/releases/` without making network changes. The release records both R2 and
Pages artifacts; `upload-release.mjs` handles only the R2 portion, while Pages
continues through Wrangler.

Publication has two explicit R2 phases around the Pages deploy:

- **Stage:** upload write-once immutable data, verify remote bytes against the
  local hashes, refresh and verify the shape-compatible stable data URLs, and
  publish a candidate receipt at
  `json/releases/candidates/{releaseId}.json`. The receipt records which
  release was current when staging began; `current.json` remains untouched.
- **Deploy Pages:** deploy `docs/` after the candidate is staged. The candidate
  records the provenance-gated policy and schema subset; other Pages content is
  still outside manifest coverage during the migration. A failed Pages
  deployment leaves the previously published release current.
- **Promote:** read the durable candidate receipt back from R2, refuse if the
  current release changed during the Pages deployment, re-verify immutable and
  stable bytes, validate the release-bound Pages receipt, publish the immutable
  manifest once, and publish `json/releases/current.json` last.

This ordering ensures Pages is not deployed until the data checks pass and the
current pointer is not advanced unless the matching Pages deployment succeeds.
It is intentionally not a cross-provider transaction: stable policy data may
briefly be newer than the HTML that reads it, but those stable payloads remain
schema-compatible and read-only. Retrying stage repairs any partial stable-key
copy before Pages is attempted again.
Non-migrated data continues through the legacy uploader before staging during
the transition and is explicitly outside the candidate manifest's coverage.

```bash
npm run release:manifest -- --require-clean-source
npm run release:stage -- --plan-only  # validate the local release plan; no network
npm run release:stage                 # immutable/stable R2 data + candidate receipt
npm run release:deploy-pages          # deploy + release-bound Pages receipt
npm run release:promote               # immutable manifest + current.json last
npm run release:smoke                 # verify public EN, ES, provenance + release
```

Do not promote a release unless the intervening Pages command succeeded. The
scheduled workflow enforces this stage → Pages → promote sequence.

If promotion is interrupted after Pages succeeds, rerun `npm run
release:promote`: it recovers the R2 candidate, preserves an already-written
immutable publication receipt and its original `publishedAt`, repairs stable
keys, and retries only the missing current-pointer write. If another publisher
advanced `current.json` since staging, promotion stops; regenerate, restage,
and redeploy instead of forcing an implicit rollback.

### Operational posture

RCSD.info accepts bounded eventual consistency as the maintainable tradeoff for
a read-only side project with one operator. Releases are additive and rerunnable;
the scheduled workflow is serialized; stable URLs preserve their payload shapes;
and a post-promotion smoke check covers one English page, its Spanish counterpart,
the provenance sidecar, and `releases/current.json`. The check is detection-only:
promotion has already completed, and a failure does not automatically move the
pointer back. We deliberately do not run an automatic rollback or maintain a routing
Worker, distributed lock, or hand-built cross-provider transaction. Reconsider that
choice only after a real incident, multiple active publishers, or materially higher
traffic makes the added machinery worth operating. Recovery commands and failure boundaries are in
[`RELEASE-RUNBOOK.md`](RELEASE-RUNBOOK.md).

## Multi-district reconnaissance

Tracked pilot configuration lives under `districts/`; raw samples belong in
`tmp/` and are never published automatically. Source manifests distinguish dated
portal regimes because districts routinely migrate between governance, CMS,
video, calendar, finance, and meal vendors.

RCSD remains the shadow regression baseline. San Mateo–Foster City is the first
semantic-validation pilot; Ravenswood follows to prove configuration-only reuse,
and Fresno follows only after the meeting contract stabilizes to test a materially
different stack and scale. Expert corrections must be supported by publishable
official sources and converted into repeatable tests; personal knowledge is not
silently treated as public provenance.
