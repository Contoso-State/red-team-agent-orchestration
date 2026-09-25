import test from 'node:test';import assert from 'node:assert/strict';import{mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,existsSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{createHash}from'node:crypto';import{createWorkshopMemory,createLiveMemoryHooks}from'./workshop-memory.mjs';
const env={tenantId:'11111111-1111-1111-1111-111111111111',subscriptionIds:['22222222-2222-2222-2222-222222222222']};
function fixture(t){const root=mkdtempSync(join(tmpdir(),'workshop-memory-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const session=join(root,'engagements','demo');mkdirSync(session,{recursive:true});writeFileSync(join(session,'proof.json'),'{}');const evidence=[{path:'proof.json',sha256:createHash('sha256').update('{}').digest('hex')}];return {root,session,evidence};}
const observation=evidence=>({checkId:'CHK-LOG-X',signature:'stable-check-signature',outcome:'confirmed',evidence});
test('two distinct attributed runs corroborate; one run and another agent cannot',t=>{const f=fixture(t),events=[];const make=runId=>createWorkshopMemory({...f,environment:env,runId,onEvent:e=>events.push(e)});let a=make('run1');assert.equal(a.recordDebrief({agent:'logging-coverage',observations:[observation(f.evidence)]}).promotedCount,0);assert.equal(a.recordDebrief({agent:'logging-coverage',observations:[observation(f.evidence)]}).promotedCount,0);assert.equal(make('run2').retrieve('logging-coverage').records.length,1);assert.equal(make('run2').retrieve('data-protection').records.length,0);const b=make('run2').recordDebrief({agent:'logging-coverage',observations:[observation(f.evidence)]});assert.equal(b.promotedCount,1);assert.equal(b.improvementVerified,false);assert.equal(make('run3').retrieve('logging-coverage').knowledge.length,1);assert.ok(events.some(x=>x.type==='memory.promoted'));});
test('environment scope prevents prior-run leakage and modified evidence invalidates retrieval',t=>{const f=fixture(t);createWorkshopMemory({...f,environment:env,runId:'one'}).recordDebrief({agent:'logging-coverage',observations:[observation(f.evidence)]});assert.equal(createWorkshopMemory({...f,environment:{...env,subscriptionIds:['33333333-3333-3333-3333-333333333333']},runId:'two'}).retrieve('logging-coverage').records.length,0);writeFileSync(join(f.session,'proof.json'),'changed');assert.equal(createWorkshopMemory({...f,environment:env,runId:'two'}).retrieve('logging-coverage').records.length,0);});
test('reject traversal, unsupported outcomes and symlink memory writes',t=>{const f=fixture(t),a=createWorkshopMemory({...f,environment:env,runId:'one'});assert.throws(()=>a.recordDebrief({agent:'logging-coverage',observations:[observation([{...f.evidence[0],path:'../proof.json'}])]}));assert.throws(()=>a.recordDebrief({agent:'logging-coverage',observations:[{...observation(f.evidence),outcome:'run-shell'}]}));const outside=join(f.root,'outside');mkdirSync(outside);symlinkSync(outside,join(f.session,'memory'));assert.throws(()=>a.recordDebrief({agent:'logging-coverage',observations:[observation(f.evidence)]}),/escapes/);});
test('live hook only records confirmed IDs backed by local JSONL artifacts',async t=>{const f=fixture(t),raw=join(f.session,'findings','raw');mkdirSync(raw,{recursive:true});const finding={id:'AZ-LOG-001',agent:'logging-coverage',check_id:'CHK-LOG-X',finding_class:'missing-flow'};writeFileSync(join(raw,'logging.jsonl'),JSON.stringify(finding)+'\n');writeFileSync(join(f.session,'findings','judged.jsonl'),JSON.stringify(finding)+'\n');const hooks=createLiveMemoryHooks({sessionDir:f.session,runId:'one',scope:{tenantId:env.tenantId,subscriptionId:env.subscriptionIds[0]},emit:()=>{}});const r=await hooks.record({confirmed_findings:[finding,{...finding,id:'AZ-LOG-002',check_id:'CHK-LOG-Y'}]});assert.equal(r.results[0].candidateCount,1);assert.equal(r.improvementVerified,false);});
test('persisted memory reloads across sessions; other agents cannot corroborate it',t=>{const f=fixture(t);createWorkshopMemory({...f,environment:env,runId:'first'}).recordDebrief({agent:'logging-coverage',observations:[observation(f.evidence)]});const second=join(f.root,'engagements','second');mkdirSync(second);writeFileSync(join(second,'proof.json'),'{}');const b=createWorkshopMemory({...f,session:second,environment:env,runId:'second'});assert.equal(b.retrieve('logging-coverage').records.length,1);assert.equal(b.recordDebrief({agent:'data-protection',observations:[observation(f.evidence)]}).promotedCount,0);assert.equal(b.retrieve('logging-coverage').knowledge.length,0);});
test('kill switch disables persistence and historical retrieval',t=>{const f=fixture(t);const old=process.env.REDTEAM_SELF_IMPROVE;t.after(()=>{if(old===undefined)delete process.env.REDTEAM_SELF_IMPROVE;else process.env.REDTEAM_SELF_IMPROVE=old;});process.env.REDTEAM_SELF_IMPROVE='off';const a=createWorkshopMemory({...f,environment:env,runId:'one'});assert.equal(a.recordDebrief({agent:'logging-coverage',observations:[observation(f.evidence)]}).disabled,true);assert.deepEqual(a.retrieve('logging-coverage').records,[]);});

test('live hooks bypass an unavailable AEF runtime and create no artifacts when learning is off', async t => {
  const f = fixture(t), events = [];
  const previous = process.env.REDTEAM_SELF_IMPROVE;
  t.after(() => {
    if (previous === undefined) delete process.env.REDTEAM_SELF_IMPROVE;
    else process.env.REDTEAM_SELF_IMPROVE = previous;
  });
  let calls = 0;
  const hooks = createLiveMemoryHooks({
    sessionDir:f.session, runId:'disabled',
    scope:{tenantId:env.tenantId, subscriptionId:env.subscriptionIds[0]},
    emit:e => events.push(e),
    retrieveAEF:async () => { calls++; throw Error('AEF runtime unavailable'); }
  });
  for (const value of ['off', '0', 'false', 'no', 'disabled', 'OFF']) {
    process.env.REDTEAM_SELF_IMPROVE = value;
    const loaded = await hooks.load();
    assert.equal(loaded.disabled, true);
    assert.equal(loaded.engine, null);
    assert.equal(loaded.sourceCommit, null);
    assert.equal(loaded.improvementVerified, false);
    for (const agent of Object.values(loaded.agents)) {
      assert.deepEqual(agent.records, []);
      assert.deepEqual(agent.knowledge, []);
      assert.deepEqual(agent.context, []);
    }
    // No finding/evidence access or persistence should occur once opted out.
    const state = {get confirmed_findings() { throw Error('Unexpected evidence access'); }};
    assert.deepEqual(await hooks.record(state), {disabled:true, results:[], improvementVerified:false});
  }
  assert.equal(calls, 0);
  assert.deepEqual(events, []);
  assert.equal(existsSync(join(f.session, 'memory')), false);
});

test('raw candidate alone cannot become confirmed memory',async t=>{const f=fixture(t),raw=join(f.session,'findings','raw');mkdirSync(raw,{recursive:true});const finding={id:'AZ-LOG-001',agent:'logging-coverage',check_id:'CHK-LOG-X'};writeFileSync(join(raw,'logging.jsonl'),JSON.stringify(finding)+'\n');const hooks=createLiveMemoryHooks({sessionDir:f.session,runId:'one',scope:{tenantId:env.tenantId,subscriptionId:env.subscriptionIds[0]}});const result=await hooks.record({confirmed_findings:[finding]});assert.deepEqual(result.results,[]);});
