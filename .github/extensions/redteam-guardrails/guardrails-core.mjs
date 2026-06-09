// Pure, testable guardrail logic for redteam-guardrails.
// Separated from extension.mjs (session wiring) so it can be unit-tested with `node`.
//
// Posture: READ-ONLY by default, enforced as an ALLOWLIST (deny-by-default).
// A command touching Azure (az / azd CLI or Az PowerShell) is permitted ONLY if it is a
// recognized read/query operation. Anything else is treated as a state change and blocked.
// This is deliberately stricter than a denylist so unknown/new mutating verbs fail closed.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Tool names that actually execute shell commands. The hook ONLY inspects these — file
// edit/create/read tools are never treated as commands (prevents scanning file contents).
const EXEC_TOOL =
  /(?:^|[._-])(exec|execute|shell|bash|sh|zsh|pwsh|powershell|cmd|command|run|terminal|process|spawn)(?:[._-]|$)/i;

// ---------------------------------------------------------------------------
// Azure CLI (az / azd)
// ---------------------------------------------------------------------------

// Operation tokens that READ from Azure (or read content to a local file). Matched against the
// az sub-command operation token, allowing `<verb>` and `<verb>-suffix` forms (e.g. list-ip-addresses).
const AZ_READ_OP =
  /^(list|show|get|describe|check|exists|history|versions?|locations|wait|search|query|download|validate|export|preview)(-|$)/i;

// Session / local-tooling commands that are not reads but do NOT touch the target Azure
// resources (auth context, local CLI config, extension install needed for `az graph query`).
const AZ_BENIGN =
  /^azd?\s+(account\s+(show|list|set|get-access-token|clear|list-locations)|login|logout|logoff|config\s+get(\s|$)|cloud\s+(show|list|set)|extension\s+(add|list|show|update)|graph\s+query|version|upgrade(\s|$)|find)\b/i;

// ---------------------------------------------------------------------------
// Azure PowerShell (Verb-AzNoun)
// ---------------------------------------------------------------------------

// PowerShell verbs that READ from Azure. Everything else on an *-Az* cmdlet is denied.
const PS_READ_VERBS = new Set(["get", "find", "search", "test", "measure", "resolve", "export"]);

// Az PowerShell cmdlets that only change auth/session/local context (not target resources).
const PS_BENIGN =
  /^(Connect-AzAccount|Disconnect-AzAccount|Set-AzContext|Select-AzSubscription|Clear-AzContext|Save-AzContext|Import-AzContext|Enable-AzContextAutosave|Disable-AzContextAutosave|Set-AzDefault|Get-AzContext|Get-AzSubscription)$/i;

// ---------------------------------------------------------------------------
// Segmentation + normalization
// ---------------------------------------------------------------------------

export function splitSegments(command) {
  return command
    .split(/\n|;|&&|\|\||\||&|\(|\)|\{|\}|`/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Normalize an executable token: strip surrounding quotes, any path prefix, and a
// Windows/script extension. So `'az'`, "az", az.exe, C:\tools\az.cmd all become `az`,
// and `& 'Remove-AzVM'` resolves to Remove-AzVM. Keeps invocation detection from being
// bypassed by trivially quoting or qualifying the program name.
function normalizeExe(token) {
  return token
    .replace(/^['"]+/, "")
    .replace(/['"]+$/, "")
    .replace(/^.*[\\/]/, "")
    .replace(/\.(exe|cmd|bat|ps1|com)$/i, "");
}

// Leading execution wrappers that run another program. If a segment starts with one, we
// fast-forward to the first Azure invocation token so `timeout 30 az ...`,
// `xargs -I{} az ...`, `env -i FOO=bar az ...`, `watch -n5 az ...` are still evaluated.
const WRAPPERS = new Set([
  "env", "time", "nice", "nohup", "setsid", "stdbuf", "xargs", "timeout", "watch",
]);

function isAzToken(tok) {
  const n = normalizeExe(tok);
  return n === "az" || n === "azd" || /^[A-Za-z]+-Az[A-Za-z0-9]/.test(n);
}

function strip(segment) {
  let s = segment
    .replace(/^[&\s]+/, "") // PowerShell call operator / leading whitespace
    .replace(/^(?:\w+=\S+\s+)*/, "") // leading VAR=value env assignments
    .replace(/^sudo\s+/, "");
  const toks = s.split(/\s+/);
  if (toks.length && WRAPPERS.has(normalizeExe(toks[0]).toLowerCase())) {
    const i = toks.findIndex(isAzToken);
    if (i > 0) s = toks.slice(i).join(" ");
  }
  return s;
}

function firstToken(segment) {
  return normalizeExe(strip(segment).split(/\s+/)[0] || "");
}

export function isAzInvocation(segment) {
  const first = firstToken(segment);
  return first === "az" || first === "azd";
}

export function isAzPwshInvocation(segment) {
  return /^[A-Za-z]+-Az[A-Za-z0-9]/.test(firstToken(segment));
}

// az global options that may precede the command group. Known ones are skipped so a
// read like `az --verbose vm list` / `az -o json account show` isn't mis-denied; an
// UNKNOWN leading flag still fails closed (op stays undefined -> deny).
const AZ_GLOBAL_BOOL = new Set(["--debug", "--verbose", "--only-show-errors", "-h", "--help"]);
const AZ_GLOBAL_VALUE = new Set(["-o", "--output", "--query", "--subscription"]);

export function operationToken(segment) {
  const tokens = strip(segment).split(/\s+/).slice(1);
  const path = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("-")) {
      if (path.length === 0) {
        const key = t.split("=")[0].toLowerCase();
        if (AZ_GLOBAL_VALUE.has(key)) {
          if (!t.includes("=")) i++; // also skip the value token
          continue;
        }
        if (AZ_GLOBAL_BOOL.has(key)) continue;
      }
      break;
    }
    path.push(t.toLowerCase());
  }
  return path[path.length - 1];
}

// ---------------------------------------------------------------------------
// Wrapper / indirection extraction (pwsh -Command "...", bash -c "...", iex, Start-Process,
// -EncodedCommand <base64>). Returns the inner command text(s) so embedded Azure calls are
// evaluated as if they were issued directly.
// ---------------------------------------------------------------------------

function extractInner(command) {
  const found = [];
  let m;

  const wrap =
    /\b(?:pwsh|powershell|pwsh\.exe|powershell\.exe|bash|sh|zsh|cmd|cmd\.exe)\b[^\n]*?(?:-Command|-Commands|-c|\/c|\/k)\s+(['"])([\s\S]*?)\1/gi;
  while ((m = wrap.exec(command)) !== null) found.push(m[2]);

  // Same wrappers but with an UNQUOTED payload (e.g. `cmd /c az group delete -n rg`).
  const wrapBare =
    /\b(?:pwsh|powershell|pwsh\.exe|powershell\.exe|bash|sh|zsh|cmd|cmd\.exe)\b[^\n]*?(?:-Command|-Commands|-c|\/c|\/k)\s+(?!['"])(.+)$/gim;
  while ((m = wrapBare.exec(command)) !== null) found.push(m[1]);

  const iex = /\b(?:Invoke-Expression|iex)\b\s+(['"])([\s\S]*?)\1/gi;
  while ((m = iex.exec(command)) !== null) found.push(m[2]);

  const startProc =
    /\bStart-Process\b\s+(['"]?)([\w.\-]+)\1(?:[^\n]*?-ArgumentList\s+(['"])([\s\S]*?)\3)?/gi;
  while ((m = startProc.exec(command)) !== null) found.push(`${m[2]} ${m[4] || ""}`.trim());

  const enc = /-EncodedCommand\s+([A-Za-z0-9+/=]+)/gi;
  while ((m = enc.exec(command)) !== null) {
    try {
      found.push(Buffer.from(m[1], "base64").toString("utf16le"));
    } catch {
      /* ignore undecodable */
    }
  }
  return found;
}

// Collect the raw command plus any nested wrapper payloads (bounded depth).
export function gatherCommandTexts(command, depth = 3) {
  const seen = new Set();
  const out = [];
  const stack = [[command, depth]];
  while (stack.length) {
    const [cmd, d] = stack.pop();
    if (!cmd || seen.has(cmd)) continue;
    seen.add(cmd);
    out.push(cmd);
    if (d <= 0) continue;
    for (const inner of extractInner(cmd)) stack.push([inner, d - 1]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-segment decision
// ---------------------------------------------------------------------------

// Clean a parsed flag value: strip quotes; a dynamic/non-alpha value (e.g. $VAR,
// "$(...)", or a missing value) is treated as non-GET so it fails closed.
function cleanVal(v) {
  if (v === undefined || v === null || v === "") return "UNSET";
  const s = String(v).replace(/^['"]+/, "").replace(/['"]+$/, "");
  return /^[A-Za-z]+$/.test(s) ? s.toUpperCase() : "DYNAMIC";
}

// Extract the HTTP method from an `az rest` token list. Handles `--method X`,
// `--method=X`, `-m X`, `-m=X`, and attached `-mX`. Returns null if no method flag.
function azRestMethod(toks) {
  for (let i = 1; i < toks.length; i++) {
    const t = toks[i];
    let m = t.match(/^(?:--method|-m)(?:=(.*))?$/i);
    if (m) return cleanVal(m[1] !== undefined ? m[1] : toks[i + 1]);
    m = t.match(/^-m(.+)$/i); // attached short form -mPOST
    if (m && !m[1].startsWith("-")) return cleanVal(m[1]);
  }
  return null;
}

// True if an `az rest` invocation carries a request body (so it defaults to POST).
function hasBodyFlag(toks) {
  return toks
    .slice(1)
    .some((t) => /^--body([=@].*)?$/i.test(t) || /^-b([=@].*)?$/i.test(t) || /^-b\S/.test(t));
}

// Extract the method from an Invoke-AzRestMethod token list, honoring PowerShell
// parameter abbreviation (-M, -Me, -Met, ... -Method) and `:`/`=`/space separators.
function iarmMethod(toks) {
  for (let i = 1; i < toks.length; i++) {
    const m = toks[i].match(/^-M(?:e(?:t(?:h(?:o(?:d)?)?)?)?)?(?:[:=](.*))?$/i);
    if (m) return cleanVal(m[1] !== undefined && m[1] !== "" ? m[1] : toks[i + 1]);
  }
  return null;
}

// Returns a deny reason string if the segment is a non-read Azure operation, else null.
export function violation(segment) {
  // Azure CLI ----------------------------------------------------------------
  if (isAzInvocation(segment)) {
    const norm = strip(segment);
    if (AZ_BENIGN.test(norm)) return null;

    if (/^azd?\s+rest\b/i.test(norm)) {
      const toks = norm.split(/\s+/);
      const method = azRestMethod(toks);
      if (method !== null) {
        return method === "GET" ? null : `az rest --method ${method} is a write operation`;
      }
      if (hasBodyFlag(toks)) return "az rest with a request body defaults to POST (write operation)";
      return null; // no method, no body => default GET
    }

    const op = operationToken(segment);
    if (op && AZ_READ_OP.test(op)) return null;
    return `'az ${op || "<command>"}' is not a recognized read-only operation`;
  }

  // Azure PowerShell ---------------------------------------------------------
  if (isAzPwshInvocation(segment)) {
    const first = firstToken(segment);
    if (PS_BENIGN.test(first)) return null;

    if (/^Invoke-AzRestMethod$/i.test(first)) {
      const method = iarmMethod(segment.split(/\s+/));
      if (method !== null && method !== "GET") {
        return `Invoke-AzRestMethod -Method ${method} is a write operation`;
      }
      return null;
    }

    const verb = first.split("-")[0].toLowerCase();
    if (PS_READ_VERBS.has(verb)) return null;
    return `'${first}' is not a recognized read-only Azure PowerShell cmdlet`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tool-arg + engagement helpers
// ---------------------------------------------------------------------------

export function extractCommand(toolArgs, toolName = "") {
  if (!toolArgs) return "";
  const execLike = !toolName || EXEC_TOOL.test(toolName);
  if (typeof toolArgs === "string") return execLike ? toolArgs : "";
  // Only inspect explicit command fields. NEVER stringify arbitrary args — that would scan
  // file contents from edit/create tools and false-positive on docs that mention az commands.
  const direct = toolArgs.command ?? toolArgs.script ?? toolArgs.cmd;
  if (typeof direct === "string") return direct;
  if (execLike && typeof toolArgs.input === "string") return toolArgs.input;
  return "";
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

// ---------------------------------------------------------------------------
// Top-level decision used by the preToolUse hook.
//   { deny: true,  reason, segment }  -> block (read-only modes)
//   { deny: false, ask: true, ... }   -> require human approval (controlled-validation)
//   { deny: false }                   -> allow
// controlled-validation does NOT silently allow mutations; it downgrades them to an explicit
// human-approval prompt so the read-only guarantee can never be bypassed without intent.
// ---------------------------------------------------------------------------

export function evaluate(toolArgs, cwd, toolName = "") {
  const command = extractCommand(toolArgs, toolName);
  if (!command) return { deny: false };
  const mode = engagementMode(cwd);

  for (const text of gatherCommandTexts(command)) {
    for (const segment of splitSegments(text)) {
      const reason = violation(segment);
      if (reason) {
        if (mode === "controlled-validation") return { deny: false, ask: true, reason, segment };
        return { deny: true, reason, segment };
      }
    }
  }
  return { deny: false };
}
