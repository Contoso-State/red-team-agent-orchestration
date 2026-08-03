#!/usr/bin/env node
/**
 * guard.test.mjs — tests for the platform-neutral red team guard.
 *
 * Run: node guardrails/guard.test.mjs   (also auto-discovered by `node --test`)
 *
 * Verifies that decide() reproduces the Copilot extension's decision precedence and
 * fail-closed behavior, that it matches the shared golden fixtures every adapter is
 * checked against, and that the stdin->JSON CLI wire is fail-closed. Dependency-free.
 */

import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { decide, decideSafe } from './guard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
}
function eq(a, b, msg) {
  assert.deepStrictEqual(a, b, msg);
  passed++;
}

// ---------------------------------------------------------------------------
// 1) Shared golden fixtures — the cross-platform parity baseline.
// ---------------------------------------------------------------------------

const fixtures = JSON.parse(readFileSync(join(HERE, 'fixtures', 'decisions.json'), 'utf8'));
for (const c of fixtures.cases) {
  const { decision } = decide(c.input);
  eq(decision, c.expect, `fixture "${c.name}" -> expected ${c.expect}, got ${decision}`);
}

// ---------------------------------------------------------------------------
// 2) controlled-validation mode downgrades a mutating Azure command to ASK
//    (never a silent allow).
// ---------------------------------------------------------------------------

{
  const root = mkdtempSync(join(tmpdir(), 'guard-cv-'));
  writeFileSync(join(root, 'engagement.yaml'), 'mode: controlled-validation\n');
  const r = decide({ command: 'az vm delete --name x -g rg --yes', cwd: root, toolName: 'bash' });
  eq(r.decision, 'ask', 'mutating az in controlled-validation -> ask');
  ok(/controlled-validation/i.test(r.reason), 'ask reason mentions controlled-validation');

  // A read-only command in the same mode is still allowed outright.
  const ro = decide({ command: 'az vm list', cwd: root, toolName: 'bash' });
  eq(ro.decision, 'allow', 'read-only az in controlled-validation -> allow');
  rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 3) Fail-closed: malformed / hostile input never throws and never allows.
// ---------------------------------------------------------------------------

eq(decideSafe(undefined).decision, 'allow', 'undefined input -> no command -> allow');
eq(decideSafe(null).decision, 'allow', 'null input -> no command -> allow');
eq(decide({ command: null, cwd: '.', toolName: 'bash' }).decision, 'allow', 'null command -> allow');
ok(
  ['allow', 'deny', 'ask'].includes(decideSafe({ command: { nested: {} } }).decision),
  'object command never throws',
);

// extractCommand only inspects explicit command fields, so a long opaque arg blob
// must not be allowed to smuggle a mutating command through an unexpected field.
{
  const r = decideSafe({ command: { args: 'az vm delete --yes' }, cwd: '.', toolName: 'edit' });
  eq(r.decision, 'allow', 'non-exec tool args are not scanned (no false positive / no bypass path)');
}

// ---------------------------------------------------------------------------
// 4) CLI wire: stdin JSON -> stdout {decision,reason}; always exits 0; fails closed.
// ---------------------------------------------------------------------------

function runCli(stdin) {
  const res = spawnSync(process.execPath, [join(HERE, 'guard.mjs')], {
    input: stdin,
    encoding: 'utf8',
  });
  return res;
}

{
  const res = runCli(JSON.stringify({ command: 'az vm list', cwd: '.', toolName: 'bash' }));
  eq(res.status, 0, 'CLI exits 0 on a valid read-only command');
  eq(JSON.parse(res.stdout).decision, 'allow', 'CLI allows read-only az');
}
{
  const res = runCli(JSON.stringify({ command: 'az vm delete --yes', cwd: '.', toolName: 'bash' }));
  eq(JSON.parse(res.stdout).decision, 'deny', 'CLI denies mutating az');
}
{
  const res = runCli('this is not json{{');
  eq(res.status, 0, 'CLI exits 0 even on malformed input (never crashes -> no fail-open)');
  eq(JSON.parse(res.stdout).decision, 'deny', 'CLI fails closed (deny) on malformed input');
}
{
  const res = runCli('');
  eq(JSON.parse(res.stdout).decision, 'allow', 'CLI treats empty stdin as no command -> allow');
}

console.log(`OK — ${passed} guard assertions passed`);
