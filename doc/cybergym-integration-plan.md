# CyberGym integration plan

Status: prepared September 25, 2026. Target benchmark: [Berkeley CyberGym (`sunblaze-ucb/cybergym`)](https://github.com/sunblaze-ucb/cybergym).

**Actual CyberGym score: unmeasured (`null`). No agent task was attempted.** There is no measured solve rate, baseline, or learning gain. Repository tests and setup checks are not CyberGym scores. Automatic security review blocked dependent benchmark investigation/execution; this document completes independent integration planning only. It does not authorize a different route around that block.

The existing Azure workflow remains separate, with its read-only scope and immutable guardrails intact. This plan does not change the read-only AEF source repository or enable agent-driven code/policy changes. Benchmark data, task artifacts, dependency checkouts, and results belong under ignored `engagements/` paths and stay off the primary branch.

## What the benchmark measures

CyberGym evaluates agents on vulnerability-analysis tasks using supplied vulnerable software and an independently verified proof-of-concept artifact. It is not an Azure configuration scanner or a generic repository quality assessment. Its [setup documentation](https://github.com/sunblaze-ucb/cybergym/tree/c6fe2027d39471375920b92cf1025e23a99ffda5#evaluation) requires a local evaluation environment. The reviewed [FAQ](https://github.com/sunblaze-ucb/cybergym/blob/c6fe2027d39471375920b92cf1025e23a99ffda5/FAQ.md) requires the agent to designate exactly one final submission per task and report the final-submission metric; only the evaluator may access the fixed build. The [submission requirements](https://github.com/sunblaze-ucb/cybergym/blob/c6fe2027d39471375920b92cf1025e23a99ffda5/SUBMISSION.md) also require model usage and cost reporting.

The current live adapter supplies bounded Azure configuration evidence to agents without executable model tools. Its output is structured Azure findings. Running an unrelated example agent on CyberGym would measure that example agent, not this repository's orchestration. An adapted benchmark graph can reuse this repository's execution engine, but its identity and differences must be disclosed.

## Prioritized work and acceptance gates

| Priority | Work | Acceptance gate |
| --- | --- | --- |
| P0 | Add an explicit benchmark task contract and separate adapter. Record task ID, dataset/source revisions, difficulty, budgets, model configuration, allowed inputs, artifact hashes, and terminal status. | Adapter consumes a benchmark task without an Azure subscription or Azure credentials. Invalid scope, missing inputs, unavailable evaluator, and timeouts remain explicit non-success states. Azure entry points and guards are unchanged. |
| P0 | Define a benchmark-specific graph using the shared executor, with bounded analysis, candidate production, final selection, evaluator handoff, reporting, and debrief stages. | Graph validates; cancellation and bounded retries work; all handoffs carry run/task identities. The run manifest identifies the graph and adapter revisions. Results are labeled as an adapted benchmark workflow, not an unchanged canonical Azure assessment. |
| P0 | Separate the solver's task workspace from evaluation-only material. | Solver has access only to permitted task inputs; fixed builds, reference artifacts, answer-bearing history, and evaluator credentials are unavailable to it. Network access and trajectory review are documented according to upstream rules. No live run proceeds while the tool-enforced block remains. |
| P0 | Add final-selection records and independent outcome ingestion. | Exactly one final artifact hash is designated before its final evaluation. Each task's selected artifact maps to evaluator evidence. The score ledger distinguishes valid solved/unsolved results from unattempted tasks and infrastructure failures; missing results cannot become a pass or a completed official score. |
| P1 | Add a benchmark memory namespace and immutable evaluation split. | Memory scope uses benchmark revision, task family, agent identity, and training/evaluation split instead of fabricated Azure tenant IDs. Evaluation-task answers cannot enter reusable training memory. Cross-split retrieval and wrong-scope writes fail closed. Source-run IDs and evidence hashes remain inspectable. |
| P1 | Preserve model usage and execution costs. | Every model invocation, including specialists and judges, records model identity, request count, input/output/cache token counts where available, and wall-clock time. Unsupported fields are explicitly unavailable rather than zero. Aggregate usage reconciles to invocation records; any price-based estimate records its pricing source/date. |
| P1 | Render benchmark progress and evidence in the dashboard. | Task states, actual exchanges, final selection, independent outcomes, and memory provenance reconcile to the event ledger with no missing or duplicate events. Replay is labeled. Unsupported or blocked stages do not appear complete. |
| P2 | Conduct a preregistered, bounded pilot when execution is permitted. | Fix the task subset, difficulty, model, budgets, graph revision, scoring rule, memory policy, and failure handling before execution. Preserve per-task evidence and disclose subset limits. Setup or reference-artifact verification is reported only as harness validation. |
| P2 | Compare learning disabled versus enabled under controlled conditions. | Use the same held-out tasks and budgets, isolate training from evaluation, freeze learned memory before each evaluation arm, and report paired outcomes plus cost/time differences and uncertainty. A neutral or negative result is retained. No gain claim precedes these measurements. |

## Suggested stages

1. **Contract and offline adapter work:** implement task/result schemas, provenance, graph validation, final-selection ledger, isolation checks, and usage accounting with fixtures. Review the adapted workflow and preserve the Azure path. This stage can establish integration correctness, not benchmark capability.
2. **Permitted pilot:** after the execution block is resolved through the supported authorization path, validate local prerequisites, run a small predefined subset, and independently verify each selected final artifact. Report the observed numerator, denominator, unattempted tasks, and failures alongside complete settings. A subset result must be labeled a subset result.
3. **Measured improvement:** use pilot failures to prioritize specific changes, then compare those changes on a reserved evaluation split. Candidate hypotheses include better task decomposition, evidence selection, bounded reflection, and relevant methodology retrieval. None is an established improvement until evaluated.
4. **Broader evaluation and workshop presentation:** expand only after scoring and isolation gates pass. Show actual task progress, costs, outcome evidence, and measured comparisons. Keep the Azure assessment dashboard and CyberGym results clearly attributed to their respective workflows.

Schedule and infrastructure costs remain unestimated. They depend on the permitted execution environment, selected task assets, and the adapter implementation. A score target should be set after a valid first measurement, not inferred from internal test counts.

## Existing code to reuse or adapt

| Source | Relevance |
| --- | --- |
| [`tools/graph/async-runner.mjs`](../tools/graph/async-runner.mjs) | Shared graph execution, bounded fan-out, cancellation, lifecycle events. |
| [`graph/redteam.graph.json`](../graph/redteam.graph.json) | Current Azure graph; its roster, scope, and state contract must not be silently relabeled as CyberGym. |
| [`tools/graph/run-live.mjs`](../tools/graph/run-live.mjs) | Azure-only entry point requiring scoped engagement, isolated credentials, and fresh preflight. Keep separate. |
| [`tools/graph/live-handlers.mjs`](../tools/graph/live-handlers.mjs) and [`live-broker.mjs`](../tools/graph/live-broker.mjs) | Current handlers depend on Azure findings and a finite ARM configuration-read catalog. They are not a CyberGym adapter. |
| [`tools/graph/native-model.mjs`](../tools/graph/native-model.mjs) | Current Azure model wrapper supplies no executable tools. It now preserves allowlisted runtime usage metadata separately from structured output; raw provider envelopes remain excluded. |
| [`tools/graph/trace-exchange.mjs`](../tools/graph/trace-exchange.mjs) | Exchange identity, payload-size and duration telemetry plus terminal `model.usage` records. Available token counts and estimated cost are linked to the exchange; unavailable fields remain null. This is general Azure observability, not benchmark accounting validation. |
| [`tools/graph/evaluation-record.mjs`](../tools/graph/evaluation-record.mjs) | Existing scores are explicitly `model-judgment`, `not-controlled`, and `improvement_verified: false`; do not substitute them for independent outcomes. |
| [`tools/memory/workshop-memory.mjs`](../tools/memory/workshop-memory.mjs) and [`aef_adapter.py`](../aef_adapter.py) | Existing evidence attribution and corroboration mechanisms; Azure environment scope and roster require a separate benchmark integration. |
| [`doc/aef-update-review.md`](aef-update-review.md) | Prior verification and its limits. Existing memory reuse establishes mechanics, not measured learning gains. |

Relevant offline regression checks include `tools/graph/default-learning.test.mjs`, `tools/memory/aef-bridge.test.mjs`, `tools/graph/async-runner.test.mjs`, `tools/graph/live-runtime.test.mjs`, `tools/checks/known-evidence.test.mjs`, and `tools/graph/evaluation-record.test.mjs`. Their results should accompany adapter development as engineering evidence, never as a CyberGym score.

Historical snapshot from planning, before PRs #15 and #16: independent repository validation passed 33 relevant Node tests, with zero failures or skipped tests. Canonical graph validation passed for 14 nodes and 12 specialists, and generated agent definitions were in sync at that revision. See the [PR integration review](pr-integration-review.md) for the current 15-node graph and release-candidate verification. These checks cover repository behavior; they do not validate a CyberGym adapter or scorer. Scorer implementation was also blocked by automatic security review, and no scorer files were written.

The pinned source record is [`tools/benchmark/cybergym-source-lock.json`](../tools/benchmark/cybergym-source-lock.json). A local-only, ignored status artifact at `engagements/cybergym-benchmark/status.json` records the blocked execution state, null scores, and zero attempted tasks; it is not part of the published repository. The source record documents provenance only; neither artifact establishes benchmark performance.

## Required result record

Until a permitted, independently verified task evaluation exists, preserve this measurement meaning in any report or UI. The separate execution status remains blocked as recorded in the local status artifact:

```json
{
  "benchmark": "sunblaze-ucb/cybergym",
  "score": null,
  "status": "unmeasured",
  "agent_tasks_attempted": 0,
  "learning_gain": null
}
```

A future result must add the pinned upstream/dataset/adapter/graph revisions, declared task set and difficulty, final-submission outcomes, model/budget/memory settings, cost telemetry, and evidence references. Changes to the selected task set or failure policy must be disclosed rather than silently improving the reported denominator.
