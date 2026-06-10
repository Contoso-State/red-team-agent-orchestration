#!/usr/bin/env node
/**
 * query.mjs — read-only query surface over the engagement datastore.
 *
 * This is the "cache-on-read" layer: agents and tools ask the DB for inventory,
 * per-resource config facts, findings, coverage, and task state instead of
 * re-querying Azure. Everything here is SELECT-only; it never writes the DB or
 * touches Azure.
 *
 * Commands (all take --db <path>; output is JSON unless noted):
 *   resources   [--type t] [--subscription s] [--rg g] [--limit N] [--ids]
 *   facts       --resource <id> [--key k]
 *   fresh       --resource <id> --key <k> --ttl <seconds>   (exit 0 if a fresh fact exists, else 3)
 *   findings    [--severity S] [--agent A] [--status st] [--class c] [--full]
 *   coverage    [--status s] [--domain d]
 *   next-tasks  [--limit N]
 *   stats
 *
 * Dependency-free (node:sqlite + stdlib).
 */

import { openDb } from './db.mjs';

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

function print(v) { console.log(JSON.stringify(v, null, 2)); }

function requireDb(args) {
  if (!args.db) { console.error('Error: --db <path> is required.'); process.exit(1); }
  return openDb(args.db, { create: false });
}

function cmdResources(db, args) {
  const where = [];
  const params = [];
  if (typeof args.type === 'string') { where.push('LOWER(type) = LOWER(?)'); params.push(args.type); }
  if (typeof args.subscription === 'string') { where.push('subscription_id = ?'); params.push(args.subscription); }
  if (typeof args.rg === 'string') { where.push('resource_group = ?'); params.push(args.rg); }
  const cols = args.ids ? 'resource_id' : 'resource_id, name, type, resource_group, subscription_id, location, kind';
  let sql = `SELECT ${cols} FROM resources`;
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY type, resource_id';
  const lim = parseInt(args.limit, 10);
  if (Number.isFinite(lim)) sql += ` LIMIT ${lim}`;
  const rows = db.prepare(sql).all(...params);
  if (args.ids) return print(rows.map((r) => r.resource_id));
  print(rows);
}

function cmdFacts(db, args) {
  if (!args.resource) { console.error('Error: --resource <id> is required.'); process.exit(1); }
  let sql = 'SELECT fact_key, fact_value_json, source, collected_at FROM resource_facts WHERE resource_id = ?';
  const params = [args.resource];
  if (typeof args.key === 'string') { sql += ' AND fact_key = ?'; params.push(args.key); }
  sql += ' ORDER BY fact_key';
  print(db.prepare(sql).all(...params).map((r) => ({
    fact_key: r.fact_key,
    value: r.fact_value_json == null ? null : JSON.parse(r.fact_value_json),
    source: r.source, collected_at: r.collected_at,
  })));
}

/** Cache-freshness probe: is there a fact newer than ttl seconds? exit 0 yes, 3 no. */
function cmdFresh(db, args) {
  if (!args.resource || !args.key) { console.error('Error: --resource and --key are required.'); process.exit(1); }
  const ttl = parseInt(args.ttl, 10);
  if (!Number.isFinite(ttl)) { console.error('Error: fresh requires a numeric --ttl <seconds>.'); process.exit(1); }
  const row = db.prepare('SELECT collected_at FROM resource_facts WHERE resource_id = ? AND fact_key = ?').get(args.resource, args.key);
  if (!row || !row.collected_at) { console.log('miss'); process.exit(3); }
  const ageSec = (Date.now() - Date.parse(row.collected_at)) / 1000;
  if (ageSec > ttl) { console.log(`stale (${Math.round(ageSec)}s)`); process.exit(3); }
  console.log(`fresh (${Math.round(ageSec)}s)`);
}

function cmdFindings(db, args) {
  const where = [];
  const params = [];
  if (typeof args.severity === 'string') { where.push('LOWER(severity) = LOWER(?)'); params.push(args.severity); }
  if (typeof args.agent === 'string') { where.push('agent = ?'); params.push(args.agent); }
  if (typeof args.status === 'string') { where.push('status = ?'); params.push(args.status); }
  if (typeof args.class === 'string') { where.push('finding_class = ?'); params.push(args.class); }
  if (args.full) {
    let sql = 'SELECT raw_json FROM findings';
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    return print(db.prepare(sql).all(...params).map((r) => JSON.parse(r.raw_json)));
  }
  let sql = 'SELECT * FROM v_findings_summary';
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += " ORDER BY CASE LOWER(severity) WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, finding_id";
  print(db.prepare(sql).all(...params));
}

function cmdCoverage(db, args) {
  const where = [];
  const params = [];
  if (typeof args.status === 'string') { where.push('status = ?'); params.push(args.status); }
  if (typeof args.domain === 'string') { where.push('domain = ?'); params.push(args.domain); }
  let sql = 'SELECT domain, check_id, subscription_id, type, status, count, reason FROM coverage';
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY domain, check_id, subscription_id, type';
  print(db.prepare(sql).all(...params));
}

function cmdNeighbors(db, args) {
  if (!args.resource) { console.error('Error: --resource <id> is required.'); process.exit(1); }
  const col = args.reverse ? 'dst_resource_id' : 'src_resource_id';
  const other = args.reverse ? 'src_resource_id' : 'dst_resource_id';
  let sql = `SELECT ${other} AS resource_id, edge_type, props_json FROM relationships WHERE ${col} = ?`;
  const params = [args.resource];
  if (typeof args.edge === 'string') { sql += ' AND edge_type = ?'; params.push(args.edge); }
  sql += ' ORDER BY edge_type, resource_id';
  print(db.prepare(sql).all(...params).map((r) => ({
    resource_id: r.resource_id, edge_type: r.edge_type,
    props: r.props_json ? JSON.parse(r.props_json) : null,
  })));
}

function cmdNextTasks(db, args) {
  let sql = "SELECT * FROM tasks WHERE status IN ('pending','failed','throttled') ORDER BY task_id";
  const lim = parseInt(args.limit, 10);
  if (Number.isFinite(lim)) sql += ` LIMIT ${lim}`;
  print(db.prepare(sql).all().map((t) => ({ ...t, output_refs: t.output_refs_json ? JSON.parse(t.output_refs_json) : [] })));
}

function cmdStats(db) {
  const counts = {};
  for (const t of ['subscriptions', 'resources', 'resource_facts', 'findings', 'coverage', 'tasks']) {
    counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  }
  const severity = {};
  for (const r of db.prepare('SELECT severity, finding_count FROM v_severity_rollup').all()) severity[r.severity || 'unknown'] = r.finding_count;
  const tasks = {};
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status').all()) tasks[r.status || 'unknown'] = r.n;
  print({ counts, severity, tasks });
}

function usage() {
  return `query.mjs — read-only query surface over the engagement datastore.

Commands (all need --db <path>):
  resources [--type t] [--subscription s] [--rg g] [--limit N] [--ids]
  facts --resource <id> [--key k]
  fresh --resource <id> --key <k> --ttl <seconds>
  findings [--severity S] [--agent A] [--status st] [--class c] [--full]
  coverage [--status s] [--domain d]
  neighbors --resource <id> [--edge t] [--reverse]
  next-tasks [--limit N]
  stats`;
}

function main() {
  const cmd = process.argv[2];
  const args = parseArgs(process.argv);
  if (!cmd || cmd === '--help' || cmd === '-h') { console.log(usage()); return; }
  const db = requireDb(args);
  try {
    switch (cmd) {
      case 'resources': return cmdResources(db, args);
      case 'facts': return cmdFacts(db, args);
      case 'fresh': return cmdFresh(db, args);
      case 'findings': return cmdFindings(db, args);
      case 'coverage': return cmdCoverage(db, args);
      case 'neighbors': return cmdNeighbors(db, args);
      case 'next-tasks': return cmdNextTasks(db, args);
      case 'stats': return cmdStats(db);
      default:
        console.error(`Unknown command '${cmd}'.\n`);
        console.log(usage());
        process.exit(1);
    }
  } finally {
    db.close();
  }
}

main();
