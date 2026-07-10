# RCSD.info Release Recovery

This is the one-operator runbook. RCSD.info intentionally accepts short,
shape-compatible overlap between Cloudflare Pages and R2. Do not try to turn a
failed release into a hand-built cross-service transaction.

## Normal release

The publication tail of the scheduled workflow runs these steps in order:

```bash
npm run release:manifest -- --require-clean-source
npm run upload
npm run release:stage
npm run release:deploy-pages
npm run release:promote
npm run release:smoke
```

A healthy release leaves `json/releases/current.json` published, all three remote
quality gates passed, and the English page, Spanish page, and policy provenance
sidecar reachable. The smoke check retries briefly for normal CDN propagation.

## First response

Run the smoke check once more. A transient network or cache delay needs no repair.

```bash
npm run release:smoke -- --against-current
```

If it still fails, open the failed GitHub Actions step and use the matching case
below. The ordinary repair is a **new** manual run from current `main`:

> GitHub Actions → Scheduled Board Ingestion Pipeline → Run workflow → `main` →
> Quick mode enabled

Use a new run, not “Re-run failed jobs,” if the earlier run reached the incremental
commit step: a rerun uses the original commit and may lose a push race with the
pipeline's own newer commit.

## Failure boundaries

| Failure | What remains true | Recovery |
| --- | --- | --- |
| Manifest or legacy upload | The policy release pointer is unchanged. Some non-migrated stable data may already be newer. | Start a new Quick workflow. Do not manually reverse or delete uploaded objects. |
| Stage | The prior `current.json` remains current. An incomplete immutable upload is safe to reuse. | Start a new Quick workflow. Do not delete R2 objects. |
| Pages deploy | The prior release remains current. Stable R2 data may be newer, but its shape is compatible. | Start a new Quick workflow. Never promote without the matching Pages receipt. |
| Promotion | Pages is newer. Depending on the exact interruption, `current.json` may still be old or may already have advanced. | Check the public current release. In the **same checkout** with the staged candidate and Pages receipt, rerun `npm run release:promote`; recovery is idempotent. In CI or a new checkout, start a new Quick workflow. |
| “Current changed” refusal | Another release won the compare-before-write guard. | Discard the candidate and start a complete new Quick workflow. Never force the pointer. |
| Production smoke | Promotion completed; this is a detection-only check, so `current.json` may already be new. | Rerun the smoke once. If English or Spanish HTML is broken, use the Pages rollback below, then fix and run fresh. If only provenance/current fails, do **not** roll back Pages; start a new Quick workflow. |

If the labeled smoke output is not enough, open its four targets directly:

- [English policy page](https://rcsd.info/policies/5132-bp/)
- [Spanish policy page](https://rcsd.info/politicas/5132-bp/)
- [Policy provenance](https://data.rcsd.info/json/provenance/rcsd.board-policies.json)
- [Current release](https://data.rcsd.info/json/releases/current.json)

## Rollback boundary

Roll back Pages only when the live English or Spanish HTML is actually broken.
In Cloudflare, open **Workers & Pages → rcsd-meetings → Deployments**, select the
immediately preceding successful **production** deployment, and use **Rollback**.

That changes Pages only. It does not roll back stable R2 data or `current.json`;
the temporary mismatch is acceptable because the data shape is compatible. Do
not manually copy old R2 data, edit `current.json`, or promote an old candidate.
Fix the source and start a fresh workflow.

## Stop rather than improvise

If one fresh Quick run also fails, leave the workflow red and record the failure
for the next maintenance window. Never delete immutable release prefixes, overwrite
an immutable manifest, bypass a failed quality gate, or force-push release state.
The preceding successful Pages deployment remains available as a rollback target.
