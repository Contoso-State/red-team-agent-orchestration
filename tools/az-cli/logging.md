# Logging & Detection — Az CLI Assessment Runner

Agent: `azure-redteam-logging` · Checks: `checks/logging/checks.yaml`

All commands read-only. Document detection gaps — never disable or modify logging.

## CHK-LOG-DEFENDER-DISABLED — Defender for Cloud plans disabled
```bash
az security pricing list \
  --query "value[].{name:name,tier:pricingTier}" -o json
# Flag any plan (VirtualMachines, StorageAccounts, SqlServers, Containers, KeyVaults,
# AppServices) with pricingTier=='Free'.
```

## CHK-LOG-NO-DIAG-KEYVAULT — Key Vault without diagnostic settings
```bash
az keyvault list --query "[].id" -o json
az monitor diagnostic-settings list --resource <keyvaultId> -o json
# Flag: empty value[] (no diagnostic settings forwarding logs).
```

## CHK-LOG-NO-DIAG-CRITICAL — Critical resources without diagnostic settings
```bash
# For each high-value resource id (storage, sql, nsg, app gateway, etc.):
az monitor diagnostic-settings list --resource <resourceId> -o json
# Flag: no setting routing to a Log Analytics workspace / event hub / storage.
```

## CHK-LOG-NO-ACTIVITY-EXPORT — Activity Log not exported / retained
```bash
az monitor diagnostic-settings subscription list -o json
# Flag: no subscription-level setting exporting the Activity Log to a workspace.
```

## CHK-LOG-NO-NSG-FLOW — NSG flow logs disabled
```bash
az network watcher flow-log list --location <region> -o json
# Flag: NSGs in scope with no enabled flow log.
```

## CHK-LOG-NO-ALERT-ROLE-ASSIGN — No alerting on privileged role assignment
```bash
az monitor activity-log alert list \
  --query "[].{name:name,condition:condition}" -o json
# Flag: no alert on Microsoft.Authorization/roleAssignments/write.
```

## CHK-LOG-NO-SENTINEL-IDENTITY — No SIEM/Sentinel coverage for identity events
```bash
az monitor log-analytics workspace list \
  --query "[].{name:name,rg:resourceGroup,id:customerId}" -o json
# Flag: no workspace with Sentinel + identity data connectors (SigninLogs/AuditLogs).
# Sentinel onboarding is surfaced via the SecurityInsights solution on the workspace.
```
