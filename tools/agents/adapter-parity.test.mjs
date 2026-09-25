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

test('Claude repo hooks use a cross-runtime relative command', () => {
  const settings = JSON.parse(readFileSync(join(ROOT, '.claude', 'settings.json'), 'utf8'));
  for (const event of ['SessionStart', 'PreToolUse']) {
    const hooks = settings.hooks?.[event] || [];
    assert.ok(hooks.length > 0, `${event} hook must be configured`);
    for (const group of hooks) {
      for (const hook of group.hooks || []) {
        assert.equal(hook.command, 'node .claude/hooks/redteam-guard.mjs');
        assert.equal(hook.args, undefined, 'repo hook must not depend on CLAUDE_PROJECT_DIR');
      }
    }
  }
});

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

// The Claude hook script is also discovered by other runtimes that read
// .claude/settings.json. It previously understood only Claude's payload shape and,
// on anything else, handed a non-string to the guard — which cannot classify one and
// answered "allow". A mutating Azure command in an unrecognized shape was silently
// permitted, while the file's own header promised it never silently allows.
const HOOK = '.claude/hooks/redteam-guard.mjs';
const decisionOf = (out) => {
  if (!out.trim()) return 'allow';
  return JSON.parse(out).hookSpecificOutput.permissionDecision;
};

test('hook denies a mutating command sent in a non-Claude payload shape', () => {
  const { stdout } = run(HOOK, {
    toolName: 'shell',
    toolArgs: 'az group delete --name prod-rg --yes',
    workingDirectory: '.',
  });
  assert.equal(decisionOf(stdout), 'deny', 'unrecognized shape must not fail open');
});

test('hook still evaluates a read-only command in a non-Claude payload shape', () => {
  const { stdout } = run(HOOK, { toolName: 'shell', toolArgs: 'az group list', workingDirectory: '.' });
  assert.equal(decisionOf(stdout), 'allow');
});

test('hook denies a shell tool call whose command cannot be read', () => {
  assert.equal(decisionOf(run(HOOK, { toolName: 'bash' }).stdout), 'deny');
  assert.equal(decisionOf(run(HOOK, { tool_name: 'Bash', tool_input: {} }).stdout), 'deny');
});

test('hook keeps no opinion on tool calls that carry no command by design', () => {
  const { stdout } = run(HOOK, { tool_name: 'Read', tool_input: { file_path: 'x' } });
  assert.equal(decisionOf(stdout), 'allow', 'non-shell tools must not be blocked');
});

test('hook preserves Claude-shape behaviour', () => {
  const mutating = run(HOOK, {
    hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'az group delete -n x' }, cwd: '.',
  });
  assert.equal(decisionOf(mutating.stdout), 'deny');
  const readOnly = run(HOOK, {
    hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'git status' }, cwd: '.',
  });
  assert.equal(decisionOf(readOnly.stdout), 'allow');
});

function checkedHookDecision(payload) {
  const { code, stdout, stderr } = run(HOOK, payload);
  assert.equal(code, 0, 'Claude hook must return a verdict or exit successfully');
  assert.equal(stderr.trim(), '', 'Claude hook must not crash');
  return decisionOf(stdout);
}

for (const wrapper of ['tool_input', 'toolArgs']) {
  for (const field of ['command', 'script', 'cmd', 'input']) {
    test(`hook preserves ${wrapper}.${field} command classification`, () => {
      const payload = { toolName: 'Bash', cwd: '.' };
      assert.equal(checkedHookDecision({
        ...payload, [wrapper]: { [field]: 'az group list' },
      }), 'allow');
      assert.equal(checkedHookDecision({
        ...payload, [wrapper]: { [field]: 'az group delete -n x' },
      }), 'deny');
    });
  }
}

for (const toolName of ['run', 'command', 'process', 'spawn', 'mcp.run', 'mcp.sh']) {
  test(`hook fails closed for unreadable ${toolName} commands`, () => {
    assert.equal(checkedHookDecision({ toolName, toolArgs: {} }), 'deny');
    assert.equal(checkedHookDecision({ toolName, toolArgs: { cmd: 17 } }), 'deny');
    assert.equal(checkedHookDecision({ toolName, toolArgs: { input: 'az group list' } }), 'allow');
    assert.equal(checkedHookDecision({ toolName, toolArgs: { input: 'az group delete -n x' } }), 'deny');
  });
}

test('hook never treats generic non-shell input as a command', () => {
  for (const toolName of ['Read', 'Write', 'Edit', 'search_commands']) {
    assert.equal(checkedHookDecision({
      toolName, toolArgs: { input: 'az group delete -n x' },
    }), 'allow');
  }
});

test('hook preserves an explicitly empty command', () => {
  assert.equal(checkedHookDecision({ toolName: 'Bash', tool_input: { command: '' } }), 'allow');
});
