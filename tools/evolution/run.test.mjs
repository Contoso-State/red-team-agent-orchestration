import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,mkdirSync,copyFileSync,realpathSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {decide,proposeResolver,scoreResolver} from './run.mjs';
import {contractCases} from './routing-contract.mjs';

const sourceRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
async function fixture(t) {
 const temporary=realpathSync(mkdtempSync(join(tmpdir(),'redteam-evolution-')));
 t.after(()=>rmSync(temporary,{recursive:true,force:true}));
 const root=join(temporary,'red-team'),upstream=join(temporary,'aef-core'),session=join(root,'engagements','test-session');
 for(const directory of [session,upstream,join(temporary,'empty-hooks')])mkdirSync(directory,{recursive:true});
 for(const file of ['tools/evolution/run.mjs','tools/evolution/routing-contract.mjs','tools/evolution/config.json','tools/dashboard/public/node-resolver.mjs','graph/redteam.graph.json']) {
  mkdirSync(dirname(join(root,file)),{recursive:true});copyFileSync(join(sourceRoot,file),join(root,file));
 }
 const git=(...args)=>execFileSync('git',['-c',`core.hooksPath=${join(temporary,'empty-hooks')}`,'-c','commit.gpgSign=false',...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 git('init','--quiet','--template=','-b','codex/test');
 git('-c','user.name=Evolution Test','-c','user.email=evolution-test@example.invalid','commit','--quiet','--allow-empty','-m','Test fixture');
 // Import the copied module so its immutable ROOT is this isolated checkout.
 const module=await import(pathToFileURL(join(root,'tools/evolution/run.mjs')).href);
 return {root,upstream,session,git,...module};
}

test('routing candidate preserves canonical mappings and covers the fixed alias contract',async()=>{
 const graph=JSON.parse(readFileSync(join(sourceRoot,'graph/redteam.graph.json'))),nodes=[...graph.nodes,...graph.roster.map(n=>({...n,id:n.domain}))],cases=contractCases(nodes);
 const candidate=await import('data:text/javascript;base64,'+Buffer.from(proposeResolver()).toString('base64'));
 assert.equal(scoreResolver(candidate.resolveNode,nodes,cases.golden),cases.golden.length);
 assert.equal(scoreResolver(candidate.resolveNode,nodes,cases.challenge),cases.challenge.length);
 assert.equal(scoreResolver(()=>null,nodes,cases.challenge),0);
});
test('acceptance rejects regressions, unchanged candidates and null-control ties',()=>{
 const base={goldenTotal:45,baselineGolden:45,candidateGolden:45,baselineChallenge:1,candidateChallenge:36,nullChallenge:0};
 assert.equal(decide(base),true);
 for(const changed of [{candidateGolden:44},{baselineGolden:44},{baselineChallenge:36},{nullChallenge:36}])assert.equal(decide({...base,...changed}),false);
});
test('code mutation boundary excludes main, detached HEAD, upstream, guards and arbitrary files',async t=>{
 const {root,upstream,verifyBoundary}=await fixture(t);
 verifyBoundary(root,'codex/test');
 for(const args of [[root,'main'],[root,''],[sourceRoot,'codex/test'],[upstream,'codex/test'],[root,'codex/test','guardrails/guard.mjs'],[root,'codex/test','aef_adapter.py']])assert.throws(()=>verifyBoundary(...args),/fixed routing/);
});
test('evolution rejects actual main and detached fixture checkouts before writing audit data',async t=>{
 const {root,session,git,evolve}=await fixture(t);
 git('switch','--quiet','-c','main');
 await assert.rejects(evolve({sessionDir:session,enabled:true}),/fixed routing/);
 git('checkout','--quiet','--detach','HEAD');
 assert.equal(git('branch','--show-current').trim(),'');
 await assert.rejects(evolve({sessionDir:session,enabled:true}),/fixed routing/);
 assert.deepEqual(readdirSync(session),[]);
 assert.deepEqual(readdirSync(join(root,'engagements')),['test-session']);
});
test('disabled evolution writes nothing; rounds and audit scope fail closed',async t=>{
 const {root,session,evolve,TARGET}=await fixture(t);
 assert.deepEqual(await evolve({enabled:false}),{enabled:false});
 assert.deepEqual(readdirSync(session),[]);
 for(const maxRounds of [0,3,Infinity])await assert.rejects(evolve({maxRounds}),/bounded/);
 await assert.rejects(evolve({sessionDir:root}),/target engagement/);
 writeFileSync(join(root,TARGET),proposeResolver());
 const before=readFileSync(join(root,TARGET),'utf8');
 const result=await evolve({sessionDir:session,maxRounds:1});
 assert.equal(result.decisions[0].accepted,false);assert.equal(readFileSync(join(root,TARGET),'utf8'),before);
});
