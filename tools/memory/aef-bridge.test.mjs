import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,copyFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,relative,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {AEF_PYTHON,aefPythonPath,retrieveWithAEF} from './aef-bridge.mjs';
const root=resolve('.'), hash=v=>createHash('sha256').update(v).digest('hex');
test('AEF bridge selects the platform venv executable layout', () => {
 assert.equal(aefPythonPath('C:\\workshop\\Red Team', 'win32'), 'C:\\workshop\\Red Team\\engagements\\aef-integration-verification\\.venv\\Scripts\\python.exe');
 for (const platform of ['linux', 'darwin']) assert.equal(aefPythonPath('/tmp/Red Team', platform), '/tmp/Red Team/engagements/aef-integration-verification/.venv/bin/python');
 assert.equal(AEF_PYTHON, aefPythonPath(root, process.platform));
});
test('AEF bootstrap selects Windows and POSIX venv executables without installing', () => {
 const script = `import json,runpy
from pathlib import Path, PurePosixPath, PureWindowsPath
helper=runpy.run_path(str(Path.cwd()/"tools/aef/bootstrap.py"))["venv_python"]
print(json.dumps({"nt":str(helper(PureWindowsPath("C:/workshop/.venv"),"nt")),"posix":str(helper(PurePosixPath("/tmp/workshop/.venv"),"posix"))}))`;
 const result = spawnSync(AEF_PYTHON, ['-I', '-B', '-c', script], {cwd:root, encoding:'utf8', timeout:10000});
 assert.equal(result.status, 0, result.stderr);
 assert.deepEqual(JSON.parse(result.stdout), {nt:'C:\\workshop\\.venv\\Scripts\\python.exe', posix:'/tmp/workshop/.venv/bin/python'});
});
function fixture(t) {
 const session=mkdtempSync(join(root,'engagements','qa-aef-'));t.after(()=>rmSync(session,{recursive:true,force:true}));
 mkdirSync(join(session,'memory/methodology'),{recursive:true});writeFileSync(join(session,'proof.json'),'{}');
 const environmentKey=hash(randomUUID());
 function records(runId,agent='logging-coverage',count=1) {
  const rows=Array.from({length:count},(_,i)=>({agent,checkId:'CHK-QA-'+i,signature:hash('observation-'+i),outcome:'confirmed',evidence:[{path:'proof.json',sha256:hash('{}')}]}));
  writeFileSync(join(session,'memory/methodology',runId+'.json'),JSON.stringify({version:1,runId,environmentKey,records:rows}));
  return rows.map(row=>({...row,runId,sourceSession:relative(root,session)}));
 }
 const request=records=>({session,runId:'current',environmentKey,agents:{'logging-coverage':{records}}});
 return {session,environmentKey,records,request};
}
test('installed AEF executes nodes, writes checkpoints, emits byte-counted exchanges and requires distinct runs',async t=>{
 const f=fixture(t),rows=f.records('prior'),events=[];
 const one=await retrieveWithAEF({...f.request([...rows,...rows]),emit:e=>events.push(e)});
 assert.equal(one.engine,'aef-core');assert.equal(one.modelCalls,0);
 assert.equal(one.sourceCommit,JSON.parse(readFileSync(join(root,'tools/aef/source-lock.json'),'utf8')).commit);
 assert.equal(one.agents['logging-coverage'].knowledge.length,0);
 assert.ok(one.agents['logging-coverage'].context.length>0);
 assert.ok(existsSync(join(f.session,'memory/methodology/aef/checkpoints')));
 assert.deepEqual(events.filter(e=>e.type==='node.completed').map(e=>e.node_id),['aef_consolidate','aef_retrieve','aef_reflect']);
 const transfers=events.filter(e=>e.transfer);assert.equal(transfers.length,2);
 assert.equal(transfers[0].transfer.bytes,Buffer.byteLength(JSON.stringify({records:[...rows,...rows]})));
 assert.equal(transfers[1].transfer.bytes,Buffer.byteLength(JSON.stringify(one.agents['logging-coverage'])));
 assert.deepEqual(transfers[1].evidence_refs,[one.reportRef]);
 const audit=JSON.parse(readFileSync(join(f.session,one.reportRef),'utf8'));
 assert.deepEqual(audit.agents['logging-coverage'].sources[0].evidence,rows[0].evidence);
 assert.equal(audit.agents['logging-coverage'].sources[0].runId,'prior');
 const two=await retrieveWithAEF(f.request([...rows,...f.records('second')]));
 assert.equal(two.agents['logging-coverage'].knowledge.length,1);assert.equal(two.agents['logging-coverage'].improvementVerified,false);
});
test('adapter rejects an installed revision that differs from the target source lock before emitting events',t=>{
 const f=fixture(t);
 copyFileSync(join(root,'aef_adapter.py'),join(f.session,'aef_adapter.py'));
 mkdirSync(join(f.session,'tools/aef'),{recursive:true});
 writeFileSync(join(f.session,'tools/aef/source-lock.json'),JSON.stringify({commit:'0'.repeat(40)}));
 const result=spawnSync(AEF_PYTHON,['-I','-B',join(f.session,'aef_adapter.py')],{input:'{}',encoding:'utf8',timeout:10000});
 assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr.trim(),'ValueError');
});
test('AEF rejects wrong agent, current run, foreign environment and tampered evidence',async t=>{
 const f=fixture(t),rows=f.records('prior');
 for(const bad of [f.request([{...rows[0],agent:'identity-posture'}]),{...f.request(rows),runId:'prior'},{...f.request(rows),environmentKey:hash('foreign')}]) await assert.rejects(retrieveWithAEF(bad),/failed closed/);
 writeFileSync(join(f.session,'proof.json'),'tampered');await assert.rejects(retrieveWithAEF(f.request(rows)),/failed closed/);
});
test('AEF bounds context with large verified history and isolates other agents',async t=>{
 const f=fixture(t),events=[],many=f.records('prior','logging-coverage',80);
 const result=await retrieveWithAEF({...f.request(many),agents:{'logging-coverage':{records:many},'identity-posture':{records:[]}},emit:e=>events.push(e)});
 assert.equal(result.agents['identity-posture'].context.length,0);
 const metrics=events.find(e=>e.node_id==='aef_retrieve'&&e.type==='node.completed'&&e.agent_id==='logging-coverage').metrics;
 assert.equal(metrics.records,80);assert.ok(metrics.retrieved>0&&metrics.retrieved<80);assert.ok(metrics.context_tokens<=2000);assert.equal(metrics.context_budget,2000);
});
