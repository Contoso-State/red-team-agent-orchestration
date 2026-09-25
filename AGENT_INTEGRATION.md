# AEF integration in Red Team

AEF is consumed from a pinned wheel built from source revision
`07b291198cfdeee9dc82095a9366931cf14b2a92`, verified against upstream main on
2026-09-25. The upstream checkout is read-only. `tools/aef/source-lock.json` is
the single source revision lock used by bootstrap and the adapter. Bootstrap
embeds that revision in the target-built wheel; retrieval fails closed when the
installed revision does not match the lock.
Builds, dependencies, checkpoints and assessments stay inside this repository.

## Install and verify

Use Python 3.12 to match CI (the package supports 3.11 or newer). Installation accesses the package registry for the
pinned dependencies; it reads the upstream Git archive without changing it.

```bash
python3.12 -I -B tools/aef/bootstrap.py --source /absolute/path/to/aef-core
node --test tools/memory/*.test.mjs tools/evolution/*.test.mjs
```

The installed runtime is under
`engagements/aef-integration-verification/.venv`. Its wheel hash, source revision
and installed dependency versions are recorded in `installation.json` beside it.
The bridge fails closed if that runtime is absent or evidence validation fails.

## Actual execution path

`tools/graph/live-handlers.mjs` calls `tools/memory/workshop-memory.mjs`, which
verifies historical observations before invoking `tools/memory/aef-bridge.mjs`.
That bridge runs `aef_adapter.py` with the installed AEF package and no provider.
The adapter injects AEF Services into a real GraphExecutor:

`aef_consolidate → aef_retrieve → aef_reflect`

RuleBasedConsolidator requires two distinct source runs for the same agent and
outcome. MemoryRetriever returns at most 2,000 estimated tokens per agent. The
reflection node measures context-budget compliance, not security quality.
FileDurabilityBackend stores graph checkpoints beneath the current session's
`memory/methodology/aef/`. Stores are rehydrated from verified canonical evidence
on each invocation; they are not an external memory database.

Canonical observations require matching environment scope, agent, source run,
check, signature, outcome and evidence hashes. An observation from the current
run cannot corroborate itself. Modified evidence and cross-agent records fail
closed. Retrieved advice is fallible context for revalidation, never authority
to expand access or override policy.

The existing native Azure agents remain canonical. Mechanical prompt wrappers
were removed because they were unused stubs; this integration does not claim
to replace the whole assessment graph with an AEF model-driven graph.

## Memory review and target code evolution

```bash
node tools/memory/review-session.mjs engagements/<completed-session>
node tools/evolution/run.mjs engagements/<completed-session>
```

Memory review reads existing evidence and records real retrieval/checkpoint
activity. It does not contact Azure, invoke a model or create corroborating
assessment observations. Code evolution is separately enabled in this target
and follows [AUTONOMY.md](AUTONOMY.md). AEF's upstream evolution configuration
remains disabled because its current engine raises NotImplementedError.

`REDTEAM_SELF_IMPROVE=off` disables observation retrieval and persistence.
Runtime audit/checkpoint files can still be written. `REDTEAM_CODE_EVOLUTION=off`
disables the target code loop. Neither switch changes Azure read-only guards.

## Evidence needed for learning claims

Keep run IDs, scope, source revision, check outcomes and evidence hashes. Record
candidates separately from corroborated knowledge. A model-quality claim needs
comparable baseline/candidate trials with frozen tasks, budgets and independent
controls. Passing graph tests, repeated retrieval or a context-budget score does
not establish better Azure detection or model retraining.
