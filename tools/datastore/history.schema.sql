-- history.schema.sql — longitudinal (cross-run) datastore.
--
-- One history DB per engagement lives at engagements/_history/<engagement_id>.db
-- (gitignored). Each finished engagement.db is *promoted* into it, recording a new
-- run plus the per-finding lifecycle (new / persisting / resolved / regressed) so we
-- can answer "what changed since the last assessment?" and chart severity trends.
--
-- Safety: like engagement.db this may contain raw target data — never commit it.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- One row per promoted assessment run.
CREATE TABLE IF NOT EXISTS runs (
  run_id          TEXT PRIMARY KEY,   -- CONTRACT: ISO-8601 timestamp in UTC (…Z). Stored as
                                      -- text and ordered LEXICALLY, so the format must be
                                      -- zero-padded UTC for MAX(run_id)/`run_id < ?` (see
                                      -- v_finding_lifecycle and promote.mjs) to mean "latest".
  engagement_id   TEXT,
  subscription_id TEXT,               -- primary subscription scope, if single-sub
  started_at      TEXT,
  finished_at     TEXT,
  tool_version    TEXT,
  resource_count  INTEGER DEFAULT 0,
  finding_count   INTEGER DEFAULT 0,
  new_count       INTEGER DEFAULT 0,
  persisting_count INTEGER DEFAULT 0,
  resolved_count  INTEGER DEFAULT 0,
  regressed_count INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_runs_eng ON runs(engagement_id, started_at);

-- One row per finding identity per run. identity_key = dedupe_key (or id) + scope,
-- stable across runs so the same vulnerability lines up over time.
CREATE TABLE IF NOT EXISTS finding_history (
  identity_key  TEXT NOT NULL,
  run_id        TEXT NOT NULL,
  engagement_id TEXT,
  finding_id    TEXT,
  title         TEXT,
  severity      TEXT CHECK (severity IS NULL OR severity IN ('Critical','High','Medium','Low','Informational')),
  status        TEXT,                 -- snapshot of finding status; may also be 'resolved' for synthetic close-out rows
  lifecycle     TEXT CHECK (lifecycle IS NULL OR lifecycle IN ('new','persisting','resolved','regressed')),
  first_seen    TEXT,
  last_seen     TEXT,
  resolved_at   TEXT,
  PRIMARY KEY (identity_key, run_id)
);
CREATE INDEX IF NOT EXISTS idx_fh_run      ON finding_history(run_id);
CREATE INDEX IF NOT EXISTS idx_fh_identity ON finding_history(identity_key);
CREATE INDEX IF NOT EXISTS idx_fh_eng      ON finding_history(engagement_id, run_id);

-- Resource presence + config drift over time.
CREATE TABLE IF NOT EXISTS resource_history (
  resource_id   TEXT NOT NULL,
  run_id        TEXT NOT NULL,
  engagement_id TEXT,
  present       INTEGER DEFAULT 1,
  config_hash   TEXT,
  PRIMARY KEY (resource_id, run_id)
);
CREATE INDEX IF NOT EXISTS idx_rh_run ON resource_history(run_id);

-- Latest lifecycle state per finding identity (most recent run wins).
CREATE VIEW IF NOT EXISTS v_finding_lifecycle AS
SELECT fh.*
FROM finding_history fh
JOIN (
  SELECT identity_key, MAX(run_id) AS max_run
  FROM finding_history GROUP BY identity_key
) latest ON latest.identity_key = fh.identity_key AND latest.max_run = fh.run_id;

-- Open (unresolved) finding count by severity per run — feeds trend charts.
CREATE VIEW IF NOT EXISTS v_trend_by_severity AS
SELECT run_id, engagement_id, severity, COUNT(*) AS finding_count
FROM finding_history
WHERE lifecycle <> 'resolved'
GROUP BY run_id, engagement_id, severity;
