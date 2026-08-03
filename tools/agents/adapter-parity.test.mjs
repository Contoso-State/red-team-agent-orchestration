// adapter-parity.test.mjs — wire-contract parity tests for every runtime adapter.
//
// The platform-neutral engine (guardrails/guard.mjs) is unit-tested in guard.test.mjs.
// This suite proves each PER-PLATFORM ADAPTER faithfully translates the SAME shared
// golden fixtures (guardrails/fixtures/decisions.json) into its own native wire format and
// reaches the SAME allow/deny outcome — so the guarantee "identical decision on every
// platform" holds end to end, not just in the core.
//
// For each adapter we spawn the real hook script with a platform-shaped stdin payload and
// assert its observable contract (stdout JSON / stderr / exit code). Codex additionally
// gets fail-closed + SessionStart checks because its contract (stderr + exit 2, never fail
// open) is the most delicate.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

const fixture = JSON.parse(
  readFileSync(join(ROOT, 'guardrails', 'fixtures', 'decisions.json'), 'utf8'),
);

function run(scriptRelPath, payload) {
  const res = spawnSync(process.execPath, [join(ROOT, scriptRelPath)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function parseJsonLine(stdout) {
  const line = stdout.trim();
  if (!line) return null;
  return JSON.parse(line);
}

// ---- Claude Code adapter ----------------------------------------------------
// stdin: { hook_event_name:"PreToolUse", tool_name, tool_input:{command}, cwd }
// allow -> exit 0, no stdout; deny/ask -> stdout {hookSpecificOutput:{permissionDecision}}.
function claudeDecision(c) {
  const { code, stdout } = run('.claude/hooks/redteam-guard.mjs', {
    hook_event_name: 'PreToolUse',
    tool_name: c.input.toolName,
    tool_input: { command: c.input.command },
    cwd: c.input.cwd,
  });
  assert.equal(code, 0, 'Claude adapter must always exit 0');
  const obj = parseJsonLine(stdout);
  if (!obj) return 'allow';
  return obj.hookSpecificOutput.permissionDecision;
}

// ---- Cursor adapter ---------------------------------------------------------
// stdin: { hook_event_name:"beforeShellExecution", command, cwd }
// stdout: { permission:"allow"|"deny"|"ask" } (deny path is exit 0 with JSON).
function cursorDecision(c) {
  const { stdout } = run('.cursor/hooks/redteam-guard.mjs', {
    hook_event_name: 'beforeShellExecution',
    command: c.input.command,
    cwd: c.input.cwd,
  });
  const obj = parseJsonLine(stdout);
  assert.ok(obj && obj.permission, 'Cursor adapter must emit a permission verdict');
  return obj.permission;
}

// ---- Codex adapter ----------------------------------------------------------
// stdin: { hook_event_name:"PreToolUse", tool_name, tool_input:{command}, cwd }
// allow -> exit 0, no stderr; deny/ask -> exit 2 + stderr (the ONLY block Codex honours).
function codexDecision(c) {
  const { code, stdout, stderr } = run('.codex/hooks/redteam-guard.mjs', {
    hook_event_name: 'PreToolUse',
    tool_name: c.input.toolName,
    tool_input: { command: c.input.command },
    cwd: c.input.cwd,
  });
  if (code === 2) {
    assert.ok(stderr.trim().length > 0, 'Codex block must write a reason to stderr');
    return 'deny';
  }
  assert.equal(code, 0, 'Codex allow must exit 0');
  assert.equal(stderr.trim(), '', 'Codex allow must not write to stderr');
  assert.equal(stdout.trim(), '', 'Codex allow must stay silent on stdout');
  return 'allow';
}

for (const c of fixture.cases) {
  test(`claude adapter: ${c.name} -> ${c.expect}`, () => {
    assert.equal(claudeDecision(c), c.expect);
  });
  test(`cursor adapter: ${c.name} -> ${c.expect}`, () => {
    assert.equal(cursorDecision(c), c.expect);
  });
  test(`codex adapter: ${c.name} -> ${c.expect}`, () => {
    assert.equal(codexDecision(c), c.expect);
  });
}

// ---- Codex-specific fail-closed + lifecycle contract ------------------------

test('codex adapter: malformed stdin fails closed (exit 2 + stderr)', () => {
  const res = spawnSync(process.execPath, [join(ROOT, '.codex/hooks/redteam-guard.mjs')], {
    input: 'not json at all',
    encoding: 'utf8',
  });
  assert.equal(res.status, 2, 'malformed input must block with exit 2, never fail open');
  assert.ok((res.stderr || '').trim().length > 0, 'must explain the fail-closed block');
});

test('codex adapter: SessionStart emits banner and exits 0 (non-blocking)', () => {
  const { code, stdout, stderr } = run('.codex/hooks/redteam-guard.mjs', {
    hook_event_name: 'SessionStart',
  });
  assert.equal(code, 0, 'SessionStart must never block the session');
  assert.equal(stderr.trim(), '', 'SessionStart must not write to stderr');
  const obj = parseJsonLine(stdout);
  assert.equal(obj.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(obj.hookSpecificOutput.additionalContext, /READ-ONLY posture/);
});

test('codex adapter: unknown lifecycle event passes through (exit 0, silent)', () => {
  const { code, stdout, stderr } = run('.codex/hooks/redteam-guard.mjs', {
    hook_event_name: 'PostToolUse',
  });
  assert.equal(code, 0);
  assert.equal(stdout.trim(), '');
  assert.equal(stderr.trim(), '');
});
