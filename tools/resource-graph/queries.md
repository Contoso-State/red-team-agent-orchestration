# Azure Resource Graph Queries

Reusable Azure Resource Graph (ARG) queries for fast, cross-subscription enumeration. Run via the `azure-arm` MCP tool or `az graph query -q "<query>"`. Resource Graph gives a single consistent snapshot and avoids per-resource throttling — it is the preferred enumeration path for the Inventory & Scope and domain agents.

> Replace `<sub>` filters as needed, or scope with `--subscriptions` / `--management-groups`.

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

### All role assignments
```kql
AuthorizationResources
| where type =~ "microsoft.authorization/roleassignments"
| project principalId = properties.principalId,
          principalType = properties.principalType,
          roleDefId = properties.roleDefinitionId,
          scope = properties.scope
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
