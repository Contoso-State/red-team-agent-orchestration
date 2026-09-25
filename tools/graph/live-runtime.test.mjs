import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {parseNativeOutput,validateOutput,callNative} from './native-model.mjs';
import {descriptor,createReadBroker} from './live-broker.mjs';
import {requireVerdicts,createLiveHandlers} from './live-handlers.mjs';
import {runGraphAsync} from './async-runner.mjs';
import {buildSecurityContext} from './run-graph.mjs';
const scope={subscriptionId:'11111111-1111-4111-8111-111111111111',mode:'read-only-assessment'};
const resource={id:`/subscriptions/${scope.subscriptionId}/resourceGroups/demo/providers/Microsoft.Storage/storageAccounts/test`,type:'Microsoft.Storage/storageAccounts'};
test('native output fails closed for error envelopes, missing structured JSON and local schema violations',()=>{
 for(const value of ['{}','bad',JSON.stringify({is_error:true,subtype:'success',structured_output:{ready:true}})])assert.throws(()=>parseNativeOutput(value));
 assert.throws(()=>validateOutput({ready:'yes'},{type:'object',properties:{ready:{type:'boolean'}},required:['ready']}));
 assert.throws(()=>validateOutput({n:10},{type:'object',properties:{n:{type:'number',maximum:3}}}));
});
test('native runtime launches with no tools/MCP and validates returned schema',async()=>{
 let seen;const value=await callNative({prompt:'bounded',schema:{type:'object',properties:{ready:{type:'boolean'}},required:['ready']},execute:async(file,args,opts)=>{seen={file,args,opts};return JSON.stringify({is_error:false,subtype:'success',structured_output:{ready:true}});}});
 assert.equal(value.ready,true);assert.equal(seen.args[seen.args.indexOf('--tools')+1],'');assert.ok(seen.args.includes('--strict-mcp-config'));assert.equal(seen.opts.input,'bounded');
});
test('native usage callback preserves plain results and reports metadata once',async()=>{
 const usage=[];
 const result=await callNative({prompt:'PRIVATE_PROMPT',schema:{type:'object'},onUsage:value=>usage.push(value),execute:async()=>JSON.stringify({is_error:false,subtype:'success',structured_output:{ready:true},usage:{input_tokens:12,output_tokens:3},total_cost_usd:0.01,modelUsage:{'claude-model':{}},result:'PRIVATE_RESULT'})});
 assert.deepEqual(result,{ready:true});assert.equal(usage.length,1);assert.equal(usage[0].input_tokens,12);assert.equal(usage[0].cost_usd,0.01);
 assert.doesNotMatch(JSON.stringify(usage),/PRIVATE/);
});
test('native usage survives error envelopes and invalid results, but transport failures remain unknown',async()=>{
 const schema={type:'object',properties:{ready:{type:'boolean'}},required:['ready']};
 const base={is_error:false,subtype:'success',usage:{input_tokens:12},total_cost_usd:0.01};
 for(const envelope of [{...base,is_error:true,errors:['PRIVATE_ERROR']},{...base},{...base,structured_output:{ready:'PRIVATE_INVALID'}}]){
  const usage=[];await assert.rejects(callNative({prompt:'test',schema,onUsage:value=>usage.push(value),execute:async()=>JSON.stringify(envelope)}));
  assert.equal(usage.length,1);assert.equal(usage[0].input_tokens,12);assert.equal(usage[0].cost_usd,0.01);assert.doesNotMatch(JSON.stringify(usage),/PRIVATE/);
 }
 for(const execute of [async()=>{throw Error('PRIVATE_TRANSPORT');},async()=>'PRIVATE_MALFORMED']){
  const usage=[];await assert.rejects(callNative({prompt:'test',schema,onUsage:value=>usage.push(value),execute}));
  assert.equal(usage.length,1);assert.equal(usage[0].input_tokens,null);assert.equal(usage[0].cost_usd,null);
 }
});
test('telemetry callbacks cannot replace the model result or its original error',async()=>{
 const options={prompt:'test',schema:{type:'object'},onUsage:()=>{throw Error('telemetry consumer failed');}};
 assert.deepEqual(await callNative({...options,execute:async()=>JSON.stringify({is_error:false,subtype:'success',structured_output:{ready:true}})}),{ready:true});
 await assert.rejects(callNative({...options,execute:async()=>{throw Error('original transport error');}}),/original transport error/);
});
test('live handler forwards usage callback and correlates its model exchange without executing Azure',async()=>{
 const fixtureDir=mkdtempSync(join(tmpdir(),'redteam-model-usage-')),sessionDir=join(fixtureDir,'engagements','test'),events=[],signal=new AbortController().signal;
 mkdirSync(sessionDir,{recursive:true});
 try{
  const handlers=createLiveHandlers({root:process.cwd(),sessionDir,scope:{...scope,tenantId:'22222222-2222-4222-8222-222222222222'},runId:'test-run',emit:event=>events.push(event),model:async request=>{
   assert.equal(request.signal,signal);assert.equal(typeof request.onUsage,'function');request.onUsage({input_tokens:12,output_tokens:3});return {relationships:[]};
  }});
  assert.deepEqual(await handlers.correlate(null,{state:{confirmed_findings:[]},signal}),{writes:{attack_paths:[]}});
  const usage=events.filter(e=>e.type==='model.usage');assert.equal(usage.length,1);assert.equal(usage[0].usage.input_tokens,12);
  assert.equal(usage[0].agent_id,'authorization-attack-path');assert.equal(usage[0].status,'completed');
  assert.equal(usage[0].exchange_id,events.find(e=>e.transfer?.kind==='model-request').exchange_id);
 }finally{rmSync(fixtureDir,{recursive:true,force:true});}
});
test('finite ARM descriptor rejects scope escapes, unknown types and type/path mismatch',()=>{
 assert.equal(descriptor(resource,scope)[0],'rest');
 for(const r of [{...resource,id:resource.id.replace(scope.subscriptionId,'other')},{...resource,id:resource.id+'/../secrets'},{...resource,type:'Microsoft.KeyVault/vaults'},{...resource,id:resource.id+'?secret=true'},{...resource,type:'unknown'}])assert.throws(()=>descriptor(r,scope));
});
test('guarded broker rejects wrong response ID and command failures without raw payload',async()=>{
 const opts={root:process.cwd(),scope,azureConfigDir:'/isolated',emit:()=>{}};
 await assert.rejects(createReadBroker({...opts,execute:async()=>({ok:true,stdout:JSON.stringify({id:'/wrong'})})})(resource),/payload withheld/);
 await assert.rejects(createReadBroker({...opts,execute:async()=>{throw Error('TOKEN secret');}})(resource),error=>!error.message.includes('TOKEN'));
 let calls=0;const broker=createReadBroker({...opts,execute:async()=>{calls++;return {ok:true,stdout:JSON.stringify({id:resource.id,allowBlobPublicAccess:false})};}});
 await broker(resource);await broker(resource);assert.equal(calls,1);await broker(resource,{fresh:true});assert.equal(calls,2);
});
test('broker uses canonical async runner with isolated credentials, scope, cancellation and bounds',async()=>{
 const signal=new AbortController().signal,events=[];
 const root=process.cwd(),azureConfigDir='/isolated credentials';let calls=0;
 const broker=createReadBroker({root,scope,azureConfigDir,emit:e=>events.push(e),execute:async(args,opts)=>{
  calls++;assert.deepEqual(args,descriptor(resource,scope));
  assert.equal(opts.cwd,root);assert.equal(opts.signal,signal);assert.equal(opts.timeoutMs,180000);assert.equal(opts.maxBuffer,4000000);
  assert.equal(opts.env.AZURE_CONFIG_DIR,azureConfigDir);assert.equal(opts.env.AZURE_EXTENSION_USE_DYNAMIC_INSTALL,'no');assert.equal(opts.env.AZURE_CORE_COLLECT_TELEMETRY,'no');
  if(calls===1)throw Error('CLI timeout with sensitive payload');return {ok:true,stdout:JSON.stringify({id:resource.id})};
 }});
 await assert.rejects(broker(resource,{agent_id:'data',signal}),/payload withheld/);
 assert.equal(events.at(-1).type,'tool.failed');assert.equal(events.some(e=>e.type==='tool.completed'),false);
 await broker(resource,{agent_id:'data',signal});assert.equal(calls,2);assert.equal(events.at(-1).type,'tool.completed');
});
test('independent judge requires complete unique explicit verdicts',()=>{
 assert.throws(()=>requireVerdicts(['A'],[]));assert.throws(()=>requireVerdicts(['A','B'],[{id:'A',verdict:'confirmed'},{id:'A',verdict:'confirmed'}]));requireVerdicts(['A'],[{id:'A',verdict:'unverified'}]);
});
test('async graph awaits real handlers and no missing/default adapter can complete',async()=>{
 const graph=JSON.parse(readFileSync(new URL('../../graph/redteam.graph.json',import.meta.url),'utf8'));await assert.rejects(runGraphAsync(graph,{handlers:{},scope}),/Missing live handler/);
 let active=0,max=0,completed=0;const handlers=Object.fromEntries(graph.nodes.filter(n=>!n.gated).map(n=>[n.id,async()=>({writes:{}})]));
 handlers.validate_scope=async()=>({writes:{scope}});handlers.run_specialist=async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,4));active--;completed++;return {writes:{}};};handlers.evaluate=async()=>({writes:{critique:{quality:1}}});
 const result=await runGraphAsync(graph,{handlers,scope,concurrency:2});assert.equal(result.status,'completed');assert.equal(completed,11);assert.equal(max,2);
 handlers.judge=async()=>{throw Error('missing judge verdict');};await assert.rejects(runGraphAsync(graph,{handlers,scope}),/missing judge verdict/);
});

test('live security context is persisted and consumed by both specialist calls without claiming collection',async()=>{
 const fixtureDir=mkdtempSync(join(tmpdir(),'redteam-live-context-')),sessionDir=join(fixtureDir,'engagements','test');
 const selectedScope={...scope,tenantId:'22222222-2222-4222-8222-222222222222',domains:['data-protection'],resource_types:['Microsoft.Storage/*']},prompts=[],events=[],signal=new AbortController().signal;
 mkdirSync(sessionDir,{recursive:true});
 try{
  const handlers=createLiveHandlers({root:process.cwd(),sessionDir,scope:selectedScope,runId:'context-fixture',emit:event=>events.push(event),
   preflight:async options=>{assert.equal(options.signal,signal);return {resources:[],inventoryRef:'inventory/resources.json'};},
   model:async request=>{prompts.push(request.prompt);return prompts.length===1?{resource_ids:[],coverage_gaps:['No resources collected in fixture']}:{findings:[],coverage_gaps:['No evidence available']};}});
  const inventory=await handlers.preflight_inventory(null,{signal});
  const state={scope:selectedScope,...inventory.writes};
  const result=await handlers.build_security_context(null,{state});
  assert.deepEqual(result.writes.security_context,buildSecurityContext(state));
  assert.deepEqual(JSON.parse(readFileSync(join(sessionDir,'evidence/security-context.json'),'utf8')),result.writes.security_context);
  assert.equal(result.writes.security_context.inventory.status,'referenced');
  assert.equal(result.writes.security_context.signals.arm.status,'unverified');
  assert.equal(Object.keys(result.writes.security_context.signals).length,8);
  assert.equal(Object.values(result.writes.security_context.signals).some(signal=>signal.status==='available'),false);
  Object.assign(state,result.writes);
  await handlers.run_specialist(null,{item:{domain:'data'},state});
  assert.equal(prompts.length,2);
  for(const prompt of prompts)assert.ok(prompt.includes(JSON.stringify(state.security_context)));
  assert.equal(events.filter(event=>event.transfer?.kind==='model-request').length,2);
  assert.ok(events.filter(event=>event.transfer?.kind==='model-request').every(event=>event.transfer.bytes>JSON.stringify(state.security_context).length));
  assert.equal(JSON.stringify(events).includes('inventory/resources.json'),false,'metadata must not expose context payload');
 }finally{rmSync(fixtureDir,{recursive:true,force:true});}
});

test('canonical live graph builds context before scope-filtered dispatch and preserves it in specialist state',async()=>{
 const graph=JSON.parse(readFileSync(new URL('../../graph/redteam.graph.json',import.meta.url),'utf8'));
 const selectedScope={...scope,tenantId:'22222222-2222-4222-8222-222222222222',domains:['data-protection'],resource_types:['Microsoft.Storage/*']},order=[];
 const handlers=Object.fromEntries(graph.nodes.filter(node=>!node.gated).map(node=>[node.id,async()=>({writes:{}})]));
 handlers.validate_scope=async()=>({writes:{scope:selectedScope}});
 handlers.preflight_inventory=async()=>({writes:{inventory_ref:'inventory/resources.json'}});
 handlers.build_security_context=async(_,{state})=>{order.push('context');return {writes:{security_context:buildSecurityContext(state)}};};
 handlers.run_specialist=async(_,{item,state})=>{order.push(item.domain);assert.equal(state.security_context.version,'security-context/v1');assert.equal(state.security_context.inventory.status,'referenced');return {writes:{}};};
 handlers.evaluate=async()=>({writes:{critique:{quality:1}}});
 const result=await runGraphAsync(graph,{handlers,scope:selectedScope});
 assert.equal(result.status,'completed');assert.deepEqual(order,['context','data']);
});
