#!/usr/bin/env node
/**
 * promote.mjs — promote a finished engagement.db into the longitudinal history DB
 * and compute the cross-run vulnerability lifecycle.
 *
 * For the engagement's current findings we compare against that engagement's prior
 * run (latest lifecycle state per identity) and classify each as:
 *   new        — never seen before
 *   persisting — present last run, still present
 *   regressed  — was resolved last run, has reappeared
 *   resolved   — was open last run, absent this run
 *
 * Output: writes the run + per-finding lifecycle into history.db, and (optionally)
 * a delta.json summarizing what changed. Both DB and delta.json live under the
 * gitignored engagements/ tree — never commit them.
 *
 * Identity: identity_key = (dedupe_key || finding_id) + '::' + (subscription_id||'').
 *
 * Usage:
 *   node tools/datastore/promote.mjs --db <engagement.db> --history <history.db> \
 *        [--out <delta.json>] [--engagement <id>] [--run <run_id>]
 *
 * Read-only with respect to Azure. Dependency-free (node:sqlite + stdlib).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { openDb, applySchema, tx, getMeta, setMeta, nowIso } from './db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const historySchemaPath = () => join(__dirname, 'history.schema.sql');

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

function minIso(a, b) { if (!a) return b; if (!b) return a; return a <= b ? a : b; }
function identityKey(f) {
  const base = f.dedupe_key || f.finding_id || f.id || '';
  return `${base}::${f.subscription_id || ''}`;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.db) { console.error('Error: --db <engagement.db> is required.'); process.exit(1); }
  if (!args.history) { console.error('Error: --history <history.db> is required.'); process.exit(1); }

  const src = openDb(args.db, { create: false });
  const engagementId = args.engagement || getMeta(src, 'engagement_id') || 'unknown';
  const toolVersion = getMeta(src, 'tool_version') || '1';
  const runId = args.run || nowIso();

  // Pull current findings + resources from the engagement DB.
  const findings = src.prepare(
    `SELECT finding_id, dedupe_key, title, severity, status, subscription_id, first_seen, last_seen
       FROM findings`
  ).all();
  const resources = src.prepare('SELECT resource_id, raw_json FROM resources').all();
  const resourceCount = resources.length;
  src.close();

  const hist = openDb(args.history, { create: true });
  applySchema(hist, historySchemaPath());

  const delta = { engagement_id: engagementId, run_id: runId, prior_run_id: null,
    counts: { new: 0, persisting: 0, regressed: 0, resolved: 0, total_current: findings.length },
    by_severity: {}, new: [], regressed: [], resolved: [] };

  tx(hist, () => {
    if (!getMeta(hist, 'engagement_id')) setMeta(hist, 'engagement_id', engagementId);

    // Prior run for this engagement (strictly before the run being promoted).
    const prior = hist.prepare(
      'SELECT run_id FROM runs WHERE engagement_id = ? AND run_id <> ? ORDER BY started_at DESC, run_id DESC LIMIT 1'
    ).get(engagementId, runId);
    delta.prior_run_id = prior ? prior.run_id : null;

    // Idempotency: re-promoting an already-recorded run_id is a true no-op. Report the
    // counts as previously stored and leave runs/finding_history/resource_history intact.
    const existingRun = hist.prepare(
      'SELECT new_count, persisting_count, resolved_count, regressed_count FROM runs WHERE run_id = ? AND engagement_id = ?'
    ).get(runId, engagementId);
    if (existingRun) {
      delta.counts.new = existingRun.new_count || 0;
      delta.counts.persisting = existingRun.persisting_count || 0;
      delta.counts.resolved = existingRun.resolved_count || 0;
      delta.counts.regressed = existingRun.regressed_count || 0;
      delta.already_promoted = true;
      return;
    }

    // Latest lifecycle state per identity among runs STRICTLY EARLIER than the run being
    // promoted. Reading the unfiltered v_finding_lifecycle view would include the current
    // run (re-promote) or a later out-of-order run, so we compute it directly from
    // finding_history restricted to run_id < runId. Map identity -> { lifecycle, ... }.
    const priorLatest = new Map();
    for (const r of hist.prepare(
      `SELECT fh.identity_key, fh.lifecycle, fh.severity, fh.title, fh.first_seen
         FROM finding_history fh
         JOIN (
           SELECT identity_key, MAX(run_id) AS max_run
           FROM finding_history
           WHERE engagement_id = ? AND run_id < ?
           GROUP BY identity_key
         ) latest ON latest.identity_key = fh.identity_key AND latest.max_run = fh.run_id
        WHERE fh.engagement_id = ? AND fh.run_id < ?`
    ).all(engagementId, runId, engagementId, runId)) {
      priorLatest.set(r.identity_key, r);
    }

    const insFh = hist.prepare(
      `INSERT INTO finding_history
         (identity_key,run_id,engagement_id,finding_id,title,severity,status,lifecycle,first_seen,last_seen,resolved_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(identity_key,run_id) DO UPDATE SET
         finding_id=excluded.finding_id, title=excluded.title, severity=excluded.severity,
         status=excluded.status, lifecycle=excluded.lifecycle, first_seen=excluded.first_seen,
         last_seen=excluded.last_seen, resolved_at=excluded.resolved_at`
    );

    const currentIdentities = new Set();
    for (const f of findings) {
      const key = identityKey(f);
      currentIdentities.add(key);
      const was = priorLatest.get(key);
      let lifecycle;
      if (!was) lifecycle = 'new';
      else if (was.lifecycle === 'resolved') lifecycle = 'regressed';
      else lifecycle = 'persisting';
      const firstSeen = was ? minIso(was.first_seen, f.first_seen || runId) : (f.first_seen || runId);
      insFh.run(key, runId, engagementId, f.finding_id, f.title, f.severity, f.status,
        lifecycle, firstSeen, f.last_seen || runId, null);

      delta.counts[lifecycle]++;
      const sev = f.severity || 'unknown';
      delta.by_severity[sev] = (delta.by_severity[sev] || 0) + 1;
      if (lifecycle === 'new') delta.new.push({ identity_key: key, finding_id: f.finding_id, title: f.title, severity: f.severity });
      if (lifecycle === 'regressed') delta.regressed.push({ identity_key: key, finding_id: f.finding_id, title: f.title, severity: f.severity });
    }

    // Resolved: was open last we knew, but absent now.
    for (const [key, was] of priorLatest) {
      if (currentIdentities.has(key)) continue;
      if (was.lifecycle === 'resolved') continue; // already resolved, no change
      insFh.run(key, runId, engagementId, null, was.title, was.severity, 'resolved', 'resolved',
        was.first_seen || null, runId, runId);
      delta.counts.resolved++;
      delta.resolved.push({ identity_key: key, title: was.title, severity: was.severity });
    }

    // Resource presence + config hash for drift tracking.
    const insRh = hist.prepare(
      `INSERT INTO resource_history (resource_id,run_id,engagement_id,present,config_hash)
       VALUES (?,?,?,1,?)
       ON CONFLICT(resource_id,run_id) DO UPDATE SET present=1, config_hash=excluded.config_hash`
    );
    for (const r of resources) {
      const hash = r.raw_json ? createHash('sha256').update(r.raw_json).digest('hex').slice(0, 16) : null;
      insRh.run(r.resource_id, runId, engagementId, hash);
    }

    hist.prepare(
      `INSERT INTO runs (run_id,engagement_id,subscription_id,started_at,finished_at,tool_version,
         resource_count,finding_count,new_count,persisting_count,resolved_count,regressed_count)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(run_id) DO UPDATE SET finished_at=excluded.finished_at,
         resource_count=excluded.resource_count, finding_count=excluded.finding_count,
         new_count=excluded.new_count, persisting_count=excluded.persisting_count,
         resolved_count=excluded.resolved_count, regressed_count=excluded.regressed_count`
    ).run(runId, engagementId, findings[0]?.subscription_id || null, runId, nowIso(), toolVersion,
      resourceCount, findings.length, delta.counts.new, delta.counts.persisting,
      delta.counts.resolved, delta.counts.regressed);
  });

  hist.close();

  if (args.out) {
    const outAbs = resolve(process.cwd(), args.out);
    mkdirSync(dirname(outAbs), { recursive: true });
    writeFileSync(outAbs, JSON.stringify(delta, null, 2) + '\n');
  }
  console.log(JSON.stringify({ promoted: { engagement_id: engagementId, run_id: runId, prior_run_id: delta.prior_run_id },
    counts: delta.counts, out: args.out ? resolve(process.cwd(), args.out) : null }, null, 2));
}

main();
