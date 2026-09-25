import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync, statSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {createLiveHandlers} from './live-handlers.mjs';
import {runGraphAsync} from './async-runner.mjs';

test('default canonical graph loads installed AEF memory and persists evidence-gated debriefs without opt-in', async t => {
  const previous = process.env.REDTEAM_SELF_IMPROVE;
  delete process.env.REDTEAM_SELF_IMPROVE;
  t.after(() => {
    if (previous === undefined) delete process.env.REDTEAM_SELF_IMPROVE;
    else process.env.REDTEAM_SELF_IMPROVE = previous;
  });
  const root = resolve('.');
  const sessionDir = mkdtempSync(join(root, 'engagements/qa-default-learning-'));
  t.after(() => rmSync(sessionDir, {recursive:true, force:true}));
  const scope = {tenantId:randomUUID(), subscriptionId:randomUUID(), mode:'read-only-assessment'};
  const graph = JSON.parse(readFileSync(join(root, 'graph/redteam.graph.json'), 'utf8'));
  const source = JSON.parse(readFileSync(join(root, 'tools/aef/source-lock.json'), 'utf8')).commit;
  // Offline fixture: only memory hooks and graph control flow are real. No Azure or model calls.
  const finding = {id:'QA-LOG-001', agent:'logging-coverage', check_id:'CHK-QA-LOG', finding_class:'fixture-only'};
  mkdirSync(join(sessionDir, 'findings/raw'), {recursive:true});
  writeFileSync(join(sessionDir, 'findings/raw/logging.jsonl'), JSON.stringify(finding) + '\n');
  writeFileSync(join(sessionDir, 'findings/judged.jsonl'), JSON.stringify(finding) + '\n');
  async function run(runId, learning = true) {
    const events = [];
    const handlers = createLiveHandlers({root, sessionDir, scope, runId, emit:e => events.push(e),
      preflight:async () => { throw Error('Unexpected real preflight'); },
      model:async () => { throw Error('Unexpected model call'); }});
    const observed = [];
    for (const node of graph.nodes) {
      if (!['validate_scope', 'memory_load', 'reflexion_debrief'].includes(node.id)) {
        handlers[node.id] = async (_, {state}) => {
          assert.equal(state.memory.engine, learning ? 'aef-core' : null);
          assert.equal(state.memory.sourceCommit, learning ? source : null);
          if (!learning) assert.equal(state.memory.disabled, true);
          observed.push(node.id);
          if (node.id === 'evaluate') return {writes:{critique:{quality:1}}};
          if (node.id === 'judge') return {writes:{confirmed_findings:[finding]}};
          return {writes:{}};
        };
      }
    }
    const result = await runGraphAsync(graph, {handlers, scope, emit:e => events.push(e)});
    assert.equal(result.status, 'completed');
    assert.ok(result.path.indexOf('memory_load') < result.path.indexOf('preflight_inventory'));
    assert.ok(result.path.indexOf('reflexion_debrief') > result.path.indexOf('judge'));
    assert.ok(observed.includes('run_specialist'));
    assert.equal(events.some(e => e.type === 'node.completed' && e.node_id === 'aef_retrieve'), learning);
    assert.equal(result.state.memory.improvementVerified, false);
    return {result, events};
  }
  const first = await run('first');
  assert.equal(first.events.filter(e => e.type === 'memory.promoted').length, 0);
  assert.ok(existsSync(join(sessionDir, 'memory/methodology/first.json')));
  const second = await run('second');
  assert.equal(second.result.state.memory.agents['logging-coverage'].records.length, 1);
  assert.equal(second.events.filter(e => e.type === 'memory.promoted').length, 1);
  const third = await run('third');
  const learned = third.result.state.memory.agents['logging-coverage'];
  assert.equal(learned.records.length, 2);
  assert.equal(learned.knowledge.length, 1);
  assert.ok(learned.context.length > 0);
  assert.equal(learned.knowledge[0].improvementVerified, false);

  // Explicit operator opt-out remains effective, while graph execution still runs.
  const memoryDir = join(sessionDir, 'memory');
  const memorySnapshot = () => readdirSync(memoryDir, {recursive:true}).sort().map(name => {
    const path = join(memoryDir, name);
    return [name, statSync(path).isFile() ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'directory'];
  });
  const before = memorySnapshot();
  process.env.REDTEAM_SELF_IMPROVE = 'off';
  const disabled = await run('disabled', false);
  for (const value of Object.values(disabled.result.state.memory.agents)) {
    assert.deepEqual(value.records, []);
    assert.deepEqual(value.knowledge, []);
    assert.deepEqual(value.context, []);
  }
  assert.equal(disabled.events.some(e => e.type.startsWith('memory.') || e.node_id?.startsWith('aef_')), false);
  assert.equal(existsSync(join(sessionDir, 'memory/methodology/disabled.json')), false);
  assert.deepEqual(memorySnapshot(), before, 'Opt-out must neither create nor modify AEF reports, checkpoints, or methodology records');
});
