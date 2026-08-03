#!/usr/bin/env node
/**
 * validate-graph.mjs — dependency-free validator for the canonical engagement graph.
 *
 * graph/redteam.graph.json is the single source of truth for orchestration (executed by
 * tools/graph/run-graph.mjs in the CLI runtimes, compiled to a LangGraph StateGraph by
 * integrations/langgraph/). A malformed graph would silently break every runtime, so this
 * validator enforces structural + referential + safety integrity that JSON Schema alone
 * cannot express:
 *
 *   - unique node ids; reserved START/END not redefined
 *   - every edge / conditional branch / fanout target / interrupt target references a real
 *     node (or START/END), and START/END are used only in the legal direction
 *   - a single START entry; every node is reachable from START and can reach END (no
 *     dead-ends, no unreachable nodes, and the reflection loop still terminates at END)
 *   - every writes/reads/reduce_into/emits references a declared state channel
 *   - every dispatch `agent` (and every roster `agent`) matches a real .github/agents card
 *   - non-default lanes are gated with a valid mode; known node kinds / reducers only
 *   - MEMORY FIREWALL: no memory_write (node-level or judge-embedded) targets a guardrail
 *     namespace (guardrails/allowlist/egress/readonly). Self-improvement can only write the
 *     methodology namespace; it can never rewrite the read-only enforcement.
 *
 * Usage:
 *   node tools/graph/validate-graph.mjs                       # validate the shipped graph
 *   node tools/graph/validate-graph.mjs path/to/graph.json    # validate a specific file
 *   node tools/graph/validate-graph.mjs --check               # CI mode (non-zero on error)
 *
 * Exit code is 0 only when there are zero errors.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..', '..');

export const RESERVED = new Set(['START', 'END']);
export const NODE_KINDS = new Set([
  'validate',
  'memory_read',
  'dispatch',
  'fanout',
  'reduce',
  'evaluator',
  'judge',
  'interrupt',
  'memory_write',
]);
export const REDUCERS = new Set(['last', 'append', 'merge_findings']);
export const LANES = new Set(['default', 'external-active', 'cluster-active']);
export const GATED_MODES = new Set(['external-active-testing', 'cluster-active-testing']);
// The immutable boundary: self-improvement may never write these namespaces.
export const GUARD_NAMESPACES = new Set(['guardrails', 'allowlist', 'egress', 'readonly', 'guard']);
// Token that marks the fan-out specialist whose agent is resolved from the roster at runtime.
export const ROSTER_AGENT_TOKEN = '$roster.agent';

/** Read the agent-card `name:` from every .github/agents/*.agent.md. */
export function loadAgentNames(root = ROOT) {
  const dir = join(root, '.github', 'agents');
  const names = new Set();
  if (!existsSync(dir)) return names;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.agent.md')) continue;
    const text = readFileSync(join(dir, file), 'utf8');
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) continue;
    const nameLine = fm[1].split(/\r?\n/).find((l) => /^name:\s*/.test(l));
    if (!nameLine) continue;
    const name = nameLine.replace(/^name:\s*/, '').replace(/^["']|["']$/g, '').trim();
    if (name) names.add(name);
  }
  return names;
}

/**
 * Validate a parsed graph object.
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateGraph(graph, { agentNames = new Set() } = {}) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  if (!graph || typeof graph !== 'object') {
    return { errors: ['graph is not an object'], warnings };
  }

  // --- top-level shape ---
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : null;
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const condEdges = Array.isArray(graph.conditional_edges) ? graph.conditional_edges : [];
  if (!nodes) err('nodes must be an array');
  if (!Array.isArray(graph.edges)) err('edges must be an array');
  if (graph.conditional_edges !== undefined && !Array.isArray(graph.conditional_edges)) {
    err('conditional_edges must be an array when present');
  }

  const channels =
    graph.state && graph.state.channels && typeof graph.state.channels === 'object'
      ? graph.state.channels
      : {};
  if (!Object.keys(channels).length) err('state.channels must declare at least one channel');
  const channelSet = new Set(Object.keys(channels));

  // channel reducers must be known
  for (const [name, ch] of Object.entries(channels)) {
    if (!ch || typeof ch !== 'object') { err(`channel ${name}: must be an object`); continue; }
    if (!REDUCERS.has(ch.reducer)) err(`channel ${name}: unknown reducer "${ch.reducer}"`);
  }

  if (!nodes) return { errors, warnings };

  // --- node ids: unique, non-reserved ---
  const byId = new Map();
  for (const n of nodes) {
    if (!n || typeof n !== 'object') { err('node entry is not an object'); continue; }
    if (typeof n.id !== 'string' || !n.id) { err('node is missing a string id'); continue; }
    if (RESERVED.has(n.id)) err(`node id "${n.id}" is reserved (START/END)`);
    if (byId.has(n.id)) err(`duplicate node id "${n.id}"`);
    byId.set(n.id, n);
    if (!NODE_KINDS.has(n.kind)) err(`node "${n.id}": unknown kind "${n.kind}"`);
  }
  const isNode = (id) => byId.has(id);
  const isNodeOrEnd = (id) => id === 'END' || byId.has(id);

  const chanRef = (nodeId, field, val) => {
    if (val === undefined) return;
    const list = Array.isArray(val) ? val : [val];
    for (const c of list) {
      if (!channelSet.has(c)) err(`node "${nodeId}": ${field} references unknown channel "${c}"`);
    }
  };
  const assertMemoryWrite = (nodeId, mw) => {
    if (!mw || typeof mw !== 'object') return;
    if (typeof mw.namespace !== 'string' || !mw.namespace) {
      err(`node "${nodeId}": memory write is missing a namespace`);
      return;
    }
    if (GUARD_NAMESPACES.has(mw.namespace)) {
      err(
        `node "${nodeId}": MEMORY FIREWALL VIOLATION — self-improvement may not write guardrail namespace "${mw.namespace}"`,
      );
    }
  };

  // --- per-node kind rules ---
  for (const n of nodes) {
    if (!n || typeof n.id !== 'string') continue;
    chanRef(n.id, 'writes', n.writes);
    chanRef(n.id, 'reads', n.reads);
    chanRef(n.id, 'emits', n.emits);

    switch (n.kind) {
      case 'dispatch': {
        if (typeof n.agent !== 'string' || !n.agent) {
          err(`dispatch node "${n.id}": missing agent`);
        } else if (n.agent !== ROSTER_AGENT_TOKEN && agentNames.size && !agentNames.has(n.agent)) {
          err(`dispatch node "${n.id}": agent "${n.agent}" has no matching .github/agents card`);
        }
        const lane = n.lane ?? 'default';
        if (!LANES.has(lane)) err(`dispatch node "${n.id}": unknown lane "${lane}"`);
        if (lane !== 'default') {
          if (!n.gated || typeof n.gated !== 'object') {
            err(`dispatch node "${n.id}": lane "${lane}" must declare a gated block`);
          } else if (!GATED_MODES.has(n.gated.mode)) {
            err(`dispatch node "${n.id}": gated.mode "${n.gated.mode}" is not a valid active mode`);
          }
        }
        break;
      }
      case 'fanout': {
        if (n.over !== 'roster') err(`fanout node "${n.id}": over must be "roster"`);
        if (typeof n.into !== 'string' || !isNode(n.into)) {
          err(`fanout node "${n.id}": into "${n.into}" is not a real node`);
        }
        chanRef(n.id, 'reduce_into', n.reduce_into);
        if (!n.reduce_into) err(`fanout node "${n.id}": missing reduce_into channel`);
        break;
      }
      case 'reduce': {
        if (!REDUCERS.has(n.reducer)) err(`reduce node "${n.id}": unknown reducer "${n.reducer}"`);
        if (!n.writes) err(`reduce node "${n.id}": missing writes channel`);
        break;
      }
      case 'evaluator': {
        if (typeof n.evaluator !== 'string' || !n.evaluator) {
          err(`evaluator node "${n.id}": missing evaluator implementation key`);
        }
        break;
      }
      case 'judge': {
        if (!n.writes) err(`judge node "${n.id}": missing writes channel`);
        if (n.memory_write) assertMemoryWrite(n.id, n.memory_write);
        break;
      }
      case 'interrupt': {
        if (typeof n.prompt !== 'string' || !n.prompt) {
          err(`interrupt node "${n.id}": missing human prompt`);
        }
        if (n.on_reject !== undefined && !isNodeOrEnd(n.on_reject)) {
          err(`interrupt node "${n.id}": on_reject "${n.on_reject}" is not a real node`);
        }
        // on_approve may be a node id OR the name of a conditional router from this node.
        if (n.on_approve !== undefined && !isNodeOrEnd(n.on_approve)) {
          const routed = condEdges.some((c) => c.from === n.id && c.router === n.on_approve);
          if (!routed) {
            err(
              `interrupt node "${n.id}": on_approve "${n.on_approve}" is neither a node nor a router defined from this node`,
            );
          }
        }
        break;
      }
      case 'memory_read': {
        if (typeof n.namespace !== 'string' || !n.namespace) {
          err(`memory_read node "${n.id}": missing namespace`);
        }
        if (n.mutable === true) err(`memory_read node "${n.id}": must not be mutable`);
        break;
      }
      case 'memory_write': {
        assertMemoryWrite(n.id, {
          namespace: n.namespace,
          mutable: n.mutable,
          auto_apply: n.auto_apply,
        });
        break;
      }
      default:
        break;
    }
  }

  // --- roster ---
  const roster = Array.isArray(graph.roster) ? graph.roster : [];
  if (!roster.length) err('roster must list at least one specialist');
  for (const r of roster) {
    if (!r || typeof r !== 'object') { err('roster entry is not an object'); continue; }
    if (typeof r.domain !== 'string' || !r.domain) err('roster entry missing domain');
    if (typeof r.agent !== 'string' || !r.agent) {
      err(`roster entry "${r.domain}": missing agent`);
    } else if (agentNames.size && !agentNames.has(r.agent)) {
      err(`roster entry "${r.domain}": agent "${r.agent}" has no matching .github/agents card`);
    }
  }

  // --- edges ---
  let startTargets = 0;
  for (const e of edges) {
    if (!e || typeof e !== 'object') { err('edge is not an object'); continue; }
    if (typeof e.from !== 'string' || typeof e.to !== 'string') {
      err(`edge ${JSON.stringify(e)}: from/to must be strings`);
      continue;
    }
    if (e.from === 'END') err('edge: END cannot be an edge source');
    if (e.to === 'START') err('edge: START cannot be an edge target');
    if (e.from !== 'START' && !isNode(e.from)) err(`edge from "${e.from}" is not a real node`);
    if (e.to !== 'END' && !isNode(e.to)) err(`edge to "${e.to}" is not a real node`);
    if (e.from === 'START') startTargets++;
  }
  if (startTargets === 0) err('graph has no START edge (no entry point)');
  if (startTargets > 1) warn('graph has multiple START edges; the runner will enter only one');

  // --- conditional edges ---
  for (const c of condEdges) {
    if (!c || typeof c !== 'object') { err('conditional_edge is not an object'); continue; }
    if (typeof c.from !== 'string' || !isNode(c.from)) {
      err(`conditional_edge from "${c && c.from}" is not a real node`);
    }
    if (typeof c.router !== 'string' || !c.router) err(`conditional_edge from "${c.from}": missing router`);
    const branches = c.branches && typeof c.branches === 'object' ? c.branches : null;
    if (!branches || !Object.keys(branches).length) {
      err(`conditional_edge from "${c.from}": branches must be a non-empty map`);
    } else {
      for (const [label, target] of Object.entries(branches)) {
        if (!isNodeOrEnd(target)) {
          err(`conditional_edge from "${c.from}" branch "${label}": target "${target}" is not a real node`);
        }
      }
    }
  }

  // --- reachability (forward from START, and every node can reach END) ---
  const successors = (id) => {
    const out = new Set();
    for (const e of edges) if (e && e.from === id && typeof e.to === 'string') out.add(e.to);
    for (const c of condEdges) {
      if (c && c.from === id && c.branches && typeof c.branches === 'object') {
        for (const t of Object.values(c.branches)) out.add(t);
      }
    }
    const node = byId.get(id);
    if (node) {
      if (node.kind === 'fanout' && typeof node.into === 'string') out.add(node.into);
      if (node.kind === 'interrupt' && typeof node.on_reject === 'string') out.add(node.on_reject);
    }
    return [...out];
  };

  // forward reachable set from START
  const reachable = new Set();
  const seed = edges.filter((e) => e && e.from === 'START').map((e) => e.to);
  const queue = [...seed];
  while (queue.length) {
    const id = queue.shift();
    if (id === 'END' || reachable.has(id)) continue;
    if (!isNode(id)) continue;
    reachable.add(id);
    for (const s of successors(id)) queue.push(s);
  }
  for (const n of nodes) {
    if (n && typeof n.id === 'string' && !reachable.has(n.id)) {
      err(`node "${n.id}" is unreachable from START`);
    }
  }

  // every node must be able to reach END (no dead-ends / infinite sinks)
  const reachEndMemo = new Map();
  const canReachEnd = (id, stack = new Set()) => {
    if (id === 'END') return true;
    if (reachEndMemo.has(id)) return reachEndMemo.get(id);
    if (stack.has(id)) return false; // cycle without exit on this path
    stack.add(id);
    let ok = false;
    for (const s of successors(id)) {
      if (canReachEnd(s, stack)) { ok = true; break; }
    }
    stack.delete(id);
    if (!stack.size) reachEndMemo.set(id, ok);
    return ok;
  };
  for (const n of nodes) {
    if (n && typeof n.id === 'string' && !canReachEnd(n.id)) {
      err(`node "${n.id}" cannot reach END (dead-end or non-terminating loop)`);
    }
  }

  return { errors, warnings };
}

/** Load + parse a graph file, returning { graph, error }. */
export function loadGraph(path) {
  try {
    const text = readFileSync(path, 'utf8');
    return { graph: JSON.parse(text), error: null };
  } catch (e) {
    return { graph: null, error: e.message };
  }
}

function main(argv) {
  const args = argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));
  const rel = positional[0] || join('graph', 'redteam.graph.json');
  const path = isAbsolute(rel) ? rel : resolve(ROOT, rel);

  const { graph, error } = loadGraph(path);
  if (error) {
    console.error(`✖ could not load graph ${path}: ${error}`);
    process.exit(1);
  }

  const { errors, warnings } = validateGraph(graph, { agentNames: loadAgentNames() });
  for (const w of warnings) console.warn(`⚠ ${w}`);
  if (errors.length) {
    console.error(`✖ ${path} is invalid:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  const nodeCount = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
  console.log(
    `✓ ${graph.name}@${graph.version} valid — ${nodeCount} nodes, ${graph.roster.length} specialists` +
      (warnings.length ? ` (${warnings.length} warning[s])` : ''),
  );
  process.exit(0);
}

// Run only when invoked directly (Windows-safe: compare canonical file URLs).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv);
}
