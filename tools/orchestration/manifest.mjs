#!/usr/bin/env node
/**
 * manifest.mjs — durable task manifest for a large-estate assessment run.
 *
 * Across 14 agents x N subscriptions x M checks the coordination state itself
 * becomes the bottleneck, so it must be durable on disk, not implicit in chat
 * context. This tool manages an append-only JSONL task queue at
 * `engagements/<session>/runs/tasks.jsonl` whose records conform to
 * `schemas/task.schema.json`.
 *
 * A task is keyed by (agent, subscription_id, check_id, scope_hash). The manifest
 * makes a long run:
 *   - RESUMABLE — `next` returns only work that isn't `done` (failed/throttled retry).
 *   - IDEMPOTENT — `add` is keyed by a deterministic task_id; re-adding is a no-op.
 *   - HONEST — a failed/partial/skipped task is a recorded coverage gap, not an abort.
 *   - MERGEABLE — `reduce` deterministically merges each task's own output file into
 *     one normalized findings set, deduped by `dedupe_key` (so aggregated findings
 *     stay aggregated even when produced by separate per-subscription tasks).
 *
 * The file is append-only: the LATEST record for a task_id wins. This is crash-safe
 * (a partial write only loses the last line) and parallel-safe (workers append).
 *
 * Usage:
 *   node tools/orchestration/manifest.mjs init      --run <runDir>
 *   node tools/orchestration/manifest.mjs add       --run <runDir> --agent A --subscription S --check C [--scope <json>]
 *   node tools/orchestration/manifest.mjs add-plan  --run <runDir> --plan <plan.json>
 *   node tools/orchestration/manifest.mjs set-status --run <runDir> --task <id> --status <s> [--ref <path>]... [--reason <r>]
 *   node tools/orchestration/manifest.mjs list      --run <runDir> [--status <s>]
 *   node tools/orchestration/manifest.mjs next      --run <runDir> [--limit N]
 *   node tools/orchestration/manifest.mjs stats     --run <runDir>
 *   node tools/orchestration/manifest.mjs reduce    --run <runDir> --out <findings.normalized.json>
 *
 * `--run` is the run directory (e.g. engagements/<session>/runs). tasks.jsonl lives
 * inside it; `reduce` resolves each task's output_refs relative to <run>/.. (the
 * session folder) when they are not absolute.
 *
 * Read-only with respect to Azure. Writes only inside the run/session folder.
 * Dependency-free (Node stdlib only).
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, isAbsolute, resolve } from 'node:path';

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4, informational: 4 };

function parseArgs(argv) {
  const out = { _: [], ref: [] };
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    const key = (eq >= 0 ? a.slice(2, eq) : a.slice(2)).replace(/-/g, '_');
    const val = eq >= 0 ? a.slice(eq + 1) : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    if (key === 'ref') out.ref.push(val);
    else out[key] = val;
  }
  return out;
}

function usage() {
  return `manifest.mjs — durable task manifest (engagements/<session>/runs/tasks.jsonl).

Commands:
  init       --run <dir>
  add        --run <dir> --agent A --subscription S --check C [--scope <json>]
  add-plan   --run <dir> --plan <plan.json>     (array of {agent,subscription_id,check_id,scope?})
  set-status --run <dir> --task <id> --status <pending|running|done|failed|throttled|partial|skipped> [--ref <path>]... [--reason <r>]
  list       --run <dir> [--status <s>]
  next       --run <dir> [--limit N]            (tasks needing work: pending/failed/throttled)
  stats      --run <dir>
  reduce     --run <dir> --out <findings.json>  (merge task outputs, dedupe by dedupe_key)`;
}

function canonical(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
  return '{' + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}

function scopeHash(agent, sub, check, scope) {
  const h = createHash('sha256');
  h.update(canonical({ agent, subscription_id: sub, check_id: check, scope: scope ?? null }));
  return h.digest('hex');
}

function makeTaskId(agent, sub, check, hash) {
  return `${agent}:${sub}:${check}:${hash.slice(0, 8)}`;
}

function manifestPath(runDir) {
  return join(runDir, 'tasks.jsonl');
}

function readRecords(runDir) {
  const p = manifestPath(runDir);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** Reduce the append-only log to the current state per task_id (last write wins). */
function currentState(runDir) {
  const state = new Map();
  for (const rec of readRecords(runDir)) state.set(rec.task_id, rec);
  return state;
}

function appendRecord(runDir, rec) {
  mkdirSync(runDir, { recursive: true });
  rec.updated_at = new Date().toISOString();
  appendFileSync(manifestPath(runDir), JSON.stringify(rec) + '\n');
}

function requireRun(args) {
  if (!args.run) { console.error('Error: --run <dir> is required.'); process.exit(1); }
  return args.run;
}

function cmdInit(args) {
  const runDir = requireRun(args);
  mkdirSync(runDir, { recursive: true });
  const p = manifestPath(runDir);
  if (!existsSync(p)) writeFileSync(p, '');
  console.log(`Initialized manifest: ${p}`);
}

function addOne(runDir, state, { agent, subscription_id, check_id, scope }) {
  const hash = scopeHash(agent, subscription_id, check_id, scope);
  const task_id = makeTaskId(agent, subscription_id, check_id, hash);
  if (state.has(task_id)) return { task_id, added: false };
  const rec = {
    task_id, agent, subscription_id, check_id, scope_hash: hash,
    status: 'pending', attempts: 0, output_refs: [],
  };
  appendRecord(runDir, rec);
  state.set(task_id, rec);
  return { task_id, added: true };
}

function cmdAdd(args) {
  const runDir = requireRun(args);
  for (const k of ['agent', 'subscription', 'check']) {
    if (!args[k]) { console.error(`Error: --${k} is required.`); process.exit(1); }
  }
  let scope = null;
  if (typeof args.scope === 'string') { try { scope = JSON.parse(args.scope); } catch { scope = args.scope; } }
  const state = currentState(runDir);
  const r = addOne(runDir, state, { agent: args.agent, subscription_id: args.subscription, check_id: args.check, scope });
  console.log(`${r.added ? 'Added' : 'Exists'}: ${r.task_id}`);
}

function cmdAddPlan(args) {
  const runDir = requireRun(args);
  if (!args.plan) { console.error('Error: --plan <file> is required.'); process.exit(1); }
  const plan = JSON.parse(readFileSync(resolve(process.cwd(), args.plan), 'utf8'));
  if (!Array.isArray(plan)) { console.error('Error: plan must be a JSON array.'); process.exit(1); }
  const state = currentState(runDir);
  let added = 0;
  for (const t of plan) {
    const agent = t.agent;
    const sub = t.subscription_id ?? t.subscription;
    const check = t.check_id ?? t.check;
    if (!agent || !sub || !check) { console.error(`Skipping malformed task: ${JSON.stringify(t)}`); continue; }
    if (addOne(runDir, state, { agent, subscription_id: sub, check_id: check, scope: t.scope ?? null }).added) added++;
  }
  console.log(`Added ${added} new task(s) (${plan.length - added} already present).`);
}

function cmdSetStatus(args) {
  const runDir = requireRun(args);
  if (!args.task || !args.status) { console.error('Error: --task and --status are required.'); process.exit(1); }
  const valid = ['pending', 'running', 'done', 'failed', 'throttled', 'partial', 'skipped'];
  if (!valid.includes(args.status)) { console.error(`Error: --status must be one of ${valid.join(', ')}.`); process.exit(1); }
  const state = currentState(runDir);
  const cur = state.get(args.task);
  if (!cur) { console.error(`Error: unknown task_id '${args.task}'. Use 'list' to see tasks.`); process.exit(1); }
  const rec = { ...cur, status: args.status };
  rec.attempts = (cur.attempts || 0) + (args.status === 'running' ? 1 : 0);
  if (args.ref.length) rec.output_refs = [...new Set([...(cur.output_refs || []), ...args.ref])];
  if (typeof args.reason === 'string') rec.reason = args.reason;
  delete rec.updated_at;
  appendRecord(runDir, rec);
  console.log(`${args.task} -> ${args.status}`);
}

function cmdList(args) {
  const runDir = requireRun(args);
  let rows = [...currentState(runDir).values()];
  if (typeof args.status === 'string') rows = rows.filter((r) => r.status === args.status);
  rows.sort((a, b) => a.task_id.localeCompare(b.task_id));
  for (const r of rows) {
    console.log(`${r.status.padEnd(9)} ${r.task_id}${r.reason ? '  (' + r.reason + ')' : ''}`);
  }
  console.log(`\n${rows.length} task(s).`);
}

function cmdNext(args) {
  const runDir = requireRun(args);
  const limit = args.limit ? parseInt(args.limit, 10) : Infinity;
  const ready = [...currentState(runDir).values()]
    .filter((r) => ['pending', 'failed', 'throttled'].includes(r.status))
    .sort((a, b) => a.task_id.localeCompare(b.task_id))
    .slice(0, limit);
  console.log(JSON.stringify(ready, null, 2));
}

function cmdStats(args) {
  const runDir = requireRun(args);
  const rows = [...currentState(runDir).values()];
  const by = {};
  for (const r of rows) by[r.status] = (by[r.status] || 0) + 1;
  const done = (by.done || 0) + (by.partial || 0);
  console.log(JSON.stringify({
    total: rows.length,
    by_status: by,
    complete_pct: rows.length ? Math.round((done / rows.length) * 1000) / 10 : 0,
  }, null, 2));
}

function asFindings(text) {
  const t = text.trim();
  if (!t) return [];
  if (t[0] === '[') return JSON.parse(t);
  if (t[0] === '{') {
    const o = JSON.parse(t);
    if (Array.isArray(o.findings)) return o.findings;
    return [o];
  }
  return t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

function mergeFinding(base, next) {
  const byId = new Map();
  for (const r of base.affected_resources || []) byId.set(r.resource_id, r);
  for (const r of next.affected_resources || []) if (!byId.has(r.resource_id)) byId.set(r.resource_id, r);
  base.affected_resources = [...byId.values()];
  if (base.affected_resources.length) base.affected_count = base.affected_resources.length;
  return base;
}

function cmdReduce(args) {
  const runDir = requireRun(args);
  if (!args.out) { console.error('Error: --out <file> is required.'); process.exit(1); }
  const sessionDir = resolve(runDir, '..'); // output_refs are relative to the session folder
  const state = [...currentState(runDir).values()];
  const merged = new Map();
  let refsRead = 0, missing = 0, rawCount = 0;
  for (const task of state) {
    if (!['done', 'partial'].includes(task.status)) continue;
    for (const ref of task.output_refs || []) {
      const p = isAbsolute(ref) ? ref : join(sessionDir, ref);
      if (!existsSync(p)) { missing++; continue; }
      refsRead++;
      for (const f of asFindings(readFileSync(p, 'utf8'))) {
        rawCount++;
        const key = f.dedupe_key || f.finding_id || f.id || canonical(f);
        if (merged.has(key)) mergeFinding(merged.get(key), f);
        else merged.set(key, { ...f, affected_resources: [...(f.affected_resources || [])] });
      }
    }
  }
  const findings = [...merged.values()].sort((a, b) => {
    const sa = SEVERITY_RANK[(a.severity || '').toLowerCase()] ?? 9;
    const sb = SEVERITY_RANK[(b.severity || '').toLowerCase()] ?? 9;
    if (sa !== sb) return sa - sb;
    return String(a.dedupe_key || a.id || '').localeCompare(String(b.dedupe_key || b.id || ''));
  });
  const outPath = resolve(process.cwd(), args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(findings, null, 2) + '\n');
  console.log(`Reduced ${rawCount} raw finding(s) from ${refsRead} file(s) -> ${findings.length} deduped finding(s).`);
  if (missing) console.log(`(${missing} referenced output file(s) not found — recorded as gaps upstream.)`);
  console.log(`Wrote ${outPath}`);
}

function main() {
  const cmd = process.argv[2];
  const args = parseArgs(process.argv);
  switch (cmd) {
    case 'init': return cmdInit(args);
    case 'add': return cmdAdd(args);
    case 'add-plan': return cmdAddPlan(args);
    case 'set-status': return cmdSetStatus(args);
    case 'list': return cmdList(args);
    case 'next': return cmdNext(args);
    case 'stats': return cmdStats(args);
    case 'reduce': return cmdReduce(args);
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

main();
