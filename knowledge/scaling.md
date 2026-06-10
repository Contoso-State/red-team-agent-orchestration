# Scaling the Assessment to Large Azure Estates

A single subscription routinely holds **thousands of resources**; a tenant or management
group can hold tens of thousands — plus an identity graph (role assignments, principals,
groups) that can dwarf the resource count. This document is the **canonical source of
truth** for how the orchestrator, domain agents, schemas, tools, and report behave at that
scale. Agent prompts and tooling reference it; when in doubt, this file wins.

Two ideas carry most of the weight:

1. **Finding *class* vs. affected resource *instance*** — one misconfiguration replicated
   across N resources is **one finding**, not N. (See [Finding aggregation](#finding-aggregation).)
2. **Filter in Azure, not in the agent** — checks run as server-side Azure Resource Graph
   (ARG) queries that return only the *vulnerable* resources, never the whole estate. (See
   [ARG execution contract](#arg-execution-contract).)

Everything else (scope knobs, sampling, orchestration checkpoints, report rendering) exists
to keep those two principles true as the estate grows.

---

## The golden rules (read these first)

1. **ARG-first.** Every check is expressed as an ARG query that filters server-side with
   `where`/`project`/`summarize` and returns only vulnerable candidates. The on-disk
   inventory (`engagements/<session>/inventory/resources.jsonl`) is a *queryable index for
   tooling*, **never** prompt input. Agents must not `cat` the inventory into context.
2. **Aggregate by default.** Identical misconfigurations are collapsed into a single
   finding with an `affected_resources[]` list. One public-blob misconfig across 500
   storage accounts = **one** finding, count 500. (See aggregation rules below.)
3. **Census cheaply, sample expensively.** ARG checks assess the whole estate cheaply
   (server-side) → run them as a full census. Only *per-resource data-plane* checks (those
   that must call `az` once per resource) are subject to a sampling budget.
4. **Bound everything that fans out.** Any loop of per-resource `az` calls runs through the
   bounded fan-out helper (concurrency cap + 429 backoff + budget). No unbounded loops.
5. **Partition by subscription.** A subscription is the unit of work. The orchestrator fans
   out per-subscription shards and reduces their results. Multi-sub / management-group runs
   are fan-out, not a different code path.
6. **Checkpoint, don't restart.** Long runs persist per-task state so a failure resumes
   instead of re-querying from zero. A partial failure becomes a recorded *coverage gap*,
   never a silent omission or a full abort.

---

## Finding aggregation

### The model

Historically a finding was 1:1 with a `resource_id`. At scale that produces an unreadable
wall of duplicates and forces the agent to hold N near-identical objects in context. The
fix is to separate the **finding class** (the misconfiguration) from the **affected
instances** (the resources exhibiting it).

A finding therefore carries:

| Field | Meaning |
|---|---|
| `finding_class` | Stable identifier for the *kind* of misconfiguration, derived from the check, e.g. `storage-public-blob`. All instances of the same class on the same logical scope collapse into one finding. |
| `dedupe_key` | Deterministic key used to merge/resume without creating duplicates. Convention: `<finding_class>:<subscription_id>` (or `:<scope_hash>` for cross-cutting findings). Stable across re-runs and shards. |
| `resource_id` | **Representative** resource — the first/most-exposed affected instance. Kept for backward compatibility: every existing consumer that reads a single `resource_id` still works. |
| `affected_resources[]` | The full list of affected instances (objects, not strings — see below). `resource_id` MUST be the `resource_id` of one of these entries. |

Each `affected_resources[]` entry is a structured object so the report's asset table,
search, and graph can use it directly:

```json
{
  "resource_id": "/subscriptions/.../storageAccounts/sa1",
  "subscription_id": "00000000-0000-0000-0000-000000000000",
  "resource_group": "rg-data",
  "type": "microsoft.storage/storageaccounts",
  "region": "eastus",
  "name": "sa1"
}
```

A finding with a single affected resource simply has a one-element `affected_resources[]`
whose entry matches `resource_id`. **Aggregation is always on**; a "single" finding is just
the N=1 case. This keeps one code path for one and for many.

### Strict aggregation rules — only collapse *homogeneous* findings

Aggregation is a readability win **only** when the collapsed instances are genuinely the
same issue with the same fix. Do **not** aggregate across a boundary where the per-resource
detail matters. Two resources belong to the same finding **only if all** of these match:

- **Same `finding_class` / check** — the same misconfiguration.
- **Same severity and confidence** — if the same misconfig is Critical on an
  internet-facing instance but Low on an isolated one, those are two findings.
- **Same remediation** — if the fix differs per resource (different owner, different
  control to toggle), keep them separate.
- **Same attack-path role** — a resource that is a *step in a specific compromise chain*
  must stay individually addressable (see [Attack paths at scale](#attack-paths-at-scale));
  do not bury it inside a 500-instance rollup.
- **Same logical scope** — by default, aggregate **within a subscription**. Do not merge
  across subscriptions when ownership or remediation differs (the common case). Cross-sub
  aggregation is allowed only for genuinely tenant-wide findings (e.g. an identity/tenant
  policy gap) and must use a `scope_hash` `dedupe_key`.

When in doubt, **split**. A slightly longer findings list is recoverable; a wrongly merged
finding that hides a Critical exploitable instance inside a "Low, 500 affected" rollup is a
real miss.

### Evidence under aggregation

- Keep evidence proportional: a representative-sample of evidence items (e.g. the 3 most
  exposed instances) plus a count, not one evidence block per resource.
- The full instance list lives in `affected_resources[]`, not in `evidence[]`.
- Never include secret values, regardless of count.

---

## ARG execution contract

ARG is the scale engine, but it is **server-side bounded, not "scale-invariant."** Checks
can still truncate, time out, or undercount. Every check author and the central ARG runner
must honor the following. (All limits below are from Azure Resource Graph product docs —
[working with large data sets][argdata] and [throttling guidance][argthrottle] — and are
subject to change by the service.)

[argdata]: https://learn.microsoft.com/azure/governance/resource-graph/concepts/work-with-data
[argthrottle]: https://learn.microsoft.com/azure/governance/resource-graph/concepts/guidance-for-throttled-requests

### Result-size + paging

- **Default and max page size is 1,000 rows.** `--first` cannot exceed 1,000. A check that
  can return **more than 1,000 vulnerable rows must page** — this is not just an inventory
  concern, it applies to *checks* too.
- **Page with `--first`/`--skip` (CLI) or `$skipToken` (REST/SDK).** Each page costs one
  query against your quota. Continue while the response is truncated (`resultTruncated` is
  `true`, or `count < totalRecords`, or a `$skipToken` is present).
- **Paging requires deterministic ordering.** Any paged query MUST end with an
  `| order by <stable column> asc` (e.g. `order by id asc`). Without it, pages overlap or
  drop rows non-deterministically.
- **`limit` / `take` / `sample` defeat paging.** When a query uses these, ARG returns
  `resultTruncated=true` with **no** `$skipToken` — you cannot page past them. Likewise if
  *all* projected columns are `dynamic` or `null` typed. Don't use `take`/`limit` in a check
  that needs completeness; use it only for deliberate sampling.
- **CSV export (Portal) caps at 55,000 rows** — irrelevant to automated checks but a trap
  if anyone exports manually.

### Query shape hazards

- **`mv-expand` multiplies rows.** Expanding an array (NSG `securityRules`, VNet `subnets`,
  role `permissions`, `diagnosticSettings`) emits one row per element. An NSG with 60 rules
  becomes 60 rows; across many NSGs this blows past the 1,000-row cap and silently truncates
  the check. **Pre-filter and `project` to the minimum columns *before* `mv-expand` where
  possible, and always page mv-expand checks.** Treat any `mv-expand` check as
  "potentially >1,000 rows."
- **30-second query timeout** (aligned with Azure Resource Manager). If a check times out:
  narrow the scope (fewer subscriptions per call) or simplify the query. Keep `join` left
  sides small.
- **`join` / `union` are limited** in flavor and size. Prefer `where id in~ (...)` lookups
  over large joins; keep the left/outer side as small as possible.

### Throttling

- **Quota is ~15 queries per 5-second window per user** (default; service-determined,
  subject to change). The 14-agent fan-out can exhaust this quickly.
- **Respect the response headers:** `x-ms-user-quota-remaining` (queries left in window) and
  `x-ms-user-quota-resets-after` (`hh:mm:ss` until reset). When remaining hits 0, wait
  `resets-after` (add jitter when parallel) before the next call. This is **ARG-layer**
  throttling (`RateLimiting` error code); distinguish it from **ARM** throttling (a hard
  limit that can't be raised).
- **Group, don't parallelize.** One query over many subscriptions/resource-IDs is cheaper
  than many small queries. Group subscription IDs (group size **< 300**, ~100 recommended)
  and use `where id in~ ({idGroup})` for batched per-resource lookups. Stagger bursts across
  5-second windows rather than firing them all at once.

### Scope caps

- **Management-group / tenant scope returns only the first 10,000 subscriptions**; the
  `x-ms-tenant-subscription-limit-hit` header flags this. For very large tenants, shard the
  subscription list yourself rather than relying on a single MG-scoped query.

### Check authoring checklist (ARG)

Every ARG-backed check declares, in its metadata:

- `max_cardinality`: can this return >1,000 rows? If yes → paging required.
- `pagination`: `single-page` | `paged` (paged checks MUST have a deterministic `order by`).
- `uses_mv_expand`: true/false (if true, treat as paged and pre-filter).
- `scope`: subscription | management-group (MG checks acknowledge the 10k cap).

The central ARG runner enforces: deterministic ordering on paged queries, skip-token/`--skip`
paging loops, header-aware backoff, and grouped subscription batching.

---

## Per-resource (data-plane) checks

Some checks cannot be pure ARG — they need a control-plane or data-plane `az` call per
resource (Defender plan state, Key Vault network/access model, storage data-plane settings,
per-resource `diagnosticSettings` not in ARG). These are the expensive tail and are the
**only** thing subject to sampling.

Rules:

- Run through the **bounded fan-out helper**: a fixed concurrency cap, exponential backoff
  on HTTP 429 / ARM throttling, and a hard call budget (`scale.max_resource_calls`).
- **Prioritize by exposure.** Within any budget, assess the highest-risk candidates first —
  resources that ARG already flagged as internet-facing, publicly reachable, privileged, or
  prod-tagged. ARG narrows the candidate set; the fan-out helper only iterates that narrowed,
  ranked set, not the whole type.
- **Sample the long tail, record the sample.** When candidates exceed
  `scale.sample_per_type`, assess a ranked sample and record in the coverage matrix that the
  remainder was `sampled` (not `assessed`). Sampling is a documented coverage decision, never
  a silent gap.
- **Log Analytics queries are their own class** — they have workspace scope, time windows,
  data-volume, and cost characteristics unlike ARG/ARM. Budget and rate them separately; do
  not fold them into the ARG quota model.

---

## Identity / RBAC at scale

Role assignments, role definitions, app registrations, service principals, groups, and PIM
state can outnumber Azure resources, and many of them are **not** in the ARG `Resources`
table — they live in `AuthorizationResources` (role assignments/definitions) or behind
Microsoft Graph, which has its **own** throttling regime separate from ARG.

- Query role assignments via `AuthorizationResources` in ARG where possible (server-side,
  paged) rather than enumerating per scope.
- Treat role assignments as **graph edges, not findings** — a finding is "this principal has
  this excessive/standing privilege," correlated by the attack-path agent, not one finding
  per assignment row.
- **Cache principal metadata by object ID.** Resolve a principal (user/SP/group) once and
  reuse it; do not re-query Graph for every assignment.
- **Bound transitive group expansion.** Nested groups can explode; cap expansion depth and
  record where the cap was hit.
- Account for **inherited assignments** (MG → sub → RG → resource) so the same effective
  grant isn't reported once per inherited scope.

### How to run it at scale

1. **Census the assignments + definitions in ARG, paged.** `AuthorizationResources` holds
   both `microsoft.authorization/roleassignments` and `.../roledefinitions`; page it
   (`--first 1000 --skip`, deterministic `order by`) exactly like `Resources`. One paged
   query per subscription beats per-scope enumeration. (See `tools/resource-graph/queries.md`.)
2. **Resolve principals once, into a cache.** Collect the distinct `principalId`s, resolve
   them in **batched** Microsoft Graph `getByIds` calls (≤ ~1,000 ids/call), and persist
   `engagements/<session>/inventory/principals.json` keyed by object ID
   (`{ type, displayName, upn, appId }`). Every downstream lookup reads the cache — never
   re-query Graph per assignment. Graph has its **own** throttling regime: run those batched
   calls through `Invoke-BoundedFanout.ps1` too.
3. **Join definitions locally.** Resolve `roleDefinitionId → roleName/actions` from the
   definitions census in memory; don't call `az role definition show` per assignment.
4. **Collapse inherited scope.** Key an effective grant by
   `(principalId, roleDefinitionId, normalized_scope)` and keep the **broadest** scope only —
   an Owner grant at the subscription should not also surface at every child RG/resource.
   Record the inheritance depth, not N duplicate rows.
5. **Bound group expansion.** When expanding a group assignment to members, cap depth
   (recommend **2**) and member count; beyond the cap, record the group as
   `expansion-capped` in coverage rather than enumerating thousands of transitive members.
6. **Emit privilege findings, aggregated.** "Standing Owner/UAA at high scope," "custom role
   with `roleAssignments/write`," etc. are **finding classes** with the offending principals
   as `affected_resources[]` (the principal/assignment id is the instance) — not one finding
   per principal. The raw assignment graph stays a machine artifact for the attack-path agent.

---

## Attack paths at scale

Naive correlation over thousands of resources can generate millions of theoretical paths.
The graph must be pruned to stay useful and renderable.

- **Nodes reference both a `finding_id` and a concrete `resource_id`.** Because findings are
  now aggregated, a path node must name the *specific* affected instance it traverses, and
  that `resource_id` MUST exist in the referenced finding's `affected_resources[]`. This
  keeps path correlation precise even though the finding is a rollup.
- **Prune to top-K per end state.** Keep the highest-scoring paths per crown-jewel / end
  state (by exploitability × impact); collapse structurally-equivalent paths into a pattern
  with a count rather than listing every permutation. Recommend **K = 10** rendered paths per
  end state.
- **Collapse equivalent patterns.** Paths that differ only by which instance of an aggregated
  finding they traverse (e.g. 1 of 500 public storage accounts) are **one pattern** with an
  instance count — not 500 paths. Pattern key: the ordered sequence of `finding_class` nodes.
- **Separate the machine graph from the rendered report.** Persist the full graph model
  (`engagements/<session>/findings/attack-graph.json` — every node/edge, for analysis and
  resume) but render only the pruned top-K set in `attack-paths.json`. The HTML report reads
  the pruned set and already falls back to a node table when the graph is large.
- **Bound correlation work.** Score and prune *as you correlate* — never materialize the full
  cartesian product of findings. Start from crown-jewel end states and walk backwards through
  the finding graph, keeping only the top-K frontier at each step.

---

## Engagement scope + scale knobs

Scope the work *before* it runs. `engagement.yaml` (schema:
`schemas/engagement.schema.json`) supports, in addition to subscriptions/RGs/exclusions:

- `scope.resource_types` — restrict to specific ARM types (e.g. just storage + SQL + network)
  to assess a slice of a huge estate first.
- `scope.domains` — restrict which domain agents run (e.g. identity + data + public exposure),
  deferring the long tail.
- `scale.sample_per_type` — max per-resource data-plane calls per resource type before
  sampling kicks in.
- `scale.max_resource_calls` — hard ceiling on per-resource `az` calls for the whole run.
- `scale.time_budget_min` — soft wall-clock budget; the orchestrator stops dispatching new
  expensive work past it and records coverage gaps.
- `scale.prioritize_exposed` — when true (default), rank candidates by exposure so the most
  important resources are assessed first within any budget.
- `scale.concurrency` — max concurrent per-resource `az` calls in the bounded fan-out helper.
  Keep low enough to stay under ARM/ARG throttling across all fanned-out agents.
- `scale.max_arg_pages` — safety cap on the number of 1,000-row ARG pages a single paged check
  fetches before the result is recorded as `partial` (guards against a runaway check).

Defaults are chosen so a **single subscription with thousands of resources** runs a full ARG
census with a bounded data-plane tail out of the box.

---

## Orchestration at scale

The coordination state itself becomes the bottleneck across 14 agents × N subscriptions ×
M checks, so it must be durable, not implicit in chat context.

- **Durable task manifest:** `engagements/<session>/runs/tasks.jsonl`, one record per task
  keyed by `(agent, subscription, check_id, scope_hash)`, with a `status`
  (`pending`/`running`/`done`/`failed`/`throttled`/`partial`/`skipped`) and output refs.
  Managed by `tools/orchestration/manifest.mjs` (`init`/`add-plan`/`next`/`set-status`/`reduce`).
- **Resume from the manifest** — re-running an engagement skips `done` tasks and retries
  `failed`/`throttled` ones (`manifest.mjs next` returns exactly the work still owed).
  `dedupe_key` on findings makes the merge idempotent.
- **Per-task write paths.** Each task writes its own
  `findings/raw/<agent>/<subscription>/<check>.jsonl`; a deterministic reduce step merges
  them. Never have parallel workers append to a single shared `<agent>.jsonl` (interleaved /
  corrupt writes).
- **Per-agent reduce summaries.** The orchestrator reads each agent's *reduced summary*, not
  its raw per-resource findings, to stay within context.
- **Budgets + partial failure.** Enforce `scale.*` budgets; a task that fails or is skipped
  for budget/permission reasons becomes a recorded **coverage gap**, never a silent omission
  or a whole-run abort.

---

## Coverage accounting

A partial or sampled run must be honest about what it did and didn't assess. Emit a
machine-readable coverage matrix keyed by domain × check × subscription × resource type
(schema: `schemas/coverage.schema.json`), with each cell in one of: `assessed`,
`skipped-by-scope`, `skipped-by-budget`, `failed`, `permission-denied`, `sampled`,
`partial`. `tools/orchestration/coverage.mjs` reduces the per-task coverage records into
`coverage.json` + `coverage.md` (a status rollup, `assessed_pct`, and a gaps table). The
report surfaces this so a reader never mistakes "not assessed" for "no findings."

**Task status → coverage status.** The manifest tracks the *task lifecycle*; coverage records
the *outcome*. Map them when a task finishes: `done` → one or more `assessed`/`sampled` cells;
`partial` → `partial` (+ `sampled` for the part that ran); `skipped` → `skipped-by-scope` or
`skipped-by-budget` (use the task `reason`); `failed`/`throttled` (after retries exhausted) →
`failed` or `permission-denied`. `tools/powershell/Invoke-BoundedFanout.ps1` already emits
coverage records directly for the per-resource tail.

---

## Preflight cost / time estimate

Before a large run, estimate and surface: number of ARG queries, expected pages per check,
the per-resource data-plane call budget, and projected runtime at the configured
concurrency — so an operator knows whether a run is ~10 minutes or several hours, and can
narrow scope first. `tools/orchestration/estimate-cost.mjs --scope-brief scope-brief.json
[--engagement engagement.yaml]` produces this projection (human summary + optional
`--out estimate.json`) straight from the scope brief, honoring `scale.*` caps.

---

## Tooling reference

The concepts above map to concrete, dependency-light tools in this repo:

| Concept | Tool |
|---|---|
| Inventory census (paged ARG) | `tools/powershell/Export-Inventory.ps1` → `inventory/resources.json` + `summary.json` |
| Scope brief (reduce summary the agents read instead of raw inventory) | `tools/resource-graph/scope-brief.mjs --inventory inventory/resources.json` → `scope-brief.json` + `scope-brief.md` |
| Single-line KQL for `az graph query -q` | `tools/resource-graph/flatten-kql.mjs` |
| Canonical ARG checks + `summarize` rollups | `tools/resource-graph/queries.md` |
| Bounded, exposure-ranked, sampled per-resource fan-out | `tools/powershell/Invoke-BoundedFanout.ps1` (concurrency cap + 429 backoff + `scale.*` budgets; emits a coverage record per candidate) |
| Preflight cost / time estimate | `tools/orchestration/estimate-cost.mjs --scope-brief scope-brief.json` → ARG queries, pages, per-resource budget, projected runtime |
| Durable task manifest (plan / dispatch / resume / reduce) | `tools/orchestration/manifest.mjs` over `engagements/<session>/runs/tasks.jsonl` (schema `schemas/task.schema.json`) |
| Coverage matrix (honest gaps) | `tools/orchestration/coverage.mjs --from <records>` → `coverage.json` + `coverage.md` (schema `schemas/coverage.schema.json`) |
| Aggregated-finding + attack-path validation | `tools/validate-findings.mjs` |
| Findings-driven report (renders `affected_resources[]`) | `tools/report/generate-report.mjs` (`--inventory-summary summary.json` for the cover) |

The **scope brief is the Inventory & Scope agent's primary downstream output**: the
orchestrator and domain agents read it (a small rollup) to decide where to look, and run
their own server-side ARG checks — they never load `resources.jsonl` into context.

---

## What already scales (don't "fix" these)

- **ARG checks** filter server-side and return only vulnerable candidates.
- **Inventory enumeration** (`tools/powershell/Export-Inventory.ps1`) already pages ARG
  (`--first 1000 --skip`) and writes a `summary.json` type rollup.
- **The report** (`tools/report/generate-report.mjs`) is findings-driven — it never ingests
  the full inventory, so its cost tracks the (now-aggregated) findings, not the resource
  count, and the graph already falls back to a node table when large.

Keep these; harden them per the rules above (page checks, not just inventory; render
`affected_resources[]`).
