// Regression checks for the single-subscription engagement contract.
// Run: node --test tools/preflight/engagement-scope.test.mjs
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

let pass = 0;
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); pass++; };
const ok = (v, msg) => { assert.ok(v, msg); pass++; };

const schema = JSON.parse(readFileSync(resolve(repoRoot, "schemas", "engagement.schema.json"), "utf8"));
const subs = schema?.properties?.scope?.properties?.subscriptions;

ok(!!subs, "scope.subscriptions exists in engagement schema");
eq(subs.type, "array", "scope.subscriptions is an array");
eq(subs.minItems, 1, "scope.subscriptions enforces at least one entry");
eq(subs.maxItems, 1, "scope.subscriptions enforces exactly one entry");
ok(Array.isArray(subs?.items?.required) && subs.items.required.includes("id"), "subscription item requires id");

const setupPrompt = readFileSync(resolve(repoRoot, ".github", "prompts", "setup.prompt.md"), "utf8");
ok(setupPrompt.includes("exactly one subscription"), "setup prompt requires exactly one subscription");
ok(!setupPrompt.includes("If they genuinely want multiple"), "setup prompt no longer allows multi-sub setup");

const reconPrompt = readFileSync(resolve(repoRoot, ".github", "prompts", "recon.prompt.md"), "utf8");
ok(/Hard stop:[\s\S]*exactly one/i.test(reconPrompt), "recon prompt contains single-sub hard stop");

console.log(`OK — ${pass} single-subscription contract assertions passed`);
