// Pure, testable guardrail logic for redteam-guardrails.
// Separated from extension.mjs (session wiring) so it can be unit-tested with `node`.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Azure CLI operation verbs that change state. Matched as the az sub-command operation token.
export const MUTATING_OPS = new Set([
  "create", "delete", "update", "set", "add", "remove", "purge", "start", "stop",
  "restart", "deallocate", "redeploy", "reset", "regenerate", "renew", "rotate",
  "import", "restore", "move", "invoke", "run", "run-command", "enable", "disable",
  "assign", "grant", "revoke", "lock", "unlock", "approve", "reject", "generate",
  "attach", "detach", "scale", "upgrade", "install", "uninstall", "replace", "put",
  "patch", "clear", "flush", "cancel", "failover", "promote", "swap", "publish",
  "deploy", "destroy", "down", "up", "provision", "wipe", "reimage",
]);

// Read-only / local-only commands that look mutating but are safe during an engagement.
export const BENIGN = /^azd?\s+(account\s+(show|list|set|get-access-token|clear)|login|logout|config(\s|$)|configure|extension\s+(add|list|show|update)|graph\s+query|version|cloud\s+(list|show))/i;

export function splitSegments(command) {
  return command.split(/\n|;|&&|\|\||\||&|\(|\)/).map((s) => s.trim()).filter(Boolean);
}

function strip(segment) {
  return segment.replace(/^(?:\w+=\S+\s+)*/, "").replace(/^sudo\s+/, "");
}

export function isAzInvocation(segment) {
  const first = strip(segment).split(/\s+/)[0];
  return first === "az" || first === "azd";
}

export function operationToken(segment) {
  const tokens = strip(segment).split(/\s+/).slice(1);
  const path = [];
  for (const t of tokens) {
    if (t.startsWith("-")) break;
    path.push(t.toLowerCase());
  }
  return path[path.length - 1];
}

// Returns a deny reason string if the segment is a forbidden mutation, else null.
export function violation(segment) {
  if (!isAzInvocation(segment)) return null;
  if (BENIGN.test(strip(segment))) return null;

  if (/^azd?\s+rest\b/i.test(segment)) {
    const m = segment.match(/--method\s+(\w+)/i);
    if (m && m[1].toUpperCase() !== "GET") {
      return `az rest --method ${m[1].toUpperCase()} is a write operation`;
    }
    return null;
  }

  const op = operationToken(segment);
  if (op && MUTATING_OPS.has(op)) {
    return `'${op}' is a state-changing Azure operation`;
  }
  return null;
}

export function extractCommand(toolArgs) {
  if (!toolArgs) return "";
  if (typeof toolArgs === "string") return toolArgs;
  return (
    toolArgs.command || toolArgs.script || toolArgs.cmd || toolArgs.input || JSON.stringify(toolArgs)
  );
}

// Read the engagement mode (best-effort, no YAML dependency). Missing file => enforce (safe default).
export function engagementMode(cwd) {
  try {
    const path = join(cwd || ".", "engagement.yaml");
    if (!existsSync(path)) return "read-only-assessment";
    const text = readFileSync(path, "utf8");
    const m = text.match(/^\s*mode:\s*['"]?([\w-]+)['"]?/m);
    return m ? m[1] : "read-only-assessment";
  } catch {
    return "read-only-assessment";
  }
}

// Top-level decision used by the preToolUse hook. Returns { deny: true, reason } or { deny: false }.
export function evaluate(toolArgs, cwd) {
  if (engagementMode(cwd) === "controlled-validation") return { deny: false };
  const command = extractCommand(toolArgs);
  if (!command) return { deny: false };
  for (const segment of splitSegments(command)) {
    const reason = violation(segment);
    if (reason) return { deny: true, reason, segment };
  }
  return { deny: false };
}
