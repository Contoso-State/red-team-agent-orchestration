#!/usr/bin/env node
/**
 * export.mjs — regenerate the run's JSON/JSONL artifacts FROM the datastore.
 *
 * Once ingest.mjs has loaded a run, engagement.db is the source of truth. This tool
 * round-trips it back out to the exact files the rest of the toolchain already
 * consumes, so nothing downstream changes:
 *   findings        -> findings/normalized/findings.json (+ reports/findings.json)
 *                      (validated by tools/validate-findings.mjs, rendered by
 *                       tools/report/generate-report.mjs)
 *   coverage        -> coverage.json   (schemas/coverage.schema.json)
 *   resources       -> inventory/resources.jsonl + inventory/summary.json
 *
 * Fidelity: each finding is reconstructed from its stored raw_json (so fields the DB
 * doesn't model — references, attack_path, etc. — survive verbatim); affected_resources
 * is replaced with the DB union only when ingest merged extra instances, and last_seen
 * is bumped if a merge advanced it. Findings are ordered by severity then dedupe_key/id,
 * matching tools/orchestration/manifest.mjs `reduce`.
 *
 * Usage:
 *   node tools/datastore/export.mjs --db <path> --out <findings.json>
 *   node tools/datastore/export.mjs --db <path> --session <dir> [--what all|findings|coverage|resources]
 *
 * Read-only with respect to Azure and the DB. Dependency-free (node:sqlite + stdlib).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { openDb } from './db.mjs';

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, informational: 4, info: 4 };

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    const key = (eq >= 0 ? a.slice(2, eq) : a.slice(2)).replace(/-/g, '_');
    out[key] = eq >= 0 ? a.slice(eq + 1) : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

function stripNulls(o) {
  const out = {};
  for (const k of Object.keys(o)) if (o[k] !== null && o[k] !== undefined) out[k] = o[k];
  return out;
}

/** Rebuild the normalized findings array from the DB (reduce-equivalent output). */
export function exportFindings(db) {
  const rows = db.prepare('SELECT finding_id, dedupe_key, severity, last_seen, raw_json FROM findings').all();
  const affStmt = db.prepare(
    'SELECT resource_id, subscription_id, resource_group, type, region, name, evidence_ref ' +
    'FROM affected_resources WHERE finding_id = ? ORDER BY resource_id'
  );
  const findings = rows.map((row) => {
    const f = JSON.parse(row.raw_json);
    const affected = affStmt.all(row.finding_id).map(stripNulls);
    const baseAff = Array.isArray(f.affected_resources) ? f.affected_resources : [];
    if (affected.length > baseAff.length) f.affected_resources = affected; // a merge added instances
    if (row.last_seen && row.last_seen !== f.last_seen) f.last_seen = row.last_seen;
    return f;
  });
  findings.sort((a, b) => {
    const sa = SEVERITY_RANK[String(a.severity || '').toLowerCase()] ?? 9;
    const sb = SEVERITY_RANK[String(b.severity || '').toLowerCase()] ?? 9;
    if (sa !== sb) return sa - sb;
    return String(a.dedupe_key || a.id || '').localeCompare(String(b.dedupe_key || b.id || ''));
  });
  return findings;
}

export function exportCoverage(db) {
  return db.prepare(
    'SELECT domain, check_id, subscription_id, type, status, count, reason FROM coverage ' +
    'ORDER BY domain, check_id, subscription_id, type'
  ).all().map(stripNulls);
}

export function exportResources(db) {
  return db.prepare('SELECT raw_json FROM resources ORDER BY type, resource_id').all()
    .map((r) => JSON.parse(r.raw_json));
}

export function exportSummary(db) {
  return db.prepare(
    'SELECT type, COUNT(*) AS count FROM resources GROUP BY type ORDER BY count DESC, type'
  ).all();
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.db) { console.error('Error: --db <path> is required.'); process.exit(1); }
  const db = openDb(args.db, { create: false });
  const wrote = [];

  if (args.out && !args.session) {
    const out = resolve(process.cwd(), args.out);
    writeJson(out, exportFindings(db));
    wrote.push(out);
  } else if (args.session) {
    const s = resolve(process.cwd(), args.session);
    const what = typeof args.what === 'string' ? args.what : 'all';
    if (what === 'all' || what === 'findings') {
      const findings = exportFindings(db);
      const a = join(s, 'findings', 'normalized', 'findings.json');
      const b = join(s, 'reports', 'findings.json');
      writeJson(a, findings); writeJson(b, findings);
      wrote.push(a, b);
    }
    if (what === 'all' || what === 'coverage') {
      const p = join(s, 'coverage.json');
      writeJson(p, exportCoverage(db)); wrote.push(p);
    }
    if (what === 'all' || what === 'resources') {
      const jsonl = join(s, 'inventory', 'resources.jsonl');
      mkdirSync(dirname(jsonl), { recursive: true });
      writeFileSync(jsonl, exportResources(db).map((r) => JSON.stringify(r)).join('\n') + '\n');
      const summary = join(s, 'inventory', 'summary.json');
      writeJson(summary, exportSummary(db));
      wrote.push(jsonl, summary);
    }
  } else {
    console.error('Error: pass --out <file> or --session <dir>.');
    process.exit(1);
  }

  console.log(JSON.stringify({ wrote }, null, 2));
  db.close();
}

main();
