import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAzCommand, runAz, runAzAsync } from './run-az.mjs';

const fakeResolver = () => ({ file: '/fake/azure/python', prefix: ['-m', 'azure.cli'] });
const unexpectedSpawn = () => { throw Error('No subprocess should run'); };

test('Windows az.cmd resolves to its bundled interpreter without spawning a shell', () => {
  const files = new Set(['C:\\Azure CLI\\wbin\\az.cmd', 'C:\\Azure CLI\\python.exe']);
  assert.deepEqual(resolveAzCommand('win32', { env: { Path: 'C:\\missing;C:\\Azure CLI\\wbin' }, exists: p => files.has(p) }), {
    file: 'C:\\Azure CLI\\python.exe', prefix: ['-m', 'azure.cli'],
  });
  files.delete('C:\\Azure CLI\\python.exe');
  assert.equal(resolveAzCommand('win32', { env: { PATH: 'C:\\Azure CLI\\wbin' }, exists: p => files.has(p) }), null);
  files.add('C:\\Azure CLI\\wbin\\az.exe');
  assert.deepEqual(resolveAzCommand('win32', { env: { PATH: 'C:\\Azure CLI\\wbin' }, exists: p => files.has(p) }), {
    file: 'C:\\Azure CLI\\wbin\\az.exe', prefix: [],
  });
});

test('POSIX resolution uses the caller PATH and no ambient CLI installation', () => {
  assert.deepEqual(resolveAzCommand('linux', { env: { PATH: '/missing:/isolated/bin' }, exists: p => p === '/isolated/bin/az' }), {
    file: '/isolated/bin/az', prefix: [],
  });
  assert.equal(resolveAzCommand('linux', { env: {}, exists: () => true }), null);
});

test('read-only argv, isolated credentials and execution bounds reach the canonical subprocess', () => {
  const args = ['account', 'show', '--subscription', '11111111-1111-1111-1111-111111111111', '-o', 'json'];
  const env = { PATH: '/isolated/bin', AZURE_CONFIG_DIR: '/isolated/credentials' };
  let calls = 0;
  const res = runAz(args, {
    env, timeoutMs: 60000, maxBuffer: 123456,
    resolveCommand: (_platform, options) => { assert.equal(options.env, env); return fakeResolver(); },
    spawn: (file, argv, options) => {
      calls++;
      assert.equal(file, '/fake/azure/python');
      assert.deepEqual(argv, ['-m', 'azure.cli', ...args]);
      assert.equal(options.env, env);
      assert.equal(options.shell, false);
      assert.equal(options.timeout, 60000);
      assert.equal(options.maxBuffer, 123456);
      return { status: 0, stdout: '{"id":"example"}', stderr: '' };
    },
  });
  assert.equal(calls, 1);
  assert.equal(res.ok, true);
  assert.deepEqual(res.json, { id: 'example' });
});

test('query pipes remain a single argument during guard classification and execution', () => {
  const query = 'Resources | project id, name | order by name asc';
  const args = ['graph', 'query', '-q', query, '--subscriptions', '11111111-1111-1111-1111-111111111111'];
  let calls = 0;
  const res = runAz(args, { resolveCommand: fakeResolver, spawn: (_file, argv) => {
    calls++; assert.deepEqual(argv, ['-m', 'azure.cli', ...args]); return { status: 0, stdout: '{"data":[]}', stderr: '' };
  } });
  assert.equal(res.ok, true, res.refused);
  assert.equal(calls, 1);
});

test('mutations are refused before resolution or execution', () => {
  const res = runAz(['group', 'delete', '--name', 'anything', '--yes'], { resolveCommand: unexpectedSpawn, spawn: unexpectedSpawn });
  assert.equal(res.ok, false);
  assert.ok(res.refused);
  assert.equal(res.status, null);
});

test('unavailable CLI, timeout, overflow and nonzero exit never become successful zero findings', () => {
  const args = ['account', 'show', '-o', 'json'];
  const missing = runAz(args, { resolveCommand: () => null, spawn: unexpectedSpawn });
  assert.equal(missing.ok, false);
  assert.match(missing.refused, /not found/);
  for (const error of [{ code: 'ETIMEDOUT', message: 'timeout' }, { code: 'ENOBUFS', message: 'output limit' }, { code: 'ENOENT', message: 'missing interpreter' }]) {
    const res = runAz(args, { resolveCommand: fakeResolver, spawn: () => ({ status: null, stdout: '[]', error }) });
    assert.equal(res.ok, false);
    assert.equal(res.json, null);
    assert.ok(res.error);
  }
  assert.equal(runAz(args, { resolveCommand: fakeResolver, spawn: () => ({ status: 1, stdout: '[]', stderr: 'read failed' }) }).ok, false);
});

test('arguments must be an argv array, never a command string', () => {
  assert.throws(() => runAz('account show'), TypeError);
  assert.throws(() => runAz(['account', 1]), TypeError);
});

// Local Node responders exercise process lifetime only; they never run Azure.
const responder = script => () => ({ file: process.execPath, prefix: ['-e', script, '--'] });
test('async canonical runner returns parsed output and refuses mutations before spawning', async () => {
  const success = await runAzAsync(['account', 'show'], { resolveCommand: responder('console.log(JSON.stringify({id:"offline"}))') });
  assert.equal(success.ok, true); assert.deepEqual(success.json, { id: 'offline' });
  const denied = await runAzAsync(['group', 'delete', '--name', 'test', '--yes'], { resolveCommand: unexpectedSpawn, spawn: unexpectedSpawn });
  assert.equal(denied.ok, false); assert.ok(denied.refused);
});

test('async canonical runner kills local responder on timeout, cancellation and output overflow', async () => {
  const args = ['account', 'show'];
  const timeout = await runAzAsync(args, { timeoutMs: 30, resolveCommand: responder('setInterval(()=>{},1000)') });
  assert.equal(timeout.ok, false); assert.match(timeout.error, /timed out/);
  const controller = new AbortController();
  const pending = runAzAsync(args, { signal: controller.signal, resolveCommand: responder('setInterval(()=>{},1000)') });
  controller.abort();
  const cancelled = await pending; assert.equal(cancelled.ok, false); assert.match(cancelled.error, /cancelled/);
  const overflow = await runAzAsync(args, { maxBuffer: 32, resolveCommand: responder('process.stdout.write("x".repeat(10000));setInterval(()=>{},1000)') });
  assert.equal(overflow.ok, false); assert.equal(overflow.json, null); assert.equal(overflow.stdout, ''); assert.match(overflow.error, /output limit/);
  const failure = await runAzAsync(args, { resolveCommand: responder('console.log("[]");process.exitCode=2') });
  assert.equal(failure.ok, false); assert.equal(failure.status, 2);
});

test('async canonical runner handles unavailable processes and already cancelled calls', async () => {
  const missing = await runAzAsync(['account', 'show'], { resolveCommand: () => ({ file: '/missing/redteam-test-responder', prefix: [] }) });
  assert.equal(missing.ok, false); assert.ok(missing.error);
  const controller = new AbortController(); controller.abort();
  const cancelled = await runAzAsync(['account', 'show'], { signal: controller.signal, resolveCommand: fakeResolver, spawn: unexpectedSpawn });
  assert.equal(cancelled.ok, false); assert.match(cancelled.error, /cancelled/);
});
