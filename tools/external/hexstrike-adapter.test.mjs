#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildRequest, normalizeResult, ADAPTER_SCHEMA, CAPABILITY } from './hexstrike-adapter.mjs';

const resourceId = '/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-test/providers/Microsoft.Web/sites/site-a';
const allowlist = {
  schema: 'external-targets/v1',
  engagement_id: 'offline-test',
  allowlist: { hosts: ['site-a.example.test'], ips: [] },
  targets: [{
    host: 'site-a.example.test',
    sources: [{ resource_id: resourceId, type: 'Microsoft.Web/sites', discovery: 'site.defaultHostName' }],
  }],
};
allowlist.content_hash = `sha256:${createHash('sha256').update(JSON.stringify(allowlist.allowlist)).digest('hex')}`;

const finding = {
  id: 'AZ-EVA-001',
  title: 'Missing security header',
  severity: 'Low',
  confidence: 'High',
  agent: 'external-vuln',
  category: 'Web',
  check_id: 'CHK-EVA-001',
  resource_id: resourceId,
  subscription_id: '00000000-0000-0000-0000-000000000001',
  description: 'Response omitted X-Content-Type-Options.',
  attack_vector: 'A remote client can inspect the response.',
  recommendation: 'Configure the response header.',
  evidence: [{ source: 'mock', summary: 'Header missing.' }],
  status: 'open',
  first_seen: '2026-09-25T00:00:00.000Z',
};

const request = buildRequest(allowlist);
assert.equal(request.schema, ADAPTER_SCHEMA);
assert.equal(request.capability, CAPABILITY);
assert.deepEqual(request.targets[0].source_resource_ids, [resourceId]);
assert.throws(() => buildRequest(allowlist, ['evil.example.test']), /not derived from this allowlist/);
assert.throws(() => buildRequest({ ...allowlist, content_hash: 'sha256:bad' }), /content hash/);
assert.throws(() => buildRequest(allowlist, ['site-a.example.test', 'site-a.example.test']), /duplicate/);

const emptySuccess = normalizeResult(request, {
  schema: ADAPTER_SCHEMA,
  capability: CAPABILITY,
  status: 'completed',
  tool: { name: 'hexstrike-ai', version: 'offline-fixture' },
  targets: [{ host: 'site-a.example.test', status: 'completed' }],
  findings: [],
});
assert.equal(emptySuccess.status, 'completed');
assert.deepEqual(emptySuccess.findings, []);

const normalized = normalizeResult(request, {
  schema: ADAPTER_SCHEMA,
  capability: CAPABILITY,
  status: 'completed',
  tool: { name: 'hexstrike-ai', version: 'offline-fixture' },
  targets: [{ host: 'site-a.example.test', status: 'completed' }],
  findings: [{ target_host: 'site-a.example.test', finding: {
    ...finding,
    evidence: [{ source: 'mock', summary: 'Authorization: Bearer secret-canary omitted a header.' }],
  } }],
});
assert.match(normalized.findings[0].evidence[0].summary, /Authorization: \[REDACTED\]/);
assert.doesNotMatch(normalized.findings[0].evidence[0].summary, /secret-canary/);
assert.ok(normalized.findings[0].evidence.some((e) => e.source.includes('HexStrike')));

assert.throws(() => normalizeResult(request, {
  schema: ADAPTER_SCHEMA, capability: CAPABILITY, status: 'completed',
  tool: { name: 'hexstrike-ai', version: 'offline-fixture' },
  targets: [{ host: 'evil.example.test', status: 'completed' }], findings: [],
}), /was not requested/);
assert.throws(() => normalizeResult({ ...request, command: 'arbitrary command' }, {
  schema: ADAPTER_SCHEMA, capability: CAPABILITY, status: 'completed',
  tool: { name: 'hexstrike-ai', version: 'offline-fixture' },
  targets: [{ host: 'site-a.example.test', status: 'completed' }], findings: [],
}), /unsupported field/);
assert.throws(() => normalizeResult(request, {
  schema: ADAPTER_SCHEMA, capability: CAPABILITY, status: 'partial',
  tool: { name: 'hexstrike-ai', version: 'offline-fixture' },
  targets: [{ host: 'site-a.example.test', status: 'failed' }], findings: [], reason: 'timeout',
}), /must include a reason/);
const partialResult = normalizeResult(request, {
  schema: ADAPTER_SCHEMA, capability: CAPABILITY, status: 'partial',
  tool: { name: 'hexstrike-ai', version: 'offline-fixture' },
  targets: [{ host: 'site-a.example.test', status: 'failed', reason: 'timeout' }], findings: [], reason: 'timeout',
});
assert.equal(partialResult.status, 'partial');
assert.equal(partialResult.reason, 'timeout');
const partialWithEvidence = normalizeResult(request, {
  schema: ADAPTER_SCHEMA, capability: CAPABILITY, status: 'partial',
  tool: { name: 'hexstrike-ai', version: 'offline-fixture' },
  targets: [{ host: 'site-a.example.test', status: 'completed' }],
  findings: [{ target_host: 'site-a.example.test', finding }],
  reason: 'additional observations were truncated',
});
assert.equal(partialWithEvidence.findings.length, 1);
const failedResult = normalizeResult(request, {
  schema: ADAPTER_SCHEMA, capability: CAPABILITY, status: 'failed',
  tool: { name: 'hexstrike-ai', version: 'offline-fixture' },
  targets: [{ host: 'site-a.example.test', status: 'failed', reason: 'transport failed' }], findings: [], reason: 'transport failed',
});
assert.equal(failedResult.status, 'failed');
assert.throws(() => normalizeResult(request, {
  schema: ADAPTER_SCHEMA, capability: CAPABILITY, status: 'failed',
  tool: { name: 'hexstrike-ai', version: 'offline-fixture' },
  targets: [{ host: 'site-a.example.test', status: 'completed' }],
  findings: [{ target_host: 'site-a.example.test', finding }], reason: 'failed',
}), /failed result cannot promote findings/);
assert.throws(() => normalizeResult(request, {
  schema: ADAPTER_SCHEMA, capability: CAPABILITY, status: 'completed',
  tool: { name: 'hexstrike-ai', version: 'offline-fixture' },
  targets: [{ host: 'site-a.example.test', status: 'completed' }],
  findings: [{ target_host: 'site-a.example.test', finding: { ...finding, resource_id: '/subscriptions/other/resourceGroups/rg/providers/Example/a/b' } }],
}), /not a source resource/);

console.log('OK — HexStrike adapter contract assertions passed');

const resultFor = (candidate = finding) => ({
  schema: ADAPTER_SCHEMA, capability: CAPABILITY, status: 'completed',
  tool: { name: 'hexstrike-ai', version: 'offline-fixture' },
  targets: [{ host: 'site-a.example.test', status: 'completed' }],
  findings: [{ target_host: 'site-a.example.test', finding: candidate }],
});

test('redacts every retained finding string and preserves the caller input', () => {
  const candidate = {
    ...finding,
    attack_path: ['access_token=OFFLINE_ATTACK_CANARY'],
    controls: { mitre: ['api_key=OFFLINE_CONTROL_CANARY'] },
    affected_resources: [{ resource_id: resourceId, name: 'password=OFFLINE_RESOURCE_CANARY' }],
    evidence: [{ source: 'offline', summary: 'Fixture', raw_ref: 'access_token=OFFLINE_PATH_CANARY' }],
    references: ['https://example.test/?sig=OFFLINE_URI_CANARY'],
  };
  const original = structuredClone(candidate);
  const value = normalizeResult(request, resultFor(candidate));
  assert.doesNotMatch(JSON.stringify(value), /OFFLINE_.*?_CANARY/);
  assert.deepEqual(candidate, original);
  assert.match(value.findings[0].attack_path[0], /\[REDACTED\]/);
});

test('removes entire credential headers including later cookies and Basic authorization', () => {
  for (const summary of [
    'Cookie: first=visible; session=OFFLINE_SECRET_CANARY',
    'Set-Cookie: first=visible; other=OFFLINE_SECRET_CANARY',
    'Authorization: Basic OFFLINE_SECRET_CANARY',
    'Proxy-Authorization: Basic OFFLINE_SECRET_CANARY',
    '{"access_token":"OFFLINE_SECRET_CANARY"}',
    "{'client_secret':'OFFLINE_SECRET_CANARY'}",
  ]) {
    const candidate = { ...finding, evidence: [{ source: 'fixture', summary }] };
    const value = normalizeResult(request, resultFor(candidate));
    assert.doesNotMatch(JSON.stringify(value), /OFFLINE_SECRET_CANARY/, summary);
  }
});

test('rejects unknown payloads at every finding object boundary', () => {
  for (const candidate of [
    { ...finding, raw: { password: 'OFFLINE_CANARY' } },
    { ...finding, evidence: [{ source: 'fixture', summary: 'Fixture', raw: { token: 'OFFLINE_CANARY' } }] },
    { ...finding, affected_resources: [{ resource_id: resourceId, credentials: 'OFFLINE_CANARY' }] },
    { ...finding, controls: { unknown: ['OFFLINE_CANARY'] } },
  ]) {
    assert.throws(() => normalizeResult(request, resultFor(candidate)), /unsupported field/);
  }
  const envelope = resultFor();
  envelope.findings[0].raw = 'OFFLINE_CANARY';
  assert.throws(() => normalizeResult(request, envelope), /unsupported field/);
});

test('requires every aggregated resource to belong to the requested host provenance', () => {
  const otherResourceId = resourceId.replace('site-a', 'site-b');
  const outsider = '/subscriptions/outside/resourceGroups/rg/providers/Microsoft.Web/sites/other';
  assert.throws(() => normalizeResult(request, resultFor({
    ...finding, affected_resources: [{ resource_id: resourceId }, { resource_id: outsider }],
  })), /affected resource is not a source resource/);
  assert.throws(() => normalizeResult(request, resultFor({
    ...finding, affected_resources: [{ resource_id: resourceId, subscription_id: 'wrong-subscription' }],
  })), /affected resource subscription does not match/);
  for (const affected_resources of [[], [{ resource_id: otherResourceId }]]) {
    assert.throws(() => normalizeResult(request, resultFor({ ...finding, affected_resources })), /representative resource/);
  }
  const multiSourceRequest = structuredClone(request);
  multiSourceRequest.targets[0].source_resource_ids.push(otherResourceId);
  const valid = normalizeResult(multiSourceRequest, resultFor({
    ...finding,
    affected_resources: [
      { resource_id: resourceId, subscription_id: finding.subscription_id },
      { resource_id: otherResourceId },
    ],
  }));
  assert.equal(valid.findings[0].affected_resources.length, 2);
});

test('validates optional scalar, array and nested finding fields before promotion', () => {
  const invalid = [
    { check_id: 17 }, { risk: {} }, { finding_class: 'INVALID CLASS' },
    { attack_path: { bad: true } }, { attack_path: [3] },
    { controls: [] }, { controls: { mitre: 'not-an-array' } },
    { references: ['not a URI'] }, { references: ['https://example.test/%GG'] },
    { affected_resources: {} }, { affected_resources: [{ resource_id: 42 }] },
    { evidence: [{ source: 'fixture', summary: 'Fixture', raw_ref: {} }] },
    { last_seen: null },
  ];
  for (const fields of invalid) {
    assert.throws(() => normalizeResult(request, resultFor({ ...finding, ...fields })), /HexStrike adapter:/,
      JSON.stringify(fields));
  }
  const valid = normalizeResult(request, resultFor({
    ...finding, finding_class: 'missing-header', dedupe_key: 'missing-header:fixture',
    resource_group: 'rg-test', region: 'eastus', risk: 'Fixture risk',
    attack_path: ['Observe the header'],
    controls: { mitre: ['T1190'], cis_azure: ['1.1'], defender_for_cloud: [], nist_800_53: ['SC-7'] },
    references: ['https://example.test/reference'], last_seen: '2026-09-25T12:00:00-04:00',
  }));
  assert.equal(valid.findings[0].finding_class, 'missing-header');
});

test('requires RFC3339 dates and rejects impossible calendar values', () => {
  for (const first_seen of [
    '01/01/2020', '2026-09-25', '2026-02-29T00:00:00Z', '2026-04-31T00:00:00Z',
    '2026-09-25T24:00:00Z', '2026-09-25T00:00:00+24:00', '2026-09-25T00:00:00Z\n',
  ]) {
    assert.throws(() => normalizeResult(request, resultFor({ ...finding, first_seen })), /RFC3339/);
  }
  for (const first_seen of ['2024-02-29T23:59:59Z', '2026-09-25t00:00:00.123z', '2026-09-25T00:00:00+05:30']) {
    assert.equal(normalizeResult(request, resultFor({ ...finding, first_seen })).findings[0].first_seen, first_seen);
  }
});

test('validates optional envelope reasons and redacts tool metadata', () => {
  for (const value of [17, {}, null]) {
    const result = resultFor();
    result.reason = value;
    assert.throws(() => normalizeResult(request, result), /reason must be a string/);
    delete result.reason;
    result.targets[0].reason = value;
    assert.throws(() => normalizeResult(request, result), /reason must be a string/);
  }
  const result = resultFor();
  result.tool.version = 'password=OFFLINE_VERSION_CANARY';
  assert.doesNotMatch(JSON.stringify(normalizeResult(request, result)), /OFFLINE_VERSION_CANARY/);
  assert.throws(() => buildRequest({ ...allowlist, engagement_id: 17 }), /engagement/);
  assert.throws(() => buildRequest(allowlist, 'site-a.example.test'), /must be an array/);
});

test('adapter schema key allowlists stay synchronized with canonical finding fields', () => {
  const canonical = JSON.parse(readFileSync(new URL('../../schemas/finding.schema.json', import.meta.url), 'utf8'));
  const adapter = JSON.parse(readFileSync(new URL('../../schemas/hexstrike-adapter.schema.json', import.meta.url), 'utf8'));
  const boundary = adapter.definitions.finding.allOf[1];
  assert.deepEqual(Object.keys(boundary.properties).sort(), Object.keys(canonical.properties).sort());
  for (const key of ['evidence', 'affected_resources', 'controls']) {
    const actual = boundary.properties[key].items ?? boundary.properties[key];
    const expected = canonical.properties[key].items ?? canonical.properties[key];
    assert.equal(actual.additionalProperties, false);
    assert.deepEqual(Object.keys(actual.properties).sort(), Object.keys(expected.properties).sort());
  }
});
