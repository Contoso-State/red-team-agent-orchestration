# `tools/datastore/` — Engagement Datastore

Dependency-free SQLite datastore that gives the assessment a **cache** (stop re-querying Azure) and a
**canonical store** (one place to join findings, resources, identity edges, coverage), plus a
longitudinal history for **new / persisting / resolved / regressed** lifecycle.

Built on Node's built-in `node:sqlite` (Node 22.5+, we run v25) — **no npm install**. Import emits one
`ExperimentalWarning` to stderr; stdout stays clean. Use `NODE_NO_WARNINGS=1` for quiet output.

Canonical design doc: [`../../knowledge/datastore.md`](../../knowledge/datastore.md).

## Files

| File | Role |
|---|---|
| `db.mjs` | Core helpers + CLI (`init` / `info` / `migrate` / `query`). `query` is read-only-guarded. |
| `schema.sql` | Per-engagement DDL (resources, facts, relationships, findings, coverage, tasks, views). |
| `ingest.mjs` | **Files → DB. The single writer.** Auto-discovers a session's artifacts; one transaction; merges findings (union `affected_resources[]`). |
| `query.mjs` | Read-only cache API: `resources` / `facts` / `fresh` / `findings` / `coverage` / `neighbors` / `next-tasks` / `stats`. `fresh` exits `0` (fresh) or `3` (miss/stale). |
| `export.mjs` | DB → canonical artifacts (`findings.json`, `coverage.json`, inventory). |
| `history.schema.sql` | Longitudinal DDL (`runs`, `finding_history`, `resource_history`, lifecycle/trend views). |
| `promote.mjs` | Fold a finished run into the history DB, classify lifecycle, emit `delta.json`. |

## One run, end to end

```bash
DB=engagements/<session>/engagement.db
SESSION=engagements/<session>

# 1. create the DB
node tools/datastore/db.mjs init --db "$DB" --engagement <engagement-id>

# 2. ingest the session's artifacts (inventory, relationships, coverage, tasks, raw findings)
node tools/datastore/ingest.mjs --db "$DB" --session "$SESSION"

# 3. read back as a cache (no Azure call on a hit)
node tools/datastore/query.mjs facts     --db "$DB" --resource <resource-id>
node tools/datastore/query.mjs neighbors --db "$DB" --resource <resource-id>
node tools/datastore/query.mjs fresh      --db "$DB" --resource <resource-id> --key <fact-key> --ttl 3600

# 4. export the canonical findings/coverage/inventory the report consumes
node tools/datastore/export.mjs --db "$DB" --session "$SESSION" --what all

# 5. promote into history + emit the what-changed delta
node tools/datastore/promote.mjs --db "$DB" \
  --history engagements/_history/<engagement-id>.db \
  --out "$SESSION"/reports/delta.json
```

## Rules

- **`ingest.mjs` is the only writer.** Agents write raw JSONL/evidence to files; the orchestrator
  ingests. Agents read the DB concurrently but never write it.
- **Config only, never secrets** in `resource_facts`.
- **Every `*.db` is gitignored.** Never commit or push an engagement or history DB.
