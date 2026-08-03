import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ROOT, loadGraph } from './run-graph.mjs';
import {
  DOMAIN_PACKS,
  offlineRowsProvider,
  makeDispatchFactory,
  runBenchmark,
  scoreUtilization,
  runMain,
  runReflection,
  runHitl,
  checkMemoryFirewall,
} from './utilization-benchmark.mjs';

const { graph } = loadGraph(join(ROOT, 'graph', 'redteam.graph.json'));

test('benchmark drives the canonical graph to a >=95/100 utilization score offline', () => {
  const card = runBenchmark({ graph });
  assert.ok(card.score >= 95, `expected >=95, got ${card.score}/${card.max}`);
  assert.equal(card.max, 100);
});

test('every rubric item is satisfied against the shipped sample rows', () => {
  const card = runBenchmark({ graph });
  const failed = card.items.filter((it) => it.points < it.max);
  assert.deepEqual(failed.map((f) => f.id), [], `unmet rubric items: ${failed.map((f) => `${f.id} (${f.detail})`).join(', ')}`);
});

test('main run visits every node kind and dispatches the full in-scope roster', () => {
  const main = runMain(graph, { rowsProvider: offlineRowsProvider() });
  assert.equal(main.res.status, 'completed');
  // Read-only scope excludes the m365-gated email specialist -> 11 of 12.
  assert.equal(main.stats.specialistsRun.size, 11);
  // The deterministic checks engine actually evaluated predicates.
  assert.ok(main.stats.checksRan >= 1);
  assert.ok((main.res.state.candidate_findings || []).length > 0);
});

test('the bounded reflection loop iterates then terminates within max_revisions', () => {
  const reflection = runReflection(graph, { rowsProvider: offlineRowsProvider() });
  assert.equal(reflection.res.status, 'completed');
  const rev = reflection.res.state.revision;
  const max = reflection.res.params.max_revisions;
  assert.ok(rev > 1, `loop should iterate at least once (rev=${rev})`);
  assert.ok(rev <= max, `loop must terminate within max_revisions (rev=${rev}, max=${max})`);
});

test('the HITL authorization interrupt pauses then resumes on approval', () => {
  const hitl = runHitl(graph, { rowsProvider: offlineRowsProvider() });
  assert.equal(hitl.run1.status, 'interrupted');
  assert.equal(hitl.run1.node, 'authorize_active');
  assert.equal(hitl.run2.status, 'completed');
  assert.equal(hitl.run2.state.approved, true);
});

test('the memory firewall refuses guardrail-namespace writes', () => {
  assert.equal(checkMemoryFirewall(), true);
});

test('every roster domain maps to at least one existing predicate pack', () => {
  const rosterDomains = graph.roster.map((r) => r.domain);
  for (const d of rosterDomains) {
    assert.ok(Array.isArray(DOMAIN_PACKS[d]) && DOMAIN_PACKS[d].length > 0, `roster domain "${d}" has no pack mapping`);
  }
});

test('dispatch factory records per-domain specialist runs and honest ran/total stats', () => {
  const stats = { checksRan: 0, checksTotal: 0, matched: 0, specialistsRun: new Set() };
  const dispatch = makeDispatchFactory({ rowsProvider: offlineRowsProvider(), stats });
  const res = dispatch({ id: 'run_specialist' }, { item: { domain: 'data' }, state: {} });
  assert.ok(Array.isArray(res.writes.raw_findings));
  assert.ok(stats.checksTotal > 0);
  assert.ok(stats.checksRan <= stats.checksTotal);
  assert.ok(stats.specialistsRun.has('data'));
});

test('scoreUtilization is deterministic across repeated runs', () => {
  const a = runBenchmark({ graph });
  const b = runBenchmark({ graph });
  assert.equal(a.score, b.score);
  const reScore = scoreUtilization(graph, { main: a.main, reflection: a.reflection, hitl: a.hitl, firewallOk: a.firewallOk });
  assert.equal(reScore.score, a.score);
});
