import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, symlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { createDashboard, projectEvent, safeReference } from './server.mjs';

const event = (id=1, extra={}) => ({ schema_version:1, id, ts:'2026-09-14T12:00:00.000Z', session_id:'test', run_id:'run-1', type:'agent.started', agent_id:'Red Team Web & Static Sites', node_id:'run_specialist', status:'running', ...extra });
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'redteam-dashboard-')), session=join(root,'engagements/test'), file=join(session,'runs/live-events.jsonl'), graph=join(root,'graph.json');
  mkdirSync(join(session,'runs'),{recursive:true});
  writeFileSync(graph,JSON.stringify({nodes:[{id:'report',kind:'dispatch',agent:'Red Team Reporting'}],edges:[],roster:[{domain:'web',agent:'Red Team Web & Static Sites'}]}));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const dashboard=createDashboard({session,engagementRoot:join(root,'engagements'),graphPath:graph,pollMs:50});
  t.after(()=>dashboard.close());
  return {root,session,file,graph,dashboard};
}
async function get(url, path, headers={}) { const response=await fetch(url+path,{headers});return {status:response.status,headers:response.headers,text:await response.text()}; }

test('projection excludes secret-bearing and private fields; only known metadata survives',()=>{
  const input=event(1,{summary:'Bearer secret-token',reasoning:'private chain',message:'password=hunter2',command:'az account get-access-token',output:'TOP_SECRET',metrics:{count:4,secret:321,quality:Infinity},evidence_refs:['evidence/safe.json','../secret','evidence/.azure/token','https://evil.test','reports/result.md']});
  const output=projectEvent(input);
  assert.equal(output.summary,'agent · started');assert.deepEqual(output.metrics,{count:4});assert.deepEqual(output.evidence_refs,['evidence/safe.json','reports/result.md']);
  assert.doesNotMatch(JSON.stringify(output),/hunter2|TOP_SECRET|Bearer|chain|get-access/);
  assert.equal(projectEvent({...input,type:'reasoning.private'}),null);assert.equal(projectEvent({...input,ts:'yesterday'}),null);assert.equal(projectEvent({...input,id:undefined}),null);
});
test('reference allowlist rejects traversal, hidden files, URL schemes, absolute paths and backslashes',()=>{
  for(const ref of ['/etc/passwd','reports/../secret','reports/%2e%2e/foo','evidence\\file','data:text/html,bad','reports/.hidden','../../x','arbitrary/file','evidence/access-token.json'])assert.equal(safeReference(ref),null,ref);
});
test('memory and broker contract retains real counts without equating verification and measurement',()=>{
  assert.deepEqual(projectEvent(event(1,{type:'memory.verified',metrics:{evidenceFiles:7}})).memory,{stage:'verified'});
  assert.deepEqual(projectEvent(event(2,{type:'memory.retrieved',metrics:{records:9,promoted:2}})).metrics,{records:9,promoted:2});
  assert.equal(projectEvent(event(3,{type:'tool.cached',metrics:{cache_hits:1}})).metrics.cache_hits,1);
  assert.equal(projectEvent(event(4,{type:'tool.completed',metrics:{azure_reads:1}})).metrics.azure_reads,1);
  assert.equal(projectEvent(event(5,{type:'run.completed',metrics:{confirmed_findings:2}})).metrics.confirmed_findings,2);
});

test('evaluation projection never promotes a model judgment into a learning claim or forwards notes',()=>{
  const result=projectEvent(event(6,{type:'evaluation.completed',evaluation:{kind:'model-judgment',route:'refine',comparison:'improvement-proven',notes:'PRIVATE_NOTE'},metrics:{quality:0.6,revision:1,candidates:2}}));
  assert.deepEqual(result.evaluation,{kind:'model-judgment',route:'refine',comparison:'not-controlled'});
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|improvement-proven/);
});
test('empty session is honest and HTTP only serves same-origin allowlisted resources',async t=>{
  const {dashboard}=fixture(t),url=await dashboard.listen(0);
  assert.equal(dashboard.server.address().address,'127.0.0.1');
  const snapshot=await get(url,'/api/snapshot');assert.equal(snapshot.status,200);assert.equal(JSON.parse(snapshot.text).events.length,0);assert.equal(JSON.parse(snapshot.text).log_state,'waiting');
  const page=await get(url,'/');assert.match(page.text,/Agent Observatory/);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal((await get(url,'/api/snapshot',{Origin:'https://evil.example'})).status,403);
  assert.equal((await get(url,'/api/snapshot',{'Sec-Fetch-Site':'cross-site'})).status,403);
  const wrongHost=await new Promise((accept,reject)=>{const req=request(url+'/api/snapshot',{headers:{Host:'evil.example'}},res=>{res.resume();accept(res.statusCode);});req.on('error',reject);req.end();});
  assert.equal(wrongHost,403);
  for(const path of ['/server.mjs','/../../etc/passwd','/%2e%2e/%2e%2e/etc/passwd','/api/file?path=/etc/passwd','/styles.css/../server.mjs'])assert.equal((await get(url,path)).status,404,path);
  assert.equal((await fetch(url+'/api/snapshot',{method:'POST'})).status,405);
});
test('JSONL tail waits for complete lines, rejects invalid records and handles log replacement',t=>{
  const {dashboard,file}=fixture(t);
  const serialized=JSON.stringify(event());appendFileSync(file,serialized.slice(0,40));dashboard.scan();assert.equal(dashboard.snapshot().events.length,0);
  appendFileSync(file,serialized.slice(40)+'\nnot json\n'+JSON.stringify(event(2,{type:'agent.completed'}))+'\n');dashboard.scan();
  assert.deepEqual(dashboard.snapshot().events.map(e=>e.type),['agent.started','agent.completed']);assert.equal(dashboard.snapshot().dropped,1);
  renameSync(file,file+'.old');writeFileSync(file,JSON.stringify(event(3,{type:'run.completed'}))+'\n');dashboard.scan();assert.equal(dashboard.snapshot().generation,1);assert.equal(dashboard.snapshot().events.length,1);assert.equal(dashboard.snapshot().events[0].id,'3');
});
test('oversized records are discarded across chunk boundaries without poisoning following rows',t=>{
  const {dashboard,file}=fixture(t);
  writeFileSync(file,'x'.repeat(1100000));dashboard.scan();dashboard.scan();appendFileSync(file,'\n'+JSON.stringify(event(2))+'\n');dashboard.scan();assert.equal(dashboard.snapshot().events.length,1);assert.equal(dashboard.snapshot().events[0].id,'2');assert.ok(dashboard.snapshot().dropped>0);
});
test('symlinked logs and session components are never read',t=>{
  const {dashboard,file,root,session,graph}=fixture(t),outside=join(root,'outside.jsonl');writeFileSync(outside,JSON.stringify(event())+'\n');symlinkSync(outside,file);dashboard.scan();assert.equal(dashboard.snapshot().log_state,'unavailable');assert.equal(dashboard.snapshot().events.length,0);
  const alias=join(root,'engagements/alias');symlinkSync(session,alias);assert.throws(()=>createDashboard({session:alias,engagementRoot:join(root,'engagements'),graphPath:graph}),/Symbolic/);
  assert.throws(()=>createDashboard({session:root,engagementRoot:join(root,'engagements'),graphPath:graph}),/outside/);
});
test('evidence links return recorded metadata only, even when a referenced artifact contains secrets',async t=>{
  const {dashboard,file,session}=fixture(t);mkdirSync(join(session,'evidence'));writeFileSync(join(session,'evidence/config.json'),'TOP_SECRET_DO_NOT_SERVE');writeFileSync(file,JSON.stringify(event(1,{evidence_refs:['evidence/config.json']}))+'\n');dashboard.scan();
  const url=await dashboard.listen(0),cursor=dashboard.snapshot().events[0].cursor;
  const result=await get(url,`/api/evidence?event=${encodeURIComponent(cursor)}&index=0`);assert.equal(result.status,200);assert.match(result.text,/Recorded reference only/);assert.doesNotMatch(result.text,/TOP_SECRET/);
  assert.equal((await get(url,'/evidence/config.json')).status,404);assert.equal((await get(url,'/api/evidence?event=1&index=0')).status,404);
});
test('SSE delivers only actual appended events after a truthful initial snapshot',async t=>{
  const {dashboard,file}=fixture(t),url=await dashboard.listen(0);
  await new Promise((accept,reject)=>{
    const timeout=setTimeout(()=>{req.destroy();reject(new Error('SSE append timed out'));},2500);let body='';
    const req=request(url+'/api/events',res=>{res.setEncoding('utf8');res.on('data',chunk=>{body+=chunk;if(body.includes('event: snapshot')&&!body.includes('event: activity')&&!body.includes('append-triggered')){
      body+='append-triggered';appendFileSync(file,JSON.stringify(event(7,{type:'message.sent',from_agent:'Red Team Web & Static Sites',to_agent:'Red Team Reporting',message:'private ignored'}))+'\n');dashboard.scan();
    }if(body.includes('event: activity')){clearTimeout(timeout);assert.match(body,/message.sent/);assert.doesNotMatch(body,/private ignored/);req.destroy();accept();}});});req.on('error',reject);req.end();
  });
});

test('correlated transfer and memory provenance are allowlisted without payload contents',()=>{
  const output=projectEvent(event(8,{type:'message.sent',run_kind:'memory-review',exchange_id:'exchange-1',transfer:{kind:'model-response',bytes:123,outcome:'received',payload:'PRIVATE'}}));
  assert.equal(output.run_kind,'memory-review');assert.equal(output.exchange_id,'exchange-1');assert.deepEqual(output.transfer,{kind:'model-response',bytes:123,outcome:'received'});
  const memory=projectEvent(event(9,{type:'memory.verified',memory:{source_ids:['run-1','run-1','password'],environment_key:'a'.repeat(64),outcome:'evidence-integrity-verified',body:'PRIVATE'}}));
  assert.deepEqual(memory.memory,{stage:'verified',source_ids:['run-1'],environment_key:'a'.repeat(64),outcome:'evidence-integrity-verified'});
  assert.doesNotMatch(JSON.stringify([output,memory]),/PRIVATE/);
});
test('existing ninja logo is served as a fixed local SVG asset',async t=>{
  const {dashboard}=fixture(t),url=await dashboard.listen(0),response=await get(url,'/ninja-logo.svg');
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/image\/svg\+xml/);assert.match(response.text,/<svg/);
});

test('AEF context and code evolution keep bounded metrics and transfer sizes without code or memory payloads',()=>{
  for (const kind of ['memory-request','memory-response','code-candidate']) {
    const projected=projectEvent(event(10,{type:'message.sent',run_kind:'code-evolution',transfer:{kind,bytes:800,outcome:'sent',content:'PRIVATE'}}));
    assert.deepEqual(projected.transfer,{kind,bytes:800,outcome:'sent'});
    assert.equal(projected.run_kind,'code-evolution');
  }
  const result=projectEvent(event(11,{type:'evolution.accepted',metrics:{baseline:1,observed:36,delta:35,challenge_total:36,context_tokens:1998,context_budget:2000},code:'PRIVATE'}));
  assert.equal(result.metrics.delta,35);
  assert.equal(result.metrics.context_budget,2000);
  assert.equal(result.metrics.challenge_total,36);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
});
