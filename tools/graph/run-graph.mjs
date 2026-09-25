#!/usr/bin/env node
/**
 * run-graph.mjs — dependency-free execution engine for the canonical engagement graph.
 *
 * This is the Node "Pregel-lite" runner that executes graph/redteam.graph.json inside the
 * four CLI runtimes (Copilot/Claude/Codex/Cursor). It owns the deterministic control plane
 * of an engagement:
 *
 *   - typed state channels with per-channel reducers (last / append / merge_findings),
 *   - the fan-out Send over the in-scope specialist roster and the deterministic reduce,
 *   - the bounded evaluator->refine reflection loop (route_after_evaluate),
 *   - the human-in-the-loop authorization interrupt for the gated active lanes
 *     (pause -> approve/reject -> resume), with route_active lane selection,
 *   - durable checkpoint + resume so a long run survives a crash or an interrupt.
 *
 * The engine does NOT itself call Azure or an LLM. Node execution is delegated to a HANDLER
 * registry that the host runtime overrides: the real specialist dispatch is performed by the
 * orchestrator agent in the CLI runtime, while the engine guarantees the topology, state
 * merges, loop bounds, routing, and checkpointing are identical everywhere. Default handlers
 * are deterministic and side-effect-limited so the whole graph runs end-to-end as a `--dry-run`
 * (and in unit tests) with no Azure credentials. The self-improvement handlers (evaluator-
 * optimizer, Agent-as-a-Judge FP gate, methodology memory) are layered on top in
 * tools/graph/self-improve.mjs; this file provides safe deterministic defaults for them.
 *
 * Usage:
 *   node tools/graph/run-graph.mjs                       # dry-run the shipped graph, print the path
 *   node tools/graph/run-graph.mjs --graph <path>        # run a specific graph
 *   node tools/graph/run-graph.mjs --engagement <yaml>   # seed scope from an engagement file
 *   node tools/graph/run-graph.mjs --session <dir>       # persist checkpoints under <dir>/runs
 *   node tools/graph/run-graph.mjs --resume [--approve|--reject]   # resume a paused interrupt
 *
 * Read-only with respect to Azure. Writes only checkpoints/memory inside the session folder
 * and the methodology memory namespace. Dependency-free (Node stdlib only).
 */

import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, isAbsolute, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mergeFinding } from '../orchestration/manifest.mjs';
import { ROOT, loadGraph, validateGraph, loadAgentNames, GUARD_NAMESPACES } from './validate-graph.mjs';
import { createEventWriter } from '../dashboard/events.mjs';
import {
  applyLearnedParams,
  makeAuditLog,
  makeProceduralStore,
  makeSelfImprovementHandlers,
} from './self-improve.mjs';

// Re-export the graph-loading helpers so callers can drive the runner from one module.
export { ROOT, loadGraph } from './validate-graph.mjs';

// ---------------------------------------------------------------------------
// State + reducers
// ---------------------------------------------------------------------------

export const REDUCERS = {
  last: (_cur, val) => val,
  append: (cur, val) => [...(Array.isArray(cur) ? cur : []), ...(Array.isArray(val) ? val : [val])],
  merge_findings: (cur, val) => {
    const list = Array.isArray(cur) ? cur.map((f) => ({ ...f })) : [];
    const byKey = new Map();
    for (const f of list) byKey.set(findingKey(f), f);
    for (const f of Array.isArray(val) ? val : [val]) {
      if (f == null) continue;
      const key = findingKey(f);
      if (byKey.has(key)) mergeFinding(byKey.get(key), f);
      else {
        const copy = { ...f, affected_resources: [...(f.affected_resources || [])] };
        byKey.set(key, copy);
        list.push(copy);
      }
    }
    return [...byKey.values()];
  },
};

function findingKey(f) {
  return f.dedupe_key || f.finding_id || f.id || JSON.stringify(f);
}

/** Build the initial state object with each channel seeded per its declared shape. */
export function initialState(graph) {
  const state = {};
  const channels = graph.state?.channels || {};
  for (const [name, ch] of Object.entries(channels)) {
    if (ch.reducer === 'append' || ch.reducer === 'merge_findings') state[name] = [];
    else if (chanIsNumber(ch)) state[name] = 0;
    else state[name] = null;
  }
  return state;
}

function chanIsNumber(ch) {
  const t = ch.type;
  return t === 'number' || (Array.isArray(t) && t.includes('number'));
}

/** Apply a single channel write through its reducer. */
export function applyWrite(state, graph, channel, value) {
  const ch = graph.state?.channels?.[channel];
  if (!ch) throw new Error(`write to unknown channel "${channel}"`);
  const reducer = REDUCERS[ch.reducer];
  if (!reducer) throw new Error(`channel "${channel}" has unknown reducer "${ch.reducer}"`);
  state[channel] = reducer(state[channel], value);
}

function applyResults(state, graph, res) {
  if (!res || !res.writes) return;
  const entries = Array.isArray(res.writes)
    ? res.writes.map((w) => [w.channel, w.value])
    : Object.entries(res.writes);
  for (const [channel, value] of entries) applyWrite(state, graph, channel, value);
}

// ---------------------------------------------------------------------------
// Methodology memory store (firewalled). W3 replaces the persistence with a
// richer procedural Store; here it enforces the one invariant that matters: a
// write can only ever target a non-guardrail namespace.
// ---------------------------------------------------------------------------

export function makeMemoryStore({ root = ROOT, persist = false } = {}) {
  const mem = new Map();
  const dir = join(root, 'memory');
  const assertNamespace = (ns) => {
    if (typeof ns !== 'string' || !ns) throw new Error('memory namespace is required');
    if (GUARD_NAMESPACES.has(ns)) {
      throw new Error(`MEMORY FIREWALL: refusing to write guardrail namespace "${ns}"`);
    }
  };
  return {
    load(ns) {
      assertNamespace(ns);
      if (mem.has(ns)) return mem.get(ns);
      const p = join(dir, `${ns}.store.json`);
      if (persist && existsSync(p)) {
        try {
          const val = JSON.parse(readFileSync(p, 'utf8'));
          mem.set(ns, val);
          return val;
        } catch {
          /* fall through to empty */
        }
      }
      return { entries: [] };
    },
    write(ns, entry) {
      assertNamespace(ns);
      const cur = this.load(ns);
      const next = { entries: [...(cur.entries || []), entry] };
      mem.set(ns, next);
      if (persist) {
        mkdirSync(dir, { recursive: true });
        appendFileSync(join(dir, `${ns}.log.jsonl`), JSON.stringify({ ts: new Date().toISOString(), entry }) + '\n');
      }
      return next;
    },
  };
}

// ---------------------------------------------------------------------------
// Routers (conditional edges)
// ---------------------------------------------------------------------------

export function defaultRouters() {
  return {
    route_after_evaluate(state, params) {
      const rev = state.revision || 0;
      const quality = state.critique?.quality ?? 1;
      if (rev < (params.max_revisions ?? 0) && quality < (params.quality_threshold ?? 0)) return 'refine';
      return 'proceed';
    },
    route_active(state) {
      const mode = state.scope?.mode || 'read-only-assessment';
      if (mode === 'external-active-testing') return 'external_active';
      if (mode === 'cluster-active-testing') return 'cluster_active';
      return 'none';
    },
  };
}

// ---------------------------------------------------------------------------
// Default node handlers. Deterministic, no Azure, no LLM. The host runtime
// overrides dispatch/evaluator/judge with real implementations.
// ---------------------------------------------------------------------------

/** Build an evidence-reference summary. A reference alone never proves collection succeeded. */
export function buildSecurityContext(state = {}) {
  const inventoryRef = typeof state.inventory_ref === 'string' && state.inventory_ref.trim()
    ? state.inventory_ref : null;
  return {
    version: 'security-context/v1',
    status: 'summary-only',
    scope: {
      mode: state.scope?.mode || 'read-only-assessment',
      domains: state.scope?.domains || [],
      resource_types: state.scope?.resource_types || [],
    },
    inventory: {
      ref: inventoryRef,
      status: inventoryRef ? 'referenced' : 'missing',
    },
    signals: {
      defender_endpoint: { status: 'unavailable', evidence_refs: [] },
      entra_identity: { status: 'unavailable', evidence_refs: [] },
      sentinel: { status: 'unavailable', evidence_refs: [] },
      defender_cloud: { status: 'unavailable', evidence_refs: [] },
      arm: {
        status: inventoryRef ? 'unverified' : 'unavailable',
        evidence_refs: inventoryRef ? [inventoryRef] : [],
      },
      behavior_analytics: { status: 'unavailable', evidence_refs: [] },
      exposure_management: { status: 'unavailable', evidence_refs: [] },
      threat_intelligence: { status: 'unavailable', evidence_refs: [] },
    },
    handoff: {
      instructions: [
        'Treat unavailable and unverified signals as coverage gaps, not clean results.',
        'Use evidence_refs to retrieve source summaries.',
        'Verify source provenance and collection success before treating a reference as evidence.',
        'Never infer a signal that is not present.',
      ],
    },
  };
}

function isThenable(value) {
  return value != null && typeof value.then === 'function';
}

function requireSynchronousResult(result, node) {
  if (isThenable(result)) {
    // Avoid an unhandled rejection while rejecting async handlers in the sync runner.
    Promise.resolve(result).catch(() => {});
    throw new Error(`node "${node.id}" returned a Promise; use runGraphAsync for async handlers`);
  }
  return result || {};
}

export function defaultHandlers({ store } = {}) {
  const memory = store || makeMemoryStore();
  return {
    validate(node, ctx) {
      // Scope is normally seeded from engagement.yaml by the caller; pass it through.
      const scope = ctx.scope || { mode: 'read-only-assessment', m365_in_scope: false };
      return { writes: { scope } };
    },
    memory_read(node) {
      return { writes: { memory: memory.load(node.namespace || 'methodology') } };
    },
    context(node, ctx) {
      const context = typeof ctx.securityContext === 'function'
        ? ctx.securityContext(node, ctx)
        : buildSecurityContext(ctx.state);
      if (isThenable(context)) {
        return Promise.resolve(context).then((value) => ({ writes: { [node.writes]: value } }));
      }
      return { writes: { [node.writes]: context } };
    },
    // dispatch is a no-op in the engine: the CLI orchestrator performs the real
    // read-only specialist run. A caller-supplied dispatch handler emits findings.
    dispatch(node, ctx) {
      if (typeof ctx.dispatch === 'function') return ctx.dispatch(node, ctx) || {};
      return {};
    },
    reduce(node, ctx) {
      // fold the source channel into the target channel using the target's reducer
      const src = node.reads ? ctx.state[node.reads] : [];
      return { writes: { [node.writes]: src || [] } };
    },
    evaluator(node, ctx) {
      // Deterministic default: proceed immediately (quality at threshold). W3 swaps
      // in the evaluator-optimizer that actually scores and can drive the refine loop.
      const rev = (ctx.state.revision || 0) + 1;
      const quality = typeof ctx.quality === 'number' ? ctx.quality : 1;
      return { writes: { critique: { quality, notes: [] }, revision: rev } };
    },
    judge(node, ctx) {
      // Default FP gate is identity (promote all candidates). W3 adds the read-only
      // re-verification gate + methodology FP-suppression memory write.
      const candidates = ctx.state.candidate_findings || [];
      const confirmed = typeof ctx.judge === 'function' ? ctx.judge(candidates, ctx) : candidates;
      return { writes: { confirmed_findings: confirmed } };
    },
    memory_write(node, ctx) {
      // Persist inert run metadata. Promotion policy lives in self-improve.mjs; this generic
      // runner remains firewalled to the node's non-guardrail namespace.
      memory.write(node.namespace || 'methodology', {
        node: node.id,
        confirmed: (ctx.state.confirmed_findings || []).length,
        ts: new Date().toISOString(),
      });
      return {};
    },
  };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

function indexGraph(graph) {
  const byId = new Map();
  for (const n of graph.nodes) byId.set(n.id, n);
  const edgeFrom = new Map();
  for (const e of graph.edges) {
    if (!edgeFrom.has(e.from)) edgeFrom.set(e.from, []);
    edgeFrom.get(e.from).push(e.to);
  }
  const condFrom = new Map();
  for (const c of graph.conditional_edges || []) condFrom.set(c.from, c);
  return { byId, edgeFrom, condFrom };
}

/** Which roster specialists are in scope (honors the `when` inclusion predicate). */
export function inScopeRoster(graph, state) {
  const scope = state.scope || {};
  const selectedDomains = Array.isArray(scope.domains) ? scope.domains : [];
  const selectedTypes = Array.isArray(scope.resource_types) ? scope.resource_types : [];
  const normalize = (value) => String(value).toLowerCase();
  const typeMatches = (selected, supported) => {
    if (typeof selected !== 'string' || typeof supported !== 'string') return false;
    const candidate = normalize(selected);
    const pattern = normalize(supported);
    // Select the intersection of two type sets; either side can name a provider wildcard.
    if (candidate.endsWith('/*') && pattern.startsWith(candidate.slice(0, -1))) return true;
    if (pattern.endsWith('/*') && candidate.startsWith(pattern.slice(0, -1))) return true;
    return candidate === pattern;
  };
  return (graph.roster || []).filter((r) => {
    if (!r.when) return true;
    if (scope[r.when] !== true && !(Array.isArray(scope.flags) && scope.flags.includes(r.when))) return false;
    return true;
  }).filter((r) => {
    if (selectedDomains.length && Array.isArray(r.scope_domains) &&
        !r.scope_domains.some((domain) => selectedDomains.includes(domain))) return false;
    if (selectedTypes.length && (!Array.isArray(r.resource_types) || !r.resource_types.length)) return false;
    if (selectedTypes.length && Array.isArray(r.resource_types) && r.resource_types.length &&
        !selectedTypes.some((selected) => r.resource_types.some((supported) => typeMatches(selected, supported)))) return false;
    return true;
  });
}

function getPath(value, path) {
  return String(path).split('.').reduce((current, key) => (
    current && typeof current === 'object' ? current[key] : undefined
  ), value);
}

function assertActiveRequirements(graph, scope, lane) {
  const mode = lane === 'external_active' ? 'external-active-testing' : 'cluster-active-testing';
  const node = graph.nodes.find((candidate) => candidate.gated?.mode === mode);
  const prefix = lane === 'external_active' ? 'external_testing' : 'cluster_testing';
  const enabledPath = `${prefix}.enabled`;
  const attestationPath = `${prefix}.authorization.attestation_id`;
  const requirements = node?.gated?.requires;
  if (!Array.isArray(requirements) || !requirements.includes(enabledPath) || !requirements.includes(attestationPath)) {
    throw new Error(`${mode} requires an explicit enabled and attestation gate`);
  }
  const missing = requirements.filter((path) => {
    const value = getPath(scope, path);
    if (path === enabledPath) return value !== true;
    if (path === attestationPath) return typeof value !== 'string' || !value.trim();
    return true; // Unknown requirement contracts fail closed.
  });
  if (missing.length) {
    throw new Error(`${mode} requires ${missing.join(', ')}`);
  }
}

/**
 * Execute the graph.
 * @returns {{ status:'completed'|'interrupted', state, path:string[], steps:number, prompt?:string, node?:string }}
 */
export function runGraph(graph, options = {}) {
  const params = { ...(graph.params || {}), ...(options.params || {}) };
  const routers = { ...defaultRouters(), ...(options.routers || {}) };
  const handlers = { ...defaultHandlers({ store: options.store }), ...(options.handlers || {}) };
  const maxSteps = options.maxSteps ?? 1000;
  const onCheckpoint = options.onCheckpoint || (() => {});
  const decision = options.decision; // one-shot human decision on resume (true/false/undefined)

  const { byId, edgeFrom, condFrom } = indexGraph(graph);
  const state = options.initialState || initialState(graph);
  const ctx = {
    graph,
    params,
    state,
    scope: options.scope,
    dispatch: options.dispatchFn,
    judge: options.judgeFn,
    quality: options.quality,
    securityContext: options.securityContextFn,
  };

  const runHandler = (node) => {
    const h = handlers[node.id] || handlers[node.kind];
    if (!h) return {};
    return requireSynchronousResult(h(node, ctx), node);
  };

  const linearNext = (nodeId) => {
    const outs = edgeFrom.get(nodeId) || [];
    return outs[0];
  };
  const conditionalNext = (nodeId) => {
    const cond = condFrom.get(nodeId);
    const label = routers[cond.router](state, params, ctx);
    const target = cond.branches[label];
    if (target === undefined) throw new Error(`router ${cond.router} returned unknown branch "${label}"`);
    return { label, target };
  };

  let current = options.startAt || linearNext('START');
  if (!current) throw new Error('graph has no START edge');
  const path = [];
  let steps = 0;

  const checkpoint = (status) => {
    const rec = { step: steps, node: current, status, ts: new Date().toISOString(), state: structuredClone(state) };
    onCheckpoint(rec);
  };

  while (current !== 'END') {
    if (++steps > maxSteps) throw new Error(`step budget exceeded (${maxSteps}); possible non-terminating loop`);
    const node = byId.get(current);
    if (!node) throw new Error(`unknown node "${current}"`);
    path.push(current);

    if (node.kind === 'fanout') {
      const child = byId.get(node.into);
      for (const item of inScopeRoster(graph, state)) {
        const childCtx = { ...ctx, item, roster: item };
        const h = handlers[child.id] || handlers[child.kind];
        const res = h ? requireSynchronousResult(h(child, childCtx), child) : {};
        applyResults(state, graph, res);
      }
      checkpoint('done');
      current = linearNext(node.into); // run_specialist -> collect_raw
      continue;
    }

    if (node.kind === 'interrupt') {
      const active = routers.route_active(state, params, ctx);
      if (active !== 'none') {
        assertActiveRequirements(graph, state.scope || {}, active);
        const known = state.approved;
        if (known == null && decision == null) {
          checkpoint('interrupted');
          return { status: 'interrupted', state, path, steps, prompt: node.prompt, node: current };
        }
        const approved = (known != null ? known : decision) === true;
        applyWrite(state, graph, 'approved', approved);
        if (!approved) {
          checkpoint('done');
          current = node.on_reject;
          continue;
        }
      }
      const cond = condFrom.get(current);
      const target = cond.branches[active];
      if (target === undefined) throw new Error(`route_active returned unknown branch "${active}"`);
      checkpoint('done');
      current = target;
      continue;
    }

    // ordinary node
    const res = runHandler(node);
    applyResults(state, graph, res);
    checkpoint('done');

    current = condFrom.has(current) ? conditionalNext(current).target : linearNext(current);
    if (current === undefined) throw new Error(`node "${node.id}" has no outgoing transition`);
  }

  path.push('END');
  return { status: 'completed', state, path, steps };
}

/**
 * Async graph execution for hosts whose dispatch handlers launch real agents.
 * Fan-out children are started together and their results are reduced in roster
 * order so execution is concurrent while state merging stays deterministic.
 */
export async function runGraphAsync(graph, options = {}) {
  const params = { ...(graph.params || {}), ...(options.params || {}) };
  const routers = { ...defaultRouters(), ...(options.routers || {}) };
  const handlers = { ...defaultHandlers({ store: options.store }), ...(options.handlers || {}) };
  const maxSteps = options.maxSteps ?? 1000;
  const onCheckpoint = options.onCheckpoint || (() => {});
  const decision = options.decision;
  const onSpecialistTimeout = options.onSpecialistTimeout || (() => {});
  const emit = options.emitEvent || (() => {});

  const { byId, edgeFrom, condFrom } = indexGraph(graph);
  const state = options.initialState || initialState(graph);
  const ctx = {
    graph,
    params,
    state,
    scope: options.scope,
    dispatch: options.dispatchFn,
    judge: options.judgeFn,
    quality: options.quality,
    securityContext: options.securityContextFn,
  };

  const runHandler = async (node, handlerCtx = ctx) => {
    const h = handlers[node.id] || handlers[node.kind];
    if (!h) return {};
    return (await h(node, handlerCtx)) || {};
  };
  const runBoundedDispatch = async (node) => {
    const timeoutSeconds = Number(params.dispatch_timeout_seconds ?? 600);
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
      throw new Error('dispatch_timeout_seconds must be a positive number');
    }
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        runHandler(node, { ...ctx, signal: controller.signal }),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort(new Error(`dispatch deadline exceeded (${timeoutSeconds}s)`));
            reject(new Error(`dispatch node "${node.id}" deadline exceeded (${timeoutSeconds}s)`));
          }, timeoutSeconds * 1000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const linearNext = (nodeId) => (edgeFrom.get(nodeId) || [])[0];
  const conditionalNext = (nodeId) => {
    const cond = condFrom.get(nodeId);
    const label = routers[cond.router](state, params, ctx);
    const target = cond.branches[label];
    if (target === undefined) throw new Error(`router ${cond.router} returned unknown branch "${label}"`);
    return target;
  };

  let current = options.startAt || linearNext('START');
  if (!current) throw new Error('graph has no START edge');
  const path = [];
  let steps = 0;
  const checkpoint = (status) => {
    const rec = { step: steps, node: current, status, ts: new Date().toISOString(), state: structuredClone(state) };
    onCheckpoint(rec);
  };

  while (current !== 'END') {
    if (++steps > maxSteps) throw new Error(`step budget exceeded (${maxSteps}); possible non-terminating loop`);
    const node = byId.get(current);
    if (!node) throw new Error(`unknown node "${current}"`);
    path.push(current);
    emit('node.started', { node_id: node.id, status: 'running' });

    if (node.kind === 'fanout') {
      const child = byId.get(node.into);
      const timeoutSeconds = Number(params.specialist_timeout_seconds ?? 900);
      if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
        throw new Error('specialist_timeout_seconds must be a positive number');
      }
      const subscriptionId =
        ctx.scope?.subscriptions?.[0]?.id ||
        ctx.scope?.subscription_id ||
        ctx.scope?.subscriptionId ||
        'unknown';
      const results = await Promise.all(
        inScopeRoster(graph, state).map(async (item) => {
          let timer;
          let timedOut = false;
          const controller = new AbortController();
          const timeout = new Promise((resolve) => {
            timer = setTimeout(() => {
              timedOut = true;
              controller.abort(new Error(`specialist deadline exceeded (${timeoutSeconds}s)`));
              resolve({ timedOut: true });
            }, timeoutSeconds * 1000);
          });
          try {
            emit('task.dispatched', { node_id: child.id, agent_id: item.agent, task_id: item.domain, status: 'pending' });
            emit('agent.started', { node_id: child.id, agent_id: item.agent, task_id: item.domain, status: 'running' });
            const childCtx = {
              ...ctx,
              state: structuredClone(state),
              item,
              roster: item,
              signal: controller.signal,
            };
            const result = await Promise.race([
              runHandler(child, childCtx).then((value) => ({ value })),
              timeout,
            ]);
            if (!result.timedOut) {
              emit('agent.completed', { node_id: child.id, agent_id: item.agent, task_id: item.domain, status: 'completed' });
              return result.value;
            }

            const gap = {
              domain: item.domain,
              check_id: '__specialist__',
              subscription_id: subscriptionId,
              type: '*',
              status: 'partial',
              count: 1,
              reason: `specialist deadline exceeded (${timeoutSeconds}s)`,
            };
            onSpecialistTimeout({ node: child.id, item, timeoutSeconds, coverageGap: gap });
            emit('agent.failed', { node_id: child.id, agent_id: item.agent, task_id: item.domain, status: 'failed' });
            return { writes: { coverage_gaps: [gap] } };
          } catch (error) {
            const reason = timedOut
              ? `specialist deadline exceeded (${timeoutSeconds}s)`
              : `specialist failed: ${error instanceof Error ? error.message : String(error)}`;
            emit('agent.failed', { node_id: child.id, agent_id: item.agent, task_id: item.domain, status: 'failed' });
            return {
              writes: {
                coverage_gaps: [{
                  domain: item.domain,
                  check_id: '__specialist__',
                  subscription_id: subscriptionId,
                  type: '*',
                  status: timedOut ? 'partial' : 'failed',
                  count: 1,
                  reason,
                }],
              },
            };
          } finally {
            clearTimeout(timer);
          }
        }),
      );
      for (const result of results) applyResults(state, graph, result);
      checkpoint('done');
      emit('node.completed', { node_id: node.id, status: 'completed' });
      current = linearNext(node.into);
      continue;
    }

    if (node.kind === 'interrupt') {
      const active = routers.route_active(state, params, ctx);
      if (active !== 'none') {
        assertActiveRequirements(graph, state.scope || {}, active);
        const known = state.approved;
        if (known == null && decision == null) {
          checkpoint('interrupted');
          emit('node.completed', { node_id: node.id, status: 'blocked' });
          return { status: 'interrupted', state, path, steps, prompt: node.prompt, node: current };
        }
        const approved = (known != null ? known : decision) === true;
        applyWrite(state, graph, 'approved', approved);
        if (!approved) {
          checkpoint('done');
          current = node.on_reject;
          continue;
        }
      }
      const cond = condFrom.get(current);
      const target = cond.branches[active];
      if (target === undefined) throw new Error(`route_active returned unknown branch "${active}"`);
      checkpoint('done');
      emit('node.completed', { node_id: node.id, status: 'completed' });
      current = target;
      continue;
    }

    const result = node.kind === 'dispatch'
      ? await runBoundedDispatch(node)
      : await runHandler(node);
    applyResults(state, graph, result);
    checkpoint('done');
    // A memory read is an observable step of the run, so report what was actually
    // retrieved — including an empty store. "Memory was consulted and held nothing"
    // is a different, more useful fact than a panel that simply never updates.
    if (node.kind === 'memory_read') {
      const entries = result?.writes?.[node.writes || 'memory']?.entries || [];
      const kindCount = (want) => entries.filter(e => e && e.kind === want).length;
      emit('memory.retrieved', {
        node_id: node.id,
        status: 'retrieved',
        metrics: {
          records: entries.length,
          retrieved: entries.length,
          knowledge_count: kindCount('knowledge'),
          experience_count: kindCount('experience'),
          suppression_count: kindCount('suppression'),
        },
      });
    }
    emit('node.completed', { node_id: node.id, status: 'completed' });
    current = condFrom.has(current) ? conditionalNext(current) : linearNext(current);
    if (current === undefined) throw new Error(`node "${node.id}" has no outgoing transition`);
  }

  path.push('END');
  return { status: 'completed', state, path, steps };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    out[key] = val;
  }
  return out;
}

function readEngagementScope(path) {
  // Minimal, dependency-free YAML sniff: we only need `mode:` and whether M365/email is in
  // scope. Anything richer is the validate node's job in the real runtime.
  try {
    const text = readFileSync(path, 'utf8');
    const modeMatch = text.match(/^\s*mode:\s*([A-Za-z0-9_-]+)/m);
    const mode = modeMatch ? modeMatch[1] : 'read-only-assessment';
    const m365 = /m365|email|exchange|office\s*365/i.test(text);
    return { mode, m365_in_scope: m365 };
  } catch (error) {
    throw new Error(`Cannot read requested engagement file: ${error.message}`);
  }
}

function checkpointWriter(sessionDir) {
  if (!sessionDir) return () => {};
  const runDir = join(sessionDir, 'runs');
  const file = join(runDir, 'graph-checkpoints.jsonl');
  return (rec) => {
    mkdirSync(runDir, { recursive: true });
    appendFileSync(file, JSON.stringify(rec) + '\n');
  };
}

/**
 * Bring the Agent Observatory up before the first node runs, so a long assessment is
 * observable from its own start rather than from whenever someone remembers to launch it.
 * Observability is best-effort: a port clash or a dashboard fault degrades to a warning
 * and never takes the engagement down with it.
 */
export async function startObservatory(sessionDir, args = {}, { engagementRoot } = {}) {
  if (!sessionDir || args['no-dashboard'] || args.dashboard === false || args.dashboard === 'false') return null;
  const port = args['dashboard-port'] === undefined ? 4318 : Number(args['dashboard-port']);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.warn('⚠ ignoring invalid --dashboard-port; the assessment continues without the Observatory');
    return null;
  }
  try {
    const { createDashboard } = await import('../dashboard/server.mjs');
    const dashboard = createDashboard({ session: sessionDir, ...(engagementRoot ? { engagementRoot } : {}) });
    const url = await dashboard.listen(port);
    console.log(`▶ Agent Observatory: ${url}`);
    console.log(`  session: ${basename(sessionDir)} · metadata only · no Azure calls`);
    return { dashboard, url };
  } catch (error) {
    const hint = error?.code === 'EADDRINUSE'
      ? `port ${port} is already in use; pass --dashboard-port <n> for a second run`
      : error.message;
    console.warn(`⚠ Agent Observatory unavailable (${hint}); the assessment continues`);
    return null;
  }
}

/**
 * A finished run normally releases the port. `--dashboard-linger` keeps the completed
 * run readable until Ctrl+C, which is what you want when the report is the thing you
 * came to look at.
 */
async function finishObservatory(observatory, args) {
  if (!observatory) return;
  if (args['dashboard-linger']) {
    console.log(`▶ Agent Observatory still serving ${observatory.url} — press Ctrl+C to stop`);
    await new Promise(() => {});
    return;
  }
  await observatory.dashboard.close();
}

function loadLastCheckpoint(sessionDir) {
  const file = join(sessionDir, 'runs', 'graph-checkpoints.jsonl');
  if (!existsSync(file)) return null;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  return JSON.parse(lines[lines.length - 1]);
}

async function main(argv) {
  const args = parseArgs(argv);
  const rel = typeof args.graph === 'string' ? args.graph : join('graph', 'redteam.graph.json');
  const graphPath = isAbsolute(rel) ? rel : resolve(ROOT, rel);

  const { graph, error } = loadGraph(graphPath);
  if (error) { console.error(`✖ could not load graph ${graphPath}: ${error}`); process.exit(1); }

  const { errors } = validateGraph(graph, { agentNames: loadAgentNames() });
  if (errors.length) {
    console.error(`✖ refusing to run an invalid graph (${errors.length} error[s]); run tools/graph/validate-graph.mjs`);
    process.exit(1);
  }

  const sessionDir = typeof args.session === 'string' ? resolve(ROOT, args.session) : null;
  const scope = typeof args.engagement === 'string'
    ? readEngagementScope(resolve(ROOT, args.engagement))
    : { mode: 'read-only-assessment', m365_in_scope: false };

  const runId = typeof args.run === 'string' ? args.run : `run-${Date.now()}`;
  const methodology = sessionDir ? makeProceduralStore({ persist: true }) : makeMemoryStore({ persist: false });
  const audit = sessionDir ? makeAuditLog({ persist: true }) : null;
  const opts = {
    scope,
    onCheckpoint: checkpointWriter(sessionDir),
    store: methodology,
  };
  if (sessionDir) opts.params = applyLearnedParams({ ...(graph.params || {}) }, methodology);
  // The event writer creates runs/ first: the dashboard only serves an existing session
  // directory, and the run.started row must not land before there is anything to read it.
  let observatory = null;
  if (sessionDir) {
    const emit = createEventWriter(sessionDir, { runId });
    opts.emitEvent = emit;
    opts.handlers = makeSelfImprovementHandlers({
      store: methodology,
      audit,
      runId,
      emitEvent: emit,
    }).handlers;
    observatory = await startObservatory(sessionDir, args);
    emit('run.started', { node_id: 'validate_scope', status: 'running' });
  }

  if (args.resume) {
    if (!sessionDir) { console.error('✖ --resume requires --session <dir>'); process.exit(1); }
    const cp = loadLastCheckpoint(sessionDir);
    if (!cp) { console.error('✖ no checkpoint to resume from'); process.exit(1); }
    opts.initialState = cp.state;
    opts.startAt = cp.node;
    if (args.approve) opts.decision = true;
    else if (args.reject) opts.decision = false;
    else { console.error('✖ resuming an interrupt requires --approve or --reject'); process.exit(1); }
  }

  const result = await runGraphAsync(graph, opts);

  console.log('DRY RUN — simulated dispatch; no Azure assessment or live evidence verification performed.');

  if (result.status === 'interrupted') {
    console.log(`⏸ paused at "${result.node}" for human authorization:`);
    console.log(`   ${result.prompt}`);
    console.log(`   resume with: node tools/graph/run-graph.mjs --session <dir> --resume --approve   (or --reject)`);
    await finishObservatory(observatory, args);
    process.exit(0);
  }

  console.log(`✓ ${graph.name}@${graph.version} dry run completed in ${result.steps} steps`);
  console.log(`  path: ${result.path.join(' -> ')}`);
  console.log(`  simulated confirmed findings: ${(result.state.confirmed_findings || []).length}`);
  opts.emitEvent?.('run.completed', {
    node_id: 'reflexion_debrief',
    status: 'completed',
    metrics: { confirmed_findings: (result.state.confirmed_findings || []).length },
  });
  await finishObservatory(observatory, args);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv);
}
