# Database — Az CLI Assessment Runner

Agent: `azure-redteam-data` · Checks: `checks/database/checks.yaml`

All commands read-only. Assess firewall/encryption/auth config — never read records.

## CHK-DB-SQL-ALLOW-AZURE-SERVICES — SQL firewall allows all Azure services
```bash
az sql server list --query "[].{name:name,rg:resourceGroup}" -o json
az sql server firewall-rule list --server <server> -g <rg> \
  --query "[?startIpAddress=='0.0.0.0' && endIpAddress=='0.0.0.0']" -o json
# The 0.0.0.0 rule = "Allow Azure services and resources to access this server".
```

## CHK-DB-SQL-PUBLIC-NETWORK — SQL public network access / broad firewall
```bash
az sql server show --name <server> -g <rg> \
  --query "{publicNetworkAccess:publicNetworkAccess}" -o json
az sql server firewall-rule list --server <server> -g <rg> \
  --query "[?startIpAddress=='0.0.0.0' && endIpAddress=='255.255.255.255']" -o json
```

## CHK-DB-SQL-NO-ENTRA-ADMIN — SQL without Entra (Azure AD) admin
```bash
az sql server ad-admin list --server <server> -g <rg> -o json
# Flag: empty (SQL auth only, no Entra-only authentication).
```

## CHK-DB-SQL-NO-TDE — Transparent Data Encryption disabled
```bash
az sql db list --server <server> -g <rg> --query "[].name" -o json
az sql db tde show --database <db> --server <server> -g <rg> -o json
# Flag: status != Enabled.
```

## CHK-DB-SQL-NO-AUDIT — SQL auditing disabled
```bash
az sql server audit-policy show --name <server> -g <rg> -o json
# Flag: state != Enabled.
```

## CHK-DB-COSMOS-PUBLIC-FIREWALL — Cosmos DB open firewall / public access
```bash
az cosmosdb list \
  --query "[].{name:name,rg:resourceGroup,publicNetworkAccess:publicNetworkAccess,ipRules:ipRules,vnetFilter:isVirtualNetworkFilterEnabled}" -o json
# Flag: publicNetworkAccess=='Enabled' with empty ipRules and no VNet filter.
```

## CHK-DB-FLEX-PUBLIC-ACCESS — PostgreSQL/MySQL Flexible Server public access
```bash
az postgres flexible-server list \
  --query "[].{name:name,network:network.publicNetworkAccess}" -o json
az mysql flexible-server list \
  --query "[].{name:name,network:network.publicNetworkAccess}" -o json
# Flag: publicNetworkAccess=='Enabled'. Also review firewall rules:
az postgres flexible-server firewall-rule list --name <server> -g <rg> \
  --query "[?startIpAddress=='0.0.0.0']" -o json
```

## CHK-DB-SQL-NO-DEFENDER-VA — Defender for SQL / vulnerability assessment off
```bash
# Per-server security alert policy (Microsoft Defender for SQL) — read-only:
az rest --method GET \
  --url "https://management.azure.com/subscriptions/<subId>/resourceGroups/<rg>/providers/Microsoft.Sql/servers/<server>/securityAlertPolicies/Default?api-version=2022-05-01-preview" -o json
# Recurring vulnerability assessment config — read-only:
az rest --method GET \
  --url "https://management.azure.com/subscriptions/<subId>/resourceGroups/<rg>/providers/Microsoft.Sql/servers/<server>/vulnerabilityAssessments/Default?api-version=2022-05-01-preview" -o json
# Flag: securityAlertPolicies state != 'Enabled', OR no vulnerabilityAssessments with
# recurringScans.isEnabled==true and a results store configured. (Subscription plan
# on/off is owned by logging: CHK-LOG-DEFENDER-DISABLED — do not re-flag it here.)
```
