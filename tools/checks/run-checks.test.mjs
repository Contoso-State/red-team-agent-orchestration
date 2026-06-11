#!/usr/bin/env node
/**
 * run-checks.test.mjs — standalone tests for the deterministic check engine.
 * Run: node tools/checks/run-checks.test.mjs
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getPath, evalPredicate, rowToAffected, evidenceSummary,
  buildFinding, rowsForCheck, evaluateEntry, buildSummary, loadPack,
} from './run-checks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let n = 0;
function ok(cond, msg) { n++; if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

const NOW = '2026-06-11T00:00:00.000Z';

// --- getPath -------------------------------------------------------------
eq(getPath({ a: { b: 2 } }, 'a.b'), 2, 'getPath nested');
eq(getPath({ a: { b: 2 } }, 'a.x'), undefined, 'getPath miss');
eq(getPath({ a: 1 }, 'a'), 1, 'getPath root');
eq(getPath(null, 'a'), undefined, 'getPath null obj');
eq(getPath({ a: null }, 'a.b'), undefined, 'getPath through null');

// --- leaf ops ------------------------------------------------------------
const R = { x: 5, s: 'Enabled', arr: ['a', 'b'], tls: 'TLS1_0', flag: false };
ok(evalPredicate({ field: 'x', op: 'eq', value: 5 }, R), 'eq');
ok(!evalPredicate({ field: 'x', op: 'eq', value: 6 }, R), 'eq false');
ok(evalPredicate({ field: 'x', op: 'ne', value: 6 }, R), 'ne');
ok(evalPredicate({ field: 's', op: 'eqi', value: 'enabled' }, R), 'eqi');
ok(evalPredicate({ field: 's', op: 'in', value: ['Enabled', 'Disabled'] }, R), 'in');
ok(evalPredicate({ field: 's', op: 'ini', value: ['enabled'] }, R), 'ini');
ok(evalPredicate({ field: 's', op: 'nin', value: ['Disabled'] }, R), 'nin');
ok(evalPredicate({ field: 'x', op: 'gt', value: 4 }, R), 'gt');
ok(evalPredicate({ field: 'x', op: 'gte', value: 5 }, R), 'gte');
ok(evalPredicate({ field: 'x', op: 'lt', value: 6 }, R), 'lt');
ok(evalPredicate({ field: 'x', op: 'lte', value: 5 }, R), 'lte');
ok(evalPredicate({ field: 'x', op: 'exists' }, R), 'exists');
ok(evalPredicate({ field: 'missingField', op: 'missing' }, R), 'missing');
ok(!evalPredicate({ field: 'x', op: 'missing' }, R), 'missing false');
ok(evalPredicate({ field: 'arr', op: 'contains', value: 'a' }, R), 'contains array');
ok(evalPredicate({ field: 's', op: 'contains', value: 'nab' }, R), 'contains string');
ok(evalPredicate({ field: 'arr', op: 'ncontains', value: 'z' }, R), 'ncontains');
ok(evalPredicate({ field: 's', op: 'regex', value: '^Ena' }, R), 'regex');
ok(evalPredicate({ field: 'tls', op: 'version_lt', value: 'TLS1_2' }, R), 'version_lt');
ok(!evalPredicate({ field: 'tls', op: 'version_lt', value: 'TLS1_0' }, R), 'version_lt equal false');
ok(evalPredicate({ field: 'flag', op: 'eq', value: false }, R), 'eq false value');

// --- composition ---------------------------------------------------------
ok(evalPredicate({ all: [{ field: 'x', op: 'eq', value: 5 }, { field: 's', op: 'eqi', value: 'enabled' }] }, R), 'all');
ok(!evalPredicate({ all: [{ field: 'x', op: 'eq', value: 5 }, { field: 's', op: 'eq', value: 'no' }] }, R), 'all false');
ok(evalPredicate({ any: [{ field: 'x', op: 'eq', value: 0 }, { field: 'flag', op: 'eq', value: false }] }, R), 'any');
ok(evalPredicate({ not: { field: 'x', op: 'eq', value: 0 } }, R), 'not');
let threw = false; try { evalPredicate({ bogus: 1 }, R); } catch { threw = true; } ok(threw, 'invalid predicate throws');
threw = false; try { evalPredicate({ field: 'x', op: 'nope', value: 1 }, R); } catch { threw = true; } ok(threw, 'unknown op throws');

// --- rowToAffected / evidence --------------------------------------------
eq(rowToAffected({ id: '/r/1', subscriptionId: 'sub', resourceGroup: 'rg', location: 'eastus', name: 'n', type: 't' }),
  { resource_id: '/r/1', subscription_id: 'sub', resource_group: 'rg', type: 't', region: 'eastus', name: 'n' }, 'rowToAffected maps ARG row');
eq(rowToAffected({ resource_id: '/r/2' }), { resource_id: '/r/2' }, 'rowToAffected minimal');
const sampleEntry = { evidence_fields: ['allowBlobPublicAccess', 'nested.v'] };
eq(evidenceSummary(sampleEntry, { allowBlobPublicAccess: true, nested: { v: 'x' } }), 'allowBlobPublicAccess=true; v="x"', 'evidenceSummary');
eq(evidenceSummary({ evidence_fields: ['none'] }, {}), 'predicate matched', 'evidenceSummary empty fallback');

// --- rowsForCheck --------------------------------------------------------
eq(rowsForCheck([{ a: 1 }], 'X'), [{ a: 1 }], 'rowsForCheck bare array');
eq(rowsForCheck({ X: [{ a: 1 }] }, 'X'), [{ a: 1 }], 'rowsForCheck keyed');
eq(rowsForCheck({ X: { rows: [{ a: 1 }] } }, 'X'), [{ a: 1 }], 'rowsForCheck keyed.rows');
eq(rowsForCheck({ X: [] }, 'Y'), undefined, 'rowsForCheck missing → undefined');

// --- evaluateEntry aggregation -------------------------------------------
const pack = loadPack(readFileSync(join(HERE, 'sample', 'predicates.sample.json'), 'utf8'));
const rows = JSON.parse(readFileSync(join(HERE, 'sample', 'rows.sample.json'), 'utf8'));
const blob = pack.predicates.find((p) => p.check_id === 'CHK-STOR-PUBLIC-BLOB');
const seq = {};
const blobRes = evaluateEntry(blob, rows, seq, NOW);
ok(blobRes.ran, 'blob ran');
eq(blobRes.scanned, 4, 'blob scanned 4');
eq(blobRes.matched, 3, 'blob matched 3 (3 true, 1 false)');
eq(blobRes.findings.length, 2, 'blob aggregated to 2 findings (sub-a, sub-b)');
const subA = blobRes.findings.find((f) => f.subscription_id === 'sub-a');
eq(subA.affected_resources.length, 2, 'sub-a finding has 2 affected');
eq(subA.dedupe_key, 'storage-public-blob:sub-a', 'dedupe_key');
eq(subA.finding_class, 'storage-public-blob', 'finding_class');
ok(/^AZ-STOR-\d{3}$/.test(subA.id), 'finding id format');
eq(subA.severity, 'High', 'severity from default');
eq(subA.confidence, 'High', 'confidence default High');
eq(subA.status, 'open', 'status open');
ok(subA.evidence.length >= 1, 'evidence present');
eq(subA.controls.cis_azure, ['3.7'], 'controls carried');

// public-network: only the Allow row matches
const net = pack.predicates.find((p) => p.check_id === 'CHK-STOR-PUBLIC-NETWORK');
const netRes = evaluateEntry(net, rows, {}, NOW);
eq(netRes.matched, 1, 'network matched 1 (Allow only)');
eq(netRes.findings.length, 1, 'network 1 finding');

// https-only: httpsOnly=false OR minTls<1.2 → 2 of 3 match
const https = pack.predicates.find((p) => p.check_id === 'CHK-STOR-NO-HTTPS-ONLY');
const httpsRes = evaluateEntry(https, rows, {}, NOW);
eq(httpsRes.matched, 2, 'https matched 2 (false + TLS1_0)');

// anon-container: ini blob/container → 1 of 2
const anon = pack.predicates.find((p) => p.check_id === 'CHK-STOR-ANON-CONTAINER');
const anonRes = evaluateEntry(anon, rows, {}, NOW);
eq(anonRes.matched, 1, 'anon matched 1 (Container)');
eq(anonRes.findings[0].severity, 'Critical', 'anon critical');

// not-run when rows absent
const noRows = evaluateEntry(blob, {}, {}, NOW);
ok(!noRows.ran, 'no rows → not run');

// --- buildSummary --------------------------------------------------------
const allResults = pack.predicates.map((e) => ({ entry: e, ...evaluateEntry(e, rows, {}, NOW) }));
const summary = buildSummary(allResults, NOW);
eq(summary.schema, 'check-summary/v1', 'summary schema');
eq(summary.checks_evaluated, 4, 'summary checks_evaluated');
eq(summary.checks_not_run.length, 0, 'summary none skipped');
ok(summary.total_findings >= 4, 'summary total findings');
ok(summary.checks[0].findings[0].evidence_sample.length > 0, 'summary carries evidence sample');

// buildFinding seq increments id
const f1 = buildFinding(blob, 'sub-a', [rows['CHK-STOR-PUBLIC-BLOB'][0]], 1, NOW);
const f2 = buildFinding(blob, 'sub-b', [rows['CHK-STOR-PUBLIC-BLOB'][2]], 2, NOW);
eq(f1.id, 'AZ-STOR-001', 'seq 1 id');
eq(f2.id, 'AZ-STOR-002', 'seq 2 id');

// required finding fields present (schema sanity, not full validation)
for (const key of ['id', 'title', 'severity', 'confidence', 'agent', 'category', 'resource_id', 'subscription_id', 'description', 'attack_vector', 'recommendation', 'evidence', 'status', 'first_seen']) {
  ok(f1[key] !== undefined, `finding has required field ${key}`);
}

console.log(`OK — ${n} assertions passed`);
