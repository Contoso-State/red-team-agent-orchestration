#!/usr/bin/env node
// tools/preflight/check-environment.mjs
//
// Environment doctor for the Azure Red Team Agent Orchestration toolkit.
// Run this right after cloning, BEFORE your first assessment, to confirm your
// machine has everything the team needs:
//
//   - Node.js >= 22.5      (the engagement datastore uses the built-in node:sqlite)
//   - Azure CLI installed  (every domain agent runs read-only `az` queries)
//   - Azure CLI signed in  (`az login`)
//   - resource-graph ext   (inventory + scope brief run `az graph query`)
//   - engagement.yaml       (your scope file — created by /setup)
//
// It also reports (informational, never a blocker) which optional EVA external
// scanners (nuclei/httpx/testssl/nikto/whatweb/zap/sqlmap/semgrep) are on PATH and
// therefore which active External Vulnerability Agent tiers are available. It likewise
// reports which optional auxiliary OSS security tools (ScoutSuite, kube-bench, kubesec,
// trivy/grype, gitleaks, cartography) referenced by the harvested methodology are present
// for offline posture/IaC/secret analysis.
//
// READ-ONLY: this only *reads* tool versions and your signed-in account. It runs
// `az version`, `az account show`, and `az extension show` (all read/query) and
// touches no Azure resources. It mutates nothing and stores nothing.
//
// Usage:
//   node tools/preflight/check-environment.mjs          # human-readable report
//   node tools/preflight/check-environment.mjs --json   # machine-readable JSON
//
// Exit code: 0 if every REQUIRED check passes, 1 otherwise (so it can gate CI).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, delimiter } from "node:path";

const pexec = promisify(execFile);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIN_NODE = { major: 22, minor: 5 }; // node:sqlite landed in 22.5.0

// ---- pure helpers (unit-tested in check-environment.test.mjs) ----------------

/** Parse "v22.5.1" / "22.5" / "22" into {major, minor}. Returns null if unparseable. */
export function parseNodeVersion(raw) {
  if (typeof raw !== "string") return null;
  const m = raw.trim().replace(/^v/i, "").match(/^(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return { major: Number(m[1]), minor: m[2] === undefined ? 0 : Number(m[2]) };
}

/** True if `version` (a {major,minor}) is >= `min` ({major,minor}). */
export function meetsMinimum(version, min) {
  if (!version) return false;
  if (version.major !== min.major) return version.major > min.major;
  return version.minor >= min.minor;
}

// The optional external scanners EVA can orchestrate, mapped to the executable name
// probed on PATH. safe-active needs none (the built-in prober is dependency-free).
export const EVA_TOOLS = {
  nuclei: "nuclei",
  httpx: "httpx",
  testssl: "testssl.sh",
  nikto: "nikto",
  whatweb: "whatweb",
  zap: "zap-baseline.py",
  sqlmap: "sqlmap",
  semgrep: "semgrep",
};

/**
 * Given the set/array of EVA tool keys found on PATH, report which EVA tiers are available.
 * - safe-active is ALWAYS available (dependency-free built-in prober).
 * - active-dast needs at least one network scanner.
 * - exploit-validation needs sqlmap (the only bundled exploit-grade tool).
 * - static-analysis needs semgrep (OFFLINE).
 * Pure + unit-tested.
 */
export function evaTiersFromTools(present) {
  const have = new Set(Array.isArray(present) ? present : [...(present ?? [])]);
  const dastTools = ["nuclei", "httpx", "testssl", "nikto", "whatweb", "zap"];
  return {
    "safe-active": true,
    "active-dast": dastTools.some((t) => have.has(t)),
    "exploit-validation": have.has("sqlmap"),
    "static-analysis": have.has("semgrep"),
  };
}

// Optional auxiliary OSS security tools referenced by the harvested methodology
// (knowledge/oauth-saml-jwt.md, kubernetes/container/posture knowledge). These are
// INFORMATIONAL ONLY: presence never gates a run and nothing is ever auto-installed.
// Each key maps to one or more candidate executables probed on PATH (any match counts);
// trivy OR grype satisfies the container/IaC vuln-scanner slot.
export const OPTIONAL_SECURITY_TOOLS = {
  scoutsuite: ["scout"],          // ScoutSuite multi-cloud security auditor (CLI: `scout`)
  "kube-bench": ["kube-bench"],   // CIS Kubernetes benchmark
  kubesec: ["kubesec"],           // Kubernetes manifest risk scoring
  trivy: ["trivy", "grype"],      // container / IaC vulnerability scanner (trivy, or grype)
  gitleaks: ["gitleaks"],         // secret scanning
  cartography: ["cartography"],   // cloud asset inventory graph
};

/**
 * Given the set/array of executable names found on PATH, return the keys of the optional
 * security tools that are present (a tool is present if ANY of its candidate executables
 * is on PATH). Pure + unit-tested.
 */
export function presentOptionalTools(present) {
  const have = new Set(Array.isArray(present) ? present : [...(present ?? [])]);
  return Object.entries(OPTIONAL_SECURITY_TOOLS)
    .filter(([, exes]) => exes.some((e) => have.has(e)))
    .map(([k]) => k);
}

// ---- environment probes ------------------------------------------------------

const IS_WIN = process.platform === "win32";

// `az` ships as `az.cmd` on Windows and can only be launched through a shell there. Passing an
// args[] array together with `shell:true` is deprecated (Node DEP0190) because the arguments are
// concatenated without escaping — an injection surface. We therefore fold the arguments into a
// single, individually-quoted command string and spawn WITHOUT an args array (no DEP0190), and on
// POSIX we run az directly with no shell at all. Every argument here is a static literal; the
// quoting is defense-in-depth.
function quoteShellArg(value) {
  const s = String(value);
  const safe = IS_WIN ? /^[A-Za-z0-9_.:@+=/\\-]+$/ : /^[A-Za-z0-9_.:@+=/-]+$/;
  if (safe.test(s)) return s;
  return IS_WIN ? `"${s.replace(/"/g, '""')}"` : `'${s.replace(/'/g, `'\\''`)}'`;
}

async function az(args) {
  if (IS_WIN) {
    const command = ["az", ...args].map(quoteShellArg).join(" ");
    return pexec(command, { shell: true, windowsHide: true, timeout: 90_000 });
  }
  return pexec("az", args, { windowsHide: true, timeout: 90_000 });
}

async function checkNode() {
  const v = parseNodeVersion(process.versions.node);
  const ok = meetsMinimum(v, MIN_NODE);
  return {
    name: "Node.js >= 22.5",
    required: true,
    ok,
    detail: `found v${process.versions.node}`,
    remedy: ok
      ? null
      : `Install Node.js ${MIN_NODE.major}.${MIN_NODE.minor}+ (the datastore needs the built-in node:sqlite). See https://nodejs.org/`,
  };
}

async function checkAzInstalled() {
  try {
    const { stdout } = await az(["version", "-o", "json"]);
    let ver = "unknown";
    try { ver = JSON.parse(stdout)["azure-cli"] ?? "unknown"; } catch { /* keep unknown */ }
    return { name: "Azure CLI installed", required: true, ok: true, detail: `az ${ver}` };
  } catch (err) {
    const missing = err?.code === "ENOENT";
    return {
      name: "Azure CLI installed",
      required: true,
      ok: false,
      detail: missing ? "`az` not found on PATH" : `az version failed: ${oneLine(err)}`,
      remedy: "Install the Azure CLI: https://learn.microsoft.com/cli/azure/install-azure-cli",
    };
  }
}

async function checkAzLogin() {
  try {
    const { stdout } = await az(["account", "show", "-o", "json"]);
    const a = JSON.parse(stdout);
    return {
      name: "Azure CLI signed in",
      required: true,
      ok: true,
      detail: `${a.name} (${a.id}) as ${a.user?.name ?? a.user?.type ?? "unknown"}`,
    };
  } catch {
    return {
      name: "Azure CLI signed in",
      required: true,
      ok: false,
      detail: "no active Azure session",
      remedy: "Run `az login` (or `az login --use-device-code` on a headless host).",
    };
  }
}

async function checkResourceGraphExtension() {
  try {
    await az(["extension", "show", "--name", "resource-graph", "-o", "json"]);
    return { name: "resource-graph extension", required: true, ok: true, detail: "installed" };
  } catch {
    return {
      name: "resource-graph extension",
      required: true,
      ok: false,
      detail: "not installed (inventory + scope brief use `az graph query`)",
      remedy: "Install it once: `az extension add --name resource-graph`",
    };
  }
}

function checkEngagementFile() {
  const ok = existsSync(join(REPO_ROOT, "engagement.yaml"));
  return {
    name: "engagement.yaml present",
    required: false, // /setup creates it; not a blocker for the doctor itself
    ok,
    detail: ok ? "scope file found" : "not created yet",
    remedy: ok ? null : "Run `/setup`, or `cp engagement.example.yaml engagement.yaml` and edit it.",
  };
}

/** True if an executable named `name` is found on PATH (honors PATHEXT on Windows). Reads fs only. */
export function commandOnPath(name, env = process.env, isWin = IS_WIN) {
  const path = env.PATH || env.Path || "";
  if (!path) return false;
  const dirs = path.split(delimiter).filter(Boolean);
  const exts = isWin ? (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  for (const dir of dirs) {
    if (existsSync(join(dir, name))) return true; // exact name (covers *.sh / *.py / unix)
    if (isWin) {
      for (const ext of exts) {
        if (existsSync(join(dir, name + ext)) || existsSync(join(dir, name + ext.toLowerCase()))) return true;
      }
    }
  }
  return false;
}

// Optional: detect which EVA external scanners are installed and report available tiers.
// Never required — EVA is off by default and its Tier-1 prober is dependency-free.
function checkExternalTools() {
  const present = Object.keys(EVA_TOOLS).filter((k) => commandOnPath(EVA_TOOLS[k]));
  const tiers = evaTiersFromTools(present);
  const available = Object.entries(tiers).filter(([, v]) => v).map(([k]) => k);
  const detail = present.length
    ? `installed: ${present.join(", ")} -> tiers: ${available.join(", ")}`
    : "no external scanners on PATH -> tiers: safe-active (built-in prober only)";
  return {
    name: "EVA external scanners",
    required: false, // EVA is opt-in; missing scanners only limit which active tiers are available
    ok: true,        // informational — never a blocker
    detail,
    eva_tools_present: present,
    eva_tiers_available: available,
    remedy: present.length
      ? null
      : "Optional: install nuclei/httpx/testssl.sh/nikto/whatweb/zap/sqlmap/semgrep to unlock active EVA tiers.",
  };
}

// Optional: detect auxiliary OSS security tools referenced by the harvested methodology
// (cloud posture, Kubernetes, container/IaC, secret scanning, asset graph). Informational
// only — never required, never auto-installed; their absence only means that offline
// analysis tooling isn't locally available. Read-only presence checks on PATH.
function checkOptionalSecurityTools() {
  const onPath = new Set();
  for (const exes of Object.values(OPTIONAL_SECURITY_TOOLS)) {
    for (const e of exes) if (commandOnPath(e)) onPath.add(e);
  }
  const present = presentOptionalTools(onPath);
  const detail = present.length
    ? `installed: ${present.join(", ")}`
    : "none on PATH (optional — used only for offline posture / IaC / secret analysis)";
  return {
    name: "Optional security tools",
    required: false, // purely informational; never blocks the doctor
    ok: true,
    detail,
    optional_tools_present: present,
    remedy: present.length
      ? null
      : "Optional: install scoutsuite/kube-bench/kubesec/trivy(or grype)/gitleaks/cartography for offline posture analysis.",
  };
}

function oneLine(err) {
  return String(err?.stderr || err?.message || err).split("\n")[0].slice(0, 160);
}

// ---- runner ------------------------------------------------------------------

export async function runChecks() {
  // az probes run in parallel; `az account show` / `az extension show` each fail
  // cleanly on their own if az is missing, so parallel execution is safe.
  const [node, azInstalled, azLogin, rgExt] = await Promise.all([
    checkNode(),
    checkAzInstalled(),
    checkAzLogin(),
    checkResourceGraphExtension(),
  ]);
  return [node, azInstalled, azLogin, rgExt, checkEngagementFile(), checkExternalTools(), checkOptionalSecurityTools()];
}

function render(results) {
  const mark = (r) => (r.ok ? "[ OK ]" : r.required ? "[FAIL]" : "[WARN]");
  const color = (r, s) =>
    process.stdout.isTTY
      ? (r.ok ? `\x1b[32m${s}\x1b[0m` : r.required ? `\x1b[31m${s}\x1b[0m` : `\x1b[33m${s}\x1b[0m`)
      : s;
  console.log("\nAzure Red Team — environment check\n");
  for (const r of results) {
    console.log(`${color(r, mark(r))} ${r.name.padEnd(26)} ${r.detail}`);
    if (!r.ok && r.remedy) console.log(`       remedy: ${r.remedy}`);
  }
  const reqFails = results.filter((r) => r.required && !r.ok);
  const warns = results.filter((r) => !r.required && !r.ok);
  console.log("");
  if (reqFails.length === 0 && warns.length === 0) {
    console.log(color({ ok: true }, "All checks passed — you're ready. Next: run /setup (or /recon if engagement.yaml exists)."));
  } else if (reqFails.length === 0) {
    console.log(color({ ok: false, required: false }, `Ready, with ${warns.length} note(s) above. Next: run /setup.`));
  } else {
    console.log(color({ ok: false, required: true }, `${reqFails.length} required check(s) failed — resolve the items above, then re-run this doctor.`));
  }
  console.log("");
}

async function main() {
  const json = process.argv.includes("--json");
  const results = await runChecks();
  if (json) {
    console.log(JSON.stringify({ ready: results.every((r) => r.ok || !r.required), checks: results }, null, 2));
  } else {
    render(results);
  }
  process.exit(results.some((r) => r.required && !r.ok) ? 1 : 0);
}

// Only run when invoked directly (allows importing the pure helpers for tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`environment check crashed: ${err?.stack || err}`);
    process.exit(1);
  });
}
