import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAzCommand, runAz } from './run-az.mjs';

test('the Azure CLI resolves to something Node can actually spawn', () => {
  const resolved = resolveAzCommand();
  assert.ok(resolved, 'the Azure CLI must be resolvable on a machine that has it installed');
  if (process.platform === 'win32') {
    // The bug this guards: spawning az.cmd fails EINVAL on Node >= 20.12, so we must
    // never resolve to the batch wrapper.
    assert.doesNotMatch(resolved.file, /\.(cmd|bat)$/i, 'must not resolve to a batch wrapper');
  }
});

test('a read-only query runs without a shell and returns parsed JSON', () => {
  const res = runAz(['account', 'show', '-o', 'json'], { timeoutMs: 60_000 });
  assert.equal(res.refused, null, `should not be refused: ${res.refused}`);
  assert.equal(res.error, undefined, `should not error: ${res.error}`);
  assert.equal(res.ok, true, `az should succeed: ${res.stderr}`);
  assert.equal(typeof res.json?.id, 'string', 'account show returns a subscription id');
});

test('a mutating command is refused before it can run', () => {
  const res = runAz(['group', 'delete', '--name', 'anything', '--yes']);
  assert.equal(res.ok, false);
  assert.ok(res.refused, 'the guard must refuse a delete');
  assert.equal(res.status, null, 'nothing may be executed');
});

test('arguments must be an argv array, never a command string', () => {
  assert.throws(() => runAz('account show'), TypeError);
});
