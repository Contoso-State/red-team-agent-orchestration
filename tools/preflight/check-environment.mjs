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
import { dirname, join } from "node:path";

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

// ---- environment probes ------------------------------------------------------

const IS_WIN = process.platform === "win32";

// `az` is `az.cmd` on Windows, so it must be resolved through the shell there.
// All arguments below are static literals (no caller/user input), so enabling the
// shell introduces no injection surface.
async function az(args) {
  return pexec("az", args, { shell: IS_WIN, windowsHide: true, timeout: 90_000 });
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
  return [node, azInstalled, azLogin, rgExt, checkEngagementFile()];
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
