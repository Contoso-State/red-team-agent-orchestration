import test from 'node:test';
import assert from 'node:assert/strict';
import { traceExchange } from './trace-exchange.mjs';

test('handoff return waits for execution and records correlated sizes without content', async () => {
  const events = [];
  let finish;
  const execution = new Promise(resolve => { finish = resolve; });
  const result = traceExchange({agent:'test-agent',taskId:'test-task',payload:{text:'PRIVATE_INPUT'},emit:e=>events.push(e),execute:()=>execution});
  assert.equal(events.length,1);
  assert.equal(events[0].transfer.outcome,'sent');
  finish({text:'PRIVATE_OUTPUT'});
  assert.deepEqual(await result,{text:'PRIVATE_OUTPUT'});
  assert.equal(events.length,3);
  assert.equal(events[0].exchange_id,events[1].exchange_id);
  assert.equal(events[1].from_agent,'test-agent');
  assert.equal(events[1].to_agent,'orchestrator');
  assert.equal(events[1].transfer.bytes,Buffer.byteLength(JSON.stringify({text:'PRIVATE_OUTPUT'})));
  assert.equal(events[2].type,'model.usage');
  assert.equal(events[2].status,'completed');
  assert.equal(events[2].usage.input_tokens,null);
  assert.equal(events[2].usage.cost_usd,null);
  assert.doesNotMatch(JSON.stringify(events),/PRIVATE_INPUT|PRIVATE_OUTPUT/);
});

test('failed execution emits failure without success or raw error disclosure', async () => {
  const events=[];
  await assert.rejects(traceExchange({agent:'test-agent',taskId:'test-task',payload:{},emit:e=>events.push(e),execute:async()=>{throw Error('PRIVATE_ERROR');}}),/PRIVATE_ERROR/);
  assert.equal(events[1].transfer.outcome,'failed');
  assert.equal(events[1].status,'failed');
  assert.equal(events[1].transfer.bytes,0);
  assert.equal(events[2].type,'model.usage');
  assert.equal(events[2].status,'failed');
  assert.equal(events[2].usage.input_tokens,null);
  assert.doesNotMatch(JSON.stringify(events),/PRIVATE_ERROR|received/);
});

test('usage callback is correlated, normalized and recorded exactly once per exchange', async () => {
  const events=[];let callback;
  await traceExchange({agent:'test-agent',taskId:'test-task',payload:{},emit:e=>events.push(e),execute:async({onUsage})=>{
    callback=onUsage;
    onUsage({input_tokens:10,output_tokens:3,cost_usd:0.01,models:['claude-model'],private:'PRIVATE_METADATA'});
    onUsage({input_tokens:10,output_tokens:3,cost_usd:0.01,models:['claude-model']});
    return {done:true};
  }});
  callback({input_tokens:1000}); // Late snapshots cannot alter a finalized exchange.
  const [usage]=events.filter(e=>e.type==='model.usage');
  assert.equal(events.filter(e=>e.type==='model.usage').length,1);
  assert.equal(usage.usage.input_tokens,10);assert.equal(usage.usage.cost_usd,0.01);
  for(const event of events){assert.equal(event.exchange_id,usage.exchange_id);assert.equal(event.agent_id,'test-agent');assert.equal(event.task_id,'test-task');}
  assert.doesNotMatch(JSON.stringify(events),/PRIVATE_METADATA/);
});

test('failed exchanges retain reported usage and emit one terminal failure', async () => {
  const events=[];
  await assert.rejects(traceExchange({agent:'test-agent',taskId:'test-task',payload:{},emit:e=>events.push(e),execute:async({onUsage})=>{
    onUsage({input_tokens:10,output_tokens:3,cost_usd:0.01});throw Error('PRIVATE_FAILURE');
  }}),/PRIVATE_FAILURE/);
  const usage=events.filter(e=>e.type==='model.usage');
  assert.equal(usage.length,1);assert.equal(usage[0].status,'failed');assert.equal(usage[0].usage.input_tokens,10);
  assert.doesNotMatch(JSON.stringify(events),/PRIVATE_FAILURE/);
});

test('concurrent exchanges retain separate usage and correlation IDs', async () => {
  const events=[];
  await Promise.all([10,20].map(input_tokens=>traceExchange({agent:'test-agent',taskId:'shared-task',payload:{},emit:e=>events.push(e),execute:async({onUsage})=>{
    onUsage({input_tokens});return {};
  }})));
  const usage=events.filter(e=>e.type==='model.usage');
  assert.equal(usage.length,2);assert.equal(new Set(usage.map(e=>e.exchange_id)).size,2);
  assert.deepEqual(usage.map(e=>e.usage.input_tokens).sort((a,b)=>a-b),[10,20]);
});
