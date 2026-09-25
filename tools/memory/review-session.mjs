/** Local evidence review only: no assessment, model invocation or new memory observations. */
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseScope, validateScope } from '../powershell/read-scope.mjs';
import { createLiveMemoryHooks } from './workshop-memory.mjs';

export async function reviewSession({sessionDir, scope}) {
  sessionDir = realpathSync(sessionDir);
  if (basename(dirname(sessionDir)) !== 'engagements') throw Error('Expected an engagement session');
  const runs = join(sessionDir, 'runs');
  if (existsSync(runs) && lstatSync(runs).isSymbolicLink()) throw Error('Run directory cannot be a symlink');
  mkdirSync(runs, {recursive:true});
  if (existsSync(join(runs, 'live.lock'))) throw Error('An assessment holds the session lock');
  const log = join(runs, 'live-events.jsonl');
  if (existsSync(log) && (!lstatSync(log).isFile() || lstatSync(log).isSymbolicLink())) throw Error('Expected a regular event log');
  const runId = randomUUID(); let sequence = 0;
  const emit = event => appendFileSync(log, JSON.stringify({...event, schema_version:1, id:`${runId}:${++sequence}`, ts:new Date().toISOString(), session_id:basename(sessionDir), run_id:runId, mode:'live', run_kind:'memory-review'})+'\n', {mode:0o600});
  emit({type:'run.started', status:'running'});
  try {
    const loaded = await createLiveMemoryHooks({sessionDir, runId, scope, emit}).load();
    const metrics = {records:Object.values(loaded.agents).reduce((n,a)=>n+a.records.length,0), promoted:Object.values(loaded.agents).reduce((n,a)=>n+a.knowledge.length,0), azure_reads:0};
    emit({type:'run.completed', status:'completed', metrics});
    return {runId, runKind:'memory-review', ...metrics, improvementVerified:false};
  } catch (error) { emit({type:'run.failed',status:'failed'}); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw Error('Usage: node tools/memory/review-session.mjs engagements/<session>');
    const sessionDir = resolve(process.argv[2]);
    const doc = parseScope(readFileSync(join(sessionDir,'engagement.yaml'),'utf8'));
    const scope = {...validateScope(doc),mode:doc.mode};
    console.log(JSON.stringify(await reviewSession({sessionDir,scope})));
  } catch (error) { console.error(error.message); process.exitCode=1; }
}
