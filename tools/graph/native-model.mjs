/** Native model subprocess, deliberately with no executable tools or MCP servers. */
import { spawn, spawnSync } from 'node:child_process';
import { extractNativeUsage, normalizeModelUsage } from './model-usage.mjs';
// Preflight wrappers spawn a Node shim and Azure CLI descendants. Killing only
// the wrapper leaves those reads running after the graph has been cancelled.
export function terminateProcessTree(child,{platform=process.platform,kill=process.kill,execute=spawnSync}={}) {
  if(!Number.isInteger(child.pid)||child.pid<=0)return;
  if(platform==='win32') {
    const result=execute('taskkill',['/PID',String(child.pid),'/T','/F'],{shell:false,windowsHide:true,stdio:'ignore',timeout:5000});
    if(result.error||result.status!==0){child.kill('SIGKILL');throw Error('Process tree cleanup could not be confirmed');}
  } else {
    try{kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw Error('Process tree cleanup could not be confirmed');}
  }
}
export function runProcess(file,args,{input='',env=process.env,cwd,timeout=180000,signal,maxBytes=4000000,processTree=false}={}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(Error('Subprocess cancelled'));return;}
    const child=spawn(file,args,{env,cwd,stdio:['pipe','pipe','pipe'],detached:processTree&&process.platform!=='win32',windowsHide:true});let out='',bytes=0,done=false,failure,timer;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
    const stop=error=>{
      if(done||failure)return;failure=error;clearTimeout(timer);
      try{if(processTree)terminateProcessTree(child);else child.kill('SIGKILL');}catch{failure=Error('Subprocess failed; process tree cleanup could not be confirmed');}
      // Normally close confirms the wrapper and its inherited pipes have exited.
      // Bound cleanup failure too, while refusing any subsequent preflight work.
      timer=setTimeout(()=>{child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();child.unref();finish(Error('Subprocess failed; process cleanup timed out'));},5000);
    };
    const abort=()=>stop(Error('Subprocess cancelled'));
    timer=setTimeout(()=>stop(Error('Subprocess timed out')),timeout);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    child.on('error',()=>finish(Error('Required executable unavailable or cancelled')));
    child.stdout.on('data',chunk=>{if(failure)return;bytes+=chunk.length;if(bytes>maxBytes)stop(Error('Subprocess output limit exceeded'));else out+=chunk;});
    child.stderr.resume(); // Native error payloads may contain credentials: never persist or display them.
    child.on('close',code=>finish(failure||(code===0?null:Error(`Subprocess failed (exit ${code}); payload withheld`)),out));
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
export function parseNativeOutput(text) {
  let envelope;try{envelope=JSON.parse(text);}catch{throw Error('Native runtime returned malformed JSON');}
  return parseNativeEnvelope(envelope);
}
function parseNativeEnvelope(envelope) {
  if(!envelope || typeof envelope!=='object' || Array.isArray(envelope) || envelope.is_error!==false || envelope.subtype!=='success')throw Error('Native runtime did not complete successfully');
  let result=envelope.structured_output;
  if(!result){try{result=JSON.parse(envelope.result);}catch{throw Error('Native runtime omitted structured result');}}
  if(!result||typeof result!=='object'||Array.isArray(result))throw Error('Native result must be an object');return result;
}
export async function callNative({prompt,schema,cwd,signal,execute=runProcess,onUsage}) {
  let usage=normalizeModelUsage();
  try {
    const output=await execute('claude',['-p','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','','--no-session-persistence','--output-format','json','--json-schema',JSON.stringify(schema)],{input:prompt,cwd,signal});
    let envelope;try{envelope=JSON.parse(output);}catch{throw Error('Native runtime returned malformed JSON');}
    usage=extractNativeUsage(envelope);
    const result=parseNativeEnvelope(envelope);validateOutput(result,schema);return result;
  } finally {
    // Metadata is reported once even when structured output or transport fails.
    // A telemetry consumer must not alter the model result or replace its error.
    if(typeof onUsage==='function'){try{onUsage(usage);}catch{}}
  }
}

export function validateOutput(value,schema,path='$') {
 if(schema.type){const types=Array.isArray(schema.type)?schema.type:[schema.type];if(!types.some(t=>t==='null'?value===null:t==='array'?Array.isArray(value):t==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):t==='integer'?Number.isInteger(value):typeof value===t))throw Error(`Native schema type mismatch at ${path}`);}
 if(schema.enum&&!schema.enum.includes(value))throw Error(`Native schema enum mismatch at ${path}`);
 if(typeof value==='number'&&(!Number.isFinite(value)||(schema.minimum!==undefined&&value<schema.minimum)||(schema.maximum!==undefined&&value>schema.maximum)))throw Error(`Native schema number mismatch at ${path}`);
 if(typeof value==='string'&&((schema.pattern&&!new RegExp(schema.pattern).test(value))||(schema.minLength!==undefined&&value.length<schema.minLength)||(schema.maxLength!==undefined&&value.length>schema.maxLength)))throw Error(`Native schema string mismatch at ${path}`);
 if(Array.isArray(value)){if((schema.maxItems!==undefined&&value.length>schema.maxItems)||(schema.minItems!==undefined&&value.length<schema.minItems))throw Error(`Native schema array mismatch at ${path}`);if(schema.items)value.forEach((v,i)=>validateOutput(v,schema.items,`${path}[${i}]`));}
 else if(value&&typeof value==='object'){for(const key of schema.required||[])if(!(key in value))throw Error(`Native schema missing field ${path}.${key}`);for(const [key,v] of Object.entries(value)){if(schema.properties?.[key])validateOutput(v,schema.properties[key],`${path}.${key}`);else if(schema.additionalProperties===false)throw Error(`Native schema extra field at ${path}`);}}
 return value;
}
