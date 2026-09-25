import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseScope, validateScope } from './read-scope.mjs';
import { inScopeRoster } from '../graph/run-graph.mjs';
const sub = '11111111-1111-1111-1111-111111111111', tenant = '22222222-2222-2222-2222-222222222222', oid = '33333333-3333-3333-3333-333333333333';
const scope = () => ({ mode: 'read-only-assessment', scope: { tenant_id: tenant, subscriptions: [{ id: sub, resource_groups: ['*'] }], exclusions: {}, resource_types: [] }, caller: { required_roles: ['Reader'] } });
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0;
function run(script, { doc = scope(), fail = '', mismatch = false, args = '', badCaller = false, roleId = 'acdd72a7-3385-48ef-bd42-f606fba81ae7', page = { data: [] } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'redteam-scope-'));
  try {
    const file = join(dir, 'engagement.json'), log = join(dir, 'calls.jsonl');
    const toolkit = join(dir, 'tools/powershell');
    mkdirSync(toolkit, { recursive: true });
    for (const name of ['Common.ps1', 'read-scope.mjs', 'Invoke-Preflight.ps1', 'Export-Inventory.ps1']) copyFileSync(resolve('tools/powershell', name), join(toolkit, name));
    writeFileSync(file, JSON.stringify(doc));
    const token = `x.${Buffer.from(JSON.stringify({ tid: tenant, oid, upn: badCaller ? 'other@example.invalid' : 'demo@example.invalid' })).toString('base64url')}.x`;
    writeFileSync(join(dir, 'mock.ps1'), `
$ErrorActionPreference = 'Stop'
function az {
  $a = @($args); ConvertTo-Json -InputObject $a -Compress | Add-Content '${log}'
  if (($a -join ' ') -like '*${fail || 'NEVER_FAIL'}*') { $global:LASTEXITCODE = 7; return }
  $global:LASTEXITCODE = 0
  if ($a[0] -eq 'account' -and $a[1] -eq 'show') {
    if ($a -notcontains '--subscription') { throw 'Unscoped account read' }
    '${JSON.stringify({ id: mismatch ? oid : sub, tenantId: tenant, state: 'Enabled', user: { name: 'demo@example.invalid', type: 'user' } })}'
  } elseif ($a[1] -eq 'get-access-token') { '${JSON.stringify({ accessToken: token })}' }
  elseif ($a[0] -eq 'role') { '${JSON.stringify([{ principalId: oid, scope: `/subscriptions/${sub}`, roleDefinitionName: 'Reader', roleDefinitionId: `/subscriptions/${sub}/providers/Microsoft.Authorization/roleDefinitions/${roleId}` }])}' }
  elseif ($a[0] -eq 'graph') { '${JSON.stringify(page)}' }
}
& '${join(toolkit, script)}' -EngagementFile '${file}' -SessionPath '${join(dir, 'session')}' ${args}
`);
    // Copied toolkit confines session bookkeeping to this test sandbox.
    const result = spawnSync('pwsh', ['-NoProfile', '-File', join(dir, 'mock.ps1')], { encoding: 'utf8' });
    return { ...result, calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [] };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('strict scope parser handles template and rejects duplicate/narrowed scope', () => {
  const template = parseScope(readFileSync(resolve('engagement.example.yaml'), 'utf8'));
  template.scope.exclusions.resources = [];
  assert.equal(validateScope(template).subscriptionId, template.scope.subscriptions[0].id);
  assert.throws(() => parseScope('mode: x\nmode: y'));
  const narrowed = scope(); narrowed.scope.subscriptions[0].resource_groups = ['private'];
  assert.throws(() => validateScope(narrowed), /Narrowed/);
});
test('parsed domain selection reaches the graph without widening dispatch', () => {
  const graph = JSON.parse(readFileSync(resolve('graph/redteam.graph.json'), 'utf8'));
  const doc = parseScope(`mode: read-only-assessment
scope:
  tenant_id: ${tenant}
  subscriptions:
    - id: ${sub}
  domains:
    - data-protection
`);
  const selectedScope = { ...validateScope(doc), mode: doc.mode };
  assert.deepEqual(selectedScope.domains, ['data-protection']);
  assert.deepEqual(inScopeRoster(graph, { scope: selectedScope }).map(agent => agent.domain), ['data']);
});
test('supported domain aliases align with the canonical graph and engagement schema', () => {
  const graph = JSON.parse(readFileSync(resolve('graph/redteam.graph.json'), 'utf8'));
  const schema = JSON.parse(readFileSync(resolve('schemas/engagement.schema.json'), 'utf8'));
  const canonicalDomains = schema.properties.scope.properties.domains.items.enum;
  const defaultRoster = graph.roster.filter(agent => !agent.when);
  for (const agent of defaultRoster) {
    for (const alias of agent.scope_domains) {
      assert.ok(canonicalDomains.includes(alias), alias);
      const doc = scope(); doc.scope.domains = [alias];
      const normalized = validateScope(parseScope(JSON.stringify(doc)));
      assert.deepEqual(normalized.domains, [alias]);
      assert.deepEqual(inScopeRoster(graph, { scope: normalized }).map(entry => entry.domain), [agent.domain], alias);
    }
  }
  for (const domains of [undefined, []]) {
    const doc = scope(); if (domains !== undefined) doc.scope.domains = domains;
    assert.deepEqual(inScopeRoster(graph, { scope: validateScope(doc) }), defaultRoster);
  }
});
test('invalid and unsupported narrowed domains fail closed', () => {
  for (const domains of [null, 'data-protection', {}, [null], [42], [''], ['data'], ['unknown-domain'], ['data-protection', 'unknown-domain'], ['authorization-attack-path'], ['external-vuln'], ['email-security']]) {
    const doc = scope(); doc.scope.domains = domains;
    assert.throws(() => validateScope(parseScope(JSON.stringify(doc))), /Invalid or unsupported assessment domains/, JSON.stringify(domains));
  }
});
for (const script of ['Invoke-Preflight.ps1', 'Export-Inventory.ps1']) {
  test(`${script} pins reads despite unrelated default account`, { skip: !hasPwsh }, () => {
    const r = run(script); assert.equal(r.status, 0, r.stderr);
    assert.ok(r.calls.length > 0);
    for (const call of r.calls) assert.ok(call.includes(sub), JSON.stringify(call));
  });
  test(`${script} rejects multiple subscriptions before reads`, { skip: !hasPwsh }, () => {
    const doc = scope(); doc.scope.subscriptions.push({ id: oid });
    const r = run(script, { doc }); assert.notEqual(r.status, 0); assert.equal(r.calls.length, 0);
  });
  test(`${script} rejects unsupported domains before reads`, { skip: !hasPwsh }, () => {
    const doc = scope(); doc.scope.domains = ['data-protection', 'external-vuln'];
    const r = run(script, { doc }); assert.notEqual(r.status, 0); assert.equal(r.calls.length, 0);
  });
  test(`${script} rejects mismatched account and native failure`, { skip: !hasPwsh }, () => {
    assert.notEqual(run(script, { mismatch: true }).status, 0);
    assert.notEqual(run(script, { fail: script.startsWith('Export') ? 'graph query' : 'role assignment' }).status, 0);
  });
}
test('preflight rejects caller mismatch', { skip: !hasPwsh }, () => assert.notEqual(run('Invoke-Preflight.ps1', { badCaller: true }).status, 0));

test('preflight accepts Owner ARM reads but not custom role display-name equivalence', { skip: !hasPwsh }, () => {
  const doc = scope(); doc.caller.required_roles.push('Security Reader');
  assert.equal(run('Invoke-Preflight.ps1', { doc, roleId: '8e3af657-a8ff-443c-a75c-2fe8c4bcb635' }).status, 0);
  assert.notEqual(run('Invoke-Preflight.ps1', { roleId: oid }).status, 0);
});
test('inventory rejects malformed or foreign resource rows', { skip: !hasPwsh }, () => {
  assert.notEqual(run('Export-Inventory.ps1', { page: {} }).status, 0);
  assert.notEqual(run('Export-Inventory.ps1', { page: { data: [{ subscriptionId: oid, id: `/subscriptions/${oid}/x` }] } }).status, 0);
});
