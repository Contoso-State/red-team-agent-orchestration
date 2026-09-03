#!/usr/bin/env node
/**
 * utilization-benchmark.mjs — measures how fully the framework actually EXERCISES the
 * graph runner (tools/graph/run-graph.mjs) and the self-improving loop
 * (tools/graph/self-improve.mjs), and scores it out of 100.
 *
 * This is not a mock. It drives the REAL canonical graph (graph/redteam.graph.json) end to
 * end through `runSelfImprovingGraph`, dispatching specialists into the REAL deterministic
 * checks engine (tools/checks/run-checks.mjs) over the shipped predicate packs. It proves,
 * with evidence, that every moving part is genuinely used:
 *
 *   A. MAIN read-only run  — every node KIND is visited, the fan-out maps one specialist per
 *      in-scope roster domain, the checks engine actually evaluates predicates, the
 *      evaluator-optimizer scores + tunes params, the Agent-as-a-Judge FP gate runs, the
 *      reflexion debrief persists to methodology memory, and checkpoints are written.
 *   B. REFLECTION run      — forces sub-threshold quality so the bounded evaluator->refine
 *      loop actually iterates and then terminates within params.max_revisions.
 *   C. HITL run            — drives a gated active mode so the human-in-the-loop interrupt
 *      pauses, then resumes on approval (the active lanes themselves stay read-only no-ops;
 *      we exercise the interrupt/approve/resume machinery, not real active testing).
 *
 * Plus the immutable boundary: the memory firewall must refuse a guardrail-namespace write.
 *
 * Offline (default) it runs against each pack's committed rows.sample.json, so it is fully
 * deterministic and dependency-free (Node stdlib only) — safe for CI and unit tests. With
 * `--live` it collects real rows from Azure Resource Graph (read-only) for real-world evidence.
 *
 * Usage:
 *   node tools/graph/utilization-benchmark.mjs                 # offline, print the scorecard
 *   node tools/graph/utilization-benchmark.mjs --json          # machine-readable scorecard
 *   node tools/graph/utilization-benchmark.mjs --check [--min 95]   # exit non-zero if score < min
 *   node tools/graph/utilization-benchmark.mjs --live [--subscription <id>]   # score vs live ARG
 */

import { readFileSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { ROOT, loadGraph, runGraph, makeMemoryStore } from './run-graph.mjs';
import { validateGraph, loadAgentNames } from './validate-graph.mjs';
import { runSelfImprovingGraph, makeProceduralStore, makeAuditLog, assertMethodologyNamespace } from './self-improve.mjs';
import { loadPack, evaluateEntry } from '../checks/run-checks.mjs';

// ---------------------------------------------------------------------------
// Roster domain -> predicate pack(s). Mirrors the specialist->domain mapping the
// orchestrator uses; a domain can span multiple packs (e.g. data = storage + database).
// ---------------------------------------------------------------------------

export const DOMAIN_PACKS = {
  identity: ['identity', 'rbac'],
  network: ['network'],
  compute: ['compute'],
  'aks-container': ['container'],
  data: ['storage', 'database'],
  web: ['web'],
  ai: ['ai'],
  easm: ['easm'],
  logging: ['logging'],
  governance: ['governance'],
  supplychain: ['supplychain'],
  email: ['email'],
};

const NOW = '2026-08-03T00:00:00.000Z';

function packFile(pack) {
  return join(ROOT, 'checks', pack, 'predicates.json');
}
function sampleFile(pack) {
  return join(ROOT, 'checks', pack, 'rows.sample.json');
}

function loadPackCached(cache, pack) {
  if (!cache.has(pack)) cache.set(pack, loadPack(readFileSync(packFile(pack), 'utf8')));
  return cache.get(pack);
}

/** Offline rows provider: each pack evaluates against its committed sample rows. */
export function offlineRowsProvider() {
  const cache = new Map();
  return (pack) => {
    if (!cache.has(pack)) cache.set(pack, JSON.parse(readFileSync(sampleFile(pack), 'utf8')));
    return cache.get(pack);
  };
}

// ---------------------------------------------------------------------------
// Dispatch factory: the REAL specialist dispatch wired into the checks engine.
// Branches on node.id because preflight/run_specialist/correlate/report/active
// lanes are all `dispatch` kind in the canonical graph.
// ---------------------------------------------------------------------------

function buildAttackPaths(confirmed) {
  const list = Array.isArray(confirmed) ? confirmed : [];
  const bySub = new Map();
  for (const f of list) {
    const s = f.subscription_id || '';
    if (!bySub.has(s)) bySub.set(s, []);
    bySub.get(s).push(f);
  }
  const paths = [];
  for (const [sub, fs] of bySub) {
    if (fs.length >= 2) {
      paths.push({ subscription_id: sub, length: Math.min(fs.length, 5), hops: fs.slice(0, 5).map((f) => f.check_id || f.finding_class) });
    }
  }
  return paths;
}

export function makeDispatchFactory({ rowsProvider, packCache = new Map(), seq = {}, now = NOW, stats = null } = {}) {
  return function dispatch(node, ctx) {
    switch (node.id) {
      case 'preflight_inventory':
        return { writes: { inventory_ref: 'engagements/benchmark/inventory/resources.jsonl' } };
      case 'run_specialist': {
        const domain = ctx.item?.domain || ctx.roster?.domain;
        const packs = DOMAIN_PACKS[domain] || [];
        const findings = [];
        for (const pack of packs) {
          const p = loadPackCached(packCache, pack);
          const rows = rowsProvider(pack);
          for (const entry of p.predicates) {
            const res = evaluateEntry(entry, rows, seq, now);
            if (stats) {
              stats.checksTotal += 1;
              if (res.ran) stats.checksRan += 1;
              stats.matched += res.matched;
            }
            for (const f of res.findings) findings.push(f);
          }
        }
        if (stats && domain) stats.specialistsRun.add(domain);
        return { writes: { raw_findings: findings } };
      }
      case 'correlate':
        return { writes: { attack_paths: buildAttackPaths(ctx.state.confirmed_findings) } };
      case 'report':
        return {
          writes: {
            report_refs: [
              'engagements/benchmark/reports/leadership-summary.md',
              'engagements/benchmark/reports/report.html',
            ],
          },
        };
      case 'eva_active':
      case 'cluster_active':
        // Gated active lanes: read-only no-op here. The benchmark exercises the
        // interrupt/approve/resume machinery, never real active testing.
        return {};
      default:
        return {};
    }
  };
}

// ---------------------------------------------------------------------------
// The three graph sub-runs.
// ---------------------------------------------------------------------------

function nodeKinds(graph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  const all = new Set(graph.nodes.map((n) => n.kind));
  return { byId, all };
}

function inScopeRosterCount(graph, scope) {
  return (graph.roster || []).filter((r) => !r.when || scope[r.when] === true).length;
}

/** Sub-run A: the canonical read-only assessment, fully self-improving. */
export function runMain(graph, { rowsProvider, env } = {}) {
  const store = makeProceduralStore();
  const audit = makeAuditLog();
  const checkpoints = [];
  const stats = { checksRan: 0, checksTotal: 0, matched: 0, specialistsRun: new Set() };
  const dispatch = makeDispatchFactory({ rowsProvider, seq: {}, stats });
  const res = runSelfImprovingGraph(graph, {
    scope: { mode: 'read-only-assessment', m365_in_scope: false },
    store,
    audit,
    dispatchFn: dispatch,
    onCheckpoint: (rec) => checkpoints.push({ node: rec.node, status: rec.status }),
    env,
  });
  return { res, store, audit, checkpoints, stats };
}

/** Sub-run B: force sub-threshold quality to drive the bounded reflection loop. */
export function runReflection(graph, { rowsProvider, env } = {}) {
  const store = makeProceduralStore();
  const audit = makeAuditLog();
  const dispatch = makeDispatchFactory({ rowsProvider, seq: {} });
  const res = runSelfImprovingGraph(graph, {
    scope: { mode: 'read-only-assessment', m365_in_scope: false },
    store,
    audit,
    dispatchFn: dispatch,
    quality: 0.5, // below params.quality_threshold (0.85) -> evaluate routes to `refine`
    env,
  });
  return { res, store, audit };
}

/** Sub-run C: HITL interrupt + approve + resume on a gated active mode. */
export function runHitl(graph, { rowsProvider, env } = {}) {
  const store = makeProceduralStore();
  const audit = makeAuditLog();
  const dispatch = makeDispatchFactory({ rowsProvider, seq: {} });
  const scope = { mode: 'cluster-active-testing', m365_in_scope: false };
  const run1 = runSelfImprovingGraph(graph, { scope, store, audit, dispatchFn: dispatch, env });
  // run1 must pause at the authorization interrupt (no decision supplied yet).
  const run2 = run1.status === 'interrupted'
    ? runSelfImprovingGraph(graph, {
        scope,
        store,
        audit,
        dispatchFn: dispatch,
        initialState: run1.state,
        startAt: run1.node,
        decision: true, // human approves the gated active lane
        env,
      })
    : { status: 'skipped', state: {} };
  return { run1, run2, store, audit };
}

/** The immutable boundary: a guardrail-namespace write must be refused, twice over. */
export function checkMemoryFirewall() {
  let refusals = 0;
  try {
    makeMemoryStore().write('guardrails', { tampered: true });
  } catch {
    refusals += 1;
  }
  try {
    assertMethodologyNamespace('guardrails');
  } catch {
    refusals += 1;
  }
  return refusals === 2;
}

// ---------------------------------------------------------------------------
// Scorecard.
// ---------------------------------------------------------------------------

function hasAudit(audit, action) {
  return audit.entries().some((e) => e.action === action);
}
function auditEvent(audit, action) {
  return audit.entries().find((e) => e.action === action);
}
function storeKinds(store, kind) {
  return (store.load('methodology').entries || []).filter((e) => e && e.kind === kind);
}

export function scoreUtilization(graph, { main, reflection, hitl, firewallOk }) {
  const { byId, all } = nodeKinds(graph);
  const totalKinds = all.size;
  const visitedKinds = new Set(main.res.path.filter((id) => byId.has(id)).map((id) => byId.get(id)));

  const inScope = inScopeRosterCount(graph, { mode: 'read-only-assessment', m365_in_scope: false });

  const candidates = main.res.state.candidate_findings || [];
  const keys = candidates.map((f) => f.dedupe_key || f.finding_id || f.id || JSON.stringify(f));
  const dedupeOk = new Set(keys).size === keys.length;

  const learningCandidates = storeKinds(main.store, 'learning_candidate');
  const reflexionEntries = storeKinds(main.store, 'reflexion_debrief');
  const judgeEvt = auditEvent(main.audit, 'judge.gate');

  const revision = reflection.res.state.revision || 0;
  const maxRev = reflection.res.params?.max_revisions ?? graph.params?.max_revisions ?? 2;

  const items = [];
  const add = (id, label, ok, points, max, detail) =>
    items.push({ id, label, ok: Boolean(ok), points: ok ? max : points, max, detail });

  // 1. Graph is structurally valid (5)
  const { errors } = validateGraph(graph, { agentNames: loadAgentNames() });
  add('graph-valid', 'Canonical graph validates', errors.length === 0, 0, 5, `${errors.length} error(s)`);

  // 2. Every node KIND is exercised (12, proportional)
  const kindPts = Math.round((visitedKinds.size / totalKinds) * 12);
  items.push({
    id: 'node-kind-coverage',
    label: 'Every node kind visited',
    ok: visitedKinds.size === totalKinds,
    points: kindPts,
    max: 12,
    detail: `${visitedKinds.size}/${totalKinds} kinds`,
  });

  // 3. Fan-out dispatches one specialist per in-scope roster domain (9)
  add('fanout-roster', 'Fan-out covers in-scope roster', main.stats.specialistsRun.size === inScope, 0, 9,
    `${main.stats.specialistsRun.size}/${inScope} specialists`);

  // 4. The deterministic checks engine actually ran predicates (10)
  add('checks-engine', 'Checks engine evaluated predicates', main.stats.checksRan >= 1, 0, 10,
    `${main.stats.checksRan}/${main.stats.checksTotal} predicates ran`);

  // 5. The Agent-as-a-Judge node ran (5)
  add('judge-ran', 'Agent-as-a-Judge gate executed', hasAudit(main.audit, 'judge.gate'), 0, 5, judgeEvt ? 'judge.gate recorded' : 'missing');

  // 6. Candidate findings are deduped correctly (4)
  add('dedupe', 'merge_findings dedupe is correct', dedupeOk, 0, 4, `${keys.length} candidates, ${new Set(keys).size} unique`);

  // 7. Evaluator-optimizer scored and staged a bounded, inert candidate (10)
  add('evaluator-optimizer', 'Evaluator-optimizer staged a learning candidate', hasAudit(main.audit, 'evaluate.score') && learningCandidates.length >= 1, 0, 10,
    `${learningCandidates.length} learning_candidate entr(ies)`);

  // 8. Bounded reflection loop iterated and terminated within max_revisions (12)
  const reflectionOk = reflection.res.status === 'completed' && revision > 1 && revision <= maxRev;
  add('reflection-loop', 'Bounded evaluator->refine loop', reflectionOk, 0, 12, `revision=${revision}, max=${maxRev}, ${reflection.res.status}`);

  // 9. Judge FP-gate audit carries the gate shape (8)
  const gateShape = judgeEvt && Number.isFinite(judgeEvt.candidates) && Number.isFinite(judgeEvt.confirmed);
  add('fp-gate-audit', 'FP-gate audit recorded', gateShape, 0, 8, gateShape ? `candidates=${judgeEvt.candidates}, confirmed=${judgeEvt.confirmed}` : 'missing');

  // 10. Reflexion debrief persisted to methodology memory (10)
  add('reflexion-debrief', 'Reflexion debrief persisted', reflexionEntries.length >= 1 && hasAudit(main.audit, 'reflexion.debrief'), 0, 10,
    `${reflexionEntries.length} debrief entr(ies)`);

  // 11. Checkpoints written for the run (4)
  add('checkpoints', 'Checkpoints recorded', main.checkpoints.length >= 8, 0, 4, `${main.checkpoints.length} checkpoints`);

  // 12. HITL interrupt paused then resumed on approval (6)
  const hitlOk =
    hitl.run1.status === 'interrupted' &&
    hitl.run1.node === 'authorize_active' &&
    hitl.run2.status === 'completed' &&
    hitl.run2.state.approved === true;
  add('hitl', 'HITL interrupt + approve + resume', hitlOk, 0, 6, `${hitl.run1.status} -> ${hitl.run2.status}`);

  // 13. Memory firewall refuses guardrail writes (5)
  add('memory-firewall', 'Memory firewall enforced', firewallOk, 0, 5, firewallOk ? 'guardrail writes refused' : 'NOT enforced');

  const score = items.reduce((a, it) => a + it.points, 0);
  const max = items.reduce((a, it) => a + it.max, 0);
  return { score, max, items };
}

// ---------------------------------------------------------------------------
// Turnkey benchmark (offline unless a live rows provider is supplied).
// ---------------------------------------------------------------------------

export function runBenchmark({ graph, rowsProvider, env } = {}) {
  const provider = rowsProvider || offlineRowsProvider();
  const main = runMain(graph, { rowsProvider: provider, env });
  const reflection = runReflection(graph, { rowsProvider: provider, env });
  const hitl = runHitl(graph, { rowsProvider: provider, env });
  const firewallOk = checkMemoryFirewall();
  const card = scoreUtilization(graph, { main, reflection, hitl, firewallOk });
  return { ...card, main, reflection, hitl, firewallOk };
}

// ---------------------------------------------------------------------------
// Live Azure Resource Graph rows provider (read-only). Only used with --live.
// ---------------------------------------------------------------------------

const pexec = promisify(execFile);
const IS_WIN = process.platform === 'win32';

function quoteShellArg(value) {
  const s = String(value);
  const safe = IS_WIN ? /^[A-Za-z0-9_.:@+=/\\-]+$/ : /^[A-Za-z0-9_.:@+=/-]+$/;
  if (safe.test(s)) return s;
  return IS_WIN ? `"${s.replace(/"/g, '""')}"` : `'${s.replace(/'/g, `'\\''`)}'`;
}

async function azGraphQuery(kql, subscription) {
  // DEP0190-safe: on Windows fold args into a single quoted command string (no args[] +
  // shell:true); on POSIX run az directly with no shell.
  const args = ['graph', 'query', '-q', kql, '--first', '1000', '-o', 'json'];
  if (subscription) args.push('--subscriptions', subscription);
  const opts = { windowsHide: true, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 };
  const { stdout } = IS_WIN
    ? await pexec(['az', ...args].map(quoteShellArg).join(' '), { shell: true, ...opts })
    : await pexec('az', args, opts);
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed : parsed.data || [];
}

async function buildLiveRowsProvider({ subscription } = {}) {
  const packCache = new Map();
  const rowsCache = new Map(); // pack -> { check_id: rows[] }
  const allPacks = [...new Set(Object.values(DOMAIN_PACKS).flat())];
  for (const pack of allPacks) {
    const p = loadPackCached(packCache, pack);
    const payload = {};
    for (const entry of p.predicates) {
      const kql = entry.query?.kql;
      if (!kql) continue;
      try {
        payload[entry.check_id] = await azGraphQuery(kql, subscription);
      } catch (err) {
        process.stderr.write(`  ! live query failed for ${entry.check_id}: ${String(err.message || err).split('\n')[0]}\n`);
      }
    }
    rowsCache.set(pack, payload);
  }
  return (pack) => rowsCache.get(pack) || {};
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    const key = eq >= 0 ? a.slice(2, eq) : a.slice(2);
    const val = eq >= 0 ? a.slice(eq + 1) : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
    out[key] = val;
  }
  return out;
}

function renderCard(card, { live }) {
  const lines = [];
  lines.push(`Graph & self-improving-loop utilization: ${card.score}/${card.max}  (${live ? 'LIVE Azure Resource Graph' : 'offline sample rows'})`);
  lines.push('─'.repeat(64));
  for (const it of card.items) {
    const mark = it.points === it.max ? '✓' : it.points > 0 ? '◐' : '✗';
    lines.push(`  ${mark} ${String(it.points).padStart(2)}/${String(it.max).padStart(2)}  ${it.label}  (${it.detail})`);
  }
  lines.push('─'.repeat(64));
  return lines.join('\n');
}

async function main(argv) {
  const args = parseArgs(argv);
  const rel = typeof args.graph === 'string' ? args.graph : join('graph', 'redteam.graph.json');
  const graphPath = isAbsolute(rel) ? rel : resolve(ROOT, rel);
  const { graph, error } = loadGraph(graphPath);
  if (error) { console.error(`✖ could not load graph ${graphPath}: ${error}`); process.exit(1); }

  const live = Boolean(args.live);
  const rowsProvider = live
    ? await buildLiveRowsProvider({ subscription: typeof args.subscription === 'string' ? args.subscription : undefined })
    : offlineRowsProvider();

  const card = runBenchmark({ graph, rowsProvider });

  if (args.json) {
    console.log(JSON.stringify({ score: card.score, max: card.max, live, items: card.items }, null, 2));
  } else {
    console.log(renderCard(card, { live }));
  }

  const min = Number.isFinite(Number(args.min)) ? Number(args.min) : 95;
  if (args.check) {
    if (card.score < min) {
      console.error(`✖ utilization ${card.score}/${card.max} is below the ${min} bar`);
      process.exit(1);
    }
    console.log(`✓ utilization ${card.score}/${card.max} meets the ${min} bar`);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv);
}
