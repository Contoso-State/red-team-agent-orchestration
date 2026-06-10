---
title: Engagement Datastore
description: The SQLite-backed datastore that caches Azure config, joins findings across domains, and tracks what changed between runs.
---

# Engagement Datastore

Behind every run is a **local SQLite database** that turns the assessment from a pile of
one-shot `az` / Resource Graph queries into a queryable, incremental system. Inventory,
resource configuration, relationships, findings, and coverage are loaded **once** and read
back from the database — so agents look things up instead of re-hitting Azure, attack-path
reasoning becomes a SQL join, and the report can say exactly **what changed** since last time.

:::{important}
The datastore holds target **configuration and findings**, so every database file is
**gitignored** and must never be committed. It stores config only (SKU, TLS version, public-access
flags, firewall rules) — **never** secrets, keys, or connection strings. See [Safety &
Authorization](safety.md).
:::

## Why a database

- **Stop re-querying Azure.** A domain agent that needs "the network config of this VM" or
  "who can write to this storage account" does a point lookup instead of another slow,
  rate-limited, non-deterministic `az` round-trip.
- **Join across domains.** Findings, resources, identity edges, and coverage live in one place,
  so attack-path reasoning — *public IP → NSG any-any → VM with a managed identity that has
  Owner* — is a single query, not N files glued together in a prompt.
- **Cross-run lifecycle.** With history, every finding is classified **new / persisting /
  resolved / regressed** and severity is trended over time — the thing leadership actually asks
  for.
- **Built for scale.** On estates with thousands of resources, the database (not the prompt) is
  the working set. Agents query an index instead of reading raw inventory into context — the
  core technique in [Scaling to Large Azure Estates](https://github.com/Contoso-State/red-team-agent-orchestration/blob/main/knowledge/scaling.md).
- **Dependency-free & portable.** Node v22.5+ (we run v25) ships `node:sqlite` built in, so there
  is **no npm dependency** — consistent with the repo's `.mjs`-only convention. The result is a
  single file you can open with any SQLite client, diff between runs, and delete to reset. No
  server, no daemon.

This is deliberately **not** a hosted database. The unit of work is one engagement; a
per-engagement file matches the blast radius, the retention story, and the gitignore boundary.

## What it stores

Two databases, both gitignored, both living under `engagements/`:

### `engagements/<session>/engagement.db` — per-run store + cache

Schema: `tools/datastore/schema.sql`. Core tables:

| Table | Holds |
|---|---|
| `meta` | engagement id, tool version, created-at, schema version |
| `subscriptions` | subscription metadata in scope |
| `resources` | one row per Azure resource (id, type, name, rg, location, subscription) |
| `resource_facts` | per-resource **configuration** facts (key/value/json) with a `collected_at` timestamp for freshness — config only, **never secrets** |
| `relationships` | typed edges between resources — the graph attack-path reasoning walks |
| `findings` | deduplicated finding classes (by `dedupe_key`, fallback `id`) |
| `affected_resources` | the instance list unioned onto each finding |
| `evidence`, `findings_controls`, `attack_paths`, `attack_path_steps` | sanitized evidence, control mappings, attack chains |
| `coverage` | per-check coverage (assessed / skipped / failed / permission-denied / sampled / partial) — the honest-gaps ledger |
| `tasks` | durable task-manifest state (pending / running / done / failed / …) for resume |

### `engagements/_history/<engagement.id>.db` — longitudinal store

Schema: `tools/datastore/history.schema.sql`. Tables `runs`, `finding_history`,
`resource_history`; views `v_finding_lifecycle` (latest state per finding identity) and
`v_trend_by_severity`. This is where **new / persisting / resolved / regressed** lives.

## Cache-on-read

The datastore is a **read-through cache** in front of Azure, not a second crawler:

```{mermaid}
graph LR
    Census[Inventory & Scope<br/>paged ARG census] -->|ingest once| DB[(engagement.db)]
    Agent[Domain agent] -->|1. query facts| DB
    DB -->|hit: fresh| Agent
    DB -.->|miss / stale exit 3| AZ[Targeted az / ARG check]
    AZ -->|2. ingest result| DB
```

1. **Inventory & Scope** runs the paged census once and **ingests** it into the database.
2. A domain agent asks the database first
   (`query.mjs facts --resource <id>`); the `fresh` subcommand is a freshness probe that
   **exits 0** on a fresh hit and **exits 3** on a miss or stale entry.
3. **On a hit**, the agent uses the cached config and does **not** call Azure.
4. **On a miss/stale**, the agent runs the targeted check, then the result is ingested so the
   next reader hits the cache.

Every `resource_facts` row carries `collected_at`; a fact older than the engagement's TTL is
treated as a miss and re-collected.

## Single-writer model

To avoid write contention under the orchestrator's parallel fan-out:

- **`ingest.mjs` is the only writer.** Domain agents write their own raw artifacts
  (`findings/raw/<agent>.jsonl`, evidence, coverage) to files; the orchestrator ingests them.
  Agents **read** the database freely (concurrent readers are fine) but never write it directly.
- **Writes run in one transaction**, so an ingest either fully applies or rolls back — no
  half-loaded run.
- **Finding merge is deterministic:** match by `dedupe_key` (fallback `id`), union
  `affected_resources[]`, first-write-wins on everything else. Re-ingesting the same file is
  idempotent.
- **The read API is read-only-guarded** — it refuses anything but `SELECT` / `EXPLAIN` /
  `PRAGMA`, so reads can't accidentally mutate state.

## Cross-run lifecycle

`promote.mjs` is the **last** step of a run: it folds the finished run into the history database
and classifies every finding against its prior state — **new**, **persisting**, **regressed**
(was resolved, now back), or **resolved** (was active, absent this run). It emits a
**`reports/delta.json`** that the report's executive summary leads with ("What changed"). The
first run has no prior, so everything is new. See [Reporting](reporting.md).

## The toolbelt

All under `tools/datastore/`, dependency-free Node ESM:

| Tool | Role |
|---|---|
| `db.mjs` | core helpers + CLI (`init` / `info` / `migrate` / `query`); read-only-guarded `query` |
| `ingest.mjs` | files → DB (the single writer); auto-discovers resources, relationships, coverage, tasks, findings |
| `query.mjs` | read-only cache API: `resources` / `facts` / `fresh` / `findings` / `coverage` / `neighbors` / `next-tasks` / `stats` |
| `export.mjs` | DB → canonical `findings.json` artifacts |
| `promote.mjs` | run → history + lifecycle; emits `delta.json` |

```text
init      node tools/datastore/db.mjs   init    --db engagements/<session>/engagement.db --engagement <id>
ingest    node tools/datastore/ingest.mjs       --db engagements/<session>/engagement.db --session engagements/<session>
query     node tools/datastore/query.mjs facts  --db engagements/<session>/engagement.db --resource <id>
export    node tools/datastore/export.mjs       --db engagements/<session>/engagement.db --session engagements/<session> --what all
promote   node tools/datastore/promote.mjs      --db engagements/<session>/engagement.db --history engagements/_history/<id>.db --out engagements/<session>/reports/delta.json
```

:::{tip}
`node:sqlite` prints one `ExperimentalWarning` on import; tool **stdout stays clean**. Set
`NODE_NO_WARNINGS=1` for quiet output.
:::

## Safety & git

- **Every `*.db` is gitignored**, along with the whole `engagements/` tree. The per-session
  `engagement.db` and the `_history/*.db` files hold target configuration and findings and **must
  never be committed.** Only the tooling, schemas, and docs are committable.
- **Config only, never secrets** — the same redaction that governs evidence governs what may be
  cached.
- **Deletable = resettable** — remove `engagement.db` to reset a run's cache, or the history DB to
  reset longitudinal state. Nothing outside `engagements/` is affected.
