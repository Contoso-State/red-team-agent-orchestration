/** Calls the target-local pinned AEF runtime with verified metadata only. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, win32, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function aefPythonPath(root=ROOT, platform=process.platform) {
  const path=platform==='win32'?win32:posix;
  return path.join(root,'engagements','aef-integration-verification','.venv',
    platform==='win32'?'Scripts':'bin',platform==='win32'?'python.exe':'python');
}
export const AEF_PYTHON = aefPythonPath();
export async function retrieveWithAEF({session, runId, environmentKey, agents, emit = () => {}}) {
  if (!existsSync(AEF_PYTHON)) throw Error('AEF runtime missing: run tools/aef/bootstrap.py using Python 3.11 or newer');
  return new Promise((accept, reject) => {
    const child = spawn(AEF_PYTHON, ['-I', '-B', join(ROOT, 'aef_adapter.py')], {cwd:ROOT, env:{PATH:'/usr/bin:/bin', PYTHONDONTWRITEBYTECODE:'1'}, stdio:['pipe','pipe','pipe']});
    let pending='', size=0, result, failed=false;
    const timer=setTimeout(()=>{failed=true; child.kill(); reject(Error('AEF retrieval timed out'));},30000);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if(size > 4_000_000) {failed=true; child.kill(); return;}
      pending += chunk;
      const lines=pending.split('\n'); pending=lines.pop();
      for(const line of lines) if(line) try {
        const item=JSON.parse(line);
        if(item.kind==='event') emit(item.event);
        else if(item.kind==='result') result=item.result;
        else throw Error('Unknown AEF output');
      } catch {failed=true; child.kill();}
    });
    child.stderr.resume();
    child.stdin.on('error',()=>{});
    child.on('error', error => {clearTimeout(timer);reject(error);});
    child.on('close', code => {clearTimeout(timer); if (code===0 && result && !failed && !pending) {
      for (const [agent, value] of Object.entries(result.agents)) emit({type:'message.sent', from_agent:'aef_retrieve', to_agent:agent, exchange_id:`${runId}:${agent}`, evidence_refs:[result.reportRef], transfer:{kind:'memory-response',bytes:Buffer.byteLength(JSON.stringify(value)),outcome:'received'}});
      accept(result);
    } else reject(Error('AEF evidence retrieval failed closed'));});
    child.stdin.end(JSON.stringify({session:relative(ROOT,session), runId, environmentKey, agents}), () => {
      for (const [agent, value] of Object.entries(agents)) emit({type:'message.sent', from_agent:agent, to_agent:'aef_consolidate', exchange_id:`${runId}:${agent}`, transfer:{kind:'memory-request',bytes:Buffer.byteLength(JSON.stringify(value)),outcome:'sent'}});
    });
  });
}
