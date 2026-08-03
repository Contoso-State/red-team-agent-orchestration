import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ROOT, loadGraph } from './run-graph.mjs';
import {
  assertMethodologyNamespace,
  assertWritablePath,
  makeProceduralStore,
  makeAuditLog,
  selfImprovementEnabled,
  scoreFindings,
  tuneParams,
  PARAM_BOUNDS,
  judgeFindings,
  loadFpSuppressions,
  reflexionDebrief,
  applyLearnedParams,
  makeSelfImprovementHandlers,
  runSelfImprovingGraph,
} from './self-improve.mjs';

const { graph } = loadGraph(join(ROOT, 'graph', 'redteam.graph.json'));

// --- the immutable boundary: firewalls ---

test('namespace firewall: only methodology is writable', () => {
  for (const ns of ['guardrails', 'allowlist', 'egress', 'readonly', 'guard']) {
    assert.throws(() => assertMethodologyNamespace(ns), /FIREWALL/);
  }
  assert.throws(() => assertMethodologyNamespace('findings'), /FIREWALL/);
  assert.equal(assertMethodologyNamespace('methodology'), 'methodology');
  assert.equal(assertMethodologyNamespace('methodology/fp'), 'methodology/fp');
});

test('path firewall: refuses guardrails/ and escapes, allows memory/methodology', () => {
  assert.throws(() => assertWritablePath('guardrails/guard.mjs'), /FIREWALL/);
  assert.throws(() => assertWritablePath('../evil.txt'), /FIREWALL/);
  const ok = assertWritablePath('memory/methodology/store.log.jsonl');
  assert.match(ok.replaceAll('\\', '/'), /memory\/methodology\/store\.log\.jsonl$/);
});

// --- procedural store ---

test('procedural store appends, loads, and rolls back', () => {
  const store = makeProceduralStore();
  store.write('methodology', { kind: 'a', v: 1 });
  store.write('methodology', { kind: 'b', v: 2 });
  assert.equal(store.load('methodology').entries.length, 2);
  assert.equal(store.rollbackLast(), true);
  assert.equal(store.load('methodology').entries.length, 1);
  assert.equal(store.load('methodology').entries[0].kind, 'a');
});

test('procedural store refuses guardrail namespaces', () => {
  const store = makeProceduralStore();
  assert.throws(() => store.write('guardrails', { x: 1 }), /FIREWALL/);
});

// --- evaluator-optimizer ---

test('scoreFindings rewards evidence + known severity', () => {
  assert.equal(scoreFindings([]).quality, 0);
  const strong = scoreFindings([
    { severity: 'high', affected_resources: [{ resource_id: 'r1' }] },
    { severity: 'medium', affected_resources: [{ resource_id: 'r2' }] },
  ]);
  assert.equal(strong.quality, 1);
  const weak = scoreFindings([{ severity: 'unknown' }, { severity: 'unknown' }]);
  assert.ok(weak.quality < strong.quality);
});

test('tuneParams stays within bounds and reacts to low evidence', () => {
  const tuned = tuneParams({ max_revisions: 2, quality_threshold: 0.85 }, { evidenceRatio: 0.3 });
  assert.equal(tuned.max_revisions, 3); // +1 for low evidence
  assert.ok(tuned.max_revisions <= PARAM_BOUNDS.max_revisions.max);
  const capped = tuneParams({ max_revisions: 99, quality_threshold: 9 }, { evidenceRatio: 1 });
  assert.equal(capped.max_revisions, PARAM_BOUNDS.max_revisions.max);
  assert.ok(capped.quality_threshold <= PARAM_BOUNDS.quality_threshold.max);
});

test('tuneParams eases the threshold after a weak history', () => {
  const store = makeProceduralStore();
  for (const q of [0.5, 0.4, 0.5]) store.write('methodology', { kind: 'param_tuning', quality: q, params: {} });
  const tuned = tuneParams({ max_revisions: 2, quality_threshold: 0.85 }, { evidenceRatio: 1 }, store);
  assert.ok(tuned.quality_threshold < 0.85);
  assert.ok(tuned.quality_threshold >= PARAM_BOUNDS.quality_threshold.min);
});

// --- Agent-as-a-Judge FP gate ---

test('judge suppresses explicit FPs and persists the signature', () => {
  const store = makeProceduralStore();
  const candidates = [
    { dedupe_key: 'real', severity: 'high' },
    { dedupe_key: 'noise', severity: 'low', false_positive: true },
  ];
  const { confirmed, newlySuppressed } = judgeFindings(candidates, { store });
  assert.equal(confirmed.length, 1);
  assert.equal(confirmed[0].dedupe_key, 'real');
  assert.deepEqual(newlySuppressed, ['noise']);
  assert.ok(loadFpSuppressions(store).has('noise'));
});

test('a suppressed signature stays suppressed on the next run (cross-run learning)', () => {
  const store = makeProceduralStore();
  judgeFindings([{ dedupe_key: 'noise', false_positive: true }], { store });
  // next engagement: the same finding arrives WITHOUT the explicit marker but is still dropped
  const second = judgeFindings([{ dedupe_key: 'noise', severity: 'low' }, { dedupe_key: 'new', severity: 'high' }], { store });
  assert.deepEqual(second.confirmed.map((f) => f.dedupe_key), ['new']);
  assert.equal(second.newlySuppressed.length, 0);
});

// --- reflexion ---

test('reflexion debrief writes a methodology entry and audits', () => {
  const store = makeProceduralStore();
  const audit = makeAuditLog();
  const entry = reflexionDebrief({ confirmed_findings: [{ dedupe_key: 'x', severity: 'high' }], revision: 1 }, { store, audit });
  assert.equal(entry.kind, 'reflexion_debrief');
  assert.equal(entry.confirmed, 1);
  assert.deepEqual(entry.severities, { high: 1 });
  assert.equal(store.load('methodology').entries.at(-1).kind, 'reflexion_debrief');
  assert.ok(audit.entries().some((e) => e.action === 'reflexion.debrief'));
});

// --- kill switch ---

test('kill switch parses env values', () => {
  assert.equal(selfImprovementEnabled({ REDTEAM_SELF_IMPROVE: 'off' }), false);
  assert.equal(selfImprovementEnabled({ REDTEAM_SELF_IMPROVE: '0' }), false);
  assert.equal(selfImprovementEnabled({ REDTEAM_SELF_IMPROVE: 'false' }), false);
  assert.equal(selfImprovementEnabled({}), true);
  assert.equal(selfImprovementEnabled({ REDTEAM_SELF_IMPROVE: 'on' }), true);
});

test('disabled learning makes handlers static (no methodology writes)', () => {
  const store = makeProceduralStore();
  const { handlers, enabled } = makeSelfImprovementHandlers({ store, env: { REDTEAM_SELF_IMPROVE: 'off' } });
  assert.equal(enabled, false);
  const ctx = { state: { candidate_findings: [{ dedupe_key: 'x', false_positive: true }], revision: 0 }, params: graph.params };
  const judged = handlers.judge({}, ctx);
  assert.equal(judged.writes.confirmed_findings.length, 1); // FP NOT suppressed when disabled
  handlers.evaluate({}, ctx);
  handlers.reflexion_debrief({}, ctx);
  assert.equal(store.load('methodology').entries.length, 0);
});

// --- learned params ---

test('applyLearnedParams merges the latest persisted tuning', () => {
  const store = makeProceduralStore();
  store.write('methodology', { kind: 'param_tuning', params: { max_revisions: 1, quality_threshold: 0.7 } });
  store.write('methodology', { kind: 'param_tuning', params: { max_revisions: 3, quality_threshold: 0.9 } });
  const params = applyLearnedParams({ max_revisions: 2, quality_threshold: 0.85 }, store);
  assert.equal(params.max_revisions, 3);
  assert.equal(params.quality_threshold, 0.9);
});

// --- end-to-end self-improving run ---

test('runSelfImprovingGraph completes, gates FPs, and records an audit trail', () => {
  const dispatchFn = (node, ctx) => {
    if (node.writes !== 'raw_findings' || !ctx.item) return {};
    const base = { dedupe_key: `f:${ctx.item.domain}`, severity: 'high', affected_resources: [{ resource_id: `${ctx.item.domain}-1` }] };
    // one specialist also emits a noisy false positive
    const extra = ctx.item.domain === 'identity' ? [{ dedupe_key: 'noise', severity: 'low', false_positive: true }] : [];
    return { writes: { raw_findings: [base, ...extra] } };
  };
  const res = runSelfImprovingGraph(graph, {
    scope: { mode: 'read-only-assessment', m365_in_scope: false },
    dispatchFn,
  });
  assert.equal(res.status, 'completed');
  // the FP was gated out of confirmed
  assert.ok(!res.state.confirmed_findings.some((f) => f.dedupe_key === 'noise'));
  assert.ok(res.state.confirmed_findings.length >= 11);
  // methodology memory learned: a suppression, a param tuning, and a reflexion entry
  const kinds = res.store.load('methodology').entries.map((e) => e.kind);
  assert.ok(kinds.includes('fp_suppression'));
  assert.ok(kinds.includes('param_tuning'));
  assert.ok(kinds.includes('reflexion_debrief'));
  const actions = res.audit.entries().map((e) => e.action);
  assert.ok(['evaluate.score', 'judge.gate', 'reflexion.debrief'].every((a) => actions.includes(a)));
});

test('learning persists across two runs on a shared store', () => {
  const store = makeProceduralStore();
  const audit = makeAuditLog();
  const dispatchFn = (node, ctx) =>
    node.writes === 'raw_findings' && ctx.item
      ? { writes: { raw_findings: [{ dedupe_key: 'noise', severity: 'low', false_positive: ctx.item.domain === 'identity' }] } }
      : {};
  runSelfImprovingGraph(graph, { store, audit, scope: { mode: 'read-only-assessment' }, dispatchFn });
  const afterFirst = store.load('methodology').entries.filter((e) => e.kind === 'fp_suppression').length;
  assert.equal(afterFirst, 1);
  // second run: the same signature is already known, so no new suppression is written
  runSelfImprovingGraph(graph, { store, audit, scope: { mode: 'read-only-assessment' }, dispatchFn });
  const afterSecond = store.load('methodology').entries.filter((e) => e.kind === 'fp_suppression').length;
  assert.equal(afterSecond, 1);
});
