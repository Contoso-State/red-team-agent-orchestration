import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { scanSession, diffAndEmit, watchSession, nodeFor, detectRunId } from './watch-session.mjs';

function makeSession() {
  const root = mkdtempSync(join(tmpdir(), 'watch-root-'));
  const session = join(root, 'session-1');
  mkdirSync(join(session, 'findings', 'raw'), { recursive: true });
  mkdirSync(join(session, 'evidence'), { recursive: true });
  return { root, session };
}

test('a new findings file is reported with its real record count', () => {
  const { session } = makeSession();
  const before = scanSession(session);
  writeFileSync(join(session, 'findings', 'raw', 'identity.jsonl'), '{"a":1}\n{"a":2}\n');
  const events = [];
  const count = diffAndEmit(before, scanSession(session), (type, payload) => events.push({ type, payload }));
  const tool = events.find(e => e.type === 'tool.completed');
  assert.ok(count >= 1);
  assert.equal(tool.payload.node_id, 'identity', 'must light its own node, not the shared fan-out node');
  assert.equal(tool.payload.metrics.findings, 2, 'record count must be measured, not guessed');
});

test('each specialist is attributed to its own graph node', () => {
  const cases = [
    ['identity.jsonl', 'identity'],
    ['network.jsonl', 'network'],
    ['aks-container.jsonl', 'aks-container'],
    ['containers.jsonl', 'aks-container'],
    ['attack-surface.engine.jsonl', 'easm'],
    ['rbac-graph.json', 'correlate'],
  ];
  for (const [file, expected] of cases) {
    assert.equal(nodeFor(file, 'findings/raw'), expected, `${file} must resolve to ${expected}`);
  }
});

test('evidence is attributed by its directory, which names the producer', () => {
  assert.equal(nodeFor('evidence/raw/aks-container/acr-list.json', 'evidence'), 'aks-container');
  assert.equal(nodeFor('evidence\\raw\\identity\\ca-policies.json', 'evidence'), 'identity');
  assert.equal(nodeFor('evidence/raw/easm/dns.json', 'evidence'), 'easm');
});

test('layout directories are never mistaken for the producing agent', () => {
  assert.equal(nodeFor('findings/raw/identity.jsonl', 'findings/raw'), 'identity');
  assert.equal(nodeFor('evidence/raw/network/nsg.json', 'evidence'), 'network');
  assert.equal(nodeFor('reports/report.html', 'reports'), 'report');
});

test('normalized outputs are watched and attributed to the node that produces them', () => {
  assert.equal(nodeFor('findings/normalized/findings.json', 'findings/normalized'), 'report');
  assert.equal(nodeFor('findings/normalized/attack-paths.json', 'findings/normalized'), 'correlate');
});

test('an unattributable artifact is not guessed at', () => {
  assert.equal(nodeFor('mystery-output.jsonl', 'findings/raw'), 'run_specialist');
});

test('writing findings emits a measured transfer so the edge shows data moving', () => {
  const { session } = makeSession();
  const before = scanSession(session);
  const body = '{"a":1}\n{"a":2}\n';
  writeFileSync(join(session, 'findings', 'raw', 'network.jsonl'), body);
  const events = [];
  diffAndEmit(before, scanSession(session), (type, payload) => events.push({ type, payload }));
  const msg = events.find(e => e.type === 'message.sent');
  assert.ok(msg, 'a findings write is a real handoff to the reduce node');
  assert.equal(msg.payload.from_agent, 'network');
  assert.equal(msg.payload.to_agent, 'collect_raw');
  assert.equal(msg.payload.transfer.kind, 'findings-data');
  assert.equal(msg.payload.transfer.bytes, Buffer.byteLength(body), 'bytes are measured from the file');
  assert.equal(msg.payload.transfer.outcome, 'sent');
});

test('the watcher joins the run already being recorded instead of starting its own', () => {
  const { session } = makeSession();
  mkdirSync(join(session, 'runs'), { recursive: true });
  const log = join(session, 'runs', 'live-events.jsonl');
  writeFileSync(log, [
    JSON.stringify({ run_id: 'rerun-2', type: 'run.started' }),
    JSON.stringify({ run_id: 'watch-999', type: 'tool.completed' }),
  ].join('\n') + '\n');
  assert.equal(detectRunId(session), 'rerun-2', 'a prior watcher run must not be mistaken for the real run');
});

test('a session with no recorded run yields no run to join', () => {
  const { session } = makeSession();
  assert.equal(detectRunId(session), null);
});

test('an unchanged session emits nothing rather than a synthetic heartbeat', () => {
  const { session } = makeSession();
  writeFileSync(join(session, 'findings', 'raw', 'network.jsonl'), '{"a":1}\n');
  const snapshot = scanSession(session);
  const events = [];
  assert.equal(diffAndEmit(snapshot, scanSession(session), (t, p) => events.push({ t, p })), 0);
  assert.equal(events.length, 0);
});

test('a growing file is reported again with the updated count', () => {
  const { session } = makeSession();
  const file = join(session, 'findings', 'raw', 'data.jsonl');
  writeFileSync(file, '{"a":1}\n');
  const before = scanSession(session);
  appendFileSync(file, '{"a":2}\n{"a":3}\n');
  const events = [];
  diffAndEmit(before, scanSession(session), (type, payload) => events.push({ type, payload }));
  const tools = events.filter(e => e.type === 'tool.completed');
  assert.equal(tools.length, 1);
  assert.equal(tools[0].payload.metrics.findings, 3);
  const msg = events.find(e => e.type === 'message.sent');
  assert.equal(msg.payload.transfer.bytes, Buffer.byteLength('{"a":2}\n{"a":3}\n'), 'only the appended bytes move');
});

test('watchSession writes observed changes to the session event log', async () => {
  const { root, session } = makeSession();
  const controller = new AbortController();
  const pending = watchSession(session, {
    intervalMs: 25,
    runId: 'test-watch',
    signal: controller.signal,
    engagementRoot: root,
  });
  writeFileSync(join(session, 'findings', 'raw', 'ai.jsonl'), '{"a":1}\n');
  await new Promise(resolve => setTimeout(resolve, 150));
  controller.abort();
  await pending;
  const log = join(session, 'runs', 'live-events.jsonl');
  assert.ok(existsSync(log), 'watcher must write to the log the dashboard tails');
  const lines = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(lines.some(e => e.agent_id === 'ai' && e.type === 'tool.completed'));
  const handoff = lines.find(e => e.type === 'message.sent');
  assert.ok(handoff, 'handoff fields must survive the writer allowlist');
  assert.equal(handoff.from_agent, 'ai');
  assert.equal(handoff.to_agent, 'collect_raw');
  assert.equal(handoff.transfer.kind, 'findings-data');
});
