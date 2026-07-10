# SMFCSD expert validation guide

This package is a reusable research instrument, not an invitation or outreach
list. An authorized human coordinates reviewers and decides what may be
shared. The repository does not contact anyone.

Prepare one frozen release candidate and select 25 items using
`expert-validation-template.json`. Show each reviewer the candidate output,
its official/derived status, the relevant official sources, effective dates,
and enough neighboring context to judge it. Hide model, prompt, implementer,
expected score, and other reviewers' answers until scoring is complete.

Ask the reviewer to score every applicable dimension independently. In
particular, factual accuracy does not substitute for usefulness: a technically
correct item can still be unsafe if a family would take the wrong next step.
Conversely, fluent prose does not compensate for a missing source or an
incorrect date.

For every proposed correction, capture both:

- the reviewer's explanation, including unpublished operational context; and
- a publishable official source URL and precise locator, when one exists.

Unpublished expert knowledge is valuable evaluation evidence, but it is not
public provenance. It should open a `needs-research` finding. Only a
source-supported correction can directly change public facts. Every accepted
finding must leave behind a fixture, validation rule, terminology entry, or a
documented editorial correction so that the learning survives the reviewer.

Any item with an action-safety score of zero blocks the affected output even
if aggregate scores are high. Publish only aggregate evaluation results; do
not identify or rank reviewers.
