import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startObservatory } from './run-graph.mjs';

/** A session directory the dashboard will accept: it must live under engagements/. */
function makeSession(t) {
  const root = mkdtempSync(join(tmpdir(), 'redteam-observatory-'));
  const engagementRoot = join(root, 'engagements');
  const session = join(engagementRoot, 'live-session');
  mkdirSync(join(session, 'runs'), { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { session, engagementRoot };
}

test('an assessment run brings the Observatory up on its own', async t => {
  const { session, engagementRoot } = makeSession(t);
  const started = await startObservatory(session, { 'dashboard-port': 0 }, { engagementRoot });
  assert.ok(started, 'the dashboard should start alongside the run');
  t.after(() => started.dashboard.close());

  assert.match(started.url, /^http:\/\/127\.0\.0\.1:\d+$/, 'it must bind loopback only');
  const snapshot = await (await fetch(`${started.url}/api/snapshot`)).json();
  assert.equal(snapshot.session_id, 'live-session');
  assert.deepEqual(snapshot.events, [], 'a new run starts with an honest empty log');
});

test('--no-dashboard keeps the run headless', async t => {
  const { session, engagementRoot } = makeSession(t);
  assert.equal(await startObservatory(session, { 'no-dashboard': true }, { engagementRoot }), null);
  assert.equal(await startObservatory(null, {}), null, 'no session means nothing to observe');
});

test('a port clash degrades to a warning instead of failing the assessment', async t => {
  const { session, engagementRoot } = makeSession(t);
  const first = await startObservatory(session, { 'dashboard-port': 0 }, { engagementRoot });
  t.after(() => first.dashboard.close());
  const port = Number(new URL(first.url).port);

  const warnings = [];
  const realWarn = console.warn;
  console.warn = msg => warnings.push(String(msg));
  try {
    const second = await startObservatory(session, { 'dashboard-port': port }, { engagementRoot });
    assert.equal(second, null, 'the run must survive a dashboard that cannot bind');
  } finally {
    console.warn = realWarn;
  }
  assert.ok(warnings.some(w => w.includes('Observatory unavailable') && w.includes('already in use')));
});

test('an invalid port is refused without taking the run down', async t => {
  const { session, engagementRoot } = makeSession(t);
  const warnings = [];
  const realWarn = console.warn;
  console.warn = msg => warnings.push(String(msg));
  try {
    assert.equal(await startObservatory(session, { 'dashboard-port': 'not-a-port' }, { engagementRoot }), null);
  } finally {
    console.warn = realWarn;
  }
  assert.ok(warnings.some(w => w.includes('invalid --dashboard-port')));
});
