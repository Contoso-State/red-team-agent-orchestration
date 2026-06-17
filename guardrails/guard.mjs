// Platform-neutral red team guard.
//
// Single decision entry point shared by every runtime adapter (Copilot, Claude Code,
// OpenAI Codex, Cursor). It wraps the three pure, unit-tested evaluators in
// guardrails/core/ and reproduces the EXACT decision precedence and fail-closed
// behavior of the Copilot extension (.github/extensions/redteam-guardrails/extension.mjs),
// so a given command yields an identical allow/ask/deny decision on every platform.
//
// Two ways to use it:
//   1. In-process (preferred for adapters + tests):
//        import { decide } from '../guard.mjs';
//        const { decision, reason } = decide({ command, cwd, toolName });
//   2. As a CLI (for platforms that can only invoke a command):
//        echo '{"command":"az vm delete ...","cwd":".","toolName":"bash"}' | node guardrails/guard.mjs
//      -> prints {"decision":"deny","reason":"..."} on stdout and always exits 0.
//
// SECURITY: every code path fails CLOSED. Any thrown error, unparseable input, or
// unexpected shape resolves to a DENY — a control that fails open is no control at all.

import { evaluate, engagementMode } from './core/guardrails-core.mjs';
import { evaluateEgress } from './core/egress-core.mjs';
import { evaluateCluster } from './core/cluster-core.mjs';
import { pathToFileURL } from 'node:url';

// Session-start context banner. Single source of truth shared by every runtime adapter
// (Copilot extension, Claude/Codex/Cursor session-start hooks) so the read-only posture
// is described identically everywhere.
export const READONLY_BANNER =
  'redteam-guardrails active: this is an Azure red team engagement with a READ-ONLY posture. ' +
  'Only read/query Azure commands are permitted (az list/show/get/query, Get-Az*, ' +
  'az rest --method GET). Mutating az/azd/Az PowerShell commands are blocked unless ' +
  'engagement.yaml sets mode: controlled-validation, in which case they require explicit ' +
  'human approval. The orchestrator must dispatch specialist agents — it does not run az itself. ' +
  'Active external probing (curl/nuclei/zap/sqlmap/nikto/httpx/testssl/nmap and similar) against ' +
  'public hosts is BLOCKED by default and only permitted for the External Vulnerability Agent ' +
  '(EVA) when the engagement is in mode: external-active-testing with external_testing enabled + ' +
  'authorized, and only against hosts on the Azure-derived allowlist ' +
  '(engagements/<session>/scope/external-targets.json). ' +
  'Reaching INTO a live cluster or container (kubectl exec/debug/cp/attach/port-forward/run, ' +
  'kube-bench, kubesec, trivy, grype, crictl, docker/nerdctl/podman run|exec) is BLOCKED by ' +
  'default and only permitted for the Azure Container & Kubernetes Agent when the engagement is ' +
  'in mode: cluster-active-testing with cluster_testing enabled + authorized, and only against ' +
  'clusters/registries on the Azure-derived cluster allowlist ' +
  '(engagements/<session>/scope/cluster-targets.json). Mutating kubectl/helm/runtime commands ' +
  'are blocked in EVERY mode; read-only kubectl (get/describe/logs/auth can-i) is always allowed.';

const FAIL_CLOSED_READONLY =
  'Red team guardrail could not evaluate this command, so it was blocked to ' +
  'preserve the read-only guarantee (fail-closed). Re-run a clearly read-only ' +
  'Azure command (list/show/get/query/Get-Az*), or report this guardrail error.';

const FAIL_CLOSED_EGRESS =
  'Red team egress guardrail could not evaluate this command, so it was blocked ' +
  '(fail-closed) to preserve the External Vulnerability Agent scope lock. Active ' +
  'external probing is only permitted against the Azure-derived allowlist under an ' +
  'authorized external-active-testing engagement.';

const FAIL_CLOSED_CLUSTER =
  'Red team cluster guardrail could not evaluate this command, so it was blocked ' +
  '(fail-closed) to preserve the read-only Kubernetes posture and the cluster-active ' +
  'scope lock. Use read-only kubectl (get/describe/logs/auth can-i), or run cluster-active ' +
  'tools only under an authorized cluster-active-testing engagement.';

const FAIL_CLOSED_INPUT =
  'Red team guardrail received malformed input, so the command was blocked (fail-closed). ' +
  'Expected JSON {"command": "...", "cwd": "...", "toolName": "..."} on stdin.';

// Normalize the neutral wire payload into the shape the evaluators expect. `command`
// may be a raw string or an object with command/script/cmd/input — extractCommand in
// guardrails-core handles both, so we pass it straight through.
function toToolArgs(command) {
  if (command == null) return '';
  if (typeof command === 'string') return { command };
  return command;
}

/**
 * Decide allow/ask/deny for a single tool invocation.
 * @param {{command?: string|object, cwd?: string, toolName?: string}} input
 * @returns {{decision: 'allow'|'ask'|'deny', reason: string}}
 */
export function decide(input = {}) {
  const cwd = input?.cwd || '.';
  const toolName = input?.toolName || '';
  const toolArgs = toToolArgs(input?.command);

  // 1) Read-only matcher. Computed first; applied last (egress/cluster denials take
  //    precedence). A throw here means we cannot prove read-only -> deny.
  let decision;
  try {
    decision = evaluate(toolArgs, cwd, toolName);
  } catch {
    return { decision: 'deny', reason: FAIL_CLOSED_READONLY };
  }

  // 2) External Vulnerability Agent (EVA) egress scope lock.
  let egress;
  try {
    egress = evaluateEgress(toolArgs, cwd, toolName);
  } catch {
    return { decision: 'deny', reason: FAIL_CLOSED_EGRESS };
  }
  if (egress && egress.deny) {
    return {
      decision: 'deny',
      reason:
        `External Vulnerability Agent scope lock: ${egress.reason}. ` +
        `Blocked: \`${egress.segment}\`. EVA may only probe hosts on the Azure-derived ` +
        `allowlist (engagements/<session>/scope/external-targets.json) under an authorized ` +
        `external-active-testing engagement.`,
    };
  }

  // 3) Azure Container & Kubernetes Agent cluster scope lock.
  let cluster;
  try {
    cluster = evaluateCluster(toolArgs, cwd, toolName);
  } catch {
    return { decision: 'deny', reason: FAIL_CLOSED_CLUSTER };
  }
  if (cluster && cluster.deny) {
    return {
      decision: 'deny',
      reason:
        `Azure Container & Kubernetes Agent cluster lock: ${cluster.reason}. ` +
        `Blocked: \`${cluster.segment}\`. Mutating kubectl/helm/runtime commands are denied in ` +
        `every mode; reaching into a live cluster/container is only permitted against the ` +
        `Azure-derived cluster allowlist (engagements/<session>/scope/cluster-targets.json) ` +
        `under an authorized cluster-active-testing engagement.`,
    };
  }

  // 4) Apply the read-only decision (ask in controlled-validation, otherwise deny).
  if (!decision || (!decision.deny && !decision.ask)) {
    return { decision: 'allow', reason: '' };
  }

  const mode = engagementMode(cwd);

  if (decision.ask) {
    return {
      decision: 'ask',
      reason:
        `controlled-validation mode: this is a state-changing Azure operation ` +
        `(${decision.reason}). Approve only if explicitly authorized in the engagement scope. ` +
        `Command: \`${decision.segment}\``,
    };
  }

  return {
    decision: 'deny',
    reason:
      `Red team engagement is in '${mode}' mode (read-only). ${decision.reason}. ` +
      `Blocked: \`${decision.segment}\`. Use a read-only equivalent (list/show/get/query/Get-Az*), ` +
      `or set mode: controlled-validation in engagement.yaml if this action is explicitly authorized.`,
  };
}

// Resolve a neutral decision while never throwing — used by the CLI so malformed
// stdin still yields an explicit deny rather than a crash (which some platforms,
// notably Cursor, would treat as fail-open).
export function decideSafe(input) {
  try {
    return decide(input);
  } catch {
    return { decision: 'deny', reason: FAIL_CLOSED_READONLY };
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

async function main() {
  const raw = await readStdin();
  let parsed;
  try {
    parsed = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    process.stdout.write(JSON.stringify({ decision: 'deny', reason: FAIL_CLOSED_INPUT }) + '\n');
    return;
  }
  const result = decideSafe(parsed);
  process.stdout.write(JSON.stringify(result) + '\n');
}

// Run as CLI only when invoked directly (not when imported by an adapter or test).
const isDirect =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  await main();
}
