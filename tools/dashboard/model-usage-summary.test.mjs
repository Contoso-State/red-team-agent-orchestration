import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeModelUsage } from './public/model-usage-summary.mjs';

const request = (exchange_id, run_id = 'run-1') => ({type:'message.sent',transfer:{kind:'model-request'},exchange_id,run_id});
const usage = (exchange_id, values, extra = {}) => ({type:'model.usage',exchange_id,run_id:'run-1',usage:values,...extra});

test('partial usage accounts for failed invocations and exposes field coverage without inventing zero', () => {
  const summary=summarizeModelUsage([
    request('a'),request('b'),request('c'),
    usage('a',{input_tokens:20,output_tokens:5,cost_usd:0.002}),
    usage('b',{input_tokens:10,output_tokens:0,cost_usd:0},{status:'failed'}),
  ]);
  assert.equal(summary.invocations,3);
  assert.equal(summary.usageRecords,2);
  assert.equal(summary.usableRecords,2);
  assert.deepEqual(summary.fields.input_tokens,{value:30,reported:2});
  assert.deepEqual(summary.fields.output_tokens,{value:5,reported:2});
  assert.deepEqual(summary.fields.cost_usd,{value:0.002,reported:2});
  assert.deepEqual(summary.fields.cache_read_input_tokens,{value:null,reported:0});
});

test('duplicate delivery never double counts and exchange identities are scoped to a run', () => {
  const row=usage('same',{input_tokens:8,cost_usd:0.01});
  const summary=summarizeModelUsage([request('same'),request('same'),row,row,{...row,run_id:'run-2'}]);
  assert.equal(summary.invocations,2);
  assert.equal(summary.usageRecords,2);
  assert.deepEqual(summary.fields.input_tokens,{value:16,reported:2});
});

test('conflicting duplicates and uncorrelated records are visible and excluded from totals', () => {
  const summary=summarizeModelUsage([request('a'),usage('a',{input_tokens:2}),usage('a',{input_tokens:3}),usage(null,{input_tokens:999})]);
  assert.equal(summary.invocations,1);
  assert.equal(summary.conflicts,1);
  assert.equal(summary.uncorrelated,1);
  assert.equal(summary.usageRecords,0);
  assert.deepEqual(summary.fields.input_tokens,{value:null,reported:0});
});

test('legacy, empty and malformed usage stays unavailable', () => {
  for(const events of [[],[request('legacy')],[usage('invalid',{input_tokens:-1,output_tokens:0.5,cost_usd:'0.02',cache_read_input_tokens:Infinity})]]){
    const summary=summarizeModelUsage(events);
    for(const metric of Object.values(summary.fields))assert.deepEqual(metric,{value:null,reported:0});
  }
});

test('an emitted record with unavailable values does not count as usable coverage', () => {
  const summary=summarizeModelUsage([request('empty'),usage('empty',{}, {status:'failed'})]);
  assert.equal(summary.invocations,1);
  assert.equal(summary.usageRecords,1);
  assert.equal(summary.usableRecords,0);
});
