import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordEvaluation } from './evaluation-record.mjs';
import { createLiveHandlers } from './live-handlers.mjs';
import { projectEvent } from '../dashboard/server.mjs';

function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'redteam-evaluation-')),sessionDir=join(root,'engagements','test');
  mkdirSync(sessionDir,{recursive:true});t.after(()=>rmSync(root,{recursive:true,force:true}));
  const events=[], params={max_revisions:2,quality_threshold:0.85};
  return {root,sessionDir,events,params,runId:'test-run',emit:event=>events.push(event),revision:1,
    candidates:[{id:'finding-1',detail:'PRIVATE_CANDIDATE'}],evidence:{web:[{id:'resource-1',fact:'PRIVATE_EVIDENCE'}]},critique:{quality:0.4,notes:['PRIVATE_NOTE']}};
}

test('evaluation preserves independent round snapshots, canonical routing and content hashes',t=>{
  const f=fixture(t),first=recordEvaluation(f);
  const path=join(f.sessionDir,'runs/test-run/evaluation-round-1.json'),original=readFileSync(path,'utf8');
  assert.equal(first.route,'refine');
  assert.equal(first.input_sha256,createHash('sha256').update(JSON.stringify(first.inputs)).digest('hex'));
  f.candidates.push({id:'finding-2'});
  const second=recordEvaluation({...f,revision:2});
  assert.equal(second.route,'proceed'); // Revision cap proceeds even with a low judgment.
  assert.notEqual(second.input_sha256,first.input_sha256);
  assert.equal(readFileSync(path,'utf8'),original);
  assert.equal(second.improvement_verified,false);
  assert.throws(()=>recordEvaluation(f),/EEXIST/);
  assert.equal(f.events.length,2);
  const projected=projectEvent({schema_version:1,id:1,ts:second.recorded_at,...f.events[1]});
  assert.deepEqual(projected.evaluation,{kind:'model-judgment',comparison:'not-controlled',route:'proceed'});
  assert.deepEqual(projected.metrics,{quality:0.4,revision:2,candidates:2});
  assert.deepEqual(projected.evidence_refs,['runs/test-run/evaluation-round-2.json']);
  assert.doesNotMatch(JSON.stringify(f.events),/PRIVATE|improvement_verified.*true/);
});

test('invalid evaluator results and redirected output fail without completed events',t=>{
  const f=fixture(t);
  for(const critique of [{quality:NaN,notes:[]},{quality:2,notes:[]},{quality:0.9,notes:'invalid'}])assert.throws(()=>recordEvaluation({...f,critique}),/Invalid evaluator/);
  assert.throws(()=>recordEvaluation({...f,runId:'../escape'}),/Invalid evaluation/);
  const outside=join(f.root,'outside');mkdirSync(outside);symlinkSync(outside,join(f.sessionDir,'runs'));
  assert.throws(()=>recordEvaluation(f),/real directory/);
  assert.deepEqual(readdirSync(outside),[]);assert.equal(f.events.length,0);
});

test('live evaluator handler emits every stubbed judgment with real exchange metadata and durable artifacts',async t=>{
  const f=fixture(t);let calls=0;
  const scope={tenantId:'22222222-2222-4222-8222-222222222222',subscriptionId:'11111111-1111-4111-8111-111111111111',mode:'read-only-assessment'};
  const handlers=createLiveHandlers({...f,root:process.cwd(),scope,model:async()=>({quality:++calls===1?0.4:0.9,notes:[]}),preflight:async()=>{throw Error('No Azure in this contract test');}});
  const a=await handlers.evaluate({}, {state:{},params:f.params});
  const b=await handlers.evaluate({}, {state:a.writes,params:f.params});
  assert.equal(b.writes.revision,2);assert.equal(calls,2);
  const judgments=f.events.filter(e=>e.type==='evaluation.completed');
  assert.deepEqual(judgments.map(e=>e.evaluation.route),['refine','proceed']);
  assert.equal(f.events.filter(e=>e.type==='message.sent').length,4);
  for(const event of judgments)assert.equal(JSON.parse(readFileSync(join(f.sessionDir,event.evidence_refs[0]),'utf8')).critique.quality,event.metrics.quality);
});
