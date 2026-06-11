#!/usr/bin/env node
/**
 * ledger.test.mjs — standalone tests for the token ledger.
 * Run: node tools/tokens/ledger.test.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  estimateTokens, component, componentFromText, buildLedger,
  parseMeasured, collectComponents, DEFAULT_RATIO,
} from './ledger.mjs';

let n = 0;
function ok(cond, msg) { n++; if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// --- estimateTokens ------------------------------------------------------
eq(estimateTokens('', 4), 0, 'empty → 0');
eq(estimateTokens('abcd', 4), 1, '4 bytes / 4 = 1');
eq(estimateTokens('abcde', 4), 2, '5 bytes / 4 → ceil 2');
eq(estimateTokens('aaaaaaaa', 4), 2, '8/4 = 2');
eq(estimateTokens({ a: 1 }, 4), estimateTokens('{"a":1}', 4), 'object stringified');
eq(estimateTokens(null), 0, 'null → 0');
ok(estimateTokens('x'.repeat(40)) === 10, 'default ratio 4');
// multibyte counts bytes not chars
ok(estimateTokens('€€€€', 4) === 3, 'utf8 byte count (3 bytes each → 12/4=3)');

// --- component validation ------------------------------------------------
let threw = false; try { component('x', { direction: 'sideways', tokens: 1 }); } catch { threw = true; }
ok(threw, 'invalid direction throws');
const c1 = component('sp', { phase: 'dispatch', agent: 'a', direction: 'input', tokens: 10 });
eq(c1.method, 'estimated', 'default method estimated');
eq(c1.agent, 'a', 'agent set');
const c0 = component('x', { direction: 'output' });
eq(c0.tokens, 0, 'missing tokens → 0');
eq(c0.agent, '(shared)', 'default agent');
eq(c0.phase, 'unattributed', 'default phase');

// --- componentFromText ---------------------------------------------------
const ct = componentFromText('doc', { phase: 'p', agent: 'a', direction: 'input', text: 'abcd' }, 4);
eq(ct.tokens, 1, 'fromText tokens');
eq(ct.bytes, 4, 'fromText bytes');

// --- buildLedger rollups -------------------------------------------------
const comps = [
  component('a', { phase: 'dispatch', agent: 'id', direction: 'input', tokens: 100 }),
  component('b', { phase: 'triage', agent: 'id', direction: 'input', tokens: 20 }),
  component('c', { phase: 'analysis', agent: 'id', direction: 'output', tokens: 50 }),
  component('d', { phase: 'analysis', agent: 'net', direction: 'output', tokens: 30 }),
];
const led = buildLedger(comps, { ratio: 4, now: '2026-01-01T00:00:00Z' });
eq(led.schema, 'token-usage/v1', 'schema');
eq(led.method, 'estimated', 'all-estimated method');
eq(led.totals.input_tokens, 120, 'total input');
eq(led.totals.output_tokens, 80, 'total output');
eq(led.totals.total_tokens, 200, 'grand total');
// per_agent sorted by total desc; id=170, net=30
eq(led.per_agent[0].agent, 'id', 'top agent id');
eq(led.per_agent[0].total_tokens, 170, 'id total');
eq(led.per_agent[1].agent, 'net', 'second agent net');
const analysis = led.per_phase.find((p) => p.phase === 'analysis');
eq(analysis.output_tokens, 80, 'analysis phase output');
ok(led.notes.length >= 1, 'has notes');

// --- method derivation ---------------------------------------------------
const measuredOnly = buildLedger([component('m', { direction: 'input', tokens: 5, method: 'measured' })]);
eq(measuredOnly.method, 'measured', 'measured-only method');
const mixed = buildLedger([
  component('m', { direction: 'input', tokens: 5, method: 'measured' }),
  component('e', { direction: 'output', tokens: 5, method: 'estimated' }),
]);
eq(mixed.method, 'hybrid', 'mixed → hybrid');
const overridden = buildLedger([component('e', { direction: 'input', tokens: 5 })], { method: 'measured' });
eq(overridden.method, 'measured', 'explicit method override');

// --- parseMeasured -------------------------------------------------------
const m = parseMeasured('{"phase":"analysis","agent":"id","input_tokens":10,"output_tokens":4}\n\n{"phase":"reporting","output_tokens":7}\nnot json\n');
eq(m.length, 3, 'parsed measured components (2 + 1)');
ok(m.every((x) => x.method === 'measured'), 'all measured');
const inComp = m.find((x) => x.direction === 'input');
eq(inComp.tokens, 10, 'measured input tokens');

// --- collectComponents (temp session) ------------------------------------
const root = mkdtempSync(join(tmpdir(), 'ledger-'));
try {
  // fake repo agent prompt
  mkdirSync(join(root, 'repo', 'agents', 'data-protection'), { recursive: true });
  writeFileSync(join(root, 'repo', 'agents', 'data-protection', 'system-prompt.md'), 'x'.repeat(400)); // 100 tok @4
  // session findings
  const sess = join(root, 'sess');
  mkdirSync(join(sess, 'findings', 'summary'), { recursive: true });
  mkdirSync(join(sess, 'findings', 'raw'), { recursive: true });
  writeFileSync(join(sess, 'findings', 'summary', 'data-protection.json'), 'y'.repeat(80)); // 20 tok @4
  writeFileSync(join(sess, 'findings', 'data-protection.json'), JSON.stringify([{ agent: 'data-protection', id: 'AZ-STOR-001' }])); // output
  writeFileSync(join(sess, 'findings', 'raw', 'data-protection.engine.jsonl'), 'z'.repeat(4000)); // excluded

  const { components, notes } = collectComponents({ sessionDir: sess, repoRoot: join(root, 'repo'), ratio: 4 });
  const sp = components.find((c) => c.label === 'system-prompt:data-protection');
  ok(sp && sp.tokens === 100 && sp.direction === 'input', 'collected system prompt as input ~100 tok');
  const tri = components.find((c) => c.label === 'triage-summary:data-protection');
  ok(tri && tri.tokens === 20 && tri.direction === 'input', 'collected triage summary as input');
  const outc = components.find((c) => c.direction === 'output');
  ok(outc && outc.label.startsWith('findings:'), 'collected findings as output');
  ok(notes.some((nn) => /Excluded/.test(nn)), 'note about excluded engine output');
  // engine jsonl must NOT appear as a component
  ok(!components.some((c) => c.label.includes('engine.jsonl')), 'engine jsonl excluded from components');

  // agents inferred from summaries when not passed
  const inferred = collectComponents({ sessionDir: sess, repoRoot: join(root, 'repo'), ratio: 4 });
  ok(inferred.components.some((c) => c.agent === 'data-protection'), 'inferred agent from summary filename');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`OK — ${n} assertions passed`);
