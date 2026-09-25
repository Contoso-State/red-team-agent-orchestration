import test from 'node:test';
import assert from 'node:assert/strict';
import { runGraphAsync } from './async-runner.mjs';

const empty = async () => ({ writes: {} });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const graph = () => ({
  params: {},
  state: { channels: { values: { type: 'array', reducer: 'append' } } },
  nodes: [{ id: 'work', kind: 'dispatch', agent: 'reviewer' }],
  edges: [{ from: 'START', to: 'work' }, { from: 'work', to: 'END' }],
  conditional_edges: [],
});
const fanout = () => ({
  ...graph(),
  roster: ['identity', 'network', 'data'].map(domain => ({ domain })),
  nodes: [
    { id: 'plan', kind: 'fanout', into: 'specialist' },
    { id: 'specialist', kind: 'dispatch' },
    { id: 'final', kind: 'dispatch' },
  ],
  edges: [{ from: 'START', to: 'plan' }, { from: 'specialist', to: 'final' }, { from: 'final', to: 'END' }],
});

function assertPaired(events) {
  const attempts = new Map();
  for (const event of events) {
    const [kind, stage] = event.type.split('.');
    if (!['agent', 'node'].includes(kind)) continue;
    const key = `${kind}:${event.node_id}:${event.agent_id || ''}:${event.task_id}`;
    if (stage === 'started') {
      assert.equal(attempts.has(key), false, `duplicate start: ${key}`);
      attempts.set(key, false);
    } else {
      assert.ok(['completed', 'failed'].includes(stage));
      assert.equal(attempts.get(key), false, `unpaired or duplicate terminal: ${key}`);
      assert.equal(event.status, stage);
      attempts.set(key, true);
    }
  }
  assert.ok(attempts.size > 0);
  assert.ok([...attempts.values()].every(Boolean), 'every started attempt has a terminal event');
}

test('handler rejection fails its agent and node exactly once without exposing the error payload', async () => {
  const events = [], failure = Error('sensitive handler payload');
  await assert.rejects(runGraphAsync(graph(), {
    handlers: { work: async () => { throw failure; } }, emit: event => events.push(event),
  }), error => error === failure);
  assert.deepEqual(events.map(event => event.type), ['node.started', 'agent.started', 'agent.failed', 'node.failed']);
  assert.equal(JSON.stringify(events).includes(failure.message), false);
  assertPaired(events);
});

test('invalid handler results cannot emit agent or node completion', async () => {
  for (const result of [undefined, { writes: { unknown: true } }]) {
    const events = [];
    await assert.rejects(runGraphAsync(graph(), {
      handlers: { work: async () => result }, emit: event => events.push(event),
    }), /no result|unknown channel/);
    assert.equal(events.some(event => event.type.endsWith('.completed')), false);
    assertPaired(events);
  }
});

test('pre-aborted execution starts no work, while in-flight cancellation fails both lifecycles', async () => {
  const controller = new AbortController(), events = [], reason = Error('cancelled');
  controller.abort(reason);
  await assert.rejects(runGraphAsync(graph(), {
    signal: controller.signal, handlers: { work: empty }, emit: event => events.push(event),
  }), error => error === reason);
  assert.deepEqual(events, []);

  const active = new AbortController();
  await assert.rejects(runGraphAsync(graph(), {
    signal: active.signal, emit: event => events.push(event),
    handlers: { work: async () => { active.abort(reason); return { writes: { values: ['discarded'] } }; } },
  }), error => error === reason);
  assert.equal(events.some(event => event.type.endsWith('.completed')), false);
  assertPaired(events);
});

test('async checkpoint failure or cancellation leaves the node failed with no false completion', async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController(), failure = Error('checkpoint failed'), events = [];
    await assert.rejects(runGraphAsync(graph(), {
      handlers: { work: empty }, signal: controller.signal, emit: event => events.push(event),
      onCheckpoint: async () => {
        await Promise.resolve();
        if (cancel) controller.abort(failure);
        else throw failure;
      },
    }), error => error === failure);
    assert.deepEqual(events.map(event => event.type), ['node.started', 'agent.started', 'agent.completed', 'node.failed']);
    assertPaired(events);
  }
});

test('missing or unknown outgoing transitions fail the node before a success checkpoint', async () => {
  for (const target of [undefined, 'missing']) {
    const spec = graph(), events = [];
    spec.edges[1].to = target;
    await assert.rejects(runGraphAsync(spec, {
      handlers: { work: empty }, emit: event => events.push(event),
      onCheckpoint: () => assert.fail('invalid transition must not checkpoint success'),
    }), /No outgoing transition|Unknown graph node/);
    assert.equal(events.at(-1).type, 'node.failed');
    assertPaired(events);
  }
});

test('fan-out failure cancels active siblings, stops queued work, and waits for cleanup before rejection', async () => {
  const events = [], started = [], first = deferred(), siblingStarted = deferred(), siblingAborted = deferred(), cleanup = deferred();
  const failure = Error('first specialist failed'), caller = new AbortController();
  let settled = false, cleaned = false;
  const run = runGraphAsync(fanout(), {
    concurrency: 2, signal: caller.signal, emit: event => events.push(event),
    handlers: {
      specialist: async (_node, { item, signal }) => {
        started.push(item.domain);
        if (item.domain === 'identity') { await first.promise; throw failure; }
        signal.addEventListener('abort', () => siblingAborted.resolve(), { once: true });
        siblingStarted.resolve();
        await cleanup.promise;
        cleaned = true;
        // Even a handler that returns after cancellation cannot be marked successful.
        return { writes: { values: ['cancelled response'] } };
      },
      final: () => assert.fail('failed fan-out must not advance'),
    },
  });
  run.then(() => { settled = true; }, () => { settled = true; });
  await siblingStarted.promise;
  first.resolve();
  await siblingAborted.promise;
  assert.equal(settled, false);
  assert.equal(events.some(event => event.type === 'node.failed'), false, 'node failure waits for cleanup');
  assert.equal(caller.signal.aborted, false, 'internal sibling cancellation leaves caller controller intact');
  cleanup.resolve();
  await assert.rejects(run, error => error === failure);
  assert.equal(cleaned, true);
  assert.deepEqual(started, ['identity', 'network']);
  assert.equal(events.filter(event => event.type === 'message.sent').length, 2);
  assert.equal(events.some(event => event.type.endsWith('.completed')), false);
  assert.equal(events.at(-1).type, 'node.failed');
  assertPaired(events);
});

test('caller cancellation propagates to all active fan-out handlers and prevents queued dispatch', async () => {
  const controller = new AbortController(), reason = Error('stop run'), events = [], ready = deferred();
  let started = 0, cleaned = 0;
  const run = runGraphAsync(fanout(), {
    concurrency: 2, signal: controller.signal, emit: event => events.push(event),
    handlers: {
      specialist: async (_node, { signal }) => {
        const aborted = new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
        if (++started === 2) ready.resolve();
        await aborted;
        cleaned++;
        signal.throwIfAborted();
      },
      final: () => assert.fail('cancelled fan-out must not advance'),
    },
  });
  await ready.promise;
  controller.abort(reason);
  await assert.rejects(run, error => error === reason);
  assert.equal(started, 2);
  assert.equal(cleaned, 2);
  assert.equal(events.some(event => event.type.endsWith('.completed')), false);
  assertPaired(events);
});

test('successful fan-out reduces deterministically and repeated attempts retain distinct lifecycle IDs', async () => {
  const spec = fanout(), events = [], release = deferred();
  spec.params = { max_revisions: 2, quality_threshold: 0.9 };
  spec.state.channels.critique = { type: 'object', reducer: 'last' };
  spec.edges = spec.edges.filter(edge => edge.from !== 'final');
  spec.conditional_edges = [{ from: 'final', router: 'route_after_evaluate', branches: { refine: 'plan', proceed: 'END' } }];
  let evaluations = 0;
  const result = await runGraphAsync(spec, {
    concurrency: 3, emit: event => events.push(event),
    handlers: {
      specialist: async (_node, { item }) => {
        if (item.domain === 'identity') await release.promise;
        if (item.domain === 'network') release.resolve();
        return { writes: { values: [item.domain] } };
      },
      final: async () => ({ writes: { critique: { quality: ++evaluations === 1 ? 0 : 1 } } }),
    },
    onCheckpoint: () => assert.notEqual(events.at(-1).type, 'node.completed', 'node success follows checkpoint'),
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.state.values, ['identity', 'network', 'data', 'identity', 'network', 'data']);
  assert.equal(events.some(event => event.type.endsWith('.failed')), false);
  const sent = events.filter(event => event.type === 'message.sent');
  for (const event of sent) assert.equal(events.filter(other => other.type === 'agent.started' && other.task_id === event.task_id).length, 1);
  assertPaired(events);
});
