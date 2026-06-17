// Unit tests for the redteam-guardrails decision logic (allowlist / deny-by-default).
// Run: node .github/extensions/redteam-guardrails/guardrails-core.test.mjs
import assert from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { violation, evaluate, extractCommand } from "./guardrails-core.mjs";

let pass = 0;
const denied = (cmd) => { assert.ok(violation(cmd), `expected DENY: ${cmd}`); pass++; };
const allowed = (cmd) => { assert.strictEqual(violation(cmd), null, `expected ALLOW: ${cmd}`); pass++; };

// --- mutating az CLI -> deny ---
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
  "az account management-group create --name mg",
  "az ad app credential reset --id x",
  "az feature register --name f --namespace ns",
  "az storage blob upload -f ./x -c c -n n",
].forEach(denied);

// --- read-only az CLI -> allow ---
[
  "az account show",
  "az account set --subscription 00000000-0000-0000-0000-000000000000",
  "az account get-access-token",
  "az graph query -q \"Resources | project id\"",
  "az storage account list -o json",
  "az storage account keys list -n s -g rg",
  "az role assignment list --all",
  "az network nsg rule list --nsg-name n -g rg",
  "az keyvault show --name kv",
  "az rest --method GET --url https://graph.microsoft.com/v1.0/directoryRoles",
  "az rest --url https://graph.microsoft.com/v1.0/users",
  "az extension add --name resource-graph",
  "az vm list-ip-addresses",
  "az aks get-credentials -n c -g rg",
  "az version",
].forEach(allowed);

// --- mutating Azure PowerShell -> deny ---
[
  "New-AzVM -ResourceGroupName rg -Name v",
  "Set-AzStorageAccount -ResourceGroupName rg -Name s -AllowBlobPublicAccess $false",
  "Remove-AzKeyVault -VaultName kv",
  "Update-AzSqlServer -ResourceGroupName rg -ServerName s",
  "Invoke-AzVMRunCommand -ResourceGroupName rg -VMName v -CommandId RunShellScript",
  "Invoke-AzRestMethod -Method POST -Path /x",
  "Add-AzRoleAssignment -ObjectId x -RoleDefinitionName Owner",
  "Start-AzVM -ResourceGroupName rg -Name v",
].forEach(denied);

// --- read-only Azure PowerShell -> allow ---
[
  "Get-AzVM -ResourceGroupName rg",
  "Get-AzStorageAccount",
  "Find-AzResource -ResourceType Microsoft.Storage/storageAccounts",
  "Test-AzResourceGroupDeployment -ResourceGroupName rg",
  "Export-AzResourceGroup -ResourceGroupName rg -Path ./out.json",
  "Invoke-AzRestMethod -Method GET -Path /x",
  "Set-AzContext -Subscription 0000",
  "Select-AzSubscription -SubscriptionId 0000",
  "Connect-AzAccount",
].forEach(allowed);

// --- wrapper / indirection bypasses -> deny (via evaluate, default read-only mode) ---
const denyEval = (cmd) => {
  assert.strictEqual(evaluate(cmd, "/nonexistent").deny, true, `expected DENY (eval): ${cmd}`);
  pass++;
};
[
  "pwsh -Command \"az group delete -n rg --yes\"",
  "powershell -Command \"Remove-AzResourceGroup -Name rg\"",
  "bash -c \"az vm create -n v -g rg\"",
  "cmd /c az group delete -n rg",
  "Invoke-Expression \"Remove-AzKeyVault -VaultName kv\"",
  "iex \"az vm create -n v\"",
  "& az role assignment create --assignee x --role Owner",
  "Start-Process az -ArgumentList \"group delete -n rg\"",
  "az account show && az group delete -n rg",
].forEach(denyEval);

// -EncodedCommand (base64 utf16le of a mutating command) -> deny
const enc = Buffer.from("Remove-AzResourceGroup -Name rg", "utf16le").toString("base64");
denyEval(`powershell -EncodedCommand ${enc}`);

// --- non-Azure shell text must never trip the guard (false-positive guard) ---
[
  "git commit -m 'Add per-domain az CLI runners and create agents'",
  "New-Item -ItemType Directory -Path tools",
  "echo 'create delete update' > notes.txt",
  "python -c \"print('remove')\"",
  "Update-Module Az",
  "Import-Module Az.Accounts",
].forEach(allowed);

// --- hardening: az rest method/body parsing (all must DENY writes) ---
[
  "az rest --method=POST --url https://management.azure.com/x",
  "az rest -m POST --url https://management.azure.com/x",
  "az rest -mPOST --url https://management.azure.com/x",
  "az rest --method 'POST' --url https://management.azure.com/x",
  "az rest --method DELETE --uri https://management.azure.com/x",
  "az rest --uri https://management.azure.com/x --body @b.json",
  "az rest --uri https://management.azure.com/x --body=@b.json",
  "az rest --uri https://management.azure.com/x -b @b.json",
  "az rest --method $VAR --uri https://management.azure.com/x",
].forEach(denied);
[
  "az rest --method GET --url https://management.azure.com/x",
  "az rest --url https://graph.microsoft.com/v1.0/users",
  "az rest --method get --uri https://graph.microsoft.com/v1.0/domains",
].forEach(allowed);

// --- hardening: quoted / path / extension executable normalization -> deny ---
[
  "'az' group delete -n rg",
  "\"az\" vm create -n v -g rg",
  "az.exe group delete -n rg",
  "az.cmd group delete -n rg",
  "& 'Remove-AzVM' -Name v -ResourceGroupName rg",
  "& \"New-AzVM\" -Name v",
].forEach(denied);

// --- hardening: Invoke-AzRestMethod method abbreviation / separators -> deny ---
[
  "Invoke-AzRestMethod -Me POST -Path /x",
  "Invoke-AzRestMethod -M PUT -Path /x",
  "Invoke-AzRestMethod -Method:DELETE -Path /x",
  "Invoke-AzRestMethod -Method=PATCH -Path /x",
].forEach(denied);
[
  "Invoke-AzRestMethod -Method GET -Path /x",
  "Invoke-AzRestMethod -Path /x -MaximumRetryCount 3",
].forEach(allowed);

// --- hardening: execution-wrapper fast-forward -> deny the inner az write ---
[
  "env az group delete -n rg",
  "env -i FOO=bar az group delete -n rg",
  "timeout 30 az group delete -n rg",
  "timeout --foreground 30 az group delete -n rg",
  "nohup az group delete -n rg",
  "watch -n 5 az group delete -n rg",
].forEach(denied);
allowed("timeout 30 az group list"); // wrapper around a read stays allowed

// --- hardening: leading az global flags don't break read detection (FP guard) ---
[
  "az --verbose vm list",
  "az -o json account show",
  "az --query \"[].name\" vm list",
  "az --subscription 00000000-0000-0000-0000-000000000000 group show -n rg",
].forEach(allowed);
[
  "az --verbose vm delete -n v -g rg",
  "az -o json group delete -n rg",
  "az --frobnicate vm list", // unknown leading global -> fail closed -> deny
].forEach(denied);

// --- hardening: local CLI config mutation tightened ---
allowed("az config get defaults");
[
  "az config set extension.use_dynamic_install=yes_without_prompt",
  "az config unset defaults.group",
].forEach(denied);

// --- hardening: backtick command substitution unwrapped (via evaluate) ---
denyEval("echo `az group delete -n rg`");
denyEval("RESULT=`az role assignment create --assignee x --role Owner`");

// --- tool scoping: only command-execution tools are inspected ---
// File edit/create tools (args without a command field) must be ignored even if their content
// mentions mutating az commands (this was a real false-positive bug).
assert.strictEqual(
  extractCommand({ path: "x.md", file_text: "run `az group delete` then `az vm create`" }, "create"),
  "",
  "file-write tool args must not be treated as a command"
);
assert.strictEqual(evaluate({ path: "x.md", file_text: "az group delete -n rg" }, "/nonexistent", "create").deny,
  false, "create tool must never be denied");
assert.strictEqual(evaluate({ command: "az group delete -n rg" }, "/nonexistent", "execute").deny,
  true, "execute tool with command field must be inspected");
pass += 3;

// --- mode gating ---
assert.strictEqual(evaluate("az vm create -n v -g rg", "/nonexistent").deny, true,
  "default (no engagement.yaml) must DENY mutations");

const dir = mkdtempSync(join(tmpdir(), "guardrail-"));
writeFileSync(join(dir, "engagement.yaml"), "mode: controlled-validation\n");
const cv = evaluate("az vm create -n v -g rg", dir);
assert.strictEqual(cv.deny, false, "controlled-validation must not hard-deny");
assert.strictEqual(cv.ask, true, "controlled-validation must require approval (ask)");
pass += 2;

writeFileSync(join(dir, "engagement.yaml"), "mode: read-only-assessment\n");
assert.strictEqual(evaluate("az vm create -n v -g rg", dir).deny, true,
  "read-only-assessment must DENY mutations");
pass++;

// --- robustness: evaluate() must NEVER throw (the wiring fails CLOSED on a throw, but
// the contract is that pathological/adversarial input still returns a decision object). ---
const pathological = [
  "", "   ", "az", "az ", "az rest", "az rest --method", "az rest -m",
  "`".repeat(50), "az " + "(".repeat(200), "az group delete; ".repeat(100),
  "-EncodedCommand !!!notbase64!!!", "pwsh -Command '", "az --", "az --=",
  "Remove-Az", "Invoke-AzRestMethod -M", "az \"unterminated", "az group\u2028delete",
  "az rest --method $(echo POST)", "${IFS}az${IFS}vm${IFS}delete",
];
for (const cmd of pathological) {
  let d;
  assert.doesNotThrow(() => { d = evaluate({ command: cmd }, "/nonexistent", "execute"); },
    `evaluate must not throw on: ${JSON.stringify(cmd)}`);
  assert.strictEqual(typeof d.deny, "boolean", `decision.deny must be boolean for: ${JSON.stringify(cmd)}`);
  pass++;
}
assert.doesNotThrow(() => evaluate(undefined, undefined, undefined), "evaluate must tolerate undefined args");
assert.doesNotThrow(() => evaluate({}, "/nonexistent", "execute"), "evaluate must tolerate empty args");
pass += 2;

console.log(`OK — ${pass} guardrail assertions passed`);
