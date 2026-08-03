# Methodology memory (self-improvement surface)

This directory is the **only** place the fully-autonomous self-improving loop is allowed to
write. Everything here is **auto-applied at runtime with no PR and no human gate** — each
engagement can make the next one better by updating this namespace.

## What lives here

`methodology/` holds append-only, procedural memory learned across runs:

- **`param_tuning`** — bounded, clamped copies of the reflection-loop parameters
  (`max_revisions`, `quality_threshold`) produced by the evaluator-optimizer.
- **`fp_suppression`** — false-positive signatures the Agent-as-a-Judge gate has decided to
  suppress, so a known-noisy finding stays suppressed on later runs.
- **`reflexion_debrief`** — confirmed-finding signatures, severity tallies, and run metadata
  from the end-of-run debrief.

Runtime logs (`*.log.jsonl`, `*.store.json`) are `.gitignore`d because they can reference
target-specific detail; only this README and the namespace placeholder are tracked.

## The one immutable boundary

Self-improvement can change **how** agents investigate and critique; it can never change **what**
they are allowed to do. Two firewalls enforce this (see `tools/graph/self-improve.mjs`):

- **Namespace firewall** — writes may target only the `methodology` namespace. Any guardrail
  namespace (`guardrails`, `allowlist`, `egress`, `readonly`, `guard`) is refused.
- **Filesystem firewall** — writes under `guardrails/**` or outside the repo root are refused.

The read-only Azure enforcement in `guardrails/guard.mjs` is therefore outside the learning
surface and cannot be self-modified.

## Observability & safety controls (not gates)

- **Audit log** — every mutation is recorded (`memory/methodology/audit.log.jsonl` when
  persisted) with a before/after count.
- **Rollback** — the procedural store supports `rollbackLast()` to revert the most recent write.
- **Kill switch** — set `REDTEAM_SELF_IMPROVE=off` to disable learning entirely. The assessment
  still runs; it just stops tuning params, suppressing FPs, and writing methodology memory.
