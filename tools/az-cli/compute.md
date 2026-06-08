# Compute — Az CLI Assessment Runner

Agent: `azure-redteam-compute` · Checks: `checks/compute/checks.yaml`

All commands read-only. Never exec into VMs/containers or use run-command.

## CHK-COMP-AKS-PUBLIC-API — AKS API server publicly reachable
```bash
az aks list \
  --query "[].{name:name,rg:resourceGroup,privateCluster:apiServerAccessProfile.enablePrivateCluster,authorizedRanges:apiServerAccessProfile.authorizedIpRanges}" -o json
# Flag: enablePrivateCluster != true AND no authorizedIpRanges.
```

## CHK-COMP-AKS-LOCAL-ADMIN — AKS local accounts enabled (no Entra RBAC)
```bash
az aks list \
  --query "[].{name:name,disableLocalAccounts:disableLocalAccounts,aadProfile:aadProfile}" -o json
# Flag: disableLocalAccounts != true or aadProfile.enableAzureRBAC != true.
```

## CHK-COMP-AKS-NO-NETPOL — AKS without network policy
```bash
az aks list \
  --query "[].{name:name,networkPolicy:networkProfile.networkPolicy}" -o json
# Flag: networkPolicy null/none.
```

## CHK-COMP-APPSVC-SECRETS-PLAINTEXT — Secrets in App Service settings
```bash
az webapp list --query "[].{name:name,rg:resourceGroup}" -o json
az webapp config appsettings list --name <app> -g <rg> \
  --query "[].name" -o json   # names only; flag secret-like keys not using Key Vault references
```

## CHK-COMP-APPSVC-NO-AUTH — App Service without authentication
```bash
az webapp auth show --name <app> -g <rg> -o json
# Flag: enabled != true on an app intended to be protected.
```

## CHK-COMP-APPSVC-FTP-DEBUG — FTP/remote debugging enabled
```bash
az webapp config show --name <app> -g <rg> \
  --query "{ftpsState:ftpsState,remoteDebugging:remoteDebuggingEnabled}" -o json
# Flag: ftpsState=='AllAllowed' or remoteDebuggingEnabled==true.
```

## CHK-COMP-VM-NO-DISK-ENCRYPTION — VM OS/data disk not encrypted
```bash
az vm list -o json
az vm encryption show --name <vm> -g <rg> -o json   # flag if not EncryptionAtRest/ADE enabled
```

## CHK-COMP-VM-PUBLIC-RUNCOMMAND — Internet-facing VM exposed to runCommand abuse
```bash
az vm list-ip-addresses -o json   # identify VMs with public IPs
az vm identity show --name <vm> -g <rg> -o json   # privileged MI on a public VM = pivot
# Cross-reference with rbac.md runCommand holders.
```

## CHK-COMP-ACR-ADMIN-USER — Container registry admin user enabled
```bash
az acr list --query "[].{name:name,adminUserEnabled:adminUserEnabled,publicNetworkAccess:publicNetworkAccess}" -o json
# Flag: adminUserEnabled==true.
```
