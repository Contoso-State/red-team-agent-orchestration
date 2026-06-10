# The Engagement Datastore

This is the **canonical source of truth** for the SQLite-backed engagement datastore: why it
exists, what it stores, how agents use it as a cache, how cross-run history works, and the safety
rules that keep target data out of git. Agent prompts and tooling reference this file; when in doubt,
this file wins.

The datastore turns the assessment from a pile of one-shot `az`/ARG queries into a queryable,
incremental system. One run gets one `engagement.db`; every run also folds into a longitudinal
`_history/<engagement.id>.db` so the report can say what changed.

---

## Why SQLite

- **Stop re-querying Azure.** Inventory, resource configuration facts, relationships, coverage, and
  tasks are loaded once and read back from the DB. A domain agent that needs "the network config of
  this VM" or "who can write to this storage account" does a point lookup instead of another `az`
  round-trip (which is slow, rate-limited, and non-deterministic).
- **Join across domains.** Findings, resources, identity edges, and coverage live in one place, so
  attack-path reasoning ("public IP → NSG any-any → VM with a managed identity that has Owner") is a
  SQL join, not N files glued together in a prompt.
- **Cross-run lifecycle.** With history we can classify every finding as **new / persisting /
  resolved / regressed** and trend severity over time — the thing leadership actually asks for.
- **Dependency-free.** Node **v22.5+** (we run v25) ships `node:sqlite` built in
  (`import { DatabaseSync } from 'node:sqlite'`), so there is **no npm dependency** — consistent with
  the repo's dependency-light, `.mjs`-only convention. (It prints one `ExperimentalWarning` to
  stderr on import; tool stdout stays clean. Use `NODE_NO_WARNINGS=1` for quiet output.)
- **Portable + inspectable.** A single file you can open with any SQLite client, diff between runs,
  and delete to reset. No server, no daemon.

This is deliberately **not** a hosted database. The unit of work is one engagement; a per-engagement
file matches the blast radius, the retention story, and the gitignore boundary.

---

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
| `relationships` | typed edges between resources (PK `src_resource_id, dst_resource_id, edge_type`) — the graph attack-path reasoning walks |
| `findings` | deduplicated finding classes (by `dedupe_key`, fallback `id`) |
| `affected_resources` | the instance list unioned onto each finding |
| `evidence`, `findings_controls`, `attack_paths`, `attack_path_steps` | sanitized evidence, control mappings, and attack chains |
| `coverage` | per-check coverage records (assessed / skipped-by-scope / skipped-by-budget / failed / permission-denied / sampled / partial) — the honest-gaps ledger |
| `tasks` | durable task manifest state (pending / running / done / failed / throttled / partial / skipped) for resume |

Views: `v_findings_summary`, `v_severity_rollup`.

### `engagements/_history/<engagement.id>.db` — longitudinal store

Schema: `tools/datastore/history.schema.sql`. Tables `runs`, `finding_history`
(PK `identity_key, run_id`), `resource_history`; views `v_finding_lifecycle` (latest state per
finding identity) and `v_trend_by_severity`. This is where new/persisting/resolved/regressed lives.

---

## Cache-on-read (the core pattern)

The datastore is a **read-through cache** in front of Azure, not a second crawler:

1. **Inventory & Scope** runs the paged ARG census once and **ingests** it
   (`tools/datastore/ingest.mjs`) into `resources` / `resource_facts` / `relationships`.
2. A **domain agent** that needs a resource's config asks the DB first:
   `node tools/datastore/query.mjs facts --db <db> --resource <id>` (or `resources`, `neighbors`).
   The `fresh` subcommand is a freshness probe — it **exits 0** when the cached fact is within the
   TTL and **exits 3** on a miss or stale entry.
3. **On a cache hit** the agent uses the cached config and does **not** call Azure.
4. **On a miss/stale** (exit 3) the agent runs the targeted `az`/ARG check, then the result is
   ingested so the next reader hits the cache.

This keeps the expensive, rate-limited, non-deterministic calls to a minimum while the raw inventory
stays **out of the prompt** — agents query the index, they never `cat` `resources.jsonl` into context
(see `knowledge/scaling.md`).

**Freshness:** every `resource_facts` row carries `collected_at`. The TTL is an engagement choice; a
fact older than the TTL is treated as a miss and re-collected. Findings and coverage are run-scoped
and not TTL'd within a run.

---

## Single-writer model

To avoid SQLite write contention under the orchestrator's parallel fan-out:

- **`ingest.mjs` is the only writer.** Domain agents write their own raw artifacts
  (`findings/raw/<agent>.jsonl`, evidence, coverage records) to files; the orchestrator ingests them.
  Agents **read** the DB freely (concurrent readers are fine) but never write it directly.
- **Writes run in one transaction** (`tx()` in `db.mjs`) so an ingest either fully applies or rolls
  back — no half-loaded run.
- **Finding merge is deterministic** and mirrors `tools/orchestration/manifest.mjs reduce`: match by
  `dedupe_key` (fallback `id`), **union `affected_resources[]` only**, all other fields first-write
  wins, `last_seen = max`. Re-ingesting the same file is idempotent.
- **`db.mjs query` is read-only-guarded** — it refuses anything but `SELECT`/`EXPLAIN`/`PRAGMA`
  reads, so the read API can't accidentally mutate state.

---

## Cross-run lifecycle (history)

`tools/datastore/promote.mjs` folds a finished run into the history DB and classifies every finding:

- **identity_key** = `(dedupe_key || finding_id)::(subscription_id || '')` — stable across runs.
- It reads each identity's **prior** state from `v_finding_lifecycle` *before* inserting the current
  run, then classifies:
  - **new** — not seen in any prior run.
  - **persisting** — active last run, still present.
  - **regressed** — was `resolved`, now present again.
  - **resolved** — was active, **absent** this run (inserted with lifecycle `resolved`,
    `resolved_at = now`).
- It records resource/config hashes per run and emits a **`reports/delta.json`** the report's
  executive summary leads with ("What changed"). The first run has no prior, so everything is new.

Promote is the **last** step of a run, after export. It is the only thing that writes the history DB.

---

## The toolbelt

All under `tools/datastore/`, dependency-free Node ESM:

| Tool | Role | Notes |
|---|---|---|
| `db.mjs` | core helpers + CLI (`init` / `info` / `migrate` / `query`) | `openDb`, `applySchema`, `tx`, `initDb`, `migrate`; read-only-guarded `query` |
| `ingest.mjs` | files → DB (the single writer) | `--db <db> --session <dir>` auto-discovers resources/subscriptions/relationships/coverage/tasks/findings; one transaction |
| `query.mjs` | read-only cache API | `resources` / `facts` / `fresh` / `findings` / `coverage` / `neighbors` / `next-tasks` / `stats`; `fresh` exits 0 fresh, 3 miss/stale |
| `export.mjs` | DB → canonical artifacts | `--what all\|findings\|coverage\|resources`; writes `findings/normalized/findings.json` **and** `reports/findings.json` |
| `promote.mjs` | run → history + lifecycle | `--db <db> --history <hist.db> [--out delta.json]`; writes runs/finding_history, emits delta |

`schema.sql` and `history.schema.sql` are the DDL. `CURRENT_SCHEMA_VERSION` in `db.mjs` gates
migrations.

### Lifecycle in one run

```
init      node tools/datastore/db.mjs init --db engagements/<session>/engagement.db --engagement <id>
ingest    node tools/datastore/ingest.mjs --db engagements/<session>/engagement.db --session engagements/<session>
query     node tools/datastore/query.mjs facts --db engagements/<session>/engagement.db --resource <id>
export    node tools/datastore/export.mjs --db engagements/<session>/engagement.db --session engagements/<session> --what all
promote   node tools/datastore/promote.mjs --db engagements/<session>/engagement.db --history engagements/_history/<id>.db --out engagements/<session>/reports/delta.json
```

---

## Safety & git

- **Every `*.db` is gitignored**, along with the whole `engagements/` tree (`.gitignore` blocks
  `*.db*`). The per-session `engagement.db` and the `_history/*.db` files hold target configuration
  and findings and **must never be committed or pushed.** Only the tooling, schemas, and this doc are
  committable.
- **Config only, never secrets.** `resource_facts` stores configuration (SKU, TLS version, public
  access flag, firewall rules) — never key material, connection strings, or token values. The same
  `data_handling` redaction that governs evidence governs what may be cached.
- **Deletable = resettable.** Removing `engagement.db` resets the run's cache; removing the history
  DB resets longitudinal state. Nothing outside `engagements/` is affected.
