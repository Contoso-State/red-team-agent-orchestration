import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEventWriter } from './events.mjs';

test('event writer appends dashboard-compatible metadata', t => {
  const root = mkdtempSync(join(tmpdir(), 'redteam-events-'));
  const session = join(root, 'engagements', 'test');
  mkdirSync(session, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const previous = process.cwd();
  process.chdir(root);
  try {
    const write = createEventWriter(session, { runId: 'run-1', engagementRoot: join(root, 'engagements') });
    write('agent.started', {
      agent_id: 'Red Team Reporting',
      node_id: 'report',
      status: 'running',
      type: 'run.failed',
      secret: 'must-not-be-written',
    });
    const rows = readFileSync(join(session, 'runs', 'live-events.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, 'agent.started');
    assert.equal(rows[0].agent_id, 'Red Team Reporting');
    assert.equal(rows[0].secret, undefined);
  } finally {
    process.chdir(previous);
  }
});
