import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runPreflightRead, runLivePreflight, PREFLIGHT_POWERSHELL_WRAPPER } from './live-preflight.mjs';
import { isWithinDirectory } from './live-paths.mjs';

const subscriptionId = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';
const accountName = 'workshop@example.invalid';
const account = { id: subscriptionId, tenantId, state: 'Enabled', user: { name: accountName } };
const me = { id: '33333333-3333-4333-8333-333333333333', userPrincipalName: accountName };
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'redteam-preflight-test-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sessionDir = join(root, 'engagements', 'offline session');
  const azureConfigDir = join(sessionDir, 'isolated credentials');
  mkdirSync(azureConfigDir, { recursive: true });
  mkdirSync(join(sessionDir, 'evidence'), { recursive: true });
  mkdirSync(join(sessionDir, 'inventory'), { recursive: true });
  const engagementFile = join(sessionDir, 'engagement.json');
  writeFileSync(engagementFile, JSON.stringify({ mode: 'read-only-assessment', engagement: { authorized_by: accountName }, scope: { tenant_id: tenantId, subscriptions: [{ id: subscriptionId }] } }));
  const manifestFile = join(sessionDir, 'evidence/preflight-manifest.json');
  writeFileSync(manifestFile, JSON.stringify({ status: 'passed', readerEquivalent: true, verifiedAt: new Date().toISOString(), tenantId, subscriptionId, azureConfigDir, scopeFile: engagementFile, accountName, objectId: me.id }));
  return { root, sessionDir, azureConfigDir, engagementFile, manifestFile, audit: join(sessionDir, 'evidence/audit.jsonl') };
}
const accountArgs = ['account', 'show', '--subscription', subscriptionId, '--output', 'json'];

test('preflight read uses the canonical runner with exact scope, isolated environment and bounds', t => {
  const f = fixture(t); let calls = 0;
  const result = runPreflightRead(f, accountArgs, { execute: (args, options) => {
    calls++; assert.deepEqual(args, accountArgs);
    assert.equal(options.cwd, f.sessionDir); assert.equal(options.env.AZURE_CONFIG_DIR, f.azureConfigDir);
    assert.equal(options.env.AZURE_EXTENSION_USE_DYNAMIC_INSTALL, 'no'); assert.equal(options.env.AZURE_CORE_COLLECT_TELEMETRY, 'no');
    assert.equal(options.timeoutMs, 120000); assert.equal(options.maxBuffer, 20000000);
    return { ok: true, status: 0, stdout: JSON.stringify(account) };
  } });
  assert.deepEqual(JSON.parse(result), account); assert.equal(calls, 1);
  const audit = JSON.parse(readFileSync(f.audit, 'utf8'));
  assert.equal(audit.decision, 'allow'); assert.deepEqual(audit.operation, accountArgs.slice(0, 3));
  assert.equal(readFileSync(f.audit, 'utf8').includes(accountName), false);
});

test('preflight preserves inventory argv while removing tags from its allowed projection', t => {
  const f = fixture(t);
  const query = 'Resources | project id, name, type, resourceGroup, subscriptionId, location, kind, tags | order by type asc';
  const args = ['graph', 'query', '-q', query, '--subscriptions', subscriptionId, '--first', '1000', '--skip', '0'];
  runPreflightRead(f, args, { execute: (forwarded) => {
    assert.equal(forwarded[3], query.replace(', tags', ''));
    assert.deepEqual(forwarded.slice(4), args.slice(4));
    return { ok: true, stdout: '{"data":[]}' };
  } });
  assert.equal(args[3], query);
});

test('preflight rejects scope escapes and refusals without publishing subprocess payloads', t => {
  const f = fixture(t); let calls = 0;
  for (const args of [accountArgs.slice(0, 2), [...accountArgs, '--subscription', subscriptionId], accountArgs.map(a => a === subscriptionId ? tenantId : a), ['rest', '--method', 'GET', '--url', 'https://example.invalid', '--subscription', subscriptionId]]) {
    assert.throws(() => runPreflightRead(f, args, { execute: () => { calls++; } }));
  }
  assert.equal(calls, 0);
  for (const result of [{ ok: false, status: 0, stdout: 'sensitive payload' }, { ok: false, refused: 'scope denied' }, { ok: false, error: 'timed out' }]) {
    assert.throws(() => runPreflightRead(f, accountArgs, { execute: () => result }), /^Error: Guarded preflight Azure read failed; payload withheld$/);
  }
  assert.throws(() => runPreflightRead(f, accountArgs, { execute: () => { throw Error('sensitive payload'); } }), /payload withheld/);
});

test('host preflight uses Node and scoped PowerShell wrapper with no shell shim or PATH rewrite', async t => {
  const f = fixture(t), calls = [], events = [];
  const marker = join(f.root, 'engagements/.current-session'); writeFileSync(marker, 'previous session');
  const resources = [{ id: `/subscriptions/${subscriptionId}/resourceGroups/demo/providers/Microsoft.Storage/storageAccounts/test`, subscriptionId }];
  const result = await runLivePreflight({ ...f, emit: e => events.push(e), execute: async (file, args, options) => {
    calls.push({ file, args, options });
    assert.equal(options.env.AZURE_CONFIG_DIR, f.azureConfigDir); assert.equal(options.env.PATH, process.env.PATH);
    if (file === process.execPath) {
      assert.equal(args[1], '--az-shim'); assert.equal(options.maxBytes, 4000000);
      return JSON.stringify(args[2] === 'account' ? account : me);
    }
    assert.equal(file, 'pwsh'); assert.match(args[2], /Invoke-GuardedPreflight\.ps1$/);
    assert.equal(readFileSync(args[2], 'utf8'), PREFLIGHT_POWERSHELL_WRAPPER);
    assert.equal(options.env.REDTEAM_NODE_EXECUTABLE, process.execPath);
    assert.equal(options.timeout, 300000); assert.equal(options.maxBytes, 2000000);
    writeFileSync(marker, 'temporary session');
    writeFileSync(join(f.sessionDir, 'inventory/resources.json'), JSON.stringify(resources));
    return '';
  } });
  assert.equal(calls.length, 4); assert.deepEqual(result.resources, resources);
  assert.equal(readFileSync(marker, 'utf8'), 'previous session');
  const manifest = JSON.parse(readFileSync(f.manifestFile, 'utf8'));
  assert.equal(manifest.hostPreflightPassed, true); assert.equal(manifest.resourceCount, 1);
  assert.deepEqual(events.map(e => e.type), ['preflight.started', 'preflight.completed']);
});

test('failed host preflight cannot reuse a prior success and restores session marker', async t => {
  const f = fixture(t), events = [];
  const marker = join(f.root, 'engagements/.current-session'); writeFileSync(marker, 'previous session');
  await assert.rejects(runLivePreflight({ ...f, emit: e => events.push(e), execute: async (file, args) => {
    if (file === process.execPath) return JSON.stringify(args[2] === 'account' ? account : me);
    writeFileSync(marker, 'temporary session'); throw Error('offline simulated script failure');
  } }), /offline simulated script failure/);
  assert.equal(readFileSync(marker, 'utf8'), 'previous session');
  assert.equal(JSON.parse(readFileSync(f.manifestFile, 'utf8')).hostPreflightPassed, false);
  assert.equal(events.some(e => e.type === 'preflight.completed'), false);
});

test('session containment accepts Windows and POSIX descendants and rejects drive and sibling escapes', () => {
  for (const paths of [posix, win32]) {
    const parent = paths === win32 ? 'C:\\work\\engagements\\session' : '/work/engagements/session';
    assert.equal(isWithinDirectory(parent, paths.join(parent, 'isolated credentials'), paths), true);
    assert.equal(isWithinDirectory(parent, paths.join(parent, '..local'), paths), true);
    for (const child of [parent, paths.dirname(parent), paths.join(parent, '..', 'sibling'), `${parent}-other/credentials`, 'relative/credentials']) {
      assert.equal(isWithinDirectory(parent, child, paths), false, child);
    }
  }
  assert.equal(isWithinDirectory('C:\\session', 'D:\\session\\credentials', win32), false);
  assert.equal(isWithinDirectory('C:\\session', '\\\\server\\share\\credentials', win32), false);
});

test('preflight rejects pre-aborted work before launching any process', async t => {
  const f = fixture(t), controller = new AbortController(); controller.abort();
  let calls = 0;
  await assert.rejects(runLivePreflight({ ...f, signal: controller.signal, execute: async () => { calls++; } }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

for (const cancelledStage of [1, 2, 3, 4]) {
  test(`preflight cancellation at stage ${cancelledStage} stops subsequent work and withholds success`, async t => {
    const f = fixture(t), controller = new AbortController(), events = [];
    const marker = join(f.root, 'engagements/.current-session'); writeFileSync(marker, 'previous session');
    let calls = 0;
    await assert.rejects(runLivePreflight({ ...f, signal: controller.signal, emit: event => events.push(event), execute: async (file, args, options) => {
      calls++; assert.equal(options.signal, controller.signal); assert.equal(options.processTree, true);
      if (file === 'pwsh') writeFileSync(marker, 'temporary session');
      if (calls === cancelledStage) controller.abort();
      return file === process.execPath ? JSON.stringify(args[2] === 'account' ? account : me) : '';
    } }), { name: 'AbortError' });
    assert.equal(calls, cancelledStage);
    assert.equal(readFileSync(marker, 'utf8'), 'previous session');
    assert.equal(JSON.parse(readFileSync(f.manifestFile, 'utf8')).hostPreflightPassed, false);
    assert.equal(events.some(event => event.type === 'preflight.completed'), false);
  });
}

test('PowerShell wrapper passes complex argv through Node and propagates failed reads (offline stub)', t => {
  // This integration uses local PowerShell plus a fake Node responder only. No
  // installed Azure CLI, credentials, or network access are needed or exercised.
  const available = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8', timeout: 20000 });
  if (available.error?.code === 'ENOENT') return t.skip('PowerShell unavailable; pure process-contract tests still run');
  assert.equal(available.status, 0, available.stderr);
  const f = fixture(t);
  const wrapper = join(f.root, 'wrapper.ps1'), script = join(f.root, 'test script.ps1'), responder = join(f.root, 'fake shim.mjs');
  writeFileSync(wrapper, PREFLIGHT_POWERSHELL_WRAPPER);
  writeFileSync(responder, "console.log(JSON.stringify({argv:process.argv.slice(2),config:process.env.AZURE_CONFIG_DIR}));process.exitCode=Number(process.env.REDTEAM_TEST_EXIT||0);");
  writeFileSync(script, `param([string]$EngagementFile,[string]$SessionPath)
. $env:REDTEAM_TEST_COMMON
$result = Invoke-AzJson -Arguments @('graph', 'query', '-q', 'Resources | project name, id', '--subscription', '${subscriptionId}', '--query', 'literal ''quote''')
$result | ConvertTo-Json -Compress -Depth 5
`);
  const args = ['-NoProfile', '-File', wrapper, '-ScriptPath', script, '-EngagementFile', f.engagementFile, '-SessionPath', f.sessionDir];
  const env = { ...process.env, AZURE_CONFIG_DIR: f.azureConfigDir, REDTEAM_NODE_EXECUTABLE: process.execPath, REDTEAM_PREFLIGHT_SHIM: responder, REDTEAM_TEST_COMMON: fileURLToPath(new URL('../powershell/Common.ps1', import.meta.url)) };
  const success = spawnSync('pwsh', args, { env, encoding: 'utf8', timeout: 20000, maxBuffer: 1000000 });
  assert.equal(success.status, 0, success.stderr);
  const value = JSON.parse(success.stdout);
  assert.equal(value.config, f.azureConfigDir);
  assert.deepEqual(value.argv, ['--az-shim', 'graph', 'query', '-q', 'Resources | project name, id', '--subscription', subscriptionId, '--query', "literal 'quote'", '--only-show-errors', '--output', 'json']);
  const failure = spawnSync('pwsh', args, { env: { ...env, REDTEAM_TEST_EXIT: '7' }, encoding: 'utf8', timeout: 20000, maxBuffer: 1000000 });
  assert.notEqual(failure.status, 0); assert.equal(failure.stdout.trim(), '');
});
