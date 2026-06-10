-- schema.sql — engagement datastore (one SQLite DB per assessment run).
--
-- This is the source of truth for a single run: normalized inventory, per-resource
-- configuration facts, relationships, findings (+ affected instances, evidence,
-- control mappings), attack paths, coverage, and durable task state. Existing
-- JSON/JSONL artifacts are EXPORTS from this DB (see tools/datastore/export.mjs).
--
-- Conventions:
--   * raw_json columns preserve the full upstream object losslessly (queried via JSON1).
--   * Every table carries provenance (source / collected_at) where it makes sense.
--   * NEVER store secret values. Evidence keeps a reference into evidence/raw/ only.
--   * Applied idempotently: every object uses IF NOT EXISTS so re-applying is a no-op.

PRAGMA foreign_keys = ON;

-- Key/value metadata: schema_version, engagement_id, tool_version, created_at, ...
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- In-scope subscriptions enumerated for this engagement.
CREATE TABLE IF NOT EXISTS subscriptions (
  subscription_id TEXT PRIMARY KEY,
  name            TEXT,
  state           TEXT,
  collected_at    TEXT
);

-- Canonical resource inventory (ARG census). raw_json is the full ARG row.
CREATE TABLE IF NOT EXISTS resources (
  resource_id     TEXT PRIMARY KEY,
  name            TEXT,
  type            TEXT,
  resource_group  TEXT,
  subscription_id TEXT,
  location        TEXT,
  kind            TEXT,
  tags_json       TEXT,
  raw_json        TEXT,
  collected_at    TEXT,
  etl_run_id      TEXT
);
CREATE INDEX IF NOT EXISTS idx_resources_type    ON resources(type);
CREATE INDEX IF NOT EXISTS idx_resources_sub     ON resources(subscription_id);
CREATE INDEX IF NOT EXISTS idx_resources_rg      ON resources(resource_group);

-- Deep per-resource configuration gathered by sample-stage `az` calls, cached so
-- agents don't re-fetch (the "configuration data" store). fact_value_json is JSON.
CREATE TABLE IF NOT EXISTS resource_facts (
  resource_id     TEXT NOT NULL,
  fact_key        TEXT NOT NULL,
  fact_value_json TEXT,
  source          TEXT,
  collected_at    TEXT,
  PRIMARY KEY (resource_id, fact_key)
);
CREATE INDEX IF NOT EXISTS idx_facts_key ON resource_facts(fact_key);

-- Graph edges for attack-path correlation (VM->NIC->PublicIP, principal->role->scope).
CREATE TABLE IF NOT EXISTS relationships (
  src_resource_id TEXT NOT NULL,
  dst_resource_id TEXT NOT NULL,
  edge_type       TEXT NOT NULL,
  props_json      TEXT,
  collected_at    TEXT,
  PRIMARY KEY (src_resource_id, dst_resource_id, edge_type)
);
CREATE INDEX IF NOT EXISTS idx_rel_src  ON relationships(src_resource_id);
CREATE INDEX IF NOT EXISTS idx_rel_dst  ON relationships(dst_resource_id);
CREATE INDEX IF NOT EXISTS idx_rel_type ON relationships(edge_type);

-- Findings. raw_json keeps the full schemas/finding.schema.json object for lossless
-- export; the columns are the hot query paths. dedupe_key drives aggregation/merge.
CREATE TABLE IF NOT EXISTS findings (
  finding_id      TEXT PRIMARY KEY,           -- the finding "id", e.g. AZ-STOR-001
  dedupe_key      TEXT,
  finding_class   TEXT,
  title           TEXT,
  severity        TEXT,
  confidence      TEXT,
  agent           TEXT,
  category        TEXT,
  check_id        TEXT,
  subscription_id TEXT,
  resource_id     TEXT,                        -- representative instance
  status          TEXT,                        -- open|confirmed|false_positive|remediated|accepted_risk
  first_seen      TEXT,
  last_seen       TEXT,
  description     TEXT,
  attack_vector   TEXT,
  recommendation  TEXT,
  risk            TEXT,
  raw_json        TEXT
);
CREATE INDEX IF NOT EXISTS idx_findings_dedupe   ON findings(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
CREATE INDEX IF NOT EXISTS idx_findings_agent    ON findings(agent);
CREATE INDEX IF NOT EXISTS idx_findings_sub      ON findings(subscription_id);
CREATE INDEX IF NOT EXISTS idx_findings_class    ON findings(finding_class);

-- The N aggregated instances exhibiting a finding (affected_resources[]).
CREATE TABLE IF NOT EXISTS affected_resources (
  finding_id      TEXT NOT NULL,
  resource_id     TEXT NOT NULL,
  subscription_id TEXT,
  resource_group  TEXT,
  type            TEXT,
  region          TEXT,
  name            TEXT,
  evidence_ref    TEXT,
  PRIMARY KEY (finding_id, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_affected_resource ON affected_resources(resource_id);

-- Evidence items (redacted; never secret values). raw_ref points into evidence/raw/.
CREATE TABLE IF NOT EXISTS evidence (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id  TEXT NOT NULL,
  source      TEXT,
  summary     TEXT,
  raw_ref     TEXT
);
CREATE INDEX IF NOT EXISTS idx_evidence_finding ON evidence(finding_id);

-- Compliance control mappings, one row per (finding, framework, control).
CREATE TABLE IF NOT EXISTS findings_controls (
  finding_id TEXT NOT NULL,
  framework  TEXT NOT NULL,               -- cis_azure|mitre|defender_for_cloud|nist_800_53
  control_id TEXT NOT NULL,
  PRIMARY KEY (finding_id, framework, control_id)
);
CREATE INDEX IF NOT EXISTS idx_controls_fw ON findings_controls(framework, control_id);

-- Multi-step compromise chains correlated from findings.
CREATE TABLE IF NOT EXISTS attack_paths (
  path_id      TEXT PRIMARY KEY,
  title        TEXT,
  severity     TEXT,
  description  TEXT,
  raw_json     TEXT
);
CREATE TABLE IF NOT EXISTS attack_path_steps (
  path_id     TEXT NOT NULL,
  step_no     INTEGER NOT NULL,
  finding_id  TEXT,
  resource_id TEXT,
  note        TEXT,
  PRIMARY KEY (path_id, step_no)
);

-- Coverage matrix cell (schemas/coverage.schema.json). Supersedes coverage.json.
CREATE TABLE IF NOT EXISTS coverage (
  domain          TEXT NOT NULL,
  check_id        TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  type            TEXT NOT NULL,
  status          TEXT NOT NULL,           -- assessed|skipped-by-scope|skipped-by-budget|failed|permission-denied|sampled|partial
  count           INTEGER DEFAULT 1,
  reason          TEXT,
  collected_at    TEXT,
  PRIMARY KEY (domain, check_id, subscription_id, type)
);
CREATE INDEX IF NOT EXISTS idx_coverage_status ON coverage(status);

-- Durable task manifest (mirrors schemas/task.schema.json and manifest.mjs keying).
CREATE TABLE IF NOT EXISTS tasks (
  task_id          TEXT PRIMARY KEY,        -- <agent>:<sub>:<check>:<scope_hash[0:8]>
  agent            TEXT,
  subscription_id  TEXT,
  check_id         TEXT,
  scope_hash       TEXT,
  status           TEXT,                    -- pending|running|done|failed|throttled|partial|skipped
  attempts         INTEGER DEFAULT 0,
  reason           TEXT,
  output_refs_json TEXT,
  updated_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- Convenience views ------------------------------------------------------------

-- Findings with their affected-instance count (aggregation is always on).
CREATE VIEW IF NOT EXISTS v_findings_summary AS
  SELECT f.finding_id, f.dedupe_key, f.finding_class, f.title, f.severity,
         f.confidence, f.agent, f.category, f.subscription_id, f.status,
         COUNT(ar.resource_id) AS affected_count
  FROM findings f
  LEFT JOIN affected_resources ar ON ar.finding_id = f.finding_id
  GROUP BY f.finding_id;

-- Severity rollup for dashboards/report headers.
CREATE VIEW IF NOT EXISTS v_severity_rollup AS
  SELECT severity, COUNT(*) AS finding_count
  FROM findings
  GROUP BY severity;
