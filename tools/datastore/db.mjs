#!/usr/bin/env node
/**
 * db.mjs — engagement datastore core (SQLite via Node's built-in `node:sqlite`).
 *
 * One SQLite database is the source of truth for a single assessment run. This
 * module owns connection setup, schema application, and lightweight migration; the
 * sibling tools (ingest/export/query/promote) build on the helpers exported here.
 *
 * Why `node:sqlite`: it ships with Node (>=22.5) so the datastore adds ZERO new
 * dependencies, consistent with the rest of tools/ (dependency-free Node ESM). It is
 * still flagged experimental and prints one ExperimentalWarning to stderr on import;
 * that never touches stdout, so JSON output stays clean. Suppress with NODE_NO_WARNINGS=1
 * or `node --no-warnings` if desired.
 *
 * Safety: the DB lives under engagements/<session>/ (gitignored). It may contain raw
 * target data — never commit it. Never store secret values; evidence keeps refs only.
 *
 * CLI:
 *   node tools/datastore/db.mjs init    --db <path> [--engagement <id>]
 *   node tools/datastore/db.mjs info    --db <path>
 *   node tools/datastore/db.mjs migrate --db <path>
 *   node tools/datastore/db.mjs query   --db <path> --sql "SELECT ..."   (read-only; JSON rows)
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CURRENT_SCHEMA_VERSION = 2;
const __dirname = dirname(fileURLToPath(import.meta.url));

export function nowIso() {
  return new Date().toISOString();
}

export function schemaPath() {
  return join(__dirname, 'schema.sql');
}

/** Open (and optionally create) a DB with the standard PRAGMAs for safe concurrent use. */
export function openDb(dbPath, { create = true } = {}) {
  const abs = resolve(process.cwd(), dbPath);
  if (create) mkdirSync(dirname(abs), { recursive: true });
  else if (!existsSync(abs)) throw new Error(`Database not found: ${abs}`);
  const db = new DatabaseSync(abs, { create });
  // WAL keeps readers lock-free while a single writer ingests; busy_timeout absorbs
  // brief write contention; foreign_keys=ON enforces the *ownership* edges declared in
  // schema.sql (a finding's children and an attack path's steps CASCADE-delete with the
  // parent). Inventory references (affected_resources.resource_id, resource_facts,
  // relationships.src/dst) are intentionally left soft — inventory may be sampled or
  // ingested independently of findings — and are enforced by the single-writer ingest,
  // not by the database.
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

export function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : undefined;
}

export function setMeta(db, key, value) {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value == null ? null : String(value));
}

/** Apply schema.sql (idempotent — every object is IF NOT EXISTS). */
export function applySchema(db, file = schemaPath()) {
  db.exec(readFileSync(file, 'utf8'));
}

/** Run fn inside a transaction; rolls back on throw. */
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
}

/**
 * Bring a DB up to CURRENT_SCHEMA_VERSION.
 *
 * NOTE on constraint changes: SQLite bakes FK and CHECK constraints into a table at
 * CREATE TABLE time, and every object here is CREATE … IF NOT EXISTS, so the v2 FK/CHECK
 * additions only take effect on *freshly created* databases. New CREATE INDEX IF NOT
 * EXISTS statements, by contrast, do apply to already-existing DBs on re-apply. Engagement
 * and history DBs are per-run, gitignored, and recreated from JSON/JSONL each assessment,
 * so they pick up the new constraints naturally; we deliberately avoid a brittle
 * table-rebuild migration. The schema stays additive and idempotent.
 */
export function migrate(db) {
  applySchema(db);
  const have = parseInt(getMeta(db, 'schema_version') || '0', 10) || 0;
  if (have < CURRENT_SCHEMA_VERSION) setMeta(db, 'schema_version', CURRENT_SCHEMA_VERSION);
  return CURRENT_SCHEMA_VERSION;
}

/** Initialize a fresh (or existing) engagement DB and stamp identity metadata. */
export function initDb(dbPath, { engagementId, toolVersion = '1' } = {}) {
  const db = openDb(dbPath, { create: true });
  tx(db, () => {
    migrate(db);
    if (!getMeta(db, 'created_at')) setMeta(db, 'created_at', nowIso());
    if (engagementId) setMeta(db, 'engagement_id', engagementId);
    setMeta(db, 'tool_version', toolVersion);
  });
  return db;
}

const COUNT_TABLES = [
  'subscriptions', 'resources', 'resource_facts', 'relationships', 'findings',
  'affected_resources', 'evidence', 'findings_controls', 'attack_paths',
  'attack_path_steps', 'coverage', 'tasks',
];

export function tableCounts(db) {
  const out = {};
  for (const t of COUNT_TABLES) {
    try { out[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; }
    catch { out[t] = null; }
  }
  return out;
}

// --- CLI ---------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    const key = (eq >= 0 ? a.slice(2, eq) : a.slice(2)).replace(/-/g, '_');
    out[key] = eq >= 0 ? a.slice(eq + 1) : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

function requireDb(args) {
  if (!args.db) { console.error('Error: --db <path> is required.'); process.exit(1); }
  return args.db;
}

function usage() {
  return `db.mjs — engagement datastore core (SQLite via node:sqlite).

Commands:
  init    --db <path> [--engagement <id>]   Create/upgrade a DB and stamp metadata.
  info    --db <path>                         Print schema version, meta, and row counts.
  migrate --db <path>                         Apply the latest schema to an existing DB.
  query   --db <path> --sql "SELECT ..."     Run a read-only query; prints JSON rows.`;
}

function main() {
  const cmd = process.argv[2];
  const args = parseArgs(process.argv);
  switch (cmd) {
    case 'init': {
      const db = initDb(requireDb(args), { engagementId: typeof args.engagement === 'string' ? args.engagement : undefined });
      console.log(`Initialized datastore (schema v${getMeta(db, 'schema_version')}): ${resolve(process.cwd(), args.db)}`);
      db.close();
      return;
    }
    case 'migrate': {
      const db = openDb(requireDb(args), { create: false });
      const v = tx(db, () => migrate(db));
      console.log(`Migrated to schema v${v}.`);
      db.close();
      return;
    }
    case 'info': {
      const db = openDb(requireDb(args), { create: false });
      const meta = {};
      for (const r of db.prepare('SELECT key, value FROM meta ORDER BY key').all()) meta[r.key] = r.value;
      console.log(JSON.stringify({ db: resolve(process.cwd(), args.db), meta, counts: tableCounts(db) }, null, 2));
      db.close();
      return;
    }
    case 'query': {
      if (!args.sql || typeof args.sql !== 'string') { console.error('Error: --sql "SELECT ..." is required.'); process.exit(1); }
      if (!/^\s*(select|with|pragma)\b/i.test(args.sql)) { console.error('Error: query is read-only (must start with SELECT/WITH/PRAGMA).'); process.exit(1); }
      const db = openDb(requireDb(args), { create: false });
      console.log(JSON.stringify(db.prepare(args.sql).all(), null, 2));
      db.close();
      return;
    }
    case undefined:
    case '--help':
    case '-h':
      console.log(usage());
      return;
    default:
      console.error(`Unknown command '${cmd}'.\n`);
      console.log(usage());
      process.exit(1);
  }
}

// Run main() only when executed directly (not when imported as a module).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
