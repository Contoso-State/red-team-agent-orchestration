# Azure Resource Graph Queries

Reusable Azure Resource Graph (ARG) queries for fast, cross-subscription enumeration. Run via the `azure-arm` MCP tool or `az graph query -q "<query>"`. Resource Graph gives a single consistent snapshot and avoids per-resource throttling — it is the preferred enumeration path for the Inventory & Scope and domain agents.

> Replace `<sub>` filters as needed, or scope with `--subscriptions` / `--management-groups`.

> ⚠️ **Pass KQL to `az graph query -q` as a SINGLE-LINE string.** The queries below
> are formatted multi-line for readability, but a multi-line / here-string argument
> can be **silently mangled** at the shell→CLI boundary — the `where` / `project` /
> `summarize` pipeline gets dropped and you get *unfiltered rows with blank columns
> and no error*. Before running, collapse newlines to spaces (e.g. pipe the `.kql`
> through `node tools/resource-graph/flatten-kql.mjs <file>`), or author the query
> on one line. Verify a query returns the columns you projected before trusting it.

## Inventory

### Full resource inventory
```kql
Resources
| project id, name, type, resourceGroup, subscriptionId, location, kind, tags
| order by type asc
```

### Resource counts by type
```kql
Resources
| summarize count() by type
| order by count_ desc
```

## Scope rollups (`summarize`)

Cheap, server-side rollups for the scope brief — each returns a handful of rows no matter how
large the estate. Feed their JSON output to `tools/resource-graph/scope-brief.mjs` (via
`--inventory`/`--exposure`) or read them directly to size a run before assessing.

### Count by resource group
```kql
Resources
| summarize count() by subscriptionId, resourceGroup
| order by count_ desc
```

### Count by region
```kql
Resources
| summarize count() by location
| order by count_ desc
```

### Count by subscription (with distinct type count)
```kql
Resources
| summarize resources = count(), types = dcount(type) by subscriptionId
| order by resources desc
```

### Potential internet-facing surface (by type)
```kql
Resources
| where type in~ (
    "microsoft.network/publicipaddresses","microsoft.network/applicationgateways",
    "microsoft.network/loadbalancers","microsoft.network/frontdoors","microsoft.cdn/profiles",
    "microsoft.apimanagement/service","microsoft.web/sites","microsoft.web/staticsites",
    "microsoft.app/containerapps","microsoft.containerservice/managedclusters",
    "microsoft.network/bastionhosts","microsoft.network/virtualnetworkgateways")
| summarize count() by type
| order by count_ desc
```

> Build the operator-facing brief with:
> `node tools/resource-graph/scope-brief.mjs --inventory engagements/<session>/inventory/resources.json`
> → writes `scope-brief.json` (machine) + `scope-brief.md` (human) with type/RG/region/exposure
> rollups and flags any type over the 1,000-row page limit.

## Network exposure

### NSG rules open to the internet on sensitive ports
```kql
Resources
| where type =~ "microsoft.network/networksecuritygroups"
| mv-expand rule = properties.securityRules
| extend r = rule.properties
| where r.access =~ "Allow" and r.direction =~ "Inbound"
| where r.sourceAddressPrefix in ("*", "0.0.0.0/0", "Internet")
| where r.destinationPortRange in ("22","3389","1433","3306","5432","445","*")
| project nsg = name, rule = rule.name, port = r.destinationPortRange,
          source = r.sourceAddressPrefix, resourceGroup, subscriptionId
```

### Public IP addresses and associations
```kql
Resources
| where type =~ "microsoft.network/publicipaddresses"
| extend assoc = tostring(properties.ipConfiguration.id)
| project name, ip = properties.ipAddress, assoc, resourceGroup, subscriptionId
```

### Subnets without an NSG
```kql
Resources
| where type =~ "microsoft.network/virtualnetworks"
| mv-expand subnet = properties.subnets
| extend nsg = tostring(subnet.properties.networkSecurityGroup.id)
| where isempty(nsg)
| project vnet = name, subnet = subnet.name, resourceGroup, subscriptionId
```

## Storage & data

### Storage accounts with public access
```kql
Resources
| where type =~ "microsoft.storage/storageaccounts"
| where properties.allowBlobPublicAccess == true
    or properties.publicNetworkAccess =~ "Enabled"
    or properties.networkAcls.defaultAction =~ "Allow"
| project name, allowBlobPublicAccess = properties.allowBlobPublicAccess,
          publicNetworkAccess = properties.publicNetworkAccess,
          defaultAction = properties.networkAcls.defaultAction,
          sharedKey = properties.allowSharedKeyAccess,
          resourceGroup, subscriptionId
```

### Key Vaults using access policies or public network
```kql
Resources
| where type =~ "microsoft.keyvault/vaults"
| project name,
          rbacEnabled = properties.enableRbacAuthorization,
          publicNetwork = properties.publicNetworkAccess,
          softDelete = properties.enableSoftDelete,
          purgeProtection = properties.enablePurgeProtection,
          resourceGroup, subscriptionId
| where rbacEnabled == false or publicNetwork =~ "Enabled"
      or purgeProtection != true
```

### SQL servers with public access
```kql
Resources
| where type =~ "microsoft.sql/servers"
| project name, publicNetworkAccess = properties.publicNetworkAccess,
          resourceGroup, subscriptionId
| where publicNetworkAccess =~ "Enabled"
```

## Authorization (RBAC graph)

> `AuthorizationResources` can hold more rows than `Resources` on a large tenant. **Page it**
> (`--first 1000 --skip`, with the `order by` shown) just like the inventory, resolve each
> distinct `principalId` **once** via batched Microsoft Graph `getByIds` into a principal
> cache, and join `roleDefinitionId → roleName` locally from the definitions census. Treat
> assignments as graph **edges**, not findings. See `knowledge/scaling.md` → *Identity / RBAC
> at scale*.

### All role assignments (paged)
```kql
AuthorizationResources
| where type =~ "microsoft.authorization/roleassignments"
| project id, principalId = properties.principalId,
          principalType = properties.principalType,
          roleDefId = properties.roleDefinitionId,
          scope = properties.scope
| order by principalId asc
```

### Privileged standing assignments (Owner / Contributor / UAA at sub or MG scope)
```kql
AuthorizationResources
| where type =~ "microsoft.authorization/roleassignments"
| extend roleDefId = tostring(properties.roleDefinitionId),
         scope = tostring(properties.scope)
| extend roleGuid = tolower(tostring(split(roleDefId, "/")[-1]))
| where roleGuid in (
    "8e3af657-a8ff-443c-a75c-2fe8c4bcb635",   // Owner
    "b24988ac-6180-42a0-ab88-20f7382dd24c",   // Contributor
    "18d7d88d-d35e-4fb5-a5c3-7773c20a72d9")   // User Access Administrator
| where scope !contains "/resourceGroups/"     // subscription- or MG-level only
| project principalId = properties.principalId,
          principalType = properties.principalType, roleGuid, scope
| order by principalId asc
```

### Custom role definitions (inspect for dangerous actions)
```kql
AuthorizationResources
| where type =~ "microsoft.authorization/roledefinitions"
| where properties.type =~ "CustomRole"
| project roleName = properties.roleName,
          actions = properties.permissions,
          assignableScopes = properties.assignableScopes
```

## Compute

### AKS clusters — exposure and identity posture
```kql
Resources
| where type =~ "microsoft.containerservice/managedclusters"
| project name,
          privateCluster = properties.apiServerAccessProfile.enablePrivateCluster,
          authorizedIPs = properties.apiServerAccessProfile.authorizedIPRanges,
          localAccounts = properties.disableLocalAccounts,
          networkPolicy = properties.networkProfile.networkPolicy,
          k8sVersion = properties.kubernetesVersion,
          resourceGroup, subscriptionId
```

### Resources missing diagnostic settings (pattern)
```kql
Resources
| where type in~ ("microsoft.keyvault/vaults","microsoft.sql/servers","microsoft.storage/storageaccounts","microsoft.network/networksecuritygroups")
| join kind=leftouter (
    insightsresources
    | where type =~ "microsoft.insights/diagnosticsettings"
    | project resourceId = tolower(tostring(properties.targetResourceId))
) on $left.id == $right.resourceId
| where isempty(resourceId)
| project name, type, resourceGroup, subscriptionId
```
