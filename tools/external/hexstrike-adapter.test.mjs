#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
