import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
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
  buildSecurityContext,
} from './run-graph.mjs';
import { makeAuditLog, makeProceduralStore, makeSelfImprovementHandlers } from './self-improve.mjs';

const graph = loadGraph(join(ROOT, 'graph', 'redteam.graph.json')).graph;

test('CLI identifies simulated completion and fails on an unreadable requested scope', () => {
  const runner = join(ROOT, 'tools/graph/run-graph.mjs');
  const simulation = spawnSync(process.execPath, [runner], { encoding: 'utf8' });
  assert.equal(simulation.status, 0, simulation.stderr);
  assert.match(simulation.stdout, /DRY RUN.*no Azure assessment/);
  const missing = spawnSync(process.execPath, [runner, '--engagement', join(ROOT, 'does-not-exist', 'engagement.yaml')], { encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Cannot read requested engagement file/);
  assert.doesNotMatch(missing.stdout, /completed/);
});

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
  assert.equal(s.security_context, null); // object/last
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
  assert.ok(res.path.includes('build_security_context'));
});

test('security context is available to every specialist without fabricating signals', () => {
  const seen = [];
  const res = runGraph(graph, {
    scope: { mode: 'read-only-assessment', m365_in_scope: false },
    handlers: {
      preflight_inventory: () => ({ writes: { inventory_ref: 'engagements/test/inventory/resources.jsonl' } }),
      build_security_context: (_node, ctx) => ({
        writes: {
          security_context: {
            version: 'security-context/v1',
            signals: { arm: { status: 'available', evidence_refs: [ctx.state.inventory_ref] } },
          },
        },
      }),
      run_specialist: (_node, ctx) => {
        seen.push(ctx.state.security_context);
        return {};
      },
    },
  });
  assert.equal(res.status, 'completed');
  assert.equal(seen.length, 11);
  assert.ok(seen.every((context) => context?.version === 'security-context/v1'));
  assert.equal(seen[0].signals.arm.status, 'available');
});

test('default security context distinguishes an inventory reference from verified evidence', () => {
  const inventoryRef = '/nonexistent/inventory/resources.jsonl';
  const context = buildSecurityContext({
    scope: { mode: 'read-only-assessment', domains: ['data-protection'] },
    inventory_ref: inventoryRef,
  });
  assert.equal(context.version, 'security-context/v1');
  assert.equal(context.status, 'summary-only');
  assert.equal(context.inventory.ref, inventoryRef);
  assert.equal(context.inventory.status, 'referenced');
  assert.deepEqual(Object.keys(context.signals).sort(), [
    'arm', 'behavior_analytics', 'defender_cloud', 'defender_endpoint',
    'entra_identity', 'exposure_management', 'sentinel', 'threat_intelligence',
  ]);
  assert.deepEqual(context.signals.arm, { status: 'unverified', evidence_refs: [inventoryRef] });
  for (const [family, signal] of Object.entries(context.signals)) {
    if (family === 'arm') continue;
    assert.deepEqual(signal, { status: 'unavailable', evidence_refs: [] }, family);
  }
});

test('missing and malformed inventory references never imply available ARM evidence', () => {
  for (const inventory_ref of [undefined, null, '', '   ', {}, [], 42]) {
    const context = buildSecurityContext({ inventory_ref });
    assert.equal(context.inventory.ref, null);
    assert.equal(context.inventory.status, 'missing');
    assert.deepEqual(context.signals.arm, { status: 'unavailable', evidence_refs: [] });
  }
});

test('async security context resolves before specialist dispatch and checkpoint persistence', async () => {
  const context = { version: 'custom-context/v1', signals: { arm: { status: 'unverified', evidence_refs: ['inventory.jsonl'] } } };
  const seen = [];
  const checkpoints = [];
  let resolved = false;
  const result = await runGraphAsync(graph, {
    scope: { mode: 'read-only-assessment', domains: ['data-protection'] },
    securityContextFn: async () => {
      await new Promise((resolve) => setImmediate(resolve));
      resolved = true;
      return context;
    },
    onCheckpoint: (checkpoint) => checkpoints.push(checkpoint),
    handlers: {
      run_specialist: (_node, ctx) => {
        assert.equal(resolved, true, 'context must resolve before specialists begin');
        seen.push(ctx.state.security_context);
        return {};
      },
    },
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(seen, [context]);
  assert.deepEqual(result.state.security_context, context);
  const persisted = checkpoints.find((checkpoint) => checkpoint.node === 'build_security_context');
  assert.ok(persisted, 'the security context node must produce a checkpoint');
  assert.deepEqual(persisted.state.security_context, context);
});

test('synchronous graph rejects async security context callbacks with an actionable error', () => {
  assert.throws(
    () => runGraph(graph, {
      scope: { mode: 'read-only-assessment' },
      securityContextFn: async () => ({ version: 'custom-context/v1' }),
    }),
    /runGraphAsync/,
  );
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
  assert.ok(maxActive > 1);
  assert.equal(res.state.raw_findings.length, 11);
  assert.deepEqual(
    res.state.raw_findings.map((finding) => finding.dedupe_key),
    inScopeRoster(graph, { scope: { m365_in_scope: false } }).map((item) => `f-${item.domain}`),
  );
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
    assert.equal(retrieved[0].metrics.records, 0, 'dashboard counters consume the allowlisted records metric');
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
    assert.equal(event.metrics.records, 3);
    assert.equal(event.metrics.retrieved, 3);
    assert.equal(event.metrics.knowledge_count, 2);
    assert.equal(event.metrics.suppression_count, 1);
    assert.equal(event.metrics.experience_count, 0);
  });

test('async graph emits real self-improvement memory candidates without fabricating promotions', async () => {
    const store = makeProceduralStore();
    const audit = makeAuditLog();
    const events = [];
    const emitEvent = (type, metadata) => events.push({ type, ...metadata });
    const { handlers: learningHandlers } = makeSelfImprovementHandlers({
      store,
      audit,
      runId: 'run-observed-memory',
      emitEvent,
    });
    await runGraphAsync(graph, {
      scope: { mode: 'read-only-assessment', m365_in_scope: false },
      emitEvent,
      handlers: {
        ...specialistDispatch().handlers,
        ...learningHandlers,
      },
    });

    const memoryEvents = events.filter((event) => event.type.startsWith('memory.'));
    assert.ok(memoryEvents.some((event) => event.type === 'memory.retrieved'));
    assert.ok(memoryEvents.some((event) => event.type === 'memory.candidate' && event.node_id === 'evaluate'));
    assert.ok(memoryEvents.some((event) => event.type === 'memory.candidate' && event.node_id === 'reflexion_debrief'));
    assert.equal(memoryEvents.some((event) => event.type === 'memory.promoted'), false);
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

test('the `when` predicate includes the email specialist only when M365 is in scope', () => {
  assert.equal(inScopeRoster(graph, { scope: { m365_in_scope: false } }).length, 11);
  assert.equal(inScopeRoster(graph, { scope: { m365_in_scope: true } }).length, 12);
  const res = runGraph(graph, {
    scope: { mode: 'read-only-assessment', m365_in_scope: true },
    ...specialistDispatch(),
  });
  assert.equal(res.state.raw_findings.length, 12);
});

test('specialist fan-out honors selected assessment domains', () => {
  const scoped = inScopeRoster(graph, {
    scope: { domains: ['identity-posture', 'data-protection'], m365_in_scope: false },
  });
  assert.deepEqual(scoped.map((item) => item.domain), ['identity', 'data']);
});

test('specialist fan-out honors selected ARM resource types', () => {
  const scoped = inScopeRoster(graph, {
    scope: { resource_types: ['Microsoft.Compute/virtualMachines'], m365_in_scope: true },
  });
  assert.deepEqual(scoped.map((item) => item.domain), ['compute']);
});

test('ARM scope matching intersects exact types and provider wildcards in either direction', () => {
  for (const resourceType of [
    'Microsoft.Network/applicationGateways',
    'Microsoft.Network/*',
    'MICROSOFT.NETWORK/*',
  ]) {
    const scoped = inScopeRoster(graph, { scope: { resource_types: [resourceType] } });
    assert.deepEqual(scoped.map((item) => item.domain), ['network', 'web', 'easm'], resourceType);
  }
  const dataOnly = inScopeRoster(graph, {
    scope: { domains: ['data-protection'], resource_types: ['Microsoft.Storage/*'] },
  });
  assert.deepEqual(dataOnly.map((item) => item.domain), ['data']);
  const disjoint = inScopeRoster(graph, {
    scope: { domains: ['data-protection'], resource_types: ['Microsoft.Network/*'] },
  });
  assert.deepEqual(disjoint, []);
  const adjacentProvider = inScopeRoster(graph, {
    scope: { resource_types: ['Microsoft.Networking/*'] },
  });
  assert.deepEqual(adjacentProvider, [], 'provider names must not match on a partial prefix');
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
  const res = runGraph(graph, {
    scope: {
      mode: 'external-active-testing',
      external_testing: { enabled: true, authorization: { attestation_id: 'ROE-1' } },
    },
  });
  assert.equal(res.status, 'interrupted');
  assert.equal(res.node, 'authorize_active');
  assert.match(res.prompt, /authoriz/i);
  assert.equal(res.state.approved, null);
});

test('resuming the interrupt with approval runs the external active lane', () => {
  const scope = {
    mode: 'external-active-testing',
    external_testing: { enabled: true, authorization: { attestation_id: 'ROE-1' } },
  };
  const paused = runGraph(graph, { scope });
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
  const paused = runGraph(graph, {
    scope: {
      mode: 'external-active-testing',
      external_testing: { enabled: true, authorization: { attestation_id: 'ROE-1' } },
    },
  });
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
  const scope = {
    mode: 'cluster-active-testing',
    cluster_testing: { enabled: true, authorization: { attestation_id: 'ROE-2' } },
  };
  const paused = runGraph(graph, { scope });
  assert.equal(paused.status, 'interrupted');
  const resumed = runGraph(graph, { initialState: paused.state, startAt: 'authorize_active', decision: true });
  assert.ok(resumed.path.includes('cluster_active'));
  assert.ok(!resumed.path.includes('eva_active'));
});

test('active mode fails closed when its enabled attestation block is missing', () => {
  assert.throws(
    () => runGraph(graph, { scope: { mode: 'external-active-testing' } }),
    /external-active-testing requires external_testing.enabled, external_testing.authorization.attestation_id/,
  );
});

for (const [mode, scopeKey, activeNode] of [
  ['external-active-testing', 'external_testing', 'eva_active'],
  ['cluster-active-testing', 'cluster_testing', 'cluster_active'],
]) {
  for (const [runnerName, runner] of [['sync', runGraph], ['async', runGraphAsync]]) {
    test(`${runnerName} ${mode} requires a boolean enabled flag and nonempty attestation`, async () => {
      const invalidBlocks = [
        undefined,
        { enabled: 'false', authorization: { attestation_id: 'ROE-1' } },
        { enabled: 'true', authorization: { attestation_id: 'ROE-1' } },
        { enabled: 1, authorization: { attestation_id: 'ROE-1' } },
        { enabled: true, authorization: { attestation_id: {} } },
        { enabled: true, authorization: { attestation_id: [] } },
        { enabled: true, authorization: { attestation_id: '' } },
        { enabled: true, authorization: { attestation_id: '   ' } },
      ];
      for (const block of invalidBlocks) {
        const dispatched = [];
        await assert.rejects(
          async () => runner(graph, {
            scope: { mode, [scopeKey]: block },
            decision: true,
            handlers: { [activeNode]: () => { dispatched.push(activeNode); return {}; } },
          }),
          /requires/,
          JSON.stringify(block),
        );
        assert.deepEqual(dispatched, [], 'invalid authorization must never dispatch an active node');
      }
    });

    test(`${runnerName} ${mode} accepts only an actual boolean approval`, async () => {
      const scope = { mode, [scopeKey]: { enabled: true, authorization: { attestation_id: 'ROE-1' } } };
      const approved = await runner(graph, { scope, decision: true });
      assert.equal(approved.state.approved, true);
      assert.ok(approved.path.includes(activeNode));
      for (const decision of ['false', 'true', 1, {}]) {
        const rejected = await runner(graph, { scope, decision });
        assert.equal(rejected.state.approved, false);
        assert.equal(rejected.path.includes(activeNode), false);
        const restored = await runner(graph, {
          initialState: { ...initialState(graph), scope, approved: decision },
          startAt: 'authorize_active',
        });
        assert.equal(restored.state.approved, false);
        assert.equal(restored.path.includes(activeNode), false);
      }
    });

    test(`${runnerName} ${mode} fails closed when its gate contract is incomplete or unknown`, async () => {
      const scope = { mode, [scopeKey]: { enabled: true, authorization: { attestation_id: 'ROE-1' } } };
      for (const requirements of [
        undefined,
        [],
        [`${scopeKey}.enabled`],
        [`${scopeKey}.enabled`, `${scopeKey}.authorization.attestation_id`, 'unsupported.requirement'],
      ]) {
        const alteredGraph = structuredClone(graph);
        alteredGraph.nodes.find((node) => node.id === activeNode).gated.requires = requirements;
        await assert.rejects(
          async () => runner(alteredGraph, { scope, decision: true }),
          /requires/,
        );
      }
    });
  }
}

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
