# AEF integration review — 2026-09-25

Historical snapshot of the AEF integration before PRs #15 and #16. The checks
below describe that revision, not the current release candidate. See the
[PR integration review](pr-integration-review.md) for the current 15-node graph
and release-candidate verification. Fresh Azure assessment and measured
security-quality improvement remain unverified; the larger workshop goal is
not complete. Assessment-derived results are excluded from this public record.

## Source and branch

| Item | Verified result |
| --- | --- |
| Target branch | `codex/demo-security-subscription` |
| Target HEAD and freshly fetched `origin/main` | `49eb452f80693892f11ecaa85d40ba09a5078dae` |
| AEF remote | `https://github.com/AndrewGoodson/aef-core.git` |
| Latest verified AEF main and installed source | `07b291198cfdeee9dc82095a9366931cf14b2a92` |
| Previous integrated AEF revision | `f3548cec803cf4409652b30d9150736009abf12b` |

The target already contained current main. Eight upstream commits changed provider
support, effort configuration, scaffold/login behavior, and documentation. The
learning, state, reasoning, services, and evaluation APIs used by this integration
did not change. Updating the source pin does not establish a learning gain.

The bootstrap builds a wheel from a read-only Git archive in target-owned ignored
storage. It embeds the source commit and records wheel/install provenance. The
adapter checks the installed source against `tools/aef/source-lock.json` before
emitting events or writing memory. A mismatched package fails closed.

## Defaults and fixes

- The live entry point executes `graph/redteam.graph.json`, including memory
  retrieval before preflight and a methodology debrief after judged findings.
  Methodology learning is on when `REDTEAM_SELF_IMPROVE` is unset. Setting it to
  `off` explicitly disables memory retrieval/persistence while preserving graph
  execution. Native orchestration instructions now describe the same default.
- An installed-runtime regression exercises three offline fixture graph runs:
  inert first observation, second-run corroboration, then retrieval of reusable
  knowledge. It also checks the explicit opt-out. These are memory-mechanics
  results, not Azure findings or model-weight retraining.
- The event writer preserves bounded memory attribution through JSONL and the
  dashboard projection. Freeform retrieved contents remain excluded. The UI
  labels existing promoted knowledge as **previously promoted**.
- Asynchronous Azure reads use the canonical guard-gated runner with isolated
  CLI configuration, bounded output, timeouts, and cancellation. The PowerShell
  broker uses the same runner. Platform/argument tests use mocked executables.
- Failed or cancelled graph work emits terminal lifecycle events. Fan-out stops
  queued work, cancels active siblings, waits for cleanup, and retains the first
  failure. Repeated graph attempts have distinct task IDs.

Target-owned code evolution remains enabled through its explicit bounded runner.
It is separate from methodology learning and does not run automatically after
each assessment. The unused upstream evolution engine is not enabled. Prompts,
tools, policy, and Azure guardrails are outside the learning boundary.

## Verification

| Gate | Result |
| --- | --- |
| Historical `node --test` suite | **287 passed, 0 failed, 0 skipped** |
| Installed AEF provenance and memory mechanics | Passed, including wrong-source rejection |
| Default graph and learning integration | Passed without an opt-in flag |
| Canonical graph validation at that revision | Passed: 14 nodes, 12 specialists |
| Generated runtime definitions | Regenerated from canonical sources; drift check passed |

For publishable browser verification using isolated synthetic data, see the
[PR integration review](pr-integration-review.md). Local assessment artifacts,
their review telemetry, and their evaluation results remain outside this record.

The initial baseline suite contained an existing ambient `az account show` test.
That test was replaced with deterministic mocks; the final suite uses offline
collector fixtures. No new specialist Azure assessment was launched.

## Limits of memory evidence

The offline regressions establish retrieval mechanics, evidence validation, and
corroboration across distinct fixture runs. Those results do not establish
improved security outcomes. Internal evaluator judgments are not a controlled
baseline-versus-learned comparison. A learning-gain claim still requires matched
evaluations with independent outcome evidence; no such gain is claimed here.

## Integrity and remaining work

The read-only upstream check compared 1,248 tracked files, including content,
mode, and modification time; none changed. Upstream HEAD/status and the target's
pre-existing staged diff were preserved. Immutable guard files were unchanged.
Assessment data, the installed runtime, logs, and screenshots remain under
ignored `engagements/` paths. That historical review performed no commit, push,
or publication; release-candidate status is recorded in the
[PR integration review](pr-integration-review.md).

Automatic approval review previously rejected live Azure specialist assessment.
That dependent work remains blocked. Fresh scoped preflight, a permitted live
assessment, and a controlled evaluation are still needed to establish present
environment coverage and measured learning gains. Independent local checks above
do not substitute for those results.

Local evidence directory: `engagements/aef-update-2026-09-25/`, including
`final-node.log`, `integrity-final.json`, `local-memory-review.json`, and
`output/playwright/`. These artifacts are intentionally not committed.

Execution prompt: [AEF update goal](aef-update-goal.md).
