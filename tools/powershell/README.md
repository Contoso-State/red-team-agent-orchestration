# Scoped read-only PowerShell helpers

Run preflight before inventory, with the same local engagement and session:

```powershell
./tools/powershell/Invoke-Preflight.ps1 -EngagementFile ./engagement.yaml -SessionPath ./engagements/example
./tools/powershell/Export-Inventory.ps1 -EngagementFile ./engagement.yaml -SessionPath ./engagements/example
```

Both scripts require exactly one explicit GUID subscription and tenant. They never
select or fall back to the Azure CLI default account. Optional `-Subscriptions` on
inventory must match that single target. Account state, tenant and subscription
must match before resource reads; malformed responses and native command failures
abort without a completion message.

`read-scope.mjs` supports the template's block maps/lists, plain and quoted scalars,
empty arrays/maps, and JSON documents. Unsupported YAML syntax, duplicate YAML
keys, narrowed resource-group/type selections, or nonempty exclusions fail closed.
Use domain agents with scope-aware queries for narrowed scopes; these helpers do
not silently widen scope. Inventory rejects foreign resource IDs and caps paging
at 50 pages, failing instead of publishing a truncated census.

Domain selections are preserved for specialist dispatch. Supported values are
`identity-posture`, `network-exposure`, `compute-platform`, `aks-container`,
`data-protection`, `web-exposure`, `ai-foundry`, `attack-surface`,
`logging-coverage`, `governance-posture`, and `devops-supplychain`. An omitted or
empty list uses the default read-only roster. Unknown domains and explicit
`email-security`, `external-vuln`, or `authorization-attack-path` selections fail
closed; this standalone collector cannot fulfill those lanes.

Preflight resolves caller claims using the explicitly scoped ARM token in memory.
It never writes the token. It verifies direct/inherited subscription-wide built-in
role IDs; built-in Owner and Contributor satisfy Reader/Security Reader ARM read
capabilities and produce a privileged-caller warning. Custom role names do not
prove equivalence. Group memberships, deny assignments, Graph access and data-plane
capabilities require separate live validation; a successful role preflight is not
proof that every specialist API is accessible. Missing required capabilities fail;
optional gaps remain in the local coverage artifact.

Tests use mocked PowerShell Azure commands and copied temporary toolkits. They
never authenticate to Azure or modify the repository's active-session marker:

```sh
node --test tools/powershell/scoped-scripts.test.mjs
```

PowerShell tests skip when `pwsh` is unavailable; parser validation still runs.
