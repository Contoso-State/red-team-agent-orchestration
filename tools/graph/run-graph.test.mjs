import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  ROOT,
  loadGraph,
  runGraph,
  runGraphAsync,
  initialState,
  applyWrite,
  REDUCERS,
  defaultRouters,
  makeMemoryStore,
  inScopeRoster,
} from './run-graph.mjs';

const graph = loadGraph(join(ROOT, 'graph', 'redteam.graph.json')).graph;

// A dispatch handler for the fan-out specialists: each emits one finding keyed by domain.
const specialistDispatch = () => ({
  handlers: {
    run_specialist: (_node, ctx) => ({
      writes: {
        raw_findings: [
          {
            dedupe_key: `f-${ctx.item.domain}`,
            severity: 'high',
            affected_resources: [{ resource_id: `${ctx.item.domain}-r1` }],
          },
        ],
      },
    }),
  },
});

// --- state + reducers ---

test('initialState seeds channels by shape', () => {
  const s = initialState(graph);
  assert.deepEqual(s.raw_findings, []); // append
  assert.deepEqual(s.candidate_findings, []); // merge_findings
  assert.equal(s.revision, 0); // number
  assert.equal(s.scope, null); // object/last
});

test('append reducer concatenates; last overwrites', () => {
  assert.deepEqual(REDUCERS.append([1], [2, 3]), [1, 2, 3]);
  assert.deepEqual(REDUCERS.append(undefined, 5), [5]);
  assert.equal(REDUCERS.last('a', 'b'), 'b');
});

test('merge_findings dedupes by dedupe_key and unions affected_resources', () => {
  const a = { dedupe_key: 'k', severity: 'high', affected_resources: [{ resource_id: 'r1' }] };
  const b = { dedupe_key: 'k', severity: 'high', affected_resources: [{ resource_id: 'r2' }] };
  const merged = REDUCERS.merge_findings([a], [b]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].affected_resources.length, 2);
});

test('applyWrite through an unknown channel throws', () => {
  const s = initialState(graph);
  assert.throws(() => applyWrite(s, graph, 'nope', 1), /unknown channel/);
});

// --- end-to-end read-only run ---

test('read-only engagement runs the full path without pausing', () => {
  const res = runGraph(graph, { scope: { mode: 'read-only-assessment', m365_in_scope: false } });
  assert.equal(res.status, 'completed');
  assert.equal(res.path[0], 'validate_scope');
  assert.equal(res.path.at(-1), 'END');
  // read-only mode: the interrupt is pass-through and the active lanes never run
  assert.ok(res.path.includes('authorize_active'));
  assert.ok(!res.path.includes('eva_active'));
  assert.ok(!res.path.includes('cluster_active'));
  assert.ok(res.path.includes('correlate') && res.path.includes('report'));
});

test('fan-out Send runs every in-scope specialist and the reduce dedupes into candidates', () => {
  const res = runGraph(graph, {
    scope: { mode: 'read-only-assessment', m365_in_scope: false },
    ...specialistDispatch(),
  });
  // 11 specialists in scope (email excluded when m365 not in scope)
  assert.equal(res.state.raw_findings.length, 11);
  assert.equal(res.state.candidate_findings.length, 11);
  assert.equal(res.state.confirmed_findings.length, 11);
});

test('async fan-out starts specialist handlers concurrently and reduces deterministically', async () => {
  let active = 0;
  let maxActive = 0;
  const res = await runGraphAsync(graph, {
    scope: { mode: 'read-only-assessment', m365_in_scope: false },
    handlers: {
      run_specialist: async (_node, ctx) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active--;
        return {
          writes: {
            raw_findings: [{ dedupe_key: `f-${ctx.item.domain}`, affected_resources: [] }],
          },
        };
      },
    },
  });

  test('async graph emits node and specialist lifecycle events', async () => {
    const events = [];
    const res = await runGraphAsync(graph, {
      scope: { mode: 'read-only-assessment', m365_in_scope: false },
      emitEvent: (type, metadata) => events.push({ type, ...metadata }),
    });
    assert.equal(res.status, 'completed');
    assert.ok(events.some(event => event.type === 'node.started' && event.node_id === 'validate_scope'));
    assert.ok(events.some(event => event.type === 'task.dispatched' && event.task_id === 'identity'));
    assert.ok(events.some(event => event.type === 'agent.started' && event.agent_id === 'Red Team Identity'));
    assert.ok(events.some(event => event.type === 'agent.completed' && event.agent_id === 'Red Team Identity'));
    assert.ok(events.some(event => event.type === 'node.completed' && event.node_id === 'report'));
  });

  test('a memory read reports what it retrieved, including an empty store', async () => {
    const events = [];
    await runGraphAsync(graph, {
      scope: { mode: 'read-only-assessment', m365_in_scope: false },
      emitEvent: (type, metadata) => events.push({ type, ...metadata }),
    });
    const retrieved = events.filter(event => event.type === 'memory.retrieved');
    assert.equal(retrieved.length, 1, 'every memory_read node must be observable');
    assert.equal(retrieved[0].node_id, 'memory_load');
    assert.equal(typeof retrieved[0].metrics.retrieved, 'number');
    assert.equal(retrieved[0].metrics.retrieved, 0, 'an empty store reports zero rather than staying silent');
  });

  test('a memory read reports real counts when the store holds entries', async () => {
    const events = [];
    await runGraphAsync(graph, {
      scope: { mode: 'read-only-assessment', m365_in_scope: false },
      emitEvent: (type, metadata) => events.push({ type, ...metadata }),
      handlers: {
        memory_read: () => ({
          writes: {
            memory: {
              entries: [
                { kind: 'knowledge', id: 'k1' },
                { kind: 'knowledge', id: 'k2' },
                { kind: 'suppression', id: 's1' },
              ],
            },
          },
        }),
      },
    });
    const [event] = events.filter(e => e.type === 'memory.retrieved');
    assert.equal(event.metrics.retrieved, 3);
    assert.equal(event.metrics.knowledge_count, 2);
    assert.equal(event.metrics.suppression_count, 1);
    assert.equal(event.metrics.experience_count, 0);
  });
  assert.ok(maxActive > 1);
  assert.equal(res.state.raw_findings.length, 11);
  assert.deepEqual(
    res.state.raw_findings.map((finding) => finding.dedupe_key),
    inScopeRoster(graph, { scope: { m365_in_scope: false } }).map((item) => `f-${item.domain}`),
  );
});

test('async fan-out times out one stalled specialist without blocking the others', async () => {
  const timedOut = [];
  const res = await runGraphAsync(graph, {
    scope: { mode: 'read-only-assessment', m365_in_scope: false },
    params: { specialist_timeout_seconds: 0.01 },
    onSpecialistTimeout: (event) => timedOut.push(event),
    handlers: {
      run_specialist: async (_node, ctx) => {
        if (ctx.item.domain === 'compute') {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return {
          writes: {
            raw_findings: [{ dedupe_key: `f-${ctx.item.domain}`, affected_resources: [] }],
          },
        };
      },
    },
  });
  assert.equal(timedOut.length, 1);
  assert.equal(timedOut[0].item.domain, 'compute');
  assert.equal(res.state.raw_findings.length, 10);
  assert.deepEqual(res.state.coverage_gaps, [
    {
      domain: 'compute',
      check_id: '__specialist__',
      subscription_id: 'unknown',
      type: '*',
      status: 'partial',
      count: 1,
      reason: 'specialist deadline exceeded (0.01s)',
    },
  ]);
  assert.equal(res.status, 'completed');
});

test('async fan-out records a failed specialist and preserves other results', async () => {
  const res = await runGraphAsync(graph, {
    scope: { mode: 'read-only-assessment', m365_in_scope: false, subscription_id: 'sub-1' },
    handlers: {
      run_specialist: async (_node, ctx) => {
        if (ctx.item.domain === 'network') throw new Error('query failed');
        return {
          writes: {
            raw_findings: [{ dedupe_key: `f-${ctx.item.domain}`, affected_resources: [] }],
          },
        };
      },
    },
  });

  test('async runner bounds sequential dispatch nodes', async () => {
    await assert.rejects(
      runGraphAsync(graph, {
        scope: { mode: 'read-only-assessment', m365_in_scope: false },
        params: { dispatch_timeout_seconds: 0.01 },
        handlers: {
          preflight_inventory: async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
            return {};
          },
        },
      }),
      /preflight_inventory.*deadline exceeded/,
    );
  });
  assert.equal(res.state.raw_findings.length, 10);
  assert.deepEqual(res.state.coverage_gaps, [{
    domain: 'network',
    check_id: '__specialist__',
    subscription_id: 'sub-1',
    type: '*',
    status: 'failed',
    count: 1,
    reason: 'specialist failed: query failed',
  }]);
});
test('the `when` predicate includes the email specialist only when M365 is in scope', () => {
  assert.equal(inScopeRoster(graph, { scope: { m365_in_scope: false } }).length, 11);
  assert.equal(inScopeRoster(graph, { scope: { m365_in_scope: true } }).length, 12);
  const res = runGraph(graph, {
    scope: { mode: 'read-only-assessment', m365_in_scope: true },
    ...specialistDispatch(),
  });
  assert.equal(res.state.raw_findings.length, 12);
});

test('duplicate findings from different specialists merge in candidate_findings', () => {
  const res = runGraph(graph, {
    scope: { mode: 'read-only-assessment', m365_in_scope: false },
    handlers: {
      run_specialist: () => ({
        writes: {
          raw_findings: [{ dedupe_key: 'shared', severity: 'high', affected_resources: [{ resource_id: 'x' }] }],
        },
      }),
    },
  });
  assert.equal(res.state.raw_findings.length, 11); // append keeps all raw
  assert.equal(res.state.candidate_findings.length, 1); // but they dedupe to one
});

// --- bounded reflection loop ---

test('evaluator->refine loop iterates then terminates at max_revisions', () => {
  const res = runGraph(graph, {
    scope: { mode: 'read-only-assessment', m365_in_scope: false },
    handlers: {
      // always score below threshold so the router wants to refine
      evaluate: (_n, ctx) => ({ writes: { critique: { quality: 0 }, revision: (ctx.state.revision || 0) + 1 } }),
    },
  });
  const evals = res.path.filter((n) => n === 'evaluate').length;
  const plans = res.path.filter((n) => n === 'plan_specialists').length;
  assert.equal(evals, graph.params.max_revisions); // 2 passes then proceed
  assert.equal(plans, graph.params.max_revisions); // one initial + one refine
  assert.ok(res.path.includes('judge'));
  assert.equal(res.status, 'completed');
});

test('route_after_evaluate proceeds once quality clears the threshold', () => {
  const routers = defaultRouters();
  assert.equal(routers.route_after_evaluate({ revision: 1, critique: { quality: 0.9 } }, graph.params), 'proceed');
  assert.equal(routers.route_after_evaluate({ revision: 1, critique: { quality: 0.1 } }, graph.params), 'refine');
  assert.equal(routers.route_after_evaluate({ revision: 2, critique: { quality: 0.1 } }, graph.params), 'proceed');
});

// --- human-in-the-loop authorization interrupt ---

test('external-active engagement pauses at the authorization interrupt', () => {
  const res = runGraph(graph, { scope: { mode: 'external-active-testing' } });
  assert.equal(res.status, 'interrupted');
  assert.equal(res.node, 'authorize_active');
  assert.match(res.prompt, /authoriz/i);
  assert.equal(res.state.approved, null);
});

test('resuming the interrupt with approval runs the external active lane', () => {
  const paused = runGraph(graph, { scope: { mode: 'external-active-testing' } });
  const resumed = runGraph(graph, {
    initialState: paused.state,
    startAt: 'authorize_active',
    decision: true,
  });
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.state.approved, true);
  assert.ok(resumed.path.includes('eva_active'));
  assert.ok(resumed.path.includes('correlate'));
});

test('resuming the interrupt with rejection skips the active lane', () => {
  const paused = runGraph(graph, { scope: { mode: 'external-active-testing' } });
  const resumed = runGraph(graph, {
    initialState: paused.state,
    startAt: 'authorize_active',
    decision: false,
  });
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.state.approved, false);
  assert.ok(!resumed.path.includes('eva_active'));
  assert.equal(resumed.path[1], 'correlate'); // authorize_active -> correlate (on_reject)
});

test('cluster-active engagement pauses then runs the cluster lane on approval', () => {
  const paused = runGraph(graph, { scope: { mode: 'cluster-active-testing' } });
  assert.equal(paused.status, 'interrupted');
  const resumed = runGraph(graph, { initialState: paused.state, startAt: 'authorize_active', decision: true });
  assert.ok(resumed.path.includes('cluster_active'));
  assert.ok(!resumed.path.includes('eva_active'));
});

// --- checkpointing ---

test('a checkpoint is emitted for every executed node', () => {
  const checkpoints = [];
  const res = runGraph(graph, {
    scope: { mode: 'read-only-assessment', m365_in_scope: false },
    onCheckpoint: (rec) => checkpoints.push(rec),
  });
  assert.ok(checkpoints.length >= res.path.length - 1);
  assert.ok(checkpoints.every((c) => typeof c.node === 'string' && c.state));
});

// --- safety: memory firewall + termination guard ---

test('memory store refuses guardrail namespaces and allows methodology', () => {
  const store = makeMemoryStore();
  for (const ns of ['guardrails', 'allowlist', 'egress', 'readonly']) {
    assert.throws(() => store.write(ns, { x: 1 }), /MEMORY FIREWALL/);
  }
  assert.doesNotThrow(() => store.write('methodology', { x: 1 }));
});

test('the step budget guarantees termination', () => {
  assert.throws(
    () => runGraph(graph, { scope: { mode: 'read-only-assessment' }, maxSteps: 3 }),
    /step budget exceeded/,
  );
});
