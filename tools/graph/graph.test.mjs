import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT,
  validateGraph,
  loadGraph,
  loadAgentNames,
  RESERVED,
  NODE_KINDS,
  GUARD_NAMESPACES,
} from './validate-graph.mjs';

const GRAPH_PATH = join(ROOT, 'graph', 'redteam.graph.json');
const SCHEMA_PATH = join(ROOT, 'schemas', 'graph.schema.json');

const agentNames = loadAgentNames();
const base = loadGraph(GRAPH_PATH).graph;
const clone = () => structuredClone(base);
const validate = (g) => validateGraph(g, { agentNames });

// --- the shipped artifacts are well-formed ---

test('shipped graph parses as JSON', () => {
  const { graph, error } = loadGraph(GRAPH_PATH);
  assert.equal(error, null);
  assert.ok(graph && typeof graph === 'object');
});

test('graph schema parses as JSON', () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
});

test('shipped graph validates with zero errors', () => {
  const { errors, warnings } = validate(base);
  assert.deepEqual(errors, [], `unexpected errors: ${errors.join('; ')}`);
  assert.deepEqual(warnings, [], `unexpected warnings: ${warnings.join('; ')}`);
});

test('agent cards were actually discovered (guards a false-green)', () => {
  assert.ok(agentNames.size >= 12, `expected >=12 agent cards, found ${agentNames.size}`);
});

// --- topology invariants that make this the red-team graph ---

test('entry point is validate_scope (subscription + read-only gate first)', () => {
  const start = base.edges.find((e) => e.from === 'START');
  assert.equal(start.to, 'validate_scope');
});

test('reflection loop exists: evaluate can route back to plan_specialists', () => {
  const cond = base.conditional_edges.find((c) => c.from === 'evaluate');
  assert.ok(cond, 'evaluate must have a conditional router');
  assert.equal(cond.branches.refine, 'plan_specialists');
  assert.equal(cond.branches.proceed, 'judge');
});

test('graph terminates at reflexion_debrief -> END (self-improvement persists last)', () => {
  const end = base.edges.find((e) => e.to === 'END');
  assert.equal(end.from, 'reflexion_debrief');
});

test('every roster specialist resolves to a real agent card', () => {
  for (const r of base.roster) assert.ok(agentNames.has(r.agent), `missing card: ${r.agent}`);
});

test('gated active lanes are declared with a valid mode', () => {
  const gated = base.nodes.filter((n) => n.gated);
  assert.ok(gated.length >= 2, 'expected EVA + cluster gated lanes');
  for (const n of gated) assert.match(n.gated.mode, /-active-testing$/);
});

test('reflexion_debrief writes the methodology namespace, never a guardrail one', () => {
  const debrief = base.nodes.find((n) => n.id === 'reflexion_debrief');
  assert.equal(debrief.namespace, 'methodology');
  assert.ok(!GUARD_NAMESPACES.has(debrief.namespace));
});

test('exported constant sets are populated', () => {
  assert.ok(RESERVED.has('START') && RESERVED.has('END'));
  assert.ok(NODE_KINDS.has('judge') && NODE_KINDS.has('interrupt'));
  assert.ok(GUARD_NAMESPACES.has('guardrails'));
});

// --- negative cases: the validator must catch each class of breakage ---

test('rejects duplicate node ids', () => {
  const g = clone();
  g.nodes.push({ ...g.nodes[0] });
  const { errors } = validate(g);
  assert.ok(errors.some((e) => /duplicate node id/.test(e)));
});

test('rejects a reserved id used as a node', () => {
  const g = clone();
  g.nodes[0].id = 'END';
  const { errors } = validate(g);
  assert.ok(errors.some((e) => /reserved/.test(e)));
});

test('rejects an edge to a non-existent node', () => {
  const g = clone();
  g.edges.push({ from: 'report', to: 'nope' });
  const { errors } = validate(g);
  assert.ok(errors.some((e) => /edge to "nope" is not a real node/.test(e)));
});

test('rejects END as an edge source and START as an edge target', () => {
  const g = clone();
  g.edges.push({ from: 'END', to: 'validate_scope' });
  g.edges.push({ from: 'report', to: 'START' });
  const { errors } = validate(g);
  assert.ok(errors.some((e) => /END cannot be an edge source/.test(e)));
  assert.ok(errors.some((e) => /START cannot be an edge target/.test(e)));
});

test('rejects a write to an undeclared channel', () => {
  const g = clone();
  g.nodes.find((n) => n.id === 'report').writes = 'ghost_channel';
  const { errors } = validate(g);
  assert.ok(errors.some((e) => /unknown channel "ghost_channel"/.test(e)));
});

test('MEMORY FIREWALL: rejects a memory_write into a guardrail namespace', () => {
  const g = clone();
  g.nodes.find((n) => n.id === 'reflexion_debrief').namespace = 'guardrails';
  const { errors } = validate(g);
  assert.ok(errors.some((e) => /MEMORY FIREWALL VIOLATION/.test(e)));
});

test('MEMORY FIREWALL: rejects a judge-embedded memory write into egress', () => {
  const g = clone();
  g.nodes.find((n) => n.id === 'judge').memory_write.namespace = 'egress';
  const { errors } = validate(g);
  assert.ok(errors.some((e) => /MEMORY FIREWALL VIOLATION/.test(e)));
});

test('rejects a dispatch agent with no matching card', () => {
  const g = clone();
  g.nodes.find((n) => n.id === 'correlate').agent = 'Totally Fake Agent';
  const { errors } = validate(g);
  assert.ok(errors.some((e) => /has no matching \.github\/agents card/.test(e)));
});

test('rejects a non-default lane without a gated block', () => {
  const g = clone();
  const eva = g.nodes.find((n) => n.id === 'eva_active');
  delete eva.gated;
  const { errors } = validate(g);
  assert.ok(errors.some((e) => /must declare a gated block/.test(e)));
});

test('rejects an unreachable node', () => {
  const g = clone();
  g.nodes.push({ id: 'orphan', kind: 'dispatch', agent: 'Red Team Reporting', lane: 'default' });
  g.edges.push({ from: 'orphan', to: 'END' }); // reachable-to-END but not reachable-from-START
  const { errors } = validate(g);
  assert.ok(errors.some((e) => /"orphan" is unreachable from START/.test(e)));
});

test('rejects a dead-end node that cannot reach END', () => {
  const g = clone();
  // add a node reachable from START but with no path onward
  g.nodes.push({ id: 'sink', kind: 'dispatch', agent: 'Red Team Reporting', lane: 'default' });
  g.edges.push({ from: 'report', to: 'sink' });
  const { errors } = validate(g);
  assert.ok(errors.some((e) => /"sink" cannot reach END/.test(e)));
});

test('rejects a conditional branch to a non-existent node', () => {
  const g = clone();
  g.conditional_edges.find((c) => c.from === 'evaluate').branches.refine = 'gone';
  const { errors } = validate(g);
  assert.ok(errors.some((e) => /branch "refine": target "gone" is not a real node/.test(e)));
});

test('rejects a graph with no START edge', () => {
  const g = clone();
  g.edges = g.edges.filter((e) => e.from !== 'START');
  const { errors } = validate(g);
  assert.ok(errors.some((e) => /no START edge/.test(e)));
});

test('rejects an interrupt whose on_approve is neither a node nor a router', () => {
  const g = clone();
  g.nodes.find((n) => n.id === 'authorize_active').on_approve = 'not_a_router';
  const { errors } = validate(g);
  assert.ok(errors.some((e) => /on_approve "not_a_router"/.test(e)));
});
