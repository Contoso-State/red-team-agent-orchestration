#!/usr/bin/env node
/**
 * ingest.mjs — load a run's file artifacts into the engagement datastore.
 *
 * Parallel sub-agents stay lock-free: each writes its own findings/raw/<agent>.jsonl
 * (and the inventory tools write resources.json etc). The orchestrator — the single
 * writer — then runs this once to load everything into engagement.db. From that point
 * the DB is the source of truth and tools/datastore/export.mjs regenerates the JSON.
 *
 * Findings are merged exactly like tools/orchestration/manifest.mjs `reduce`: identical
 * findings (same dedupe_key, falling back to id) collapse into one, unioning their
 * affected_resources[]; all other fields are first-write-wins; last_seen takes the max.
 *
 * Inputs (auto-discovered from --session, or passed explicitly):
 *   inventory/resources.json|jsonl        -> resources
 *   inventory/subscriptions.json          -> subscriptions
 *   findings/raw/*.jsonl                  -> findings (+ affected_resources, evidence, controls)
 *   coverage.json                         -> coverage
 *   <facts>.json (--facts)                -> resource_facts
 *   runs/tasks.jsonl (--tasks)            -> tasks
 *
 * Usage:
 *   node tools/datastore/ingest.mjs --db <path> --session <sessionDir>
 *   node tools/datastore/ingest.mjs --db <path> --resources <f> --findings <dir|file> [--coverage <f>] ...
 *
 * Read-only with respect to Azure. Dependency-free (node:sqlite + stdlib).
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { openDb, initDb, getMeta, setMeta, tx, nowIso } from './db.mjs';

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4, informational: 4 };

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

function readJson(p) { return JSON.parse(readFileSync(p, 'utf8')); }

/** Accept a bare array, a {findings:[...]} / {data:[...]} wrapper, or JSONL. */
function readRecords(p) {
  const t = readFileSync(p, 'utf8').trim();
  if (!t) return [];
  // Try whole-file JSON first: handles bare arrays, {findings|data|records:[...]}
  // wrappers, and single pretty-printed objects (which legitimately span lines).
  try {
    const o = JSON.parse(t);
    if (Array.isArray(o)) return o;
    if (o && typeof o === 'object') {
      if (Array.isArray(o.findings)) return o.findings;
      if (Array.isArray(o.data)) return o.data;
      if (Array.isArray(o.records)) return o.records;
      return [o];
    }
    return [];
  } catch {
    // Fall back to JSONL: one JSON value per line (append-only manifests, raw findings).
    return t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
  }
}

function maxIso(a, b) {
  if (!a) return b; if (!b) return a;
  return a >= b ? a : b;
}

// --- resources / subscriptions ----------------------------------------------

function ingestResources(db, items, etlRunId) {
  const ins = db.prepare(
    `INSERT INTO resources (resource_id,name,type,resource_group,subscription_id,location,kind,tags_json,raw_json,collected_at,etl_run_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(resource_id) DO UPDATE SET
       name=excluded.name, type=excluded.type, resource_group=excluded.resource_group,
       subscription_id=excluded.subscription_id, location=excluded.location, kind=excluded.kind,
       tags_json=excluded.tags_json, raw_json=excluded.raw_json, collected_at=excluded.collected_at,
       etl_run_id=excluded.etl_run_id`
  );
  const at = nowIso();
  let n = 0;
  for (const r of items) {
    const id = r.id || r.resource_id;
    if (!id) continue;
    ins.run(
      id, r.name ?? null, r.type ? String(r.type).toLowerCase() : null,
      r.resourceGroup ?? r.resource_group ?? null,
      r.subscriptionId ?? r.subscription_id ?? null,
      r.location ?? r.region ?? null, r.kind ?? null,
      r.tags ? JSON.stringify(r.tags) : null, JSON.stringify(r), at, etlRunId
    );
    n++;
  }
  return n;
}

function ingestSubscriptions(db, items) {
  const ins = db.prepare(
    `INSERT INTO subscriptions (subscription_id,name,state,collected_at) VALUES (?,?,?,?)
     ON CONFLICT(subscription_id) DO UPDATE SET name=excluded.name, state=excluded.state, collected_at=excluded.collected_at`
  );
  const at = nowIso();
  let n = 0;
  for (const s of items) {
    const id = s.id || s.subscription_id;
    if (!id) continue;
    ins.run(id, s.name ?? null, s.state ?? null, at);
    n++;
  }
  return n;
}

// --- findings (+ children) with reduce-style merge --------------------------

function findTargetId(db, f) {
  if (f.dedupe_key) {
    const ex = db.prepare('SELECT finding_id FROM findings WHERE dedupe_key = ? LIMIT 1').get(f.dedupe_key);
    if (ex) return ex.finding_id;
  }
  const byId = db.prepare('SELECT finding_id FROM findings WHERE finding_id = ?').get(f.id);
  return byId ? byId.finding_id : null;
}

function insertFindingRow(db, f) {
  db.prepare(
    `INSERT INTO findings (finding_id,dedupe_key,finding_class,title,severity,confidence,agent,category,check_id,
       subscription_id,resource_id,status,first_seen,last_seen,description,attack_vector,recommendation,risk,raw_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    f.id, f.dedupe_key ?? null, f.finding_class ?? null, f.title ?? null, f.severity ?? null,
    f.confidence ?? null, f.agent ?? null, f.category ?? null, f.check_id ?? null,
    f.subscription_id ?? null, f.resource_id ?? null, f.status ?? null, f.first_seen ?? null,
    f.last_seen ?? null, f.description ?? null, f.attack_vector ?? null, f.recommendation ?? null,
    f.risk ?? null, JSON.stringify(f)
  );
}

function insertAffected(db, findingId, list) {
  const ins = db.prepare(
    `INSERT INTO affected_resources (finding_id,resource_id,subscription_id,resource_group,type,region,name,evidence_ref)
     VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(finding_id,resource_id) DO NOTHING`
  );
  for (const a of list || []) {
    if (!a || !a.resource_id) continue;
    ins.run(findingId, a.resource_id, a.subscription_id ?? null, a.resource_group ?? null,
      a.type ?? null, a.region ?? null, a.name ?? null, a.evidence_ref ?? null);
  }
}

function insertEvidence(db, findingId, list) {
  const ins = db.prepare('INSERT INTO evidence (finding_id,source,summary,raw_ref) VALUES (?,?,?,?)');
  for (const e of list || []) ins.run(findingId, e.source ?? null, e.summary ?? null, e.raw_ref ?? null);
}

function insertControls(db, findingId, controls) {
  if (!controls || typeof controls !== 'object') return;
  const ins = db.prepare(
    'INSERT INTO findings_controls (finding_id,framework,control_id) VALUES (?,?,?) ON CONFLICT DO NOTHING'
  );
  for (const fw of Object.keys(controls)) {
    for (const cid of controls[fw] || []) ins.run(findingId, fw, cid);
  }
}

/** Upsert one finding with reduce-style merge (union affected; first-wins scalars). */
function upsertFinding(db, f) {
  if (!f || !f.id) return { merged: false };
  const targetId = findTargetId(db, f);
  if (!targetId) {
    insertFindingRow(db, f);
    insertAffected(db, f.id, f.affected_resources);
    insertEvidence(db, f.id, f.evidence);
    insertControls(db, f.id, f.controls);
    return { merged: false };
  }
  // Merge into existing canonical finding: union affected_resources, keep representative
  // scalars/evidence/controls (mirrors manifest.mjs reduce), bump last_seen.
  insertAffected(db, targetId, f.affected_resources);
  const cur = db.prepare('SELECT last_seen FROM findings WHERE finding_id = ?').get(targetId);
  const merged = maxIso(cur?.last_seen, f.last_seen);
  if (merged && merged !== cur?.last_seen) db.prepare('UPDATE findings SET last_seen = ? WHERE finding_id = ?').run(merged, targetId);
  return { merged: true };
}

// --- coverage / facts / tasks -----------------------------------------------

function ingestCoverage(db, items) {
  const ins = db.prepare(
    `INSERT INTO coverage (domain,check_id,subscription_id,type,status,count,reason,collected_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(domain,check_id,subscription_id,type) DO UPDATE SET
       status=excluded.status, count=excluded.count, reason=excluded.reason, collected_at=excluded.collected_at`
  );
  const at = nowIso();
  let n = 0;
  for (const c of items) {
    if (!c || !c.domain || !c.check_id || !c.subscription_id || !c.type || !c.status) continue;
    ins.run(c.domain, c.check_id, c.subscription_id, c.type, c.status, c.count ?? 1, c.reason ?? null, at);
    n++;
  }
  return n;
}

function ingestFacts(db, items) {
  const ins = db.prepare(
    `INSERT INTO resource_facts (resource_id,fact_key,fact_value_json,source,collected_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(resource_id,fact_key) DO UPDATE SET
       fact_value_json=excluded.fact_value_json, source=excluded.source, collected_at=excluded.collected_at`
  );
  const at = nowIso();
  let n = 0;
  for (const f of items) {
    if (!f || !f.resource_id || !f.fact_key) continue;
    const v = f.fact_value_json ?? (f.fact_value !== undefined ? JSON.stringify(f.fact_value) : null);
    ins.run(f.resource_id, f.fact_key, v, f.source ?? null, f.collected_at ?? at);
    n++;
  }
  return n;
}

/** Graph edges (VM->NIC->PublicIP, principal->role->scope) for attack-path joins. */
function ingestRelationships(db, items) {
  const ins = db.prepare(
    `INSERT INTO relationships (src_resource_id,dst_resource_id,edge_type,props_json,collected_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(src_resource_id,dst_resource_id,edge_type) DO UPDATE SET
       props_json=excluded.props_json, collected_at=excluded.collected_at`
  );
  const at = nowIso();
  let n = 0;
  for (const r of items) {
    const src = r?.src_resource_id ?? r?.src ?? r?.source;
    const dst = r?.dst_resource_id ?? r?.dst ?? r?.target;
    const edge = r?.edge_type ?? r?.edge ?? r?.type;
    if (!src || !dst || !edge) continue;
    const props = r.props_json ?? (r.props !== undefined ? JSON.stringify(r.props) : null);
    ins.run(src, dst, edge, props, r.collected_at ?? at);
    n++;
  }
  return n;
}

/** Tasks.jsonl is append-only; reduce to last-write-wins per task_id before loading. */
function ingestTasks(db, records) {
  const state = new Map();
  for (const r of records) if (r && r.task_id) state.set(r.task_id, r);
  const ins = db.prepare(
    `INSERT INTO tasks (task_id,agent,subscription_id,check_id,scope_hash,status,attempts,reason,output_refs_json,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(task_id) DO UPDATE SET
       agent=excluded.agent, subscription_id=excluded.subscription_id, check_id=excluded.check_id,
       scope_hash=excluded.scope_hash, status=excluded.status, attempts=excluded.attempts,
       reason=excluded.reason, output_refs_json=excluded.output_refs_json, updated_at=excluded.updated_at`
  );
  for (const t of state.values()) {
    ins.run(t.task_id, t.agent ?? null, t.subscription_id ?? null, t.check_id ?? null, t.scope_hash ?? null,
      t.status ?? null, t.attempts ?? 0, t.reason ?? null,
      t.output_refs ? JSON.stringify(t.output_refs) : null, t.updated_at ?? null);
  }
  return state.size;
}

// --- source discovery --------------------------------------------------------

function discover(session) {
  const s = resolve(process.cwd(), session);
  const pick = (...c) => c.find((p) => existsSync(p));
  const findingsDir = join(s, 'findings', 'raw');
  return {
    resources: pick(join(s, 'inventory', 'resources.json'), join(s, 'inventory', 'resources.jsonl')),
    subscriptions: pick(join(s, 'inventory', 'subscriptions.json')),
    relationships: pick(join(s, 'inventory', 'relationships.json'), join(s, 'relationships.json')),
    coverage: pick(join(s, 'coverage.json'), join(s, 'inventory', 'coverage.json'), join(s, 'reports', 'coverage.json')),
    tasks: pick(join(s, 'runs', 'tasks.jsonl')),
    findings: existsSync(findingsDir) ? findingsDir : pick(join(s, 'findings', 'normalized', 'findings.json')),
  };
}

function findingFiles(p) {
  if (!p) return [];
  const abs = resolve(process.cwd(), p);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isDirectory()) {
    return readdirSync(abs).filter((f) => /\.(jsonl|json)$/i.test(f)).map((f) => join(abs, f));
  }
  return [abs];
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.db) { console.error('Error: --db <path> is required.'); process.exit(1); }
  const src = args.session ? discover(args.session) : {};
  const resourcesPath = args.resources ?? src.resources;
  const subsPath = args.subscriptions ?? src.subscriptions;
  const coveragePath = args.coverage ?? src.coverage;
  const tasksPath = args.tasks ?? src.tasks;
  const findingsArg = args.findings ?? src.findings;
  const factsPath = args.facts;
  const relPath = args.relationships ?? src.relationships;

  const db = existsSync(resolve(process.cwd(), args.db)) ? openDb(args.db, { create: true }) : initDb(args.db, {});
  const etlRunId = nowIso();
  const stats = {};

  tx(db, () => {
    if (resourcesPath && existsSync(resourcesPath)) stats.resources = ingestResources(db, readRecords(resourcesPath), etlRunId);
    if (subsPath && existsSync(subsPath)) stats.subscriptions = ingestSubscriptions(db, readRecords(subsPath));
    if (factsPath && existsSync(resolve(process.cwd(), factsPath))) stats.facts = ingestFacts(db, readRecords(factsPath));
    if (relPath && existsSync(resolve(process.cwd(), relPath))) stats.relationships = ingestRelationships(db, readRecords(relPath));

    const files = findingFiles(findingsArg);
    if (files.length) {
      const all = [];
      for (const file of files) for (const r of readRecords(file)) all.push(r);
      // Deterministic order so merge representative selection is stable (severity, then key).
      all.sort((a, b) => {
        const sa = SEVERITY_RANK[String(a.severity || '').toLowerCase()] ?? 9;
        const sb = SEVERITY_RANK[String(b.severity || '').toLowerCase()] ?? 9;
        if (sa !== sb) return sa - sb;
        return String(a.dedupe_key || a.id || '').localeCompare(String(b.dedupe_key || b.id || ''));
      });
      let merged = 0;
      for (const f of all) if (upsertFinding(db, f).merged) merged++;
      stats.findings_in = all.length;
      stats.findings_merged = merged;
    }

    if (coveragePath && existsSync(coveragePath)) stats.coverage = ingestCoverage(db, readRecords(coveragePath));
    if (tasksPath && existsSync(tasksPath)) stats.tasks = ingestTasks(db, readRecords(tasksPath));
    setMeta(db, 'last_ingest_at', etlRunId);
  });

  console.log(JSON.stringify({ db: resolve(process.cwd(), args.db), ingested: stats }, null, 2));
  db.close();
}

main();
