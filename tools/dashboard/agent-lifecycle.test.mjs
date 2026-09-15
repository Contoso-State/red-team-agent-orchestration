import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { emitAgentLifecycle } from './agent-lifecycle.mjs';
import { diffAndEmit, scanSession } from './watch-session.mjs';

function makeSession(t) {
  const root = resolve('.dashboard-test-output', `agent-lifecycle-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const engagementRoot = join(root, 'engagements');
  const session = join(engagementRoot, 'session-1');
  mkdirSync(join(session, 'runs'), { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, engagementRoot, session };
}

function readEvents(session) {
  return readFileSync(join(session, 'runs', 'live-events.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
}

test('dispatcher lifecycle helper emits typed agent events with graph attribution', t => {
  const { engagementRoot, session } = makeSession(t);
  const event = emitAgentLifecycle(session, {
    type: 'started',
    agentId: 'Red Team Identity',
    nodeId: 'identity',
    taskId: 'identity',
    runId: 'run-1',
    engagementRoot,
  });

  assert.equal(event.type, 'agent.started');
  assert.equal(event.agent_id, 'Red Team Identity');
  assert.equal(event.node_id, 'identity');
  assert.equal(event.task_id, 'identity');
  assert.equal(event.status, 'running');
});

test('dispatcher lifecycle helper joins the session run by default', t => {
  const { engagementRoot, session } = makeSession(t);
  writeFileSync(join(session, 'runs', 'live-events.jsonl'), [
    JSON.stringify({ run_id: 'assessment-42', type: 'run.started' }),
    JSON.stringify({ run_id: 'watch-1', type: 'tool.completed' }),
  ].join('\n') + '\n');

  const event = emitAgentLifecycle(session, {
    type: 'completed',
    agentId: 'Red Team Network',
    nodeId: 'network',
    engagementRoot,
  });

  assert.equal(event.run_id, 'assessment-42');
  assert.equal(event.type, 'agent.completed');
  assert.equal(event.status, 'completed');
});

test('dashboard completed-agent counter counts distinct completed agent ids in the current run', t => {
  const { engagementRoot, session } = makeSession(t);
  emitAgentLifecycle(session, { type: 'completed', agentId: 'Red Team Identity', nodeId: 'identity', runId: 'run-1', engagementRoot });
  emitAgentLifecycle(session, { type: 'completed', agentId: 'Red Team Identity', nodeId: 'identity', runId: 'run-1', engagementRoot });
  emitAgentLifecycle(session, { type: 'completed', agentId: 'Red Team Network', nodeId: 'network', runId: 'run-1', engagementRoot });
  emitAgentLifecycle(session, { type: 'completed', agentId: 'Red Team Data', nodeId: 'data', runId: 'other-run', engagementRoot });

  const run = readEvents(session).filter(event => event.run_id === 'run-1');
  const completed = new Set(run.filter(event => event.type === 'agent.completed').map(event => event.agent_id || event.node_id)).size;

  assert.equal(completed, 2);
});

test('artifact activity never infers agent completion', t => {
  const { session } = makeSession(t);
  mkdirSync(join(session, 'findings', 'raw'), { recursive: true });
  const before = scanSession(session);
  writeFileSync(join(session, 'findings', 'raw', 'identity.jsonl'), '{"finding":1}\n');
  const events = [];

  diffAndEmit(before, scanSession(session), (type, payload) => events.push({ type, ...payload }));

  assert.ok(events.some(event => event.type === 'tool.completed'), 'artifact writes remain observable');
  assert.equal(events.some(event => event.type === 'agent.completed'), false, 'only a dispatcher may emit completion');
});
