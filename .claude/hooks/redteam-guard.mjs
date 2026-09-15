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
 * SECURITY: fails CLOSED. Unparseable stdin, a thrown error, or a shell tool call
 * whose command cannot be read all yield an explicit deny — never a silent allow.
 */

import { decideSafe, READONLY_BANNER } from '../../guardrails/guard.mjs';

// Tool names that mean "this call runs a command". A call from one of these
// without a readable command string is denied rather than ignored.
const SHELL_TOOL = /(bash|shell|^sh$|zsh|powershell|pwsh|cmd|exec|terminal|run_in_terminal|execute)/i;

// Accept every payload shape known to reach this hook. Returns a string or null
// — never a non-string, so the guard is never asked to classify an object.
function extractCommand(input) {
  const ti = input.tool_input;
  if (ti && typeof ti.command === 'string') return ti.command;
  if (typeof ti === 'string') return ti;
  const ta = input.toolArgs;
  if (typeof ta === 'string') return ta;
  if (ta && typeof ta.command === 'string') return ta.command;
  if (typeof input.command === 'string') return input.command;
  return null;
}

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

  // PreToolUse. Normalize the host payload into the neutral guard schema.
  //
  // More than one runtime reaches this script: Claude Code sends
  // { tool_input: { command } }, while other hosts that discover
  // .claude/settings.json send their own field names. The previous version read
  // only Claude's shape and, when it found nothing, passed the raw object
  // through to the guard, which cannot classify a non-string and answered
  // "allow" — a mutating Azure command in an unrecognized payload was silently
  // permitted. Read every known shape, and never hand a non-string onward.
  const command = extractCommand(input);
  const cwd =
    input.cwd ||
    input.workingDirectory ||
    process.env.CLAUDE_PROJECT_DIR ||
    process.cwd();
  const toolName = input.tool_name || input.toolName || 'bash';

  // An empty string is a readable command that happens to do nothing; the other
  // adapters allow it and parity matters. Only an UNREADABLE command (no string at
  // all) is the dangerous case.
  if (typeof command !== 'string') {
    // A shell-ish tool call whose command we cannot read is exactly the case we
    // must not wave through: we cannot prove it is read-only. Deny. Tool calls
    // that legitimately carry no command (file reads, edits) are not our
    // business and keep the previous no-opinion behaviour.
    if (SHELL_TOOL.test(String(toolName))) {
      emit(
        denyOutput(
          'Red team guardrail could not read the command from this shell tool call, so it ' +
            'was blocked (fail-closed). The guard cannot prove an unreadable command is ' +
            'read-only. Report this guardrail error with the runtime name.',
        ),
      );
      return;
    }
    process.exit(0);
  }

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
