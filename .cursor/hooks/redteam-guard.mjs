#!/usr/bin/env node
/**
 * redteam-guard.mjs — Cursor adapter for the platform-neutral red team guard.
 *
 * Registered in .cursor/hooks.json for two events:
 *   - beforeShellExecution: evaluates every terminal command and DENIES anything that is
 *     not provably read-only (ASK for mutating commands in controlled-validation mode),
 *     reproducing the Copilot extension and Claude hook exactly.
 *   - beforeMCPExecution: the shell-oriented engine cannot prove an arbitrary MCP tool
 *     call is read-only, so under the read-only engagement posture every MCP call is
 *     surfaced for explicit human approval (ASK) rather than allowed.
 *
 * Wire contract (Cursor hooks):
 *   beforeShellExecution stdin -> { command, cwd, sandbox, hook_event_name, ... }
 *   beforeMCPExecution   stdin -> { tool_name, tool_input, command|url, hook_event_name, ... }
 *   stdout -> { permission: "allow"|"deny"|"ask", user_message, agent_message }
 *
 * SECURITY — Cursor FAILS OPEN: any exit code other than 0/2 lets the action through, and
 * by default a crash/timeout/invalid-JSON is treated as allow. This adapter therefore:
 *   - always writes an explicit decision to stdout (never relies on a crash to block),
 *   - on ANY error or malformed input writes an explicit deny AND exits 2 (Cursor treats
 *     exit 2 as deny even if stdout is unreadable),
 *   - is registered with "failClosed": true in .cursor/hooks.json as a third layer.
 */

import { decideSafe } from '../../guardrails/guard.mjs';

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// Explicit, belt-and-suspenders block: write deny JSON, then exit 2 so Cursor blocks
// even if it ignores stdout on this path. Used for every error/fail-closed branch.
function denyAndBlock(reason) {
  emit({ permission: 'deny', user_message: reason, agent_message: reason });
  process.exit(2);
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

function isMcpEvent(input) {
  const event = input.hook_event_name || input.hookEventName || '';
  if (event === 'beforeMCPExecution') return true;
  if (event === 'beforeShellExecution') return false;
  // No/unknown event name: treat as MCP when it looks like an MCP payload (has a tool
  // name and no plain shell command string), otherwise shell.
  return Boolean(input.tool_name) && typeof input.command !== 'string';
}

async function main() {
  const raw = await readStdin();

  let input;
  try {
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    denyAndBlock(
      'redteam-guardrails received malformed hook input from Cursor, so the action was ' +
        'blocked (fail-closed). Re-run a clearly read-only Azure command.',
    );
    return;
  }

  if (isMcpEvent(input)) {
    // We cannot classify an arbitrary MCP tool action with the shell-command engine.
    // The engagement is read-only, so surface it for explicit human review rather than
    // allow it unverified.
    const tool = input.tool_name || 'unknown MCP tool';
    const msg =
      `redteam-guardrails cannot verify the MCP tool call "${tool}" is read-only. ` +
      `This is a read-only Azure red team engagement, so the call is surfaced for your ` +
      `explicit approval — approve only read/list/get/describe operations, and deny anything ` +
      `that creates, updates, deletes, or otherwise changes Azure or cluster state.`;
    emit({ permission: 'ask', user_message: msg, agent_message: msg });
    return;
  }

  // beforeShellExecution. Normalize Cursor's payload into the neutral guard schema.
  // decideSafe/extractCommand tolerate non-string commands (they fail closed), so pass
  // input.command straight through.
  const command = input.command;
  const cwd =
    input.cwd ||
    (Array.isArray(input.workspace_roots) ? input.workspace_roots[0] : '') ||
    process.cwd();
  const { decision, reason } = decideSafe({ command, cwd, toolName: 'shell' });

  if (decision === 'deny') {
    // Clean deny path: exit 0 with the JSON so Cursor surfaces user_message/agent_message.
    emit({ permission: 'deny', user_message: reason, agent_message: reason });
    return;
  }
  if (decision === 'ask') {
    emit({ permission: 'ask', user_message: reason, agent_message: reason });
    return;
  }
  // allow: Cursor expects an explicit permission for these hooks.
  emit({ permission: 'allow' });
}

main().catch(() => {
  // Last-resort fail-closed guard: any unexpected error denies AND exits 2.
  denyAndBlock(
    'redteam-guardrails crashed while evaluating this action, so it was blocked ' +
      '(fail-closed). Report this guardrail error.',
  );
});
