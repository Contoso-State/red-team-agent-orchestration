// Unit tests for the environment doctor's pure version logic.
// Run: node tools/preflight/check-environment.test.mjs
import assert from "node:assert";
import { parseNodeVersion, meetsMinimum, evaTiersFromTools, commandOnPath } from "./check-environment.mjs";

let pass = 0;
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); pass++; };
const ok = (v, msg) => { assert.ok(v, msg); pass++; };

// --- parseNodeVersion ---
eq(parseNodeVersion("v22.5.1"), { major: 22, minor: 5 }, "leading v + patch");
eq(parseNodeVersion("22.5"), { major: 22, minor: 5 }, "no v, no patch");
eq(parseNodeVersion("24"), { major: 24, minor: 0 }, "major only -> minor 0");
eq(parseNodeVersion("v25.2.1"), { major: 25, minor: 2 }, "current runtime");
eq(parseNodeVersion("  v20.11.0 "), { major: 20, minor: 11 }, "whitespace trimmed");
eq(parseNodeVersion("nope"), null, "garbage -> null");
eq(parseNodeVersion(""), null, "empty -> null");
eq(parseNodeVersion(undefined), null, "undefined -> null");

// --- meetsMinimum (min = 22.5) ---
const MIN = { major: 22, minor: 5 };
ok(meetsMinimum({ major: 22, minor: 5 }, MIN), "exact match passes");
ok(meetsMinimum({ major: 22, minor: 6 }, MIN), "higher minor passes");
ok(meetsMinimum({ major: 25, minor: 0 }, MIN), "higher major passes even with lower minor");
ok(meetsMinimum({ major: 23, minor: 0 }, MIN), "next major passes");
ok(!meetsMinimum({ major: 22, minor: 4 }, MIN), "lower minor fails");
ok(!meetsMinimum({ major: 21, minor: 99 }, MIN), "lower major fails");
ok(!meetsMinimum({ major: 18, minor: 0 }, MIN), "LTS 18 fails (no node:sqlite)");
ok(!meetsMinimum(null, MIN), "null version fails closed");

// --- evaTiersFromTools ---
eq(evaTiersFromTools([]), { "safe-active": true, "active-dast": false, "exploit-validation": false, "static-analysis": false }, "no tools -> only safe-active");
eq(evaTiersFromTools(["nuclei"])["active-dast"], true, "nuclei unlocks active-dast");
eq(evaTiersFromTools(["whatweb"])["active-dast"], true, "whatweb unlocks active-dast");
eq(evaTiersFromTools(["sqlmap"])["exploit-validation"], true, "sqlmap unlocks exploit-validation");
eq(evaTiersFromTools(["sqlmap"])["active-dast"], false, "sqlmap alone does not unlock active-dast");
eq(evaTiersFromTools(["semgrep"])["static-analysis"], true, "semgrep unlocks static-analysis");
eq(evaTiersFromTools(["semgrep"])["active-dast"], false, "semgrep alone does not unlock active-dast");
ok(evaTiersFromTools(new Set(["httpx"]))["active-dast"], "accepts a Set");
eq(evaTiersFromTools(["semgrep", "nuclei", "sqlmap"]), { "safe-active": true, "active-dast": true, "exploit-validation": true, "static-analysis": true }, "all tiers unlocked");

// --- commandOnPath ---
ok(!commandOnPath("definitely-not-a-real-tool-xyz"), "missing command not found");
{
  const env = { PATH: "" };
  ok(!commandOnPath("anything", env, false), "empty PATH -> false");
}

console.log(`OK — ${pass} environment-doctor assertions passed`);
