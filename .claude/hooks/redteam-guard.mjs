#!/usr/bin/env node
/**
 * redteam-guard.mjs — Claude Code adapter for the platform-neutral red team guard.
 *
 * Registered in .claude/settings.json for two events:
 *   - SessionStart: injects the read-only posture banner as additionalContext.
 *   - PreToolUse (matcher "Bash"): evaluates every shell command and DENIES anything
 *     that is not provably read-only (and ASKs for mutating commands in
 *     controlled-validation mode), reproducing the Copilot extension exactly.
 *
 * Wire contract (Claude Code):
 *   stdin  -> { hook_event_name, tool_name, tool_input: { command }, cwd, ... }
 *   stdout -> { hookSpecificOutput: { hookEventName, permissionDecision, permissionDecisionReason } }
 *             for SessionStart: { hookSpecificOutput: { hookEventName, additionalContext } }
 *
 * Decision mapping:
 *   guard "deny" -> permissionDecision "deny"
 *   guard "ask"  -> permissionDecision "ask"
 *   guard "allow"-> exit 0 with NO output (no opinion; normal permission flow applies),
 *                   matching the Copilot extension's "return undefined" semantics.
 *
 * SECURITY: fails CLOSED. Any thrown error or unparseable stdin yields an explicit
 * deny — never a silent allow.
 */

import { decideSafe, READONLY_BANNER } from '../../guardrails/guard.mjs';

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function denyOutput(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
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

async function main() {
  const raw = await readStdin();

  let input;
  try {
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    // Fail closed: we received something we could not parse, so we cannot prove the
    // command is read-only.
    emit(
      denyOutput(
        'Red team guardrail received malformed hook input from Claude Code, so the command ' +
          'was blocked (fail-closed). Re-run a clearly read-only Azure command.',
      ),
    );
    return;
  }

  const event = input.hook_event_name || input.hookEventName;

  if (event === 'SessionStart') {
    emit({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: READONLY_BANNER,
      },
    });
    return;
  }

  // PreToolUse (Bash). Normalize Claude's payload into the neutral guard schema.
  const toolInput = input.tool_input || {};
  const command =
    typeof toolInput.command === 'string'
      ? toolInput.command
      : typeof toolInput === 'string'
        ? toolInput
        : toolInput;
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const toolName = input.tool_name || 'bash';

  const { decision, reason } = decideSafe({ command, cwd, toolName });

  if (decision === 'deny' || decision === 'ask') {
    emit({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    });
    return;
  }

  // allow: stay silent so Claude Code's normal permission flow applies.
  process.exit(0);
}

main().catch(() => {
  // Last-resort fail-closed guard: any unexpected error denies.
  emit(
    denyOutput(
      'Red team guardrail crashed while evaluating this command, so it was blocked ' +
        '(fail-closed). Report this guardrail error.',
    ),
  );
});
