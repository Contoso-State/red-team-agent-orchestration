import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { runProcess, terminateProcessTree } from './native-model.mjs';

test('process runner preserves successful output and withholds failed process payloads', async () => {
  assert.equal(await runProcess(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input: 'local fixture' }), 'local fixture');
  await assert.rejects(runProcess(process.execPath, ['-e', 'console.error("PRIVATE");process.exit(7)']), /^Error: Subprocess failed \(exit 7\); payload withheld$/);
  await assert.rejects(runProcess('redteam-missing-local-executable', []), /Required executable unavailable/);
});

test('pre-aborted subprocess does not launch and bounded subprocesses reject on timeout or output overflow', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runProcess('redteam-missing-local-executable', [], { signal: controller.signal }), /Subprocess cancelled/);
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 100, processTree: true }), /Subprocess timed out/);
  await assert.rejects(runProcess(process.execPath, ['-e', 'console.log("overflow");setInterval(()=>{},1000)'], { maxBytes: 1, processTree: true }), /Subprocess output limit exceeded/);
});

test('tree cancellation terminates the wrapper and local descendants before settling', { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'redteam-process-test-')), ready = join(dir, 'ready.json');
  const controller = new AbortController();
  t.after(() => {
    controller.abort();
    if (existsSync(ready)) {
      const pids = JSON.parse(readFileSync(ready, 'utf8'));
      for (const pid of [-pids.parent, pids.child]) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    }
    rmSync(dir, { recursive: true, force: true });
  });
  const descendant = `require('node:fs').writeFileSync(process.argv[1],JSON.stringify({parent:Number(process.argv[2]),child:process.pid}));setInterval(()=>{},1000);`;
  const wrapper = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)},process.argv[1],String(process.pid)],{stdio:['ignore',process.stdout,process.stderr]});setInterval(()=>{},1000);`;
  // Grandchild inherits both output pipes. close cannot arrive until the whole
  // tree releases them; killing only the wrapper would hit the cleanup timeout.
  const outcome = runProcess(process.execPath, ['-e', wrapper, ready], { signal: controller.signal, processTree: true, timeout: 8000 }).then(() => ({ success: true }), error => ({ error }));
  const deadline = Date.now() + 4000;
  while (!existsSync(ready) && Date.now() < deadline) await delay(20);
  assert.equal(existsSync(ready), true, 'local descendant must start before cancellation');
  const cancelledAt = Date.now(); controller.abort();
  const result = await outcome;
  assert.match(result.error?.message ?? '', /^Subprocess cancelled$/);
  assert.ok(Date.now() - cancelledAt < 3000, 'tree closes without reaching cleanup timeout');
});

test('Windows process tree termination uses bounded shell-free taskkill and fails closed', () => {
  const calls = [], child = { pid: 1234, kill: signal => calls.push({ fallback: signal }) };
  terminateProcessTree(child, { platform: 'win32', execute: (file, args, options) => { calls.push({ file, args, options }); return { status: 0 }; } });
  assert.deepEqual(calls, [{ file: 'taskkill', args: ['/PID', '1234', '/T', '/F'], options: { shell: false, windowsHide: true, stdio: 'ignore', timeout: 5000 } }]);
  assert.throws(() => terminateProcessTree(child, { platform: 'win32', execute: () => ({ status: 1 }) }), /cleanup could not be confirmed/);
  assert.deepEqual(calls.at(-1), { fallback: 'SIGKILL' });
});

test('POSIX tree termination targets the detached process group and accepts an exited tree', () => {
  const calls = [];
  terminateProcessTree({ pid: 1234 }, { platform: 'linux', kill: (...args) => calls.push(args) });
  assert.deepEqual(calls, [[-1234, 'SIGKILL']]);
  terminateProcessTree({ pid: 1234 }, { platform: 'linux', kill: () => { throw Object.assign(Error(), { code: 'ESRCH' }); } });
  assert.throws(() => terminateProcessTree({ pid: 1234 }, { platform: 'linux', kill: () => { throw Object.assign(Error(), { code: 'EPERM' }); } }), /cleanup could not be confirmed/);
});
