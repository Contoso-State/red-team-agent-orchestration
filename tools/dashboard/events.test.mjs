import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEventWriter } from './events.mjs';
import { projectEvent } from './server.mjs';

test('usage survives persistence and projection with exchange attribution but no raw provider fields', t => {
  const root=mkdtempSync(join(tmpdir(),'redteam-usage-events-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const session=join(root,'engagements','test');
  const write=createEventWriter(session,{runId:'usage-1',engagementRoot:join(root,'engagements')});
  const row=write('model.usage',{
    agent_id:'Red Team Identity',task_id:'identity-0',exchange_id:'exchange-1',status:'failed',
    usage:{source:'PRIVATE_SOURCE',input_tokens:40,output_tokens:0,cost_usd:0.002,models:['claude-example','PRIVATE BODY'],result:'PRIVATE_RESULT',prompt:'PRIVATE_PROMPT'},
  });
  const projected=projectEvent(row);
  assert.equal(projected.exchange_id,'exchange-1');
  assert.equal(projected.task_id,'identity-0');
  assert.equal(projected.status,'failed');
  assert.deepEqual(projected.usage,{source:'native-runtime',input_tokens:40,output_tokens:0,cache_read_input_tokens:null,cache_creation_input_tokens:null,cost_usd:0.002,models:['claude-example']});
  assert.deepEqual(projected.usage,row.usage);
  assert.doesNotMatch(readFileSync(join(session,'runs','live-events.jsonl'),'utf8'),/PRIVATE/);
  assert.equal(projectEvent({...row,type:'agent.started'}).usage,undefined);
  const legacy=projectEvent({...row,usage:undefined});
  assert.equal(legacy.usage.input_tokens,null);
  assert.equal(legacy.usage.cost_usd,null);
});

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

test('memory attribution survives the event log and dashboard projection without freeform contents', t => {
  const root = mkdtempSync(join(tmpdir(), 'redteam-memory-events-'));
  const session = join(root, 'engagements', 'test');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = createEventWriter(session, { runId: 'review-1', runKind: 'memory-review', engagementRoot: join(root, 'engagements') });
  for (const stage of ['retrieved', 'verified', 'candidate', 'promoted', 'measured']) {
    write(`memory.${stage}`, {
      agent_id: 'Red Team Identity',
      memory: {
        stage: 'PRIVATE_FORGED_STAGE',
        source_ids: ['assessment-1', 'assessment-1', 'assessment-2', 'password', { body: 'PRIVATE_BODY' }],
        environment_key: 'a'.repeat(64),
        outcome: stage === 'verified' ? 'evidence-integrity-verified' : 'inert',
        body: 'PRIVATE_BODY',
        records: [{ evidence: 'PRIVATE_EVIDENCE' }],
      },
      summary: 'PRIVATE_SUMMARY',
    });
  }
  const log = readFileSync(join(session, 'runs', 'live-events.jsonl'), 'utf8');
  assert.doesNotMatch(log, /PRIVATE_|password/);
  const rows = log.trim().split(/\r?\n/).map(JSON.parse);
  for (const row of rows) {
    const projected = projectEvent(row);
    assert.equal(projected.agent_id, 'Red Team Identity');
    assert.equal(projected.run_kind, 'memory-review');
    assert.deepEqual(projected.memory, {
      stage: row.type.split('.')[1],
      source_ids: ['assessment-1', 'assessment-2'],
      environment_key: 'a'.repeat(64),
      outcome: row.type === 'memory.verified' ? 'evidence-integrity-verified' : 'inert',
    });
  }
});

test('memory event metadata rejects unsupported values and stays bounded before persistence', t => {
  const root = mkdtempSync(join(tmpdir(), 'redteam-memory-events-'));
  const session = join(root, 'engagements', 'test');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = createEventWriter(session, { engagementRoot: join(root, 'engagements') });
  const row = write('memory.retrieved', { memory: {
    source_ids: [...Array.from({ length: 50 }, (_, i) => `run-${i}`), 'PRIVATE_OVERFLOW'],
    environment_key: 'PRIVATE_ENVIRONMENT',
    outcome: 'PRIVATE_OUTCOME',
  } });
  assert.deepEqual(row.memory, { stage: 'retrieved', source_ids: Array.from({ length: 50 }, (_, i) => `run-${i}`) });
  const unrelated = write('agent.started', { memory: { body: 'PRIVATE_UNRELATED' } });
  assert.equal(unrelated.memory, undefined);
  const log = readFileSync(join(session, 'runs', 'live-events.jsonl'), 'utf8');
  assert.doesNotMatch(log, /PRIVATE_/);
});
