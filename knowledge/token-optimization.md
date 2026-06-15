# Token Optimization — Script the Mechanical, Reason on the Compact

This red team is a **primary agentic engine**: agents own judgment — severity, exploitability,
attack-path narrative, false-positive suppression, client context. Nothing here replaces that.
What this document defines is how agents stay **token-frugal** so the judgment budget is spent on
reasoning, not on shuffling raw Azure JSON through the model.

The rule in one line: **deterministic code moves and matches data; the agent reasons over a
compact summary and writes the story.** A predicate-backed check costs ~0 model tokens to
evaluate; the agent only pays tokens to confirm, contextualize, and narrate.

This file is the **canonical contract** for that split. It complements `knowledge/scaling.md`
(which keeps the *count* of work bounded); this file keeps the *per-item token cost* bounded.

---

## What is scripted vs. agentic

| Work | Owner | Why |
|---|---|---|
| Enumerate / query Azure (ARG, `az`) | **Script** (read-only runners) | Mechanical, deterministic, no judgment. |
| Evaluate a predicate-backed check against rows | **Script** (`tools/checks/run-checks.mjs`) | A boolean rule over fields — pure code, zero model cost. |
| Aggregate matches → one finding per class × subscription | **Script** (engine + `ingest.mjs`) | Deterministic grouping (see scaling.md). |
| Build the compact triage summary | **Script** (engine) | The few-hundred-token artifact the agent actually reads. |
| Render the report, coverage, SARIF, token ledger | **Script** | Pure transforms over structured data. |
| Decide **severity / confidence** in context | **Agent** | Judgment. The engine proposes defaults; the agent owns the call. |
| Confirm vs. suppress a candidate (false positives) | **Agent** | Judgment over the summary, not the raw rows. |
| **Attack-path correlation & narrative** | **Agent** | The highest-value, irreducibly agentic output. |
| Novel / fuzzy checks with no clean predicate | **Agent** | When a rule can't capture it, the agent reasons directly — that's expected. |

If a check can be expressed as "these fields, compared this way, are a problem," it belongs in a
**predicate bank** and costs no model tokens. If it genuinely needs reasoning, keep it agentic and
spend the tokens deliberately.

---

## The token sink (what we are fixing)

The expensive pattern is an agent pulling **raw resource JSON into context** and hand-evaluating
`detection.logic` per resource, per check. On a large estate that is tens of thousands of tokens of
input the model must read, plus the output it writes restating each one.

The fix is a **dispatch boundary**:

```
        ┌─────────────── deterministic (≈0 model tokens) ───────────────┐
 az/ARG runner  ──rows.json──▶  run-checks.mjs  ──▶  findings/raw/<agent>.engine.jsonl
                                      │
                                      └──▶  findings/summary/<agent>.json   ◀── the agent reads THIS
        └────────────────────────────────────────────────────────────────┘
                                      │  (few hundred tokens)
                                      ▼
                          Agent: confirm · contextualize · suppress · narrate   (judgment)
```

The agent **never loads the raw rows** (`rows.json`) or the raw candidate JSONL into context. It
reads the **compact summary** (`check-summary/v1`: per check — scanned/matched counts, one evidence
sample, the representative resource id) and reasons over that. Raw rows stay on disk for evidence
and export; they are not prompt input — exactly like the inventory rule in `scaling.md`.

---

## The deterministic check engine

`tools/checks/run-checks.mjs` (dependency-free Node) is the scripted half.

- **Input:** one or more **predicate packs** (`checks/<domain>/predicates.json`, schema
  `schemas/predicate-pack.schema.json`) plus a `--rows <file>` JSON object keyed by `check_id`
  (the rows a read-only runner already produced). The engine **never calls Azure** itself.
- **Predicate DSL** (`evaluate`): `{all:[…]}`, `{any:[…]}`, `{not:…}`, or a leaf
  `{field, op, value}`. Ops: `eq ne eqi in ini nin gt gte lt lte exists missing contains
  ncontains regex version_lt`. Pure, structural, dot-path field resolution — no `eval`.
- **Output:** schema-valid candidate findings → `findings/raw/<agent>.engine.jsonl`, and the
  compact triage summary → `findings/summary/<agent>.json`. Findings are grouped by
  `(finding_class, subscription_id)`, `affected_resources[]` unioned, `dedupe_key` set — consistent
  with `ingest.mjs` aggregation.

A predicate pack is **self-contained** (carries title/severity_default/category/controls/
recommendation/attack_vector/agent/id_prefix) so the engine emits a complete finding. The
human-readable `logic` and methodology stay in `checks/<domain>/checks.yaml`; the pack is the
machine-readable mirror. Keep the two in sync: a check that has a predicate should have the same
`check_id`, severity, and title in both.

**Dispatch contract for a domain agent:**

1. Run your read-only runner(s) to produce `rows.json` (rows keyed by `check_id`).
2. `node tools/checks/run-checks.mjs --predicates checks/<domain>/predicates.json --rows rows.json --agent <agent> --session engagements/<session>`.
3. Read **only** `findings/summary/<agent>.json`. Confirm / contextualize / suppress / set final
   severity over that summary.
4. For any check **without** a predicate, reason directly as before — but still write findings to
   the same `findings/raw/<agent>.jsonl`, then ingest.

Checks that can't be made deterministic stay agentic; the engine is an accelerator, not a gate.

---

## Total token usage per report

Every report can carry a **total token usage** figure — input, output, and total — so an operator
sees what the engagement cost the model.

- **Ledger:** `tools/tokens/ledger.mjs` produces `reports/token-usage.json`
  (schema `token-usage/v1`: `totals`, `per_phase`, `per_agent`, `method`, `ratio`, `notes`).
- **Two sources, in priority order:**
  1. **measured** — real usage lines in `engagements/<session>/runs/usage.jsonl`
     (`{phase, agent, input_tokens, output_tokens}` per line). Authoritative when present.
  2. **estimated** — `ceil(utf8_bytes / ratio)` (default `ratio ≈ 4`) over the bytes that actually
     crossed the model boundary: **input** = system prompt + skill + compact check summary; **output**
     = LLM-authored findings + report narrative. Engine-authored `*.engine.jsonl` is **excluded** —
     it never costs the model. A run that mixes both reports `method: "hybrid"`.
- **Report:** `generate-report.mjs --token-usage reports/token-usage.json` adds the figure to the
  cover (`input X · output Y · total Z`) and an **Appendix D — Engagement Cost & Token Budget**
  with per-phase / per-agent breakdowns.
- **Budget (advisory):** `engagement.yaml` may set `scale.token_budget {max_total, warn_at}`. The
  report flags the engagement **within / near / over** budget. It is advisory and **never aborts a
  run** — going over budget is a reported fact, not a failure.

The figure is an honest accounting boundary, not a precise meter: estimated mode is a defensible
lower-bound proxy; wire `runs/usage.jsonl` when exact numbers matter.

---

## Swarm execution (how the token work is built in parallel)

Because predicate packs are per-domain and self-contained, the harvest parallelizes cleanly: each
session owns **only** its domain's `checks/<domain>/predicates.json` and slims its own
`agents/<domain>/system-prompt.md` to point at the dispatch contract. The shared core (engine,
ledger, report wiring, this doc) is built once, then domains fan out and a final merge validates
that all checks remain schema-valid with zero duplicate `check_id`s. See `knowledge/scaling.md` for
the matching finding-aggregation rules the engine honors.

---

## Attribution

Methodology framing only; no third-party code is vendored here. Where predicate logic derives from
upstream check definitions, the existing `checks/<domain>/checks.yaml` attribution and
`THIRD_PARTY_NOTICES.md` continue to apply.
