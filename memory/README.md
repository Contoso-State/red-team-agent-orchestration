# Methodology memory (self-improvement surface)

This directory is the **only** place the autonomous learning loop is allowed to write. Each
engagement records inert evidence here. Parameter updates and reusable knowledge are applied only
after the same lesson is corroborated by at least two distinct, attributed runs for one agent.

## What lives here

`methodology/` holds append-only, procedural memory learned across runs:

- **`learning_candidate`** — inert, schema-bounded parameter proposals with a source run, agent,
  fingerprint, and AEF learning-contract version. A single run can only stage a candidate.
- **`param_tuning`** — promoted, bounded copies of `max_revisions` and `quality_threshold`. A
  matching candidate must appear in at least two distinct runs before the next run can load it.
- **`fp_suppression`** — false-positive signatures the Agent-as-a-Judge gate has decided to
  suppress, so a known-noisy finding stays suppressed on later runs.
- **`reflexion_debrief`** — run-scoped confirmed-finding signatures, severity tallies, and metadata.
- **`experience`** — one inert observation for a confirmed finding, isolated by agent and run.
- **`knowledge`** — versioned procedural knowledge promoted only after the same stable signature
  and outcome recur in two distinct runs for the same agent.

No code, prompt rewrite, shell command, executable skill, credential, or guardrail may be stored
here. The compatibility contract is adapted from the safe reflection-and-memory path in the
read-only `aef-core` snapshot at commit `48ee1ef7cd9f2cc91762f4b4c08150d954d443ec`;
AEF runtime code evolution is deliberately excluded.

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

## Observability & safety controls

- **Hash-chained audit log** — every mutation and promotion decision is recorded
  (`memory/methodology/audit.log.jsonl` when persisted); `audit.verify()` detects tampering.
- **Rollback** — the procedural store supports `rollbackLast()` to revert the most recent write.
- **Kill switch** — set `REDTEAM_SELF_IMPROVE=off` to disable learning entirely. The assessment
  still runs; it just stops tuning params, suppressing FPs, and writing methodology memory.
