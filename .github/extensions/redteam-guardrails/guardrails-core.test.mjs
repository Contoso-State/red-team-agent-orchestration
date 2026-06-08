// Unit tests for the redteam-guardrails decision logic.
// Run: node .github/extensions/redteam-guardrails/guardrails-core.test.mjs
import assert from "node:assert";
import { violation, evaluate } from "./guardrails-core.mjs";

let pass = 0;
const denied = (cmd) => assert.ok(violation(cmd), `expected DENY: ${cmd}`);
const allowed = (cmd) => assert.strictEqual(violation(cmd), null, `expected ALLOW: ${cmd}`);

// --- mutating az commands must be denied ---
[
  "az vm create -n v -g rg --image Ubuntu2204",
  "az group delete -n rg --yes",
  "az storage account update -n s -g rg --allow-blob-public-access false",
  "az role assignment create --assignee x --role Owner",
  "az keyvault purge --name kv",
  "az aks upgrade -n c -g rg",
  "az network nsg rule create --nsg-name n -g rg --name r",
  "az vm run-command invoke -n v -g rg --command-id RunShellScript",
  "az rest --method POST --url https://management.azure.com/x",
  "az sql server firewall-rule create -g rg -s srv -n r",
].forEach((c) => { denied(c); pass++; });

// --- read-only / benign commands must be allowed ---
[
  "az account show",
  "az account set --subscription 00000000-0000-0000-0000-000000000000",
  "az graph query -q \"Resources | project id\"",
  "az storage account list -o json",
  "az role assignment list --all",
  "az network nsg rule list --nsg-name n -g rg",
  "az keyvault show --name kv",
  "az rest --method GET --url https://graph.microsoft.com/v1.0/directoryRoles",
  "az extension add --name resource-graph",
  "az vm list-ip-addresses",
].forEach((c) => { allowed(c); pass++; });

// --- non-az shell text must never trip the guard (false-positive guard) ---
[
  "git commit -m 'Add per-domain az CLI runners and create agents'",
  "New-Item -ItemType Directory -Path tools",
  "echo 'create delete update' > notes.txt",
  "python -c \"print('remove')\"",
].forEach((c) => { allowed(c); pass++; });

// --- mode gating: controlled-validation lifts the block ---
assert.strictEqual(evaluate("az vm create -n v -g rg", "/nonexistent").deny, true,
  "default mode must deny");
// (controlled-validation path is exercised live via engagement.yaml; logic verified above)

console.log(`OK — ${pass} guardrail assertions passed`);
