#!/usr/bin/env node
/**
 * redteam-guard.mjs — OpenAI Codex adapter for the platform-neutral red team guard.
 *
 * Registered in .codex/hooks.json for three events:
 *   - SessionStart:      injects the read-only posture banner as additionalContext.
 *   - PreToolUse:        evaluates every tool call (matcher "*") and BLOCKS anything
 *                        that is not provably read-only, reproducing the Copilot
 *                        extension, the Claude hook, and the Cursor hook exactly.
 *   - PermissionRequest: the same evaluation on the approval path, so a command that
 *                        slips past (or is escalated to) an approval prompt is still
 *                        blocked when it is not read-only.
 *
 * Codex hooks are Claude-compatible by design (the engine is literally named
 * `ClaudeHooksEngine`), so the stdin payload mirrors Claude Code:
 *   stdin  -> { hook_event_name, tool_name, tool_input: { command }, cwd, ... }
 *
 * SECURITY — Codex FAILS OPEN in two ways that Claude does not, so this adapter must
 * NOT reuse Claude's JSON-only deny:
 *   1. A `permissionDecision: "ask"` on PreToolUse is treated as *allow* by Codex
 *      (unsupported decision -> fails open). So we never emit "ask" — we BLOCK instead.
 *   2. Any non-zero exit code OTHER than 2 fails open (just a "Failed" status, no block).
 *
 * The one robust, fail-closed block that Codex honours for BOTH PreToolUse and
 * PermissionRequest is: write the reason to STDERR and `exit 2`. So:
 *   guard "deny" -> stderr + exit 2   (block)
 *   guard "ask"  -> stderr + exit 2   (block — Codex has no honoured interactive "ask"
 *                                      on PreToolUse; treat the controlled-validation /
 *                                      external-active / cluster-active escalation as a
 *                                      hard block under Codex rather than a silent allow)
 *   guard "allow"-> exit 0, no output (no opinion; normal Codex approval flow applies)
 *   malformed stdin / any thrown error -> stderr + exit 2 (NEVER exit 1, which fails open)
 *
 * SessionStart and any non-decision event exit 0 after emitting the banner (or nothing),
 * because blocking the session lifecycle would break Codex, not protect Azure.
 */

import { decideSafe, READONLY_BANNER } from '../../guardrails/guard.mjs';

// Decision events where a non-read-only action must be blocked. Every other event
// (SessionStart, PostToolUse, Stop, ...) is lifecycle-only and must never block.
const DECISION_EVENTS = new Set(['PreToolUse', 'PermissionRequest']);

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// The ONLY block Codex honours for PreToolUse + PermissionRequest: reason on stderr,
// exit code exactly 2. Used for every deny/ask/error/fail-closed branch.
function blockExit2(reason) {
  process.stderr.write(reason + '\n');
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

async function main() {
  const raw = await readStdin();

  let input;
  try {
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    // Fail closed: unparseable input means we cannot prove the action is read-only.
    blockExit2(
      'Red team guardrail received malformed hook input from Codex, so the action was ' +
        'blocked (fail-closed). Re-run a clearly read-only Azure command.',
    );
    return;
  }

  const event = input.hook_event_name || input.hookEventName;

  if (event === 'SessionStart') {
    // Non-blocking lifecycle event: surface the read-only posture as context, exit 0.
    emit({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: READONLY_BANNER,
      },
    });
    process.exit(0);
    return;
  }

  // Only PreToolUse / PermissionRequest gate actions. Any other lifecycle event must
  // pass through silently — blocking it would break Codex without protecting Azure.
  if (!DECISION_EVENTS.has(event)) {
    process.exit(0);
    return;
  }

  // PreToolUse / PermissionRequest. Normalize Codex's (Claude-shaped) payload into the
  // neutral guard schema. Tool calls without a command string (e.g. file reads) resolve
  // to allow because decideSafe only blocks provably-mutating shell/egress/cluster verbs.
  const toolInput = input.tool_input || {};
  const command =
    typeof toolInput.command === 'string'
      ? toolInput.command
      : typeof toolInput === 'string'
        ? toolInput
        : toolInput;
  const cwd = input.cwd || process.env.CODEX_PROJECT_DIR || process.cwd();
  const toolName = input.tool_name || 'shell';

  const { decision, reason } = decideSafe({ command, cwd, toolName });

  if (decision === 'deny' || decision === 'ask') {
    // Both map to a hard block under Codex: "ask" would otherwise fail open on PreToolUse.
    blockExit2(reason);
    return;
  }

  // allow: stay silent and exit 0 so Codex's normal approval flow applies.
  process.exit(0);
}

main().catch(() => {
  // Last-resort fail-closed guard: any unexpected error blocks via stderr + exit 2.
  blockExit2(
    'Red team guardrail crashed while evaluating this action, so it was blocked ' +
      '(fail-closed). Report this guardrail error.',
  );
});
