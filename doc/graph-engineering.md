---
title: Graph Engineering & Self-Improvement
description: The canonical declarative graph, bounded self-improving loops, and two-engine execution model for the Azure red-team agent framework.
---

# Graph Engineering & Self-Improvement

The primary architectural standard for this framework is now **graph engineering**: one
explicit, declarative engagement graph defines the topology, state channels, reducers,
conditional routers, bounded loops, and memory boundaries for every runtime. The source of
truth is [`graph/redteam.graph.json`](../graph/redteam.graph.json), validated against
[`schemas/graph.schema.json`](../schemas/graph.schema.json) by
`tools/graph/validate-graph.mjs`.

:::{warning}
**AI Disclosure & Disclaimer:** This independent Contoso-State demo uses AI agents for
security assessment. AI output can be wrong, incomplete, or misleading. Validate findings
independently, run only against systems you are authorized to assess, and keep human security
review in the loop for real-world decisions. This project is not affiliated with, endorsed by,
or sponsored by Microsoft.
:::

## Why graph engineering

The graph makes orchestration inspectable instead of implicit prompt choreography:

- **Determinism** — node order, routers, fan-out, and fan-in are declared in JSON and checked by
  the validator before execution.
- **Resumability** — parallel specialist work is backed by the durable JSONL task manifest in
  `tools/orchestration/manifest.mjs`, so interrupted fan-out can be resumed and reduced
  deterministically.
- **Explicit state and reducers** — each shared channel declares how writes merge, including
  append-only fan-in and finding-level dedupe.
- **Bounded self-improvement** — reflection is a loop with explicit exit criteria
  (`max_revisions: 2`, `quality_threshold: 0.85`), not an open-ended conversation.
- **Reviewable safety boundaries** — the graph declares where memory may be read or written,
  while read-only enforcement remains outside the self-improvement surface.

## Canonical topology

```{mermaid}
graph TD
    START([START]) --> VS[validate_scope<br/>subscription + read-only gate]
    VS --> ML[memory_load<br/>methodology memory]
    ML --> PI[preflight_inventory<br/>sequential inventory]
    PI --> PS[plan_specialists<br/>Send fan-out]

    subgraph Fanout[Parallel read-only specialist fan-out]
        PS --> RS[run_specialist<br/>12 domains + bounded Self-Refine]
    end

    RS --> CR[collect_raw<br/>deterministic dedupe reduce]
    CR --> EV[evaluate<br/>run-checks + critic score]

    EV -->|route_after_evaluate: refine<br/>revision < max_revisions<br/>and quality < quality_threshold| PS
    EV -->|route_after_evaluate: proceed| J[judge<br/>Agent-as-a-Judge FP gate]

    J -->|auto-write FP suppressions| MW[(memory/methodology/)]
    J --> AA{{authorize_active<br/>HITL interrupt}}
    AA -->|route_active: external_active| EVA[eva_active<br/>gated external lane]
    AA -->|route_active: cluster_active| CA[cluster_active<br/>gated AKS lane]
    AA -->|route_active: none / rejected| CO[correlate<br/>RBAC + attack paths]
    EVA --> CO
    CA --> CO
    CO --> RP[report<br/>deliverables]
    RP --> RD[reflexion_debrief<br/>run-scoped experience]
    RD -->|corroborated agent knowledge<br/>after 2+ distinct runs| MW
    RD --> END([END])

    classDef memory fill:#f8f4ff,stroke:#6f42c1,color:#3b245f;
    classDef gate fill:#fff4e6,stroke:#d97706,color:#7c2d12;
    classDef active fill:#fff1f2,stroke:#e11d48,color:#881337;
    class ML,MW,RD memory;
    class VS,AA,J gate;
    class EVA,CA active;
```

The topology is:

1. **`START -> validate_scope`** — the subscription, scope, engagement mode, and read-only role
   posture are validated before any Azure access.
2. **`memory_load`** — prior methodology memory is loaded as read-only context.
3. **`preflight_inventory`** — the Inventory & Scope agent performs sequential permission checks
   and resource enumeration.
4. **`plan_specialists -> run_specialist`** — a LangGraph-style **Send** fan-out maps over the
   in-scope read-only roster and dispatches one specialist worker per domain in parallel.
5. **`collect_raw`** — raw specialist outputs fan back in through a deterministic
   `merge_findings` reduce.
6. **`evaluate`** — the evaluator-optimizer loop head runs deterministic checks plus a critic
   score over candidate findings.
7. **`route_after_evaluate`** — if `revision < max_revisions` and quality is below
   `quality_threshold`, the graph reflects back to `plan_specialists`; otherwise it proceeds.
8. **`judge`** — an Agent-as-a-Judge gate re-checks candidate findings using targeted
   **read-only** evidence queries and suppresses false positives into methodology memory.
9. **`authorize_active` / `route_active`** — a human-in-the-loop interrupt gates the optional
   active lanes. Read-only or rejected runs route straight to correlation.
10. **`correlate -> report`** — confirmed findings are correlated into RBAC and attack paths,
    then rendered into deliverables.
11. **`reflexion_debrief -> END`** — the run records an inert episode. Stable lessons are
    promoted only after matching evidence from at least two distinct runs for the same agent.

## State channels and reducers

The graph state follows a LangGraph-style channel model. Concurrent writes are safe because
each channel declares its reducer in the graph contract.

| Channel | Type | Reducer | Role |
|---|---:|---|---|
| `scope` | object | `last` | Validated subscription, mode, domain, exclusion, and read-only role context. |
| `memory` | object | `last` | Methodology memory loaded from prior runs. |
| `inventory_ref` | string | `last` | Path to the preflight resource inventory. |
| `raw_findings` | array | `append` | Per-specialist JSONL outputs accumulated by Send fan-in. |
| `candidate_findings` | array | `merge_findings` | Deterministically deduped findings before critique and judge. |
| `critique` | object | `last` | Evaluator quality score and notes that drive reflection. |
| `revision` | number | `last` | Bounded reflection iteration counter. |
| `confirmed_findings` | array | `merge_findings` | Findings promoted by the false-positive judge. |
| `attack_paths` | array | `append` | Cross-domain authorization and attack-path chains. |
| `report_refs` | array | `append` | Rendered deliverable paths. |
| `approved` | boolean/null | `last` | Human decision at the gated active-lane interrupt. |

## Self-improving loops

The graph deliberately borrows from prior art in self-improving agents while excluding unsafe
runtime self-modification:

- **Self-Refine** — each specialist performs a bounded refinement pass on its own draft findings
  before writing raw output.
- **Evaluator-optimizer** — `evaluate` combines deterministic `run-checks` output with a critic
  score and stages a bounded, inert parameter candidate; `route_after_evaluate` routes back to
  targeted specialist planning only while the loop is under `max_revisions` and below
  `quality_threshold`.
- **Agent-as-a-Judge** — `judge` re-verifies candidate findings with 1-3 targeted read-only Azure
  queries, promotes confirmed / needs-review findings, and writes false-positive suppressions to
  methodology memory.
- **Reflexion / ExpeL-style debrief** — `reflexion_debrief` records run-attributed experiences.
  Stateless consolidation promotes only stable signatures reproduced in at least two distinct
  runs, and never pools evidence between agents.

:::{important}
**Learning is autonomous but evidence-gated.** A single run is an episode, not knowledge.
Candidates remain inert until corroborated by at least two distinct attributed runs. Promoted
outputs are limited to bounded parameters and non-executable methodology; code, prompts, tools,
permissions, and policy are outside the learning surface.
:::

### AEF-compatible learning contract

The loop adapts the safe reflection-and-memory architecture from the read-only `aef-core`
snapshot at commit `48ee1ef7cd9f2cc91762f4b4c08150d954d443ec`. The source checkout is not a
runtime dependency and was not modified. AEF's disabled runtime code-evolution path is deliberately
excluded. The imported contract contributes four controls: inert candidates, independent run
attribution, per-agent consolidation, and auditable promotion or rollback.

## Memory firewall: the immutable boundary

The one immutable boundary is the read-only enforcement system. Learning may write only
`memory/methodology/`; it may not modify the guard core, egress allowlist, cluster allowlist,
read-only role requirements, or anything under `guardrails/**`. The graph schema describes this
as a memory-write target, and `tools/graph/validate-graph.mjs` enforces structural and
referential integrity, including the memory firewall.

:::{note}
This is the framework's key differentiator from prompt-only agent safety. Typical agent graphs
often rely on instruction-following to stay safe; this framework shares a deterministic,
fail-closed read-only guard across engines. `guardrails/guard.mjs` is the platform-neutral entry
point, and its `READONLY_BANNER` tells every runtime that only read/query Azure commands are
permitted unless an explicitly gated, human-authorized lane applies.
:::

Unsafe runtime self-modification is intentionally excluded: no runtime code execution, no tool
creation, and no self-rewriting of the guard. Methodology memory can change how agents
investigate and critique; it cannot change what they are allowed to do.

## One graph, two engines

The same [`graph/redteam.graph.json`](../graph/redteam.graph.json) drives two execution models:

1. **Dependency-free Node runner** — `tools/graph/run-graph.mjs` executes the graph inside the
   GitHub Copilot CLI, Claude Code, OpenAI Codex CLI, and Cursor runtimes. The core stays
   zero-dependency and uses the durable JSONL checkpointer in `tools/orchestration/manifest.mjs`.
2. **First-class LangGraph target** — [`integrations/langgraph/`](../integrations/langgraph/)
   compiles the same JSON graph into a Python `StateGraph`, using LangGraph concepts such as
   `Send`, reducers, checkpointers, interrupts, and Store-style memory while reusing the same
   read-only guard through a subprocess bridge. Its dependencies are isolated from the Node core.

## Prior art and ecosystem

This architecture is inspired by:

- [LangGraph](https://github.com/langchain-ai/langgraph) for `StateGraph`, `Send`, reducers,
  checkpointers, interrupts, and Store-style memory.
- [Reflexion](https://arxiv.org/abs/2303.11366),
  [Self-Refine](https://arxiv.org/abs/2303.17651), Agent-as-a-Judge patterns,
  [ExpeL](https://arxiv.org/abs/2308.10144), and evaluator-optimizer loops for iterative
  improvement.
- The broader [awesome-LangGraph ecosystem](https://github.com/vonzosten/awesome-LangGraph) of
  graph-based agent systems.

The framework adapts those ideas to a red-team setting by keeping the learning surface narrow
and the enforcement surface deterministic, fail-closed, and shared by every runtime.
