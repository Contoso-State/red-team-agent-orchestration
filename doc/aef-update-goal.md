# AEF update review and execution goal

Prepared 2026-09-25 for the historical AEF update. Interpret the requested
`awf-core` as the existing read-only aef-core upstream at `<aef-core-checkout>`.
This prompt records that update's scope. See the
[PR integration review](pr-integration-review.md) for current release-candidate
verification and publication status.

## Goal prompt

Continue the workshop goal on `codex/demo-security-subscription`. Synchronize
with freshly fetched `origin/main` without losing staged or untracked work.
Verify the latest AEF upstream commit against its remote, review every change
since the integrated revision, then integrate compatible updates into this
repository. Keep the upstream repository read-only and build any runtime inside
ignored target-owned storage. Preserve the existing Azure read-only scope,
immutable guardrails, redaction, evidence provenance, and methodology-only
learning boundary. Keep assessment data and verification artifacts off main.
Run the canonical graph and evidence-gated methodology learning by default;
require an explicit operator opt-out to disable memory. Keep native launch
instructions consistent with those defaults.

Execute this loop until the local integration gates pass or a specific external
dependency prevents progress:

1. Record the branch, target/main SHAs, upstream SHA, working-tree baseline,
   integration contract, and upstream integrity baseline. Preserve user work.
2. Run the existing automated suite, graph validation, and generated-definition
   drift check. Review AEF API/configuration changes and current main integration
   points; distinguish actual learning capabilities from documentation changes.
3. Update the pinned target runtime and its provenance together. Fix demonstrated
   compatibility defects, including incorrect run attribution, event transport,
   evidence validation, or incomplete collector reporting. Add focused regression
   tests for substantive defects. Never loosen guardrails to make tests pass.
4. Exercise the installed AEF consolidate/retrieve/reflect path with known
   fixtures. Prove distinct-run corroboration, duplicate-run rejection, agent
   and environment isolation, evidence integrity, and bounded retrieval.
   Label fixture outcomes as fixtures. Retain explicit evaluation limitations.
5. Verify desktop and mobile dashboard rendering and actual local memory event
   delivery. Check graph attribution, transfers, timeline, and learning labels.
   Recorded evidence is replay; a local memory review is not a new Azure run.
6. Re-run relevant checks after fixes. Confirm upstream remained unchanged,
   artifacts are ignored, and the final diff preserves existing user changes.
   Report SHAs, executed checks, measured outcomes, and remaining blockers.

Reuse passing checks unless code changes invalidate them. Choose routine
implementation details autonomously; do not claim green from an empty dataset,
unrun check, simulation, or model-weight training that is not implemented.

## Acceptance gates

- Branch contains freshly fetched main; existing staged and untracked work is
  retained. The original update scope excluded commit, push, and publication;
  later release authorization is recorded separately.
- Latest AEF source is verified and pinned. The installed package and provenance
  match that pin; the source checkout is unchanged.
- Relevant automated tests, canonical graph validation, and generated definitions
  pass, with current logs retained locally.
- A no-opt-in regression exercises the real installed AEF runtime through the
  canonical graph: persist an inert candidate, corroborate across distinct runs,
  retrieve reusable knowledge, and honor an explicit memory opt-out.
- Real installed-package tests establish memory mechanics; desktop/mobile checks
  establish the dashboard's local integration. Security-quality gains remain
  unproven unless measured using distinct real assessment runs.
- Report separate statuses for local integration, browser verification, fresh
  Azure assessment, real-run reuse, and measured learning improvement.

## Live-work boundary

The earlier automatic tool review blocked live Azure specialist assessment.
Do not retry that action through another runtime, agent, or tool while the block
is unresolved. Complete independent integration and verification. Future live
validation also requires fresh scope, authentication, and inventory preflight;
missing coverage remains a gap, never a clean result.

Code evolution stays confined to the target-owned mechanism documented in
`AUTONOMY.md`; AEF's upstream evolution implementation and immutable controls
must not be enabled or modified to bypass those limits.

Execution results: [AEF update review](aef-update-review.md).
