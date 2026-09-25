#!/usr/bin/env node
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,realpathSync,existsSync,unlinkSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {validateScope,parseScope} from '../powershell/read-scope.mjs';
import {runGraphAsync} from './async-runner.mjs';
import {createLiveHandlers} from './live-handlers.mjs';
import {isWithinDirectory} from './live-paths.mjs';
export async function main(argv=process.argv.slice(2)){
 const args={};for(let i=0;i<argv.length;i+=2){if(!['--session','--engagement','--azure-config','--concurrency','--max-reads-per-domain'].includes(argv[i])||!argv[i+1])throw Error('Usage: run-live.mjs --session <fresh-dir> --engagement <scope.yaml> --azure-config <isolated-dir> [--concurrency 3] [--max-reads-per-domain 3]');args[argv[i].slice(2)]=argv[i+1];}
 if(!args.session||!args.engagement||!args['azure-config'])throw Error('Explicit session, engagement and isolated Azure config required');
 const root=resolve(fileURLToPath(new URL('../..',import.meta.url))),sessionDir=realpathSync(resolve(args.session)),engagementFile=realpathSync(resolve(args.engagement)),azureConfigDir=realpathSync(resolve(args['azure-config']));
 if(!isWithinDirectory(join(root,'engagements'),sessionDir)||!isWithinDirectory(sessionDir,azureConfigDir)||!isWithinDirectory(sessionDir,engagementFile))throw Error('Session, scope and isolated credentials must be within engagements/<session>');
 const doc=parseScope(readFileSync(engagementFile,'utf8')),scope={...validateScope(doc),mode:doc.mode};
 const manifest=JSON.parse(readFileSync(join(sessionDir,'evidence/preflight-manifest.json'),'utf8'));
 if(manifest.status!=='passed'||manifest.readerEquivalent!==true||manifest.tenantId!==scope.tenantId||manifest.subscriptionId!==scope.subscriptionId||realpathSync(manifest.azureConfigDir)!==azureConfigDir||Date.now()-Date.parse(manifest.verifiedAt)>3600000||!Number.isFinite(Date.parse(manifest.verifiedAt)))throw Error('Fresh scope-bound preflight manifest required (maximum age 1 hour)');
 const runDir=join(sessionDir,'runs');mkdirSync(runDir,{recursive:true});const lock=join(runDir,'live.lock');
 if(existsSync(join(runDir,'live-completed.json')))throw Error('Completed session cannot be replayed as a new live run; create a fresh session and preflight');
 writeFileSync(lock,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});
 const maxReads=Number(args['max-reads-per-domain']||3);if(!Number.isInteger(maxReads)||maxReads<1||maxReads>20){unlinkSync(lock);throw Error('max-reads-per-domain must be 1..20');}
 const runId=randomUUID();let id=0;const emit=event=>{const row={schema_version:1,id:++id,ts:new Date().toISOString(),session_id:basename(sessionDir),run_id:runId,mode:'live',...event};appendFileSync(join(runDir,'live-events.jsonl'),JSON.stringify(row)+'\n',{mode:0o600});process.stdout.write(JSON.stringify(row)+'\n');};
 const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{emit({type:'run.started',status:'running',summary:'Bounded live configuration assessment'});const {runLivePreflight}=await import('./live-preflight.mjs');const graph=JSON.parse(readFileSync(join(root,'graph/redteam.graph.json'),'utf8'));const handlers=createLiveHandlers({root,sessionDir,engagementFile,azureConfigDir,scope,runId,emit,maxReads,preflight:runLivePreflight});const result=await runGraphAsync(graph,{handlers,scope,emit,signal:controller.signal,concurrency:Number(args.concurrency||3),onCheckpoint:checkpoint=>writeFileSync(join(runDir,'live-checkpoint.json'),JSON.stringify(checkpoint,null,2),{mode:0o600})});writeFileSync(join(runDir,'live-completed.json'),JSON.stringify({...result,runId,coverage:'bounded configuration sample; unsupported checks remain unassessed'},null,2),{mode:0o600});emit({type:'run.completed',status:'completed',metrics:{confirmed_findings:result.state.confirmed_findings.length},summary:'Graph stages completed; assessment coverage remains bounded'});return result;
 }catch(error){emit({type:'run.failed',status:'failed',summary:'Live run failed; no success certificate produced'});throw error;}finally{unlinkSync(lock);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
