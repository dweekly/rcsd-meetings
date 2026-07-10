# District reconnaissance manifests

This directory holds configuration and research notes for testing whether the
RCSD pipeline can be made reusable across school districts. These files are
tracked so that source decisions, uncertainty, and pilot targets survive from
one research session to the next.

They are **not district-endorsed facts**, publication-ready datasets, or a
claim that every listed source is complete. A high-confidence vendor label
means the vendor is visible on, or directly linked from, an official source;
it does not mean the district has reviewed this manifest. Sources and vendor
contracts can change without notice.

## Publication boundary

- Manifests live outside `data/` intentionally. The current data upload and
  static-site builds must not treat them as public inputs.
- Source documents sampled during later reconnaissance belong in ignored
  working storage, not this directory, until privacy and publication review is
  complete.
- Nothing here authorizes contacting district staff, publishing a derived
  claim, or mirroring a document.
- `active.json` is the platform lab's only publication allowlist. Directory
  discovery must never publish a district. An allowlisted entry must also
  reference a manifest explicitly approved for public pilot publication;
  reconnaissance and internal manifests make the build fail closed.
- Before any manifest becomes public, verify every source again, apply the
  release allowlist, and attach the versioned dataset provenance required by
  the platform.

## Reading the manifests

- `null` source-regime bounds mean **unknown**, not “from the beginning of
  time” or “forever.”
- `observedFrom` and `observedThrough` describe evidence seen during
  reconnaissance. They are not asserted contract or platform cutover dates.
- Language entries are ordered pilot priorities. Coverage must still be
  measured per artifact; the presence of a language in a manifest never
  implies that every agenda, minute, calendar, or menu exists in it.
- `vendor.confidence` is about platform identification only. It is not a
  quality score for the source or its content.
- Pilot counts are sampling targets, not expected district totals.

All manifest JSON should parse before commit. The SMFCSD folder also contains
an expert-review template. Reviewers score factual correctness and practical
utility separately, and corrections become durable fixtures only after they
are tied to a publishable source.
