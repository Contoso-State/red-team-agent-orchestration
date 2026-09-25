---
title: PR Integration Review
description: Review decisions, corrective changes, and verification for PRs 15 and 16.
---

# PR Integration Review

Reviewed on September 25, 2026. Both changes were accepted for the release candidate
**with the corrections below** on `codex/demo-security-subscription`. This record
captures pre-publication verification. The integration pull request and its linked
GitHub Actions runs record the subsequent merge, hosted CI, and deployment status.

| Change | Reviewed source | Decision and value |
| --- | --- | --- |
| [PR #15](https://github.com/Contoso-State/red-team-agent-orchestration/pull/15): unreadable shell-command guard | `8b9d4b3678ca76bf381d28407dbcaf0ff4eaaa73` | Accept after fixes. Unreadable command-tool calls must fail closed without rejecting supported command envelopes. |
| [PR #16](https://github.com/Contoso-State/red-team-agent-orchestration/pull/16): shared security context | `4891f52244ff02939336c34aadf8e4f320bca334` | Accept after fixes. A canonical context stage makes specialist inputs and missing evidence explicit; the offline adapter supplies a narrow result-normalization boundary. |

The integration base is `49eb452f80693892f11ecaa85d40ba09a5078dae`, the fetched
`origin/main` at review time. Existing staged, unstaged, and untracked workshop work
was preserved and backed up before applying changes. The verification below covers
the **combined working tree**, including that earlier work.

## Findings and corrections

| Area | Criticism of the submitted change | Integrated correction |
| --- | --- | --- |
| Command guard | Alternate command envelopes could lose compatibility; command-tool classification missed some unreadable calls. | Preserve supported command, script, cmd, and shell fields; share the canonical command-tool matcher; add parity regressions. |
| Scope parity | LangGraph did not apply the same domain and resource-type selection as Node. Wildcard matching differed. | Apply the same scope intersection in both runners and compare exact rosters across runtimes. |
| Context delivery | LangGraph `Send` omitted context; asynchronous context callbacks were not safely handled. | Pass the context into every specialist state, await asynchronous handlers, and reject promises in the synchronous runner. |
| Evidence claims | An inventory path could be mistaken for verified, available evidence. | Mark the inventory as referenced, ARM evidence as unverified, and missing signal families as unavailable. A path alone never proves a successful collection. |
| Active gates | Truthy non-boolean values or empty attestations could satisfy approval checks. | Require strict boolean approval and nonempty attestations in both runners. |
| Empty scope | An empty specialist roster could stop the LangGraph flow before reporting. | Route the empty fan-out through reduction and reporting. |
| Offline adapter | Nested retained text and multi-value credential headers could escape redaction; affected resources and optional finding fields lacked complete validation. | Recursively redact retained strings, remove full credential-header values, reject unknown payload fields, validate all affected resources against request provenance, and validate canonical finding fields. |
| Live integration | Adding topology alone did not implement the stage in the separate live runner. | Persist `evidence/security-context.json`, pass its content into both specialist model passes, emit normal lifecycle/exchange metadata, and count actual scoped dispatches in reporting. |
| Live scope and cancellation | Scope normalization discarded domain selections; cancellation could leave preflight descendants running; separator checks rejected valid Windows paths. | Preserve and validate supported domain selections, propagate cancellation through every preflight step with process-tree cleanup, and use platform-aware path containment checks. |
| Fresh-checkout verification | Local AEF installation masked a missing CI prerequisite, and evolution tests depended on the caller's branch. | Bootstrap the pinned AEF source in CI, run the Python execution suite, and isolate evolution tests on a temporary branch while retaining production main/detached rejection. |
| Documentation | Generated guidance overstated automatic learning and blurred simulation, live execution, and LangGraph stubs. | Regenerate definitions from canonical sources; describe evidence gates, collector gaps, and runtime limitations explicitly. |

The context is a versioned **handoff**, not a new Azure collector. Its eight signal
families are Defender for Endpoint, Entra identity, Sentinel, Defender for Cloud,
ARM, behavior analytics, exposure management, and threat intelligence. Default
statuses remain explicit gaps until a collector supplies verified evidence.
See [Graph Engineering & Evidence-Gated Learning](graph-engineering.md).

The HexStrike adapter remains **offline only**. It neither launches HexStrike nor
implements a network transport. Recognized credential forms are redacted; this is
not a guarantee that arbitrary secrets embedded in free text can be detected.
See [External Vulnerability Assessment](external-vuln.md).

## Verification

The final reviewed working tree passed the checks below after the publication fixes.

- The full Node suite under the CI workflow's Node 24 runtime: **377 tests passed,
  zero failed, skipped, or cancelled**.
- The documentation workflow's Node 20 graph suite: **166 tests passed**, with no
  failures, skips, or cancellations.
- The LangGraph suite: **21 tests passed**, including actual graph execution,
  empty-scope reporting, strict active gates, and Node/Python context and roster parity.
- Canonical graph validation: **15 nodes and 12 specialist definitions**.
- Generated runtime-definition drift checks.
- The MyST HTML documentation build and generated route/asset validation.
- The two-run synthetic learning-loop check: the first run stayed provisional;
  **11 lessons promoted on the second distinct fixture run**, with audit-chain and
  memory-firewall checks passing.
- Desktop (1440 px) and mobile (390 px) browser checks against an isolated offline
  fixture: the context stage and inspection panel were present, a streamed event
  animated a data packet, no horizontal overflow occurred, and the browser logged
  no warnings or errors. Mobile graph labels remain dense; the selection control
  and detail panel provide access to nodes whose labels are hidden by collisions.

The full Node count includes the targeted guard, offline adapter, and live-handler
regressions; their targeted counts should not be added to the total. Live-handler
tests use stubbed model calls and verify that both passes receive context while
dashboard exchange events retain metadata rather than the prompt payload.

The PR's prior CI failures included an Azure CLI test depending on the installed
CLI and a cancelled nested asynchronous test. Earlier local workshop work already
corrected the CLI dependency; this integration preserves that fix. Checking the
documentation workflow's Node 20 runtime reproduced the nested-test cancellation,
which was corrected by registering the timeout test independently. An obsolete
generated-document assertion was also updated to reflect evidence-gated learning.

For a fresh checkout, use Node 24 and Python 3.12. Obtain the AEF repository and
revision recorded in `tools/aef/source-lock.json` in a **disjoint checkout**:
neither repository may contain the other. The bootstrap reads that source's Git
objects and builds the pinned package inside this repository's ignored
`engagements/` directory; it does not install into or change the source checkout.
The full Node suite requires this target-local AEF environment. The CI workflow
now installs it before running the suite.

From the repository root, replace `<disjoint-aef-checkout>` with that source path
and run the following in a POSIX shell:

```sh
python3.12 tools/aef/bootstrap.py --source "<disjoint-aef-checkout>"
engagements/aef-integration-verification/.venv/bin/python -m pip check
node --test
node tools/graph/validate-graph.mjs
node tools/agents/build-agent-defs.mjs --check
node tools/graph/verify-learning-loop.mjs
```

Install the pinned LangGraph and test dependencies in a separate local environment:

```sh
python3.12 -m venv engagements/pr-integration-review/langgraph-venv
engagements/pr-integration-review/langgraph-venv/bin/python -m pip install -r integrations/langgraph/requirements.txt
engagements/pr-integration-review/langgraph-venv/bin/python -m pip check
engagements/pr-integration-review/langgraph-venv/bin/python -m pytest integrations/langgraph/tests
```

The review used Python 3.12, Node 25.9.0, and the workflows' Node 24/20 runtimes.
Local logs and browser fixtures belong
under ignored `engagements/pr-integration-review/`, outside tracked documentation.

## Limits of this result

Hosted delivery requires passing CI against the published commit and verification
of the deployed documentation and assets. Consult the integration pull request and
GitHub Actions for those post-publication results. Windows path and process-tree
behavior has contract coverage; execution on a Windows host was not verified.

No live Azure assessment, live HexStrike execution, or CyberGym benchmark was run
for this PR review. Synthetic reuse proves the promotion mechanism, not improved
finding quality, model retraining, or a measured learning gain. LangGraph's default
assessment handlers remain stubs; its memory nodes emit events rather than
implementing the full methodology-promotion store. Live collectors and model
dispatch need their own scoped end-to-end evidence.

The read-only Azure boundary, immutable guardrails, methodology-only learning
boundary, and exclusion of engagement data from the primary branch remain in force.
