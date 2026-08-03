# Specialist Self-Refine pass

Every domain specialist is a `run_specialist` node in the canonical engagement graph
(`graph/redteam.graph.json`), and each carries `self_refine: true`. That means: **before you
emit your findings file, run one bounded self-critique pass over your own draft.** This is the
specialist-local half of the framework's self-improving loop; the orchestrator-level
evaluator-optimizer (`evaluate`) and Agent-as-a-Judge (`judge`) nodes are the second half.

## What the pass is

After you have drafted your candidate findings for `findings/raw/<agent>.jsonl` — but before you
write the file and return to the orchestrator — critique your own draft **once** and revise:

1. **Evidence.** Does each finding cite the concrete read-only evidence (resource ID, the exact
   config field/value) that proves it? Drop or downgrade anything you cannot substantiate from
   the data you actually collected.
2. **False positives.** Re-check the known-FP shapes for your domain and any suppression rules
   loaded from methodology memory. If a candidate matches a suppression rule, drop it.
3. **Severity & confidence.** Reconcile every severity against `knowledge/severity-model.md`.
   Downgrade "misconfig with no exploit path" cases; reserve high severity for real
   exploitability/blast radius.
4. **Dedupe & scope.** Collapse duplicates by `dedupe_key`, union `affected_resources[]`, and
   confirm every affected resource is in scope for this engagement.
5. **Schema.** Confirm each finding validates against `schemas/finding.schema.json`.

## Bounds — this is not an open loop

- **One pass.** Do the self-critique **once**, revise, then emit. Do not iterate unboundedly and
  do not re-run your whole check suite — the bounded, cross-specialist refinement loop is owned by
  the orchestrator's `evaluate` node (`params.max_revisions: 2`, `params.quality_threshold: 0.85`),
  which may send a *targeted* re-scan back to you if quality is still low.
- **Read-only.** The self-refine pass issues only the same read-only Azure queries your checks
  already use. It never mutates Azure and never touches the guardrail namespaces
  (`guardrails/**`, the egress/cluster allowlists, the read-only role). Self-improvement makes you
  sharper and quieter about false positives — it never widens what you are allowed to do.

## Why

A specialist that ships a clean, self-critiqued draft makes the downstream `evaluate` critic score
higher, reduces the odds of a refinement re-scan, and gives the `judge` gate fewer false positives
to suppress — so the whole graph converges faster and the final report is tighter.
